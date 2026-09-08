import { createHash } from 'node:crypto';
import { z } from 'zod';
import { database } from '../database';
import { WORKBENCH_PROTOCOL_VERSION, WORKBENCH_RUNTIME, assertWorkbenchContract } from './workbenchContract';
import { scopedId, digest } from './contract';

export const workbenchEditSchema=z.object({runId:scopedId,requestId:z.string().uuid(),baseHash:digest,prompt:z.string().trim().min(5).max(1800),scope:z.enum(['style','app'])}).strict()
  .refine(v => !/sk-[a-zA-Z0-9_-]{16,}|-----BEGIN .*PRIVATE KEY-----/.test(v.prompt), 'Do not put API keys or secrets in an edit request.');
export type WorkbenchEdit=z.infer<typeof workbenchEditSchema>;
export async function queueWorkbenchEdit(ownerId:string,input:WorkbenchEdit) {
  const edit=workbenchEditSchema.parse(input), sql=database();
  const requestHash=createHash('sha256').update(JSON.stringify(edit)).digest('hex');
  return sql.begin(async tx=>{
    const [reference]=await tx`select campaign_id from dk_generator_v2.runs where owner_id=${ownerId} and id=${edit.runId}`;
    if(!reference)throw new Error('WORKBENCH_NOT_FOUND');
    await tx`select campaign_id from dk_generator_v2.campaigns where owner_id=${ownerId} and campaign_id=${reference.campaign_id} for update`;
    const [row]=await tx`select * from dk_generator_v2.runs where owner_id=${ownerId} and id=${edit.runId} for update`;
    assertWorkbenchContract(row.contract);
    const prior=await tx`select details from dk_generator_v2.events where owner_id=${ownerId} and run_id=${edit.runId} and type='edit.requested' and details->>'requestId'=${edit.requestId}`;
    if(prior.length){if(prior[0].details.requestHash!==requestHash)throw new Error('WORKBENCH_EDIT_CONFLICT');return;}
    if(!['ready','failed'].includes(row.status)||!row.accepted||row.accepted.sourceHash!==edit.baseHash||Number(row.reserved_micros)!==0)throw new Error('WORKBENCH_EDIT_STALE');
    if(Number(row.call_count)>=Number(row.max_provider_calls))throw new Error('PILOT_CALL_LIMIT');
    const active=await tx`select id from dk_generator_v2.runs where owner_id=${ownerId} and campaign_id=${row.campaign_id} and status not in ('ready','failed','cancelled') and id<>${edit.runId}`;
    if(active.length)throw new Error('PILOT_CAMPAIGN_BUSY');
    const operation={...edit,requestHash,operationId:`edit-${edit.requestId}`};
    const priorDetails=row.details&&typeof row.details==='object'&&!Array.isArray(row.details)?row.details:{};
    const [updated]=await tx`update dk_generator_v2.runs set status='queued',worker_id=null,lease_until=null,fence=fence+1,sequence=sequence+1,
      details=${tx.json({...priorDetails,workbenchOperation:operation})}::jsonb,updated_at=clock_timestamp() where owner_id=${ownerId} and id=${edit.runId} returning sequence`;
    await tx`insert into dk_generator_v2.events(owner_id,run_id,sequence,type,message,details) values(${ownerId},${edit.runId},${updated.sequence},'edit.requested','Your change is queued. The last approved app remains available.',${tx.json(operation)}::jsonb)`;
  });
}

