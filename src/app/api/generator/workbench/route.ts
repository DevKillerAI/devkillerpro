import {NextResponse} from 'next/server';
import {z} from 'zod';
import {accessError,enforceRateLimit,requireGeneratorAccess} from '@/lib/server/access';
import {capabilityGapSchema,createWorkbenchContract,normalizeCapabilityGaps,workbenchRequestSchema,WORKBENCH_RUNTIME} from '@/lib/server/generator/workbenchContract';
import {createPilotRun,getPilotRun,listPilotRuns,getPilotEvents,getPilotSnapshots,cancelPilotRun,deletePilotProject} from '@/lib/server/generator/pilotStore';
import {PILOT_CAMPAIGN} from '@/lib/server/generator/pilotContract';
import {queueWorkbenchEdit,resumeWorkbenchCapabilityRun,workbenchEditSchema,workbenchWorkerAvailable} from '@/lib/server/generator/workbenchStore';
import {inspectWorkbenchRuntime} from '@/lib/server/generator/workbenchRuntime';
import {readPilotDelivery,exportPilotZip} from '@/lib/server/generator/pilotDelivery';
import {scopedId} from '@/lib/server/generator/contract';
import {assertSameOriginRequest} from '@/lib/server/requestOrigin';
import {deletePilotArtifacts} from '@/lib/server/generator/projectDeletion';
import {inspectWorkbenchDatabasePrerequisites} from '@/lib/server/generator/workbenchDatabase';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
const messages:Record<string,string>={PILOT_CAMPAIGN_BUSY:'Another operation is active. Open its progress before starting a new one.',PILOT_RUN_CONFLICT:'This request was already used for a different brief.',WORKBENCH_EDIT_STALE:'This version is no longer the edit base, or work is still pending. Refresh before applying your change.',WORKBENCH_EDIT_CONFLICT:'The edit request changed after submission. Refresh before trying again.',WORKBENCH_CAPABILITY_RESUME_NOT_ALLOWED:'This app is not waiting on a resumable capability decision.',PILOT_CALL_LIMIT:'This app reached its five-call test limit. No further request was sent.'};
function failure(e:unknown){const access=accessError(e);return NextResponse.json({error:access?.error||(e instanceof z.ZodError?'Invalid request. Check the brief and do not include secrets.':messages[e instanceof Error?e.message:'']||'The new generator is unavailable. No fallback to the old generator was started.')},{status:access?.status||(e instanceof z.ZodError?400:messages[e instanceof Error?e.message:'']?409:503),headers});}
async function body(req:Request){const reader=req.body?.getReader();if(!reader)throw new z.ZodError([]);const chunks:Uint8Array[]=[];let size=0;try{while(true){const c=await reader.read();if(c.done)break;size+=c.value.byteLength;if(size>128000){await reader.cancel();throw new z.ZodError([]);}chunks.push(c.value);}}finally{reader.releaseLock();}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new z.ZodError([]);}}
function origin(req:Request){assertSameOriginRequest(req);}
const deleted=(details:unknown)=>Boolean(details&&typeof details==='object'&&!Array.isArray(details)&&(details as Record<string,unknown>).deletedAt);
function presentRun<T extends {details:unknown}>(run:T):T{const details=run.details&&typeof run.details==='object'&&!Array.isArray(run.details)?run.details as Record<string,unknown>:null;if(!details||!Array.isArray(details.capabilityGaps))return run;try{const plan=details.capabilityPlan&&typeof details.capabilityPlan==='object'?details.capabilityPlan as {deferred?:unknown}:{};const planned=new Set(Array.isArray(plan.deferred)?plan.deferred.map(item=>String((item as {id?:unknown})?.id||'')):[]);const gaps=details.capabilityGaps.map(item=>capabilityGapSchema.parse(item)).filter(gap=>gap.id!=='payments.provider'||planned.has(gap.id));return {...run,details:{...details,capabilityGaps:normalizeCapabilityGaps(gaps)}};}catch{return run;}}
export async function GET(req:Request){try{
  const access=await requireGeneratorAccess(req),url=new URL(req.url),id=url.searchParams.get('run');
  if(!id){const [runs,environment,worker]=await Promise.all([listPilotRuns(access.userId,PILOT_CAMPAIGN),inspectWorkbenchRuntime(),workbenchWorkerAvailable()]);
    const campaignBudget=runs[0]?.campaignBudget||{spentMicros:0,reservedMicros:0,maxCostMicros:access.generatorBudgetMicros??1000000000};
    const budgetAvailable=access.generatorBudgetMicros===null||campaignBudget.spentMicros+campaignBudget.reservedMicros<campaignBudget.maxCostMicros;
    return NextResponse.json({ownerId:access.userId,runs:runs.filter(r=>r.contract.runtime.id===WORKBENCH_RUNTIME&&!deleted(r.details)),campaignBudget,ready:environment.available&&worker&&Boolean(process.env.OPENAI_API_KEY)&&budgetAvailable,reason:!budgetAvailable?'Your account has reached its AI creation budget. Existing apps and exports remain available.':!worker?'The generation worker is offline. No paid request can be started.':!environment.available?environment.reason:!process.env.OPENAI_API_KEY?'Server provider credentials are not configured.':null},{headers});}
  scopedId.parse(id);const run=await getPilotRun(id,access.userId);if(!run||run.contract.runtime.id!==WORKBENCH_RUNTIME||deleted(run.details))return NextResponse.json({error:'App not found.'},{status:404,headers});
  const [events,snapshots]=await Promise.all([getPilotEvents(id,access.userId),getPilotSnapshots(id,access.userId)]);
  const saved=snapshots.find(s=>s.candidate.revision===run.accepted?.revision&&s.candidate.sourceHash===run.accepted?.sourceHash);
  const delivery=saved&&run.accepted?await readPilotDelivery(saved.snapshot,run.accepted):null;
  if(url.searchParams.get('download')==='zip'){
    if(!delivery||!saved)return NextResponse.json({error:'No approved export exists.'},{status:409,headers});
    return new Response(new Uint8Array(await exportPilotZip(saved.snapshot,delivery)),{headers:{...headers,'Content-Type':'application/zip','Content-Disposition':'attachment; filename="devkiller-app.zip"','X-Content-Type-Options':'nosniff'}});
  }
  return NextResponse.json({run:presentRun(run),events,snapshots,delivery},{headers});
}catch(e){return failure(e);}}
export async function POST(req:Request){try{
  origin(req);const access=await requireGeneratorAccess(req);await enforceRateLimit(access,'generator:workbench:create',8,60);
  const request=workbenchRequestSchema.parse(await body(req)),contract=createWorkbenchContract(access.userId,request,{managedImageAi:access.managedAiEnabled});
  if(!await getPilotRun(contract.identity.missionId,access.userId)){
    const env=await inspectWorkbenchRuntime();if(!env.available||!process.env.OPENAI_API_KEY||!await workbenchWorkerAvailable())return NextResponse.json({error:'The environment or worker is offline. No paid request was started.'},{status:503,headers});
    if(contract.capabilities.includes('database.postgres')){const database=await inspectWorkbenchDatabasePrerequisites();if(!database.available)return NextResponse.json({error:database.reason},{status:503,headers});}
  }
  return NextResponse.json({run:await createPilotRun(contract,PILOT_CAMPAIGN,access.generatorBudgetMicros??1000000000)},{status:202,headers});
}catch(e){return failure(e);}}
export async function PATCH(req:Request){try{
  origin(req);const access=await requireGeneratorAccess(req);await enforceRateLimit(access,'generator:workbench:edit',10,60);
  const input=await body(req);
  if(input?.action==='cancel'){
    const cancel=z.object({action:z.literal('cancel'),runId:scopedId}).strict().parse(input),run=await getPilotRun(cancel.runId,access.userId);
    if(!run||run.contract.runtime.id!==WORKBENCH_RUNTIME)return NextResponse.json({error:'App not found.'},{status:404,headers});
    return NextResponse.json({run:await cancelPilotRun(cancel.runId,access.userId)},{headers});
  }
  if(input?.action==='delete'){
    const deletion=z.object({action:z.literal('delete'),runId:scopedId,deleteGeneratedFiles:z.boolean()}).strict().parse(input),run=await getPilotRun(deletion.runId,access.userId);
    if(!run||run.contract.runtime.id!==WORKBENCH_RUNTIME||deleted(run.details))return NextResponse.json({error:'App not found.'},{status:404,headers});
    if(!['ready','failed','cancelled'].includes(run.status))return NextResponse.json({error:'Stop the active operation before deleting this project.'},{status:409,headers});
    if(deletion.deleteGeneratedFiles)await deletePilotArtifacts(run.identity);
    await deletePilotProject(run.runId,access.userId,deletion.deleteGeneratedFiles);
    return NextResponse.json({deleted:true,generatedFilesDeleted:deletion.deleteGeneratedFiles},{headers});
  }
  if(input?.action==='resume-capabilities'){
    const resume=z.object({action:z.literal('resume-capabilities'),runId:scopedId}).strict().parse(input);
    if(!await workbenchWorkerAvailable())return NextResponse.json({error:'The generation worker is offline. No paid request was started.'},{status:503,headers});
    await resumeWorkbenchCapabilityRun(access.userId,resume.runId);
    return NextResponse.json({run:await getPilotRun(resume.runId,access.userId)},{status:202,headers});
  }
  const edit=workbenchEditSchema.parse(input);
  if(!await workbenchWorkerAvailable())return NextResponse.json({error:'The generation worker is offline. Your current app is unchanged.'},{status:503,headers});
  await queueWorkbenchEdit(access.userId,edit);return NextResponse.json({run:await getPilotRun(edit.runId,access.userId)},{status:202,headers});
}catch(e){return failure(e);}}
