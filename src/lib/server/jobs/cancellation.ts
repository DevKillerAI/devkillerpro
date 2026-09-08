import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { database, databaseConfigured } from "../database";
import { accessContext, accessError, enforceRateLimit, requireMissionOwner } from "../access";
import { terminalPipelineOutcome } from './pipelineOutcome';
import {isSameOriginRequest} from '../requestOrigin';

const context = new AsyncLocalStorage<{ signal: AbortSignal; missionId: string; operationKey: string; guard?: () => Promise<void> }>();
export function missionSignal() { return context.getStore()?.signal; }
export function missionContext() { return context.getStore(); }
export async function assertMissionActive(missionId: string) {
  missionSignal()?.throwIfAborted();
  await context.getStore()?.guard?.();
  if (!databaseConfigured()) return;
  const rows = await database()`select id from missions where id=${missionId} and status='cancelled'`;
  if (rows.length) throw new Error("Mission cancelled by user.");
}
export async function cancellableMission(req: Request, handler: (req: Request) => Promise<Response>) {
  if(!isSameOriginRequest(req)) return Response.json({error:'Origin not allowed.'},{status:403});
  const body = await req.clone().json().catch(() => ({}));
  const id = body.missionId;
  try { const access=await accessContext(req); await enforceRateLimit(access,`pipeline:${new URL(req.url).pathname}`,12,60); if(typeof id==="string") await requireMissionOwner(id,access); } catch(error) { const known=accessError(error); return Response.json({success:false,error:known?.error||"Access denied."},{status:known?.status||403}); }
  if (typeof id !== "string") return handler(req);
  if (!databaseConfigured()) return handler(req);
  // A dedicated connection owns the advisory lock until the handler finishes,
  // even if the HTTP client disconnects and retries from another worker.
  const connection = await database().reserve();
  const lockName = `pipeline:${id}`;
  let acquired = false;
  try {
    const [lock] = await connection`select pg_try_advisory_lock(hashtextextended(${lockName},0)) as acquired`;
    acquired = Boolean(lock.acquired);
    if (!acquired) return Response.json({success:false,code:"PIPELINE_BUSY",error:"This mission is already processing. Reconnect to its current execution."},{status:409});
    const [owner] = await connection`select pg_backend_pid() as pid`;
    const guard = async () => {
      const [current] = await connection`select pg_backend_pid() as pid`;
      if(current.pid !== owner.pid) throw new Error("Pipeline lock connection lost. Stop this execution.");
    };
    const worker = req.headers.get("x-devkiller-worker-token") === process.env.DEVKILLER_WORKER_TOKEN && Boolean(process.env.DEVKILLER_WORKER_TOKEN);
    const operationKey = createHash("sha256").update(JSON.stringify([id,new URL(req.url).pathname,body,worker ? req.headers.get("x-devkiller-job-id") || "worker" : randomUUID()])).digest("hex");
    const [cached] = await connection`select result from pipeline_results where operation_key=${operationKey}`;
    await assertMissionActive(id);
    if(cached) {
      const saved=cached.result;
      return saved?.pipelineOutcomeVersion===1
        ? Response.json(saved.payload,{status:saved.httpStatus})
        : Response.json(saved);
    }
  const controller = new AbortController();
  const check = async () => {
    try { await guard(); await assertMissionActive(id); } catch (error) { controller.abort(error); }
  };
  await check();
  const timer = setInterval(() => void check(), 1000);
  try {
    return await context.run({signal:controller.signal,missionId:id,operationKey,guard}, async () => {
      controller.signal.throwIfAborted();
      const result = await handler(req);
      const payload = await result.clone().json().catch(()=>null);
      await assertMissionActive(id);
      if(terminalPipelineOutcome(result.status,payload)) await connection`insert into pipeline_results(operation_key,mission_id,result) values(${operationKey},${id},${connection.json({pipelineOutcomeVersion:1,httpStatus:result.status,payload})}) on conflict do nothing`;
      return result;
    });
  } catch (error) {
    if (controller.signal.aborted) return Response.json({ success: false, cancelled: true, error: "Mission cancelled." }, { status: 409 });
    throw error;
  } finally { clearInterval(timer); }
  } finally {
    try { if(acquired) await connection`select pg_advisory_unlock(hashtextextended(${lockName},0))`; }
    finally { await connection.release(); }
  }
}