/** Explicitly retries only a capability negotiation; source/build failures use their own bounded recovery path. */
export async function resumeWorkbenchCapabilityRun(ownerId:string,runId:string) {
  scopedId.parse(ownerId);scopedId.parse(runId);const sql=database();
  return sql.begin(async tx=>{
    const [reference]=await tx`select campaign_id from dk_generator_v2.runs where owner_id=${ownerId} and id=${runId}`;
    if(!reference)throw new Error('WORKBENCH_NOT_FOUND');
    await tx`select campaign_id from dk_generator_v2.campaigns where owner_id=${ownerId} and campaign_id=${reference.campaign_id} for update`;
    const [row]=await tx`select * from dk_generator_v2.runs where owner_id=${ownerId} and id=${runId} for update`;
    assertWorkbenchContract(row.contract);
    const details=row.details&&typeof row.details==='object'&&!Array.isArray(row.details)?row.details:{};
    if(!['failed','awaiting_input'].includes(row.status)||row.accepted||Number(row.reserved_micros)!==0
      ||!['capability-unavailable','capability-required'].includes(String(details.reason))
      ||Number(row.call_count)>=Number(row.max_provider_calls))throw new Error('WORKBENCH_CAPABILITY_RESUME_NOT_ALLOWED');
    const active=await tx`select id from dk_generator_v2.runs where owner_id=${ownerId} and campaign_id=${row.campaign_id} and id<>${runId} and status not in ('ready','failed','cancelled') limit 1`;
    if(active.length)throw new Error('PILOT_CAMPAIGN_BUSY');
    const nextDetails={...details,capabilityResume:true,resumeAttempt:Number(details.resumeAttempt||0)+1};
    const [updated]=await tx`update dk_generator_v2.runs set status='queued',worker_id=null,lease_until=null,fence=fence+1,sequence=sequence+1,
      details=${tx.json(nextDetails)}::jsonb,updated_at=clock_timestamp() where owner_id=${ownerId} and id=${runId} returning sequence`;
    await tx`insert into dk_generator_v2.events(owner_id,run_id,sequence,type,message,details) values(${ownerId},${runId},${updated.sequence},'capability.resume','Continue with a safe fallback. The original brief and prior provider record are preserved.',${tx.json(nextDetails)}::jsonb)`;
  });
}

/** One-shot local replay after the parser/harness was corrected; it cannot authorize a new provider operation. */
export async function resumeWorkbenchRecordedBuild(ownerId:string,runId:string) {
  scopedId.parse(ownerId);scopedId.parse(runId);const sql=database();
  return sql.begin(async tx=>{
    const [reference]=await tx`select campaign_id from dk_generator_v2.runs where owner_id=${ownerId} and id=${runId}`;
    if(!reference)throw new Error('WORKBENCH_NOT_FOUND');
    await tx`select campaign_id from dk_generator_v2.campaigns where owner_id=${ownerId} and campaign_id=${reference.campaign_id} for update`;
    const [row]=await tx`select * from dk_generator_v2.runs where owner_id=${ownerId} and id=${runId} for update`;
    assertWorkbenchContract(row.contract);
    const details=row.details&&typeof row.details==='object'&&!Array.isArray(row.details)?row.details:{};
    const calls=await tx`select operation_id,status,result from dk_generator_v2.calls where owner_id=${ownerId} and run_id=${runId} order by created_at desc`;
    const recorded=calls[0];
    const recordedParserFailure=String(details.error||'').includes('Every journey needs an observed result')||String(details.error||'')==='PILOT_OPERATION_CONFLICT';
    if(row.status!=='failed'||row.accepted||Number(row.reserved_micros)!==0||!recordedParserFailure
      ||!recorded||recorded.status!=='completed'||!recorded.result||!/^build-[1-5]$/.test(recorded.operation_id))throw new Error('WORKBENCH_RECORDED_RECOVERY_NOT_ALLOWED');
    const active=await tx`select id from dk_generator_v2.runs where owner_id=${ownerId} and campaign_id=${row.campaign_id} and id<>${runId} and status not in ('ready','failed','cancelled') limit 1`;
    if(active.length)throw new Error('PILOT_CAMPAIGN_BUSY');
    const nextDetails={recordedReplayOnly:true,recordedBuildOperation:recorded.operation_id,recoveryReason:'Discard only invalid optional journeys; replay the settled source without another provider request.'};
    const [updated]=await tx`update dk_generator_v2.runs set status='queued',worker_id=null,lease_until=null,fence=fence+1,sequence=sequence+1,
      details=${tx.json(nextDetails)}::jsonb,updated_at=clock_timestamp() where owner_id=${ownerId} and id=${runId} returning sequence`;
    await tx`insert into dk_generator_v2.events(owner_id,run_id,sequence,type,message,details) values(${ownerId},${runId},${updated.sequence},'recovery.recorded','Rechecking the settled generated source with the corrected journey parser. No new provider call is authorized.',${tx.json(nextDetails)}::jsonb)`;
  });
}
export async function workbenchWorkerHeartbeat(workerId:string) {
  await database()`insert into dk_generator_v2.workers(id,seen_at) values(${workerId},clock_timestamp()) on conflict(id) do update set seen_at=excluded.seen_at`;
}
export async function workbenchWorkerAvailable() {
  const compatiblePrefix=`v2-worker-${WORKBENCH_PROTOCOL_VERSION}-%`;
  const [row]=await database()`select exists(select 1 from dk_generator_v2.workers where id like ${compatiblePrefix} and seen_at>clock_timestamp()-interval '45 seconds') as available`;
  return Boolean(row.available);
}

