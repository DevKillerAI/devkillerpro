import { createHash } from "node:crypto";
import { database } from "./database";
import { missionContext, missionSignal } from "./jobs/cancellation";
import { connectionDiagnostic, pause, responseText, retryDelay } from "./openaiTransport";
import { selectTaskModel } from "./modelRouting";
import { missionModel } from './modelPolicy';
import { promptCacheFields } from "./promptCache";
import { providerWaitExpired } from './providerWaitPolicy';

const instructions = "DevKiller's interface language is English. Write operational summaries, QA findings, recovery plans, status explanations and diagnostic messages in English. Preserve original user content and product names. Generated application content may follow the user's explicitly requested language.";

export async function backgroundJson(args: { schemaName: string; schema: Record<string, unknown>; prompt: string }) {
  return backgroundAttempt(args, 0);
}
async function backgroundAttempt(args: { schemaName: string; schema: Record<string, unknown>; prompt: string }, attempt: number): Promise<{data:any;requestId:string;usage:any;model:string;reused:boolean}> {
  const context = missionContext();
  if (!context) throw new Error("Background generation requires a persisted mission context.");
  const key = process.env.OPENAI_API_KEY, model = await missionModel(context.missionId,args.schemaName);
  if (!key || !model) throw new Error("OPENAI_API_KEY and OPENAI_MODEL must be configured on the server.");
  const sql = database(), signal = missionSignal();
  signal?.throwIfAborted();
  const body = { model, background: true, store: true, instructions, input: args.prompt,
    text: { format: { type: "json_schema", name: args.schemaName, strict: true, schema: args.schema } } };
  const requestKey = createHash("sha256").update(context.operationKey + JSON.stringify(body) + (attempt ? ':queue-recovery-1' : '')).digest("hex");
  // Cache routing must not change request identity or duplicate in-flight generations.
  const requestBody = {...body,...promptCacheFields(model,args.schemaName,args.schema,instructions,process.env.DEVKILLER_PROMPT_CACHE !== 'disabled')};
  let [record] = await sql`select * from provider_requests where request_key=${requestKey}`;
  if (!record) {
    // The endpoint's mission lock serializes pipeline executions. Council calls
    // have different request hashes and may still run concurrently.
    const [{ count }] = await sql`select count(*)::int as count from provider_requests where operation_key=${context.operationKey}`;
    if (count >= 40) throw new Error("PROVIDER_BUDGET_EXHAUSTED: This operation reached its generation limit.");
    const created = await sql`insert into provider_requests(request_key,mission_id,operation_key,model,schema_name)
      values(${requestKey},${context.missionId},${context.operationKey},${model},${args.schemaName}) on conflict do nothing returning *`;
    record = created[0];
    if (!record) throw new Error("PROVIDER_REQUEST_BUSY: This request is already being submitted.");
  } else if (record.status === 'cancelled' && record.diagnostic?.queueRecovery === true && attempt === 0) {
    return backgroundAttempt(args, 1);
  } else if (record.result) {
    return { data: JSON.parse(responseText(record.result)), requestId: record.response_id, usage: record.result.usage, model, reused: true };
  } else if (!record.response_id) {
    throw new Error("PROVIDER_SUBMISSION_UNCERTAIN: A previous submission has no response ID. Automatic resubmission is blocked to avoid duplicate charges.");
  }
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Client-Request-Id": requestKey };
  if (!record.response_id) {
    try {
      // Do not automatically replay ambiguous POST failures. GET polling is safe
      // to retry; a lost creation response is not proof that creation failed.
      signal?.throwIfAborted();
      const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers, body: JSON.stringify(requestBody), signal: AbortSignal.timeout(60_000) });
      const payload = await response.json();
      if (!response.ok || !payload.id) {
        await sql`update provider_requests set status='rejected',diagnostic=${sql.json({status:response.status,code:payload.error?.code,requestId:response.headers.get("x-request-id")} as never)},updated_at=now() where request_key=${requestKey}`;
        throw new Error(`OPENAI_SUBMISSION_REJECTED: HTTP ${response.status}, ${payload.error?.code || "invalid_response"}.`);
      }
      // Save before doing anything else, including cancellation checks.
      await sql`update provider_requests set response_id=${payload.id},status=${payload.status},updated_at=now() where request_key=${requestKey}`;
      record.response_id = payload.id;
    } catch (error) {
      await sql`update provider_requests set diagnostic=${sql.json(connectionDiagnostic(error))},updated_at=now() where request_key=${requestKey}`;
      if(error instanceof Error && error.message.startsWith("OPENAI_SUBMISSION_REJECTED:")) throw error;
      throw new Error(`PROVIDER_SUBMISSION_UNCERTAIN: ${JSON.stringify(connectionDiagnostic(error))}`);
    }
  }
  const deadline = Date.now() + 20 * 60_000;
  let failures = 0;
  let lastHeartbeat = 0;
  try {
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      // Cancellation is scoped to this provider response, not other missions.
      await fetch(`https://api.openai.com/v1/responses/${record.response_id}/cancel`, { method: "POST", headers, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
      signal.throwIfAborted();
    }
    let response: Response;
    let payload: any;
    try {
      response = await fetch(`https://api.openai.com/v1/responses/${record.response_id}`, { headers, signal: AbortSignal.timeout(30_000) });
      payload = await response.json();
    } catch (error) {
      await sql`update provider_requests set diagnostic=${sql.json(connectionDiagnostic(error))},updated_at=now() where request_key=${requestKey}`;
      if (++failures >= 6) throw new Error(`PROVIDER_POLL_INTERRUPTED: Saved response ${record.response_id}; ${JSON.stringify(connectionDiagnostic(error))}`);
      await pause(retryDelay(failures, null), signal); continue;
    }
    if (!response.ok) {
      if ((response.status === 429 || response.status >= 500) && ++failures < 6) { await pause(retryDelay(failures, response.headers.get("retry-after")), signal); continue; }
      throw new Error(`OPENAI_POLL_FAILED: HTTP ${response.status}, response ${record.response_id}, request ${response.headers.get("x-request-id") || "unavailable"}.`);
    }
    failures = 0;
    // Record actual provider state, not only its initial acknowledgement.
    if (Date.now() - lastHeartbeat >= 10_000) {
      await sql`update provider_requests set status=${payload.status},updated_at=now() where request_key=${requestKey}`;
      lastHeartbeat = Date.now();
    }
    if (providerWaitExpired(args.schemaName,payload.status,record.created_at)) {
      // Only a confirmed cancellation of a queued response permits one replacement.
      // A completion racing cancellation is retained as a real result.
      let stopped: Response, final: any;
      try {
        stopped = await fetch(`https://api.openai.com/v1/responses/${record.response_id}/cancel`, {method:'POST',headers,signal:AbortSignal.timeout(10_000)});
        final = await stopped.json();
      } catch {
        throw new Error('PROVIDER_WAIT_LIMIT: Cancellation response unavailable; reconcile the saved response before any new submission.');
      }
      if (!stopped.ok || !['completed','cancelled','failed','incomplete'].includes(final.status)) {
        throw new Error('PROVIDER_WAIT_LIMIT: Cancellation could not be confirmed; saved response requires reconciliation. Do not resubmit.');
      }
      const queueRecovery = payload.status === 'queued' && final.status === 'cancelled' && attempt === 0;
      payload = final;
      await sql`update provider_requests set status=${final.status},result=${sql.json(final)},diagnostic=${sql.json({code:'PROVIDER_WAIT_LIMIT',queueRecovery,reason:'Provider exceeded the local wait budget; cancellation requested.'})},updated_at=now() where request_key=${requestKey}`;
      if (queueRecovery) {
        signal?.throwIfAborted();
        return await backgroundAttempt(args, 1);
      }
    }
    if (!["queued", "in_progress"].includes(payload.status)) {
      await sql`update provider_requests set status=${payload.status},result=${sql.json(payload)},updated_at=now() where request_key=${requestKey}`;
      // Persist locally first; then minimize remote retention. A failed cleanup
      // does not invalidate a saved generation and can be handled separately.
      await fetch(`https://api.openai.com/v1/responses/${record.response_id}`, {method:"DELETE",headers,signal:AbortSignal.timeout(10_000)}).catch(()=>undefined);
      return { data: JSON.parse(responseText(payload)), requestId: response.headers.get("x-request-id") || record.response_id, usage: payload.usage, model, reused: false };
    }
    await pause(2000, signal);
  }
  throw new Error(`PROVIDER_POLL_INTERRUPTED: Saved response ${record.response_id}; local polling deadline reached. Resume the same response.`);
  } finally {
    if(signal?.aborted && record.response_id) {
      await fetch(`https://api.openai.com/v1/responses/${record.response_id}/cancel`, {method:"POST",headers,signal:AbortSignal.timeout(10_000)}).catch(()=>undefined);
    }
  }
}