/** Requeues a zero-cost preflight mismatch after the compatible worker version is online. */
export async function resumeWorkbenchPreflightRun(ownerId:string,runId:string){
  scopedId.parse(ownerId);scopedId.parse(runId);const sql=database();
  return sql.begin(async tx=>{
    const [reference]=await tx`select campaign_id from dk_generator_v2.runs where owner_id=${ownerId} and id=${runId}`;if(!reference)throw new Error('WORKBENCH_NOT_FOUND');
    await tx`select campaign_id from dk_generator_v2.campaigns where owner_id=${ownerId} and campaign_id=${reference.campaign_id} for update`;
    const [row]=await tx`select * from dk_generator_v2.runs where owner_id=${ownerId} and id=${runId} for update`;assertWorkbenchContract(row.contract);
    if(row.status!=='failed'||row.accepted||Number(row.call_count)!==0||Number(row.spent_micros)!==0||Number(row.reserved_micros)!==0||String(row.details?.error)!=='Workbench contract mismatch.')throw new Error('WORKBENCH_PREFLIGHT_RECOVERY_NOT_ALLOWED');
    const active=await tx`select id from dk_generator_v2.runs where owner_id=${ownerId} and campaign_id=${row.campaign_id} and id<>${runId} and status not in ('ready','failed','cancelled') limit 1`;if(active.length)throw new Error('PILOT_CAMPAIGN_BUSY');
    const details={preflightRecovery:true,recoveryReason:'Compatible worker loaded after a zero-cost contract-version mismatch.'};
    const [updated]=await tx`update dk_generator_v2.runs set status='queued',worker_id=null,lease_until=null,fence=fence+1,sequence=sequence+1,details=${tx.json(details)}::jsonb,updated_at=clock_timestamp() where owner_id=${ownerId} and id=${runId} returning sequence`;
    await tx`insert into dk_generator_v2.events(owner_id,run_id,sequence,type,message,details) values(${ownerId},${runId},${updated.sequence},'recovery.preflight','Compatible worker loaded. Restarting before any provider call; no earlier API cost exists.',${tx.json(details)}::jsonb)`;
  });
}

/** Replays settled build/repair calls when only an impossible model-authored control assertion blocked delivery. */
export async function resumeWorkbenchRecordedJourneyRun(ownerId:string,runId:string){
  scopedId.parse(ownerId);scopedId.parse(runId);const sql=database();
  return sql.begin(async tx=>{
    const [reference]=await tx`select campaign_id from dk_generator_v2.runs where owner_id=${ownerId} and id=${runId}`;if(!reference)throw new Error('WORKBENCH_NOT_FOUND');
    await tx`select campaign_id from dk_generator_v2.campaigns where owner_id=${ownerId} and campaign_id=${reference.campaign_id} for update`;
    const [row]=await tx`select * from dk_generator_v2.runs where owner_id=${ownerId} and id=${runId} for update`;assertWorkbenchContract(row.contract);
    const calls=await tx`select operation_id,status,actual_micros,result from dk_generator_v2.calls where owner_id=${ownerId} and run_id=${runId}`;
    const build=calls.find(call=>call.operation_id==='build-1'),repair=calls.find(call=>call.operation_id==='repair-1');
    if(row.status!=='failed'||row.accepted||Number(row.reserved_micros)!==0||!String(row.details?.error||'').includes('Expected visible text or control value')
      ||!build?.result||build.status!=='completed'||build.actual_micros===null||!repair?.result||repair.status!=='completed'||repair.actual_micros===null)throw new Error('WORKBENCH_JOURNEY_RECOVERY_NOT_ALLOWED');
    const active=await tx`select id from dk_generator_v2.runs where owner_id=${ownerId} and campaign_id=${row.campaign_id} and id<>${runId} and status not in ('ready','failed','cancelled') limit 1`;if(active.length)throw new Error('PILOT_CAMPAIGN_BUSY');
    const details={recordedReplayOnly:true,recordedBuildOperation:'build-1',recoveryReason:'Discard an impossible empty-control value assertion and replay the already-settled build and repair. No provider call is authorized.'};
    const [updated]=await tx`update dk_generator_v2.runs set status='queued',worker_id=null,lease_until=null,fence=fence+1,sequence=sequence+1,details=${tx.json(details)}::jsonb,updated_at=clock_timestamp() where owner_id=${ownerId} and id=${runId} returning sequence`;
    await tx`insert into dk_generator_v2.events(owner_id,run_id,sequence,type,message,details) values(${ownerId},${runId},${updated.sequence},'recovery.journey','Removing an invalid test assertion and replaying settled output. No new provider request is authorized.',${tx.json(details)}::jsonb)`;
  });
}

/**
 * Requeues the exact preserved candidate only when its recorded compiler failure
 * matches a platform-owned deterministic repair. No provider operation is
 * authorised and the existing spend/call history remains immutable.
 */
export async function resumeWorkbenchCompilerRepair(ownerId:string,runId:string){
  scopedId.parse(ownerId);scopedId.parse(runId);const sql=database();
  return sql.begin(async tx=>{
    const [reference]=await tx`select campaign_id from dk_generator_v2.runs where owner_id=${ownerId} and id=${runId}`;if(!reference)throw new Error('WORKBENCH_NOT_FOUND');
    await tx`select campaign_id from dk_generator_v2.campaigns where owner_id=${ownerId} and campaign_id=${reference.campaign_id} for update`;
    const [row]=await tx`select * from dk_generator_v2.runs where owner_id=${ownerId} and id=${runId} for update`;assertWorkbenchContract(row.contract);
    const error=String(row.details?.error||'');
    const candidate=row.candidate&&typeof row.candidate==='object'&&!Array.isArray(row.candidate)?row.candidate:null;
    const unsettled=await tx`select operation_id from dk_generator_v2.calls where owner_id=${ownerId} and run_id=${runId} and (status not in ('completed','failed') or actual_micros is null) limit 1`;
    const [source]=candidate?await tx`select revision,source_hash from dk_generator_v2.snapshots where owner_id=${ownerId} and run_id=${runId} and revision=${String(candidate.revision)} and source_hash=${String(candidate.sourceHash)}`:[];
    if(row.status!=='failed'||row.accepted||Number(row.reserved_micros)!==0||unsettled.length||!source
      ||!error.includes('Expected ")" but found "=>"'))throw new Error('WORKBENCH_COMPILER_RECOVERY_NOT_ALLOWED');
    const active=await tx`select id from dk_generator_v2.runs where owner_id=${ownerId} and campaign_id=${row.campaign_id} and id<>${runId} and status not in ('ready','failed','cancelled') limit 1`;if(active.length)throw new Error('PILOT_CAMPAIGN_BUSY');
    const prior=row.details&&typeof row.details==='object'&&!Array.isArray(row.details)?row.details:{};
    const deterministicCompilerRecovery={baseRevision:String(source.revision),baseHash:String(source.source_hash)};
    const details={...prior,deterministicCompilerRecovery,recoveryReason:'Apply only bounded compiler-guided repairs to the exact preserved candidate. No provider call is authorized.'};
    const [updated]=await tx`update dk_generator_v2.runs set status='queued',worker_id=null,lease_until=null,fence=fence+1,sequence=sequence+1,details=${tx.json(details)}::jsonb,updated_at=clock_timestamp() where owner_id=${ownerId} and id=${runId} returning sequence`;
    await tx`insert into dk_generator_v2.events(owner_id,run_id,sequence,type,message,details) values(${ownerId},${runId},${updated.sequence},'recovery.compiler','Applying a bounded local compiler correction to the preserved candidate. No new AI request will be made.',${tx.json(deterministicCompilerRecovery)}::jsonb)`;
  });
}

/** Rechecks a preserved candidate after a structurally redundant model-authored journey step was removed. */
export async function resumeWorkbenchJourneyNormalization(ownerId:string,runId:string){
  scopedId.parse(ownerId);scopedId.parse(runId);const sql=database();
  return sql.begin(async tx=>{
    const [reference]=await tx`select campaign_id from dk_generator_v2.runs where owner_id=${ownerId} and id=${runId}`;if(!reference)throw new Error('WORKBENCH_NOT_FOUND');
    await tx`select campaign_id from dk_generator_v2.campaigns where owner_id=${ownerId} and campaign_id=${reference.campaign_id} for update`;
    const [row]=await tx`select * from dk_generator_v2.runs where owner_id=${ownerId} and id=${runId} for update`;assertWorkbenchContract(row.contract);
    const error=String(row.details?.error||''),candidate=row.candidate&&typeof row.candidate==='object'&&!Array.isArray(row.candidate)?row.candidate:null;
    const unsettled=await tx`select operation_id from dk_generator_v2.calls where owner_id=${ownerId} and run_id=${runId} and (status not in ('completed','failed') or actual_micros is null) limit 1`;
    const [source]=candidate?await tx`select revision,source_hash from dk_generator_v2.snapshots where owner_id=${ownerId} and run_id=${runId} and revision=${String(candidate.revision)} and source_hash=${String(candidate.sourceHash)}`:[];
    if(row.status!=='failed'||row.accepted||Number(row.reserved_micros)!==0||unsettled.length||!source
      ||!error.includes('locator.click: Timeout')||!error.includes('intercepts pointer events'))throw new Error('WORKBENCH_JOURNEY_NORMALIZATION_NOT_ALLOWED');
    const active=await tx`select id from dk_generator_v2.runs where owner_id=${ownerId} and campaign_id=${row.campaign_id} and id<>${runId} and status not in ('ready','failed','cancelled') limit 1`;if(active.length)throw new Error('PILOT_CAMPAIGN_BUSY');
    const prior=row.details&&typeof row.details==='object'&&!Array.isArray(row.details)?row.details:{};
    const deterministicJourneyRecovery={baseRevision:String(source.revision),baseHash:String(source.source_hash)};
    const details={...prior,deterministicCompilerRecovery:undefined,deterministicJourneyRecovery,recoveryReason:'Recheck the exact candidate after removing one structurally redundant opener action. No provider call is authorized.'};
    const [updated]=await tx`update dk_generator_v2.runs set status='queued',worker_id=null,lease_until=null,fence=fence+1,sequence=sequence+1,details=${tx.json(details)}::jsonb,updated_at=clock_timestamp() where owner_id=${ownerId} and id=${runId} returning sequence`;
    await tx`insert into dk_generator_v2.events(owner_id,run_id,sequence,type,message,details) values(${ownerId},${runId},${updated.sequence},'recovery.journey-normalized','Rechecking the preserved app with a corrected observable journey. No new AI request will be made.',${tx.json(deterministicJourneyRecovery)}::jsonb)`;
  });
}

/** Requeues the exact candidate for one of the reviewed local source-repair rules. */
export async function resumeWorkbenchLocalRepair(ownerId:string,runId:string){
  scopedId.parse(ownerId);scopedId.parse(runId);const sql=database();
  return sql.begin(async tx=>{
    const [reference]=await tx`select campaign_id from dk_generator_v2.runs where owner_id=${ownerId} and id=${runId}`;if(!reference)throw new Error('WORKBENCH_NOT_FOUND');
    await tx`select campaign_id from dk_generator_v2.campaigns where owner_id=${ownerId} and campaign_id=${reference.campaign_id} for update`;
    const [row]=await tx`select * from dk_generator_v2.runs where owner_id=${ownerId} and id=${runId} for update`;assertWorkbenchContract(row.contract);
    const error=String(row.details?.error||''),candidate=row.candidate&&typeof row.candidate==='object'&&!Array.isArray(row.candidate)?row.candidate:null;
    const known=error.includes('Expected ")" but found "=>"')||(error.includes('locator.click: Timeout')&&error.includes('element is not visible'))||error.includes('Horizontal overflow after interaction.');
    const unsettled=await tx`select operation_id from dk_generator_v2.calls where owner_id=${ownerId} and run_id=${runId} and (status not in ('completed','failed') or actual_micros is null) limit 1`;
    const [source]=candidate?await tx`select revision,source_hash from dk_generator_v2.snapshots where owner_id=${ownerId} and run_id=${runId} and revision=${String(candidate.revision)} and source_hash=${String(candidate.sourceHash)}`:[];
    if(row.status!=='failed'||row.accepted||Number(row.reserved_micros)!==0||unsettled.length||!source||!known)throw new Error('WORKBENCH_LOCAL_RECOVERY_NOT_ALLOWED');
    const active=await tx`select id from dk_generator_v2.runs where owner_id=${ownerId} and campaign_id=${row.campaign_id} and id<>${runId} and status not in ('ready','failed','cancelled') limit 1`;if(active.length)throw new Error('PILOT_CAMPAIGN_BUSY');
    const prior=row.details&&typeof row.details==='object'&&!Array.isArray(row.details)?row.details:{};
    const deterministicLocalRecovery={baseRevision:String(source.revision),baseHash:String(source.source_hash)};
    const details={...prior,deterministicCompilerRecovery:undefined,deterministicJourneyRecovery:undefined,deterministicLocalRecovery,recoveryReason:'Apply only a reviewed compiler or responsive source correction to the exact candidate. No provider call is authorized.'};
    const [updated]=await tx`update dk_generator_v2.runs set status='queued',worker_id=null,lease_until=null,fence=fence+1,sequence=sequence+1,details=${tx.json(details)}::jsonb,updated_at=clock_timestamp() where owner_id=${ownerId} and id=${runId} returning sequence`;
    await tx`insert into dk_generator_v2.events(owner_id,run_id,sequence,type,message,details) values(${ownerId},${runId},${updated.sequence},'recovery.local','Applying a reviewed local correction to the preserved candidate. No new AI request will be made.',${tx.json(deterministicLocalRecovery)}::jsonb)`;
  });
}

/**
 * Reopens a run that passed the generic browser suite but was stopped because
 * capability-specific evidence was absent. Exactly one focused provider patch
 * is allowed; existing source and cost history remain immutable.
 */
export async function resumeWorkbenchCapabilityVerification(ownerId:string,runId:string){
  scopedId.parse(ownerId);scopedId.parse(runId);const sql=database();
  return sql.begin(async tx=>{
    const [reference]=await tx`select campaign_id from dk_generator_v2.runs where owner_id=${ownerId} and id=${runId}`;if(!reference)throw new Error('WORKBENCH_NOT_FOUND');
    await tx`select campaign_id from dk_generator_v2.campaigns where owner_id=${ownerId} and campaign_id=${reference.campaign_id} for update`;
    const [row]=await tx`select * from dk_generator_v2.runs where owner_id=${ownerId} and id=${runId} for update`;const contract=assertWorkbenchContract(row.contract);
    const candidate=row.candidate&&typeof row.candidate==='object'&&!Array.isArray(row.candidate)?row.candidate:null;
    const [source]=candidate?await tx`select revision,source_hash from dk_generator_v2.snapshots where owner_id=${ownerId} and run_id=${runId} and revision=${String(candidate.revision)} and source_hash=${String(candidate.sourceHash)}`:[];
    const unsettled=await tx`select operation_id from dk_generator_v2.calls where owner_id=${ownerId} and run_id=${runId} and (status not in ('completed','failed') or actual_micros is null) limit 1`;
    const [lastVerification]=await tx`select details from dk_generator_v2.events where owner_id=${ownerId} and run_id=${runId} and type='verification.finished' order by sequence desc limit 1`;
    const [recordedPatch]=await tx`select status,result,actual_micros from dk_generator_v2.calls where owner_id=${ownerId} and run_id=${runId} and operation_id='capability-repair-1'`;
    const checks=Array.isArray(lastVerification?.details?.checks)?lastVerification.details.checks:[];
    const genericPassed=checks.length>0&&checks.every((check:{passed?:unknown})=>check.passed===true);
    const supportsImage=Array.isArray(row.contract?.capabilities)&&(row.contract.capabilities.includes('ai.image.generate')||row.contract.capabilities.includes('ai.vision'));
    const gateDetected=String(row.details?.error)==='PILOT_DELIVERY_CHECKS_FAILED'&&genericPassed;
    const recordedLimitMismatch=String(row.details?.error||'').includes('incremental-edit context budget')&&recordedPatch?.status==='completed'&&recordedPatch.result&&recordedPatch.actual_micros!==null;
    if(row.status!=='failed'||row.accepted||!source||unsettled.length||Number(row.reserved_micros)!==0||Number(row.call_count)>=Number(row.max_provider_calls)
      ||(!gateDetected&&!recordedLimitMismatch)||!supportsImage||!contract)throw new Error('WORKBENCH_CAPABILITY_VERIFICATION_RECOVERY_NOT_ALLOWED');
    const active=await tx`select id from dk_generator_v2.runs where owner_id=${ownerId} and campaign_id=${row.campaign_id} and id<>${runId} and status not in ('ready','failed','cancelled') limit 1`;if(active.length)throw new Error('PILOT_CAMPAIGN_BUSY');
    const prior=row.details&&typeof row.details==='object'&&!Array.isArray(row.details)?row.details:{};
    const capabilityVerificationRecovery={baseRevision:String(source.revision),baseHash:String(source.source_hash)};
    const details={...prior,capabilityVerificationRecovery,recoveryReason:'Add the missing image capability integration to the exact preserved app in one bounded patch.'};
    const [updated]=await tx`update dk_generator_v2.runs set status='queued',worker_id=null,lease_until=null,fence=fence+1,sequence=sequence+1,details=${tx.json(details)}::jsonb,updated_at=clock_timestamp() where owner_id=${ownerId} and id=${runId} returning sequence`;
    await tx`insert into dk_generator_v2.events(owner_id,run_id,sequence,type,message,details) values(${ownerId},${runId},${updated.sequence},'recovery.capability-verification','The app passed its browser journeys but lacked image capability evidence. One focused repair is queued; no earlier work is discarded.',${tx.json(capabilityVerificationRecovery)}::jsonb)`;
  });
}
export const isWorkbenchRun=(run:{contract:{runtime:{id:string}}})=>run.contract.runtime.id===WORKBENCH_RUNTIME;
