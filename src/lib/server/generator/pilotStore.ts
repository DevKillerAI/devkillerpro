import type { TransactionSql } from 'postgres';
import { z } from 'zod';
import { database } from '../database';
import { contractFingerprint, contractSchema, digest, sameIdentity, scopedId, type GenerationContract } from './contract';
import { candidateBindingSchema, evaluateRelease, sameCandidate, type CandidateBinding, type VerificationEvidence } from './releaseGate';
import { createGeneratorSnapshot, type GeneratorSnapshot } from './versionedEdits';
import type { GeneratorStatus } from './lifecycle';
import { privateboardRuntimeRequalificationSchema, type PrivateboardRuntimeRequalification } from './supabasePilotRequalification';
import { assertPrivateboardContract, SUPABASE_PILOT_INITIAL_PATHS } from './supabasePilotContract';

export const PILOT_CAMPAIGN_ID = 'pilot-20260903';
export const PILOT_CAMPAIGN_MAX_MICROS = 3_000_000;
const JSON_MAX_BYTES = 10 * 1024 * 1024;
const terminal = (status: string) => ['ready', 'failed', 'cancelled'].includes(status);
type Row = Record<string, any>;

export type PilotLease = { runId: string; ownerId: string; workerId: string; fence: number; leaseUntil: number };
export type PilotBudget = { spentMicros: number; reservedMicros: number; callCount: number; maxCostMicros: number; maxProviderCalls: number };
export type PilotRun = {
  id: string; runId: string; ownerId: string; campaignId: string; contract: GenerationContract;
  identity: GenerationContract['identity']; contractHash: string; status: GeneratorStatus;
  sequence: number; fence: number; workerId: string | null; leaseUntil: number | null;
  budget: PilotBudget; campaignBudget: PilotBudget; candidate: CandidateBinding | null; accepted: CandidateBinding | null;
  details: unknown; createdAt: string; updatedAt: string;
};
export type PilotCall = {
  operationId: string; runId: string; ownerId: string; requestHash: string; model: string;
  reservedMicros: number; actualMicros: number | null; status: 'reserved' | 'submitted' | 'uncertain' | 'completed' | 'failed';
  responseId: string | null; request: unknown; result: unknown; usage: unknown; lastResponseStatus: string | null;
};
export type PilotEvent = { sequence: number; type: string; message: string; details: unknown; createdAt: string };
export type PilotSavedSnapshot = { snapshot: GeneratorSnapshot; candidate: CandidateBinding; createdAt: string };
export type ReservePilotCallInput = { operationId: string; requestHash: string; reservedMicros: number; model: string; request?: unknown };
export type SettlePilotCallInput = { actualMicros: number; status: 'completed' | 'failed'; usage?: unknown; result?: unknown; lastResponseStatus?: string };
export type ReconcilePilotTerminalCallInput = {
  requestHash: string; responseId: string; actualMicros: number; status: 'completed' | 'failed';
  usage: unknown; result: unknown; lastResponseStatus: string;
};

function integer(value: number, name: string, positive = false) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) throw new Error(`Invalid ${name}.`);
  return value;
}
function add(a: number, b: number) { return integer(a + b, 'budget total'); }
function checkBudget(budget: PilotBudget) {
  integer(budget.spentMicros, 'spent cost'); integer(budget.reservedMicros, 'reserved cost');
  integer(budget.callCount, 'call count'); integer(budget.maxCostMicros, 'cost ceiling', true); integer(budget.maxProviderCalls, 'call ceiling', true);
}
/** Pure arithmetic only. The store applies both run and campaign changes in one locked transaction. */
export function reservePilotBudget(budget: PilotBudget, micros: number): PilotBudget {
  checkBudget(budget); integer(micros, 'call reservation', true);
  if (budget.callCount >= budget.maxProviderCalls) throw new Error('PILOT_CALL_LIMIT');
  if (add(add(budget.spentMicros, budget.reservedMicros), micros) > budget.maxCostMicros) throw new Error('PILOT_BUDGET_LIMIT');
  return { ...budget, reservedMicros: add(budget.reservedMicros, micros), callCount: add(budget.callCount, 1) };
}
/** Actual overruns are recorded truthfully; they block subsequent reservations rather than hiding cost. */
export function settlePilotBudget(budget: PilotBudget, reservedMicros: number, actualMicros: number): PilotBudget {
  checkBudget(budget); integer(reservedMicros, 'call reservation', true); integer(actualMicros, 'actual cost');
  if (reservedMicros > budget.reservedMicros) throw new Error('PILOT_RESERVATION_MISMATCH');
  return { ...budget, reservedMicros: budget.reservedMicros - reservedMicros, spentMicros: add(budget.spentMicros, actualMicros) };
}

function json(value: unknown): string {
  const result = JSON.stringify(value ?? null);
  if (typeof result !== 'string' || Buffer.byteLength(result) > JSON_MAX_BYTES) throw new Error('Pilot payload exceeds its JSON limit.');
  return result;
}
// postgres serializes JSON parameters itself; a pre-stringified plain parameter would be encoded twice.
const jsonParameter = (tx: TransactionSql, serialized: string) => tx.json(JSON.parse(serialized));
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
function text(value: string, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid pilot text.');
  return value;
}
function scope(runId: string, ownerId: string) { scopedId.parse(runId); scopedId.parse(ownerId); }
function leaseSeconds(value: number) { integer(value, 'lease duration', true); if (value > 900) throw new Error('Lease exceeds 15 minutes.'); return value; }
const iso = (value: unknown) => new Date(value as string).toISOString();
const budgetFrom = (row: Row, campaign = false): PilotBudget => ({
  spentMicros: Number(row.spent_micros), reservedMicros: Number(row.reserved_micros), callCount: Number(row.call_count),
  maxCostMicros: Number(row.max_cost_micros), maxProviderCalls: campaign ? Number.MAX_SAFE_INTEGER : Number(row.max_provider_calls),
});
function mapRun(row: Row): PilotRun {
  const contract = contractSchema.parse(row.contract);
  if (contract.identity.ownerId !== row.owner_id || contract.identity.missionId !== row.id || contractFingerprint(contract) !== row.contract_hash) throw new Error('PILOT_STORED_SCOPE_MISMATCH');
  return {
    id: row.id, runId: row.id, ownerId: row.owner_id, campaignId: row.campaign_id, contract, identity: contract.identity,
    contractHash: row.contract_hash, status: row.status, sequence: integer(Number(row.sequence), 'stored event sequence'), fence: integer(Number(row.fence), 'stored fence'),
    workerId: row.worker_id, leaseUntil: row.lease_until ? new Date(row.lease_until).getTime() : null,
    budget: budgetFrom(row), campaignBudget: budgetFrom(row.campaign, true), candidate: row.candidate, accepted: row.accepted,
    details: row.details, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}
function mapCall(row: Row): PilotCall {
  return { operationId: row.operation_id, runId: row.run_id, ownerId: row.owner_id, requestHash: row.request_hash, model: row.model,
    reservedMicros: Number(row.reserved_micros), actualMicros: row.actual_micros === null ? null : Number(row.actual_micros),
    status: row.status, responseId: row.response_id, request: row.request, result: row.result, usage: row.usage, lastResponseStatus: row.last_response_status };
}
async function readRun(tx: TransactionSql, runId: string, ownerId: string): Promise<PilotRun | null> {
  const [row] = await tx`select r.*,to_jsonb(c.*) as campaign from dk_generator_v2.runs r
    join dk_generator_v2.campaigns c on c.owner_id=r.owner_id and c.campaign_id=r.campaign_id where r.owner_id=${ownerId} and r.id=${runId}`;
  return row ? mapRun(row) : null;
}
/** Campaign -> run lock order is shared by creation, claims, billing and cancellation. */
async function lockRun(tx: TransactionSql, runId: string, ownerId: string): Promise<Row | null> {
  const [reference] = await tx`select campaign_id from dk_generator_v2.runs where owner_id=${ownerId} and id=${runId}`;
  if (!reference) return null;
  await tx`select campaign_id from dk_generator_v2.campaigns where owner_id=${ownerId} and campaign_id=${reference.campaign_id} for update`;
  const [row] = await tx`select *,lease_until>clock_timestamp() as lease_valid from dk_generator_v2.runs where owner_id=${ownerId} and id=${runId} for update`;
  return row;
}
async function event(tx: TransactionSql, runId: string, ownerId: string, type: string, message: string, details: unknown = {}): Promise<PilotEvent> {
  text(type, 120); text(message, 3000);
  const [row] = await tx`update dk_generator_v2.runs set sequence=sequence+1,updated_at=clock_timestamp() where owner_id=${ownerId} and id=${runId} returning sequence`;
  const [saved] = await tx`insert into dk_generator_v2.events(owner_id,run_id,sequence,type,message,details)
    values(${ownerId},${runId},${row.sequence},${type},${message},${jsonParameter(tx, json(details))}::jsonb) returning *`;
  return { sequence: Number(saved.sequence), type: saved.type, message: saved.message, details: saved.details, createdAt: iso(saved.created_at) };
}
async function withLease<T>(lease: PilotLease, action: (tx: TransactionSql, row: Row) => Promise<T>): Promise<T> {
  scope(lease.runId, lease.ownerId); scopedId.parse(lease.workerId); integer(lease.fence, 'fence', true);
  return database().begin(async tx => {
    const row = await lockRun(tx, lease.runId, lease.ownerId);
    if (!row || row.worker_id !== lease.workerId || Number(row.fence) !== lease.fence || !row.lease_valid || terminal(row.status)) throw new Error('PILOT_LEASE_LOST');
    const result = await action(tx, row);
    const [current] = await tx`select worker_id,fence,lease_until>clock_timestamp() as lease_valid from dk_generator_v2.runs where owner_id=${lease.ownerId} and id=${lease.runId}`;
    if (!current || current.worker_id !== lease.workerId || Number(current.fence) !== lease.fence || !current.lease_valid) throw new Error('PILOT_LEASE_LOST');
    return result;
  }) as Promise<T>;
}

/** campaignId is trusted operator configuration, never a client/model field. Retries must reuse it. */
export async function createPilotRun(input: GenerationContract, campaignId = PILOT_CAMPAIGN_ID, campaignMaxCostMicros = PILOT_CAMPAIGN_MAX_MICROS): Promise<PilotRun> {
  const contract = contractSchema.parse(input); scopedId.parse(campaignId);
  integer(campaignMaxCostMicros,'campaign cost ceiling',true);
  const { ownerId, missionId: runId } = contract.identity;
  const hash = contractFingerprint(contract);
  return database().begin(async tx => {
    await tx`insert into dk_generator_v2.campaigns(owner_id,campaign_id,max_cost_micros) values(${ownerId},${campaignId},${campaignMaxCostMicros}) on conflict do nothing`;
    await tx`select campaign_id from dk_generator_v2.campaigns where owner_id=${ownerId} and campaign_id=${campaignId} for update`;
    const [campaign]=await tx`select max_cost_micros from dk_generator_v2.campaigns where owner_id=${ownerId} and campaign_id=${campaignId}`;
    if (Number(campaign.max_cost_micros) !== campaignMaxCostMicros) throw new Error('PILOT_CAMPAIGN_BUDGET_CONFLICT');
    const existing = await readRun(tx, runId, ownerId);
    if (existing) {
      if (existing.contractHash !== hash || existing.campaignId !== campaignId) throw new Error('PILOT_RUN_CONFLICT');
      return existing;
    }
    const active = await tx`select id from dk_generator_v2.runs where owner_id=${ownerId} and campaign_id=${campaignId} and status not in ('ready','failed','cancelled') limit 1`;
    if (active.length) throw new Error('PILOT_CAMPAIGN_BUSY');
    await tx`insert into dk_generator_v2.runs(owner_id,id,campaign_id,contract,contract_hash,max_cost_micros,max_provider_calls)
      values(${ownerId},${runId},${campaignId},${jsonParameter(tx, json(contract))}::jsonb,${hash},${contract.budget.maxCostMicros},${contract.budget.maxProviderCalls})`;
    await event(tx, runId, ownerId, 'run.created', 'Pilot run created. No provider call has been submitted.');
    return (await readRun(tx, runId, ownerId))!;
  });
}
export async function getPilotRun(runId: string, ownerId: string): Promise<PilotRun | null> {
  scope(runId, ownerId);
  return database().begin(tx => readRun(tx, runId, ownerId));
}
export async function listPilotRuns(ownerId: string, campaignId?: string): Promise<PilotRun[]> {
  scopedId.parse(ownerId); if (campaignId) scopedId.parse(campaignId);
  const sql = database();
  const rows = campaignId ? await sql`select r.*,to_jsonb(c.*) as campaign from dk_generator_v2.runs r join dk_generator_v2.campaigns c on c.owner_id=r.owner_id and c.campaign_id=r.campaign_id where r.owner_id=${ownerId} and r.campaign_id=${campaignId} order by r.created_at desc limit 50`
    : await sql`select r.*,to_jsonb(c.*) as campaign from dk_generator_v2.runs r join dk_generator_v2.campaigns c on c.owner_id=r.owner_id and c.campaign_id=r.campaign_id where r.owner_id=${ownerId} order by r.created_at desc limit 50`;
  return rows.map(mapRun);
}

/** Removes a terminal project from product listings while retaining its cost/audit ledger. */
export async function deletePilotProject(runId:string,ownerId:string,deleteGeneratedFiles:boolean):Promise<PilotRun>{
  scope(runId,ownerId);
  if(typeof deleteGeneratedFiles!=='boolean')throw new Error('Invalid generated-file deletion choice.');
  return database().begin(async tx=>{
    const run=await lockRun(tx,runId,ownerId);if(!run)throw new Error('PILOT_RUN_NOT_FOUND');
    if(!terminal(run.status))throw new Error('PILOT_RUN_ACTIVE');
    if(run.details?.deletedAt)throw new Error('PILOT_RUN_NOT_FOUND');
    if(deleteGeneratedFiles){
      await tx`delete from dk_generator_v2.snapshots where owner_id=${ownerId} and run_id=${runId}`;
      await tx`update dk_generator_v2.calls set request=null,result=null,response_id=null,updated_at=clock_timestamp() where owner_id=${ownerId} and run_id=${runId}`;
    }
    const deletion={deletedAt:new Date().toISOString(),generatedFilesDeleted:deleteGeneratedFiles};
    if(deleteGeneratedFiles)await tx`update dk_generator_v2.runs set accepted=null,candidate=null,details=(case when jsonb_typeof(details)='object' then details else '{}'::jsonb end)||${jsonParameter(tx,json(deletion))}::jsonb,updated_at=clock_timestamp() where owner_id=${ownerId} and id=${runId}`;
    else await tx`update dk_generator_v2.runs set details=(case when jsonb_typeof(details)='object' then details else '{}'::jsonb end)||${jsonParameter(tx,json(deletion))}::jsonb,updated_at=clock_timestamp() where owner_id=${ownerId} and id=${runId}`;
    await event(tx,runId,ownerId,'run.deleted',deleteGeneratedFiles?'Project removed and generated source/output records deleted. Cost and audit records were retained.':'Project removed from the list. Generated files were retained.',deletion);
    return (await readRun(tx,runId,ownerId))!;
  });
}
export async function claimPilotRun(runId: string, ownerId: string, workerId: string, duration = 120): Promise<PilotLease | null> {
  scope(runId, ownerId); scopedId.parse(workerId); leaseSeconds(duration);
  return database().begin(async tx => {
    const row = await lockRun(tx, runId, ownerId);
    if (!row || terminal(row.status) || row.status === 'cancelling' || row.lease_valid || row.details?.recoveryMode) return null;
    const [claimed] = await tx`update dk_generator_v2.runs set fence=fence+1,worker_id=${workerId},lease_until=clock_timestamp()+(${duration}*interval '1 second'),updated_at=clock_timestamp() where owner_id=${ownerId} and id=${runId} returning fence,lease_until`;
    await event(tx, runId, ownerId, 'worker.claimed', 'Worker claimed the pilot run.', { workerId, fence: Number(claimed.fence) });
    return { runId, ownerId, workerId, fence: Number(claimed.fence), leaseUntil: new Date(claimed.lease_until).getTime() };
  });
}
type PilotRecoveryPermission = { recoveryMode: 'recorded-output-only' } | {
  recoveryMode: 'scoped-refinement-repair'; allowedOperationId: 'refine-repair-1'; allowedRequestHash: string;
};
async function claimPilotRecovery(runId: string, ownerId: string, workerId: string, expectedSequence: number, reason: string, permission: PilotRecoveryPermission, duration: number): Promise<PilotLease> {
  scope(runId, ownerId); scopedId.parse(workerId); integer(expectedSequence, 'expected recovery sequence'); text(reason, 1800); leaseSeconds(duration);
  return database().begin(async tx => {
    const row = await lockRun(tx, runId, ownerId);
    if (!row || row.status !== 'failed' || row.accepted !== null || Number(row.reserved_micros) !== 0) throw new Error('PILOT_RECORDED_RECOVERY_NOT_ALLOWED');
    if (row.details?.recoveryMode === 'runtime-requalification' || row.details?.runtimeRequalification) throw new Error('PILOT_RUNTIME_REQUALIFICATION_ALREADY_CLAIMED');
    const environmentRecovery = await tx`select sequence from dk_generator_v2.events where owner_id=${ownerId} and run_id=${runId} and details->>'recoveryMode'='environment-recovery' limit 1`;
    if (row.details?.recoveryMode === 'environment-recovery' || row.details?.environmentRecovery || environmentRecovery.length) throw new Error('PILOT_ENVIRONMENT_RECOVERY_ALREADY_CLAIMED');
    if (Number(row.sequence) !== expectedSequence) throw new Error('PILOT_RECOVERY_SEQUENCE_CONFLICT');
    const unsettled = await tx`select operation_id from dk_generator_v2.calls where owner_id=${ownerId} and run_id=${runId} and (status not in ('completed','failed') or actual_micros is null) limit 1`;
    if (unsettled.length) throw new Error('PILOT_RECOVERY_HAS_UNSETTLED_CALLS');
    const active = await tx`select id from dk_generator_v2.runs where owner_id=${ownerId} and campaign_id=${row.campaign_id} and id<>${runId} and status not in ('ready','failed','cancelled') limit 1`;
    if (active.length) throw new Error('PILOT_CAMPAIGN_BUSY');
    const recovery = { ...permission, recoveryReason: reason, recoveryExpectedSequence: expectedSequence, recoveryWorkerId: workerId };
    const [claimed] = await tx`update dk_generator_v2.runs set status='verifying',fence=fence+1,worker_id=${workerId},lease_until=clock_timestamp()+(${duration}*interval '1 second'),
      details=(case when jsonb_typeof(details)='object' then details else jsonb_build_object('priorDetails',details) end)||${jsonParameter(tx, json(recovery))}::jsonb,
      updated_at=clock_timestamp() where owner_id=${ownerId} and id=${runId} and sequence=${expectedSequence} and status='failed' returning fence,lease_until`;
    if (!claimed) throw new Error('PILOT_RECOVERY_SEQUENCE_CONFLICT');
    await event(tx, runId, ownerId, 'recovery.claimed', permission.recoveryMode === 'recorded-output-only'
      ? 'Operator claimed recorded-output-only recovery. No new provider operations are permitted.'
      : 'Operator authorized one hash-bound refinement repair. Existing budgets and provider operation records remain in force.', recovery);
    return { runId, ownerId, workerId, fence: Number(claimed.fence), leaseUntil: new Date(claimed.lease_until).getTime() };
  });
}
/** Explicit operator-only replay. Never expose as an ordinary retry endpoint. */
export async function claimPilotRecordedRecovery(runId: string, ownerId: string, workerId: string, expectedSequence: number, reason: string, duration = 120): Promise<PilotLease> {
  return claimPilotRecovery(runId, ownerId, workerId, expectedSequence, reason, { recoveryMode: 'recorded-output-only' }, duration);
}
/** Narrow operator authorization: the request is prepared and hashed before claiming; no build restart. */
export async function claimPilotRefinementRepair(runId: string, ownerId: string, workerId: string, expectedSequence: number, reason: string, requestHash: string, duration = 120): Promise<PilotLease> {
  digest.parse(requestHash);
  return claimPilotRecovery(runId, ownerId, workerId, expectedSequence, reason, {
    recoveryMode: 'scoped-refinement-repair', allowedOperationId: 'refine-repair-1', allowedRequestHash: requestHash,
  }, duration);
}

/** Pure preflight. The claim repeats these checks while holding the campaign/run locks. */
export function validatePrivateboardRuntimeRequalification(run: PilotRun, saved: readonly PilotSavedSnapshot[], calls: readonly PilotCall[], input: PrivateboardRuntimeRequalification, previouslyClaimed = false): PrivateboardRuntimeRequalification {
  const authorization = privateboardRuntimeRequalificationSchema.parse(input);
  checkBudget(run.budget); checkBudget(run.campaignBudget);
  const details = run.details && typeof run.details === 'object' ? run.details as Record<string, unknown> : {};
  if (run.status !== 'failed' || run.accepted !== null || !run.candidate || run.budget.reservedMicros !== 0 || run.campaignBudget.reservedMicros !== 0
    || run.contract.runtime.id !== 'react-supabase-pilot' || run.contract.runtime.version !== 'v1'
    || run.ownerId !== run.contract.identity.ownerId || run.runId !== run.contract.identity.missionId
    || run.contractHash !== contractFingerprint(run.contract) || run.budget.maxProviderCalls !== run.contract.budget.maxProviderCalls || run.budget.maxProviderCalls > 5
    || run.contract.budget.maxRepairAttempts > 2 || run.budget.maxCostMicros !== run.contract.budget.maxCostMicros || run.budget.maxCostMicros > PILOT_CAMPAIGN_MAX_MICROS
    || run.campaignBudget.maxCostMicros > PILOT_CAMPAIGN_MAX_MICROS || run.campaignBudget.callCount < run.budget.callCount || run.campaignBudget.spentMicros < run.budget.spentMicros)
    throw new Error('PILOT_RUNTIME_REQUALIFICATION_NOT_ALLOWED');
  if (previouslyClaimed || details.recoveryMode || details.runtimeRequalification || saved.some(item => item.snapshot.revision === 'runtime-1'))
    throw new Error('PILOT_RUNTIME_REQUALIFICATION_ALREADY_CLAIMED');
  const operations = ['build-1', 'repair-1', 'repair-2'];
  if (calls.length < 1 || calls.length > 3 || calls.length !== run.budget.callCount
    || new Set(calls.map(call => call.operationId)).size !== calls.length
    || calls.some(call => !operations.slice(0, calls.length).includes(call.operationId) || call.ownerId !== run.ownerId || call.runId !== run.runId
      || call.status !== 'completed' || call.actualMicros === null || !Number.isSafeInteger(call.actualMicros) || call.actualMicros < 0)
    || calls.reduce((total, call) => total + call.actualMicros!, 0) !== run.budget.spentMicros)
    throw new Error('PILOT_RUNTIME_REQUALIFICATION_CALL_HISTORY_MISMATCH');
  if (saved.length !== calls.length || new Set(saved.map(item => item.snapshot.revision)).size !== saved.length)
    throw new Error('PILOT_RUNTIME_REQUALIFICATION_SOURCE_MISMATCH');
  for (const call of calls) {
    const recorded = saved.find(item => item.snapshot.revision === call.operationId);
    if (!recorded || recorded.candidate.runtimeDigest !== authorization.fromRuntimeDigest
      || recorded.snapshot.files.some(file => file.path === 'supabase/migrations/002_priority.sql')) throw new Error('PILOT_RUNTIME_REQUALIFICATION_SOURCE_MISMATCH');
    validatePilotSnapshot(run.contract, recorded.snapshot, recorded.candidate);
  }
  const original = saved.find(item => item.snapshot.revision === authorization.sourceRevision);
  if (!original || !sameCandidate(original.candidate, run.candidate) || original.candidate.runtimeDigest !== authorization.fromRuntimeDigest
    || original.candidate.sourceHash !== authorization.sourceHash || original.snapshot.hash !== authorization.sourceHash
    || original.snapshot.files.some(file => file.path === 'supabase/migrations/002_priority.sql')
    || !calls.some(call => call.operationId === authorization.sourceRevision)) throw new Error('PILOT_RUNTIME_REQUALIFICATION_SOURCE_MISMATCH');
  validatePilotSnapshot(run.contract, original.snapshot, original.candidate);
  return authorization;
}

/** Explicit operator-only runtime correction, never an ordinary worker retry or a budget reset. */
export async function claimPrivateboardRuntimeRequalification(runId: string, ownerId: string, workerId: string, expectedSequence: number, reason: string, input: PrivateboardRuntimeRequalification, duration = 120): Promise<PilotLease> {
  scope(runId, ownerId); scopedId.parse(workerId); integer(expectedSequence, 'expected recovery sequence'); text(reason, 1800); leaseSeconds(duration);
  const authorization = privateboardRuntimeRequalificationSchema.parse(input);
  return database().begin(async tx => {
    const row = await lockRun(tx, runId, ownerId);
    if (!row) throw new Error('PILOT_RUNTIME_REQUALIFICATION_NOT_ALLOWED');
    if (Number(row.sequence) !== expectedSequence) throw new Error('PILOT_RECOVERY_SEQUENCE_CONFLICT');
    const run = (await readRun(tx, runId, ownerId))!;
    const snapshots = await tx`select snapshot,candidate,created_at from dk_generator_v2.snapshots where owner_id=${ownerId} and run_id=${runId}`;
    const calls = await tx`select * from dk_generator_v2.calls where owner_id=${ownerId} and run_id=${runId}`;
    const previous = await tx`select sequence from dk_generator_v2.events where owner_id=${ownerId} and run_id=${runId} and details->>'recoveryMode' in ('runtime-requalification','environment-recovery') limit 1`;
    validatePrivateboardRuntimeRequalification(run, snapshots.map(item => ({ snapshot: item.snapshot, candidate: item.candidate, createdAt: iso(item.created_at) })), calls.map(mapCall), authorization, previous.length > 0);
    const active = await tx`select id from dk_generator_v2.runs where owner_id=${ownerId} and campaign_id=${row.campaign_id} and id<>${runId} and status not in ('ready','failed','cancelled') limit 1`;
    if (active.length) throw new Error('PILOT_CAMPAIGN_BUSY');
    const recovery = { recoveryMode: 'runtime-requalification', runtimeRequalification: authorization, recoveryReason: reason, recoveryExpectedSequence: expectedSequence, recoveryWorkerId: workerId };
    const [claimed] = await tx`update dk_generator_v2.runs set status='verifying',fence=fence+1,worker_id=${workerId},lease_until=clock_timestamp()+(${duration}*interval '1 second'),
      details=(case when jsonb_typeof(details)='object' then details else jsonb_build_object('priorDetails',details) end)||${jsonParameter(tx, json(recovery))}::jsonb,
      updated_at=clock_timestamp() where owner_id=${ownerId} and id=${runId} and sequence=${expectedSequence} and status='failed' returning fence,lease_until`;
    if (!claimed) throw new Error('PILOT_RECOVERY_SEQUENCE_CONFLICT');
    await event(tx, runId, ownerId, 'recovery.claimed', 'Operator authorized requalification of the exact failed source on the corrected runtime. Existing snapshots, costs and provider call limits remain unchanged.', recovery);
    return { runId, ownerId, workerId, fence: Number(claimed.fence), leaseUntil: new Date(claimed.lease_until).getTime() };
  });
}

/** Only the two original final operations may consume remaining authorization. */
export function validatePrivateboardRuntimeRequalificationCall(input: PrivateboardRuntimeRequalification, candidate: CandidateBinding | null, operationId: string): void {
  const authorization = privateboardRuntimeRequalificationSchema.parse(input);
  if (!candidate || candidate.runtimeDigest !== authorization.toRuntimeDigest
    || (operationId !== 'upgrade-1' && operationId !== 'refine-1')
    || candidate.revision !== (operationId === 'upgrade-1' ? authorization.requalificationRevision : 'upgrade-1')
    || (operationId === 'upgrade-1' && candidate.sourceHash !== authorization.sourceHash)) throw new Error('PILOT_RUNTIME_REQUALIFICATION_CALL_SCOPE_MISMATCH');
}

export const privateboardEnvironmentRecoverySchema = z.object({ sourceHash: digest, runtimeDigest: digest }).strict();
export type PrivateboardEnvironmentRecovery = z.infer<typeof privateboardEnvironmentRecoverySchema>;

/** Only the recorded pre-verification Docker subnet exhaustion qualifies, never a source failure. */
export function validatePrivateboardEnvironmentRecovery(run: PilotRun, saved: readonly PilotSavedSnapshot[], calls: readonly PilotCall[], events: readonly PilotEvent[], input: PrivateboardEnvironmentRecovery, now = Date.now()): PrivateboardEnvironmentRecovery {
  const authorization = privateboardEnvironmentRecoverySchema.parse(input);
  checkBudget(run.budget); checkBudget(run.campaignBudget);
  try { assertPrivateboardContract(run.contract); } catch { throw new Error('PILOT_ENVIRONMENT_RECOVERY_NOT_ALLOWED'); }
  const details = run.details && typeof run.details === 'object' ? run.details as Record<string, unknown> : {};
  if (run.status !== 'failed' || run.accepted !== null || !run.candidate || (run.leaseUntil !== null && (!Number.isFinite(run.leaseUntil) || run.leaseUntil > now))
    || run.budget.reservedMicros !== 0 || run.campaignBudget.reservedMicros !== 0
    || run.ownerId !== run.contract.identity.ownerId || run.runId !== run.contract.identity.missionId || run.contractHash !== contractFingerprint(run.contract)
    || run.budget.maxProviderCalls !== 5 || run.budget.maxCostMicros !== run.contract.budget.maxCostMicros
    || run.campaignBudget.maxCostMicros !== PILOT_CAMPAIGN_MAX_MICROS || run.campaignBudget.callCount < run.budget.callCount || run.campaignBudget.spentMicros < run.budget.spentMicros)
    throw new Error('PILOT_ENVIRONMENT_RECOVERY_NOT_ALLOWED');
  if (details.recoveryMode || details.environmentRecovery || details.runtimeRequalification || events.some(item => item.type === 'recovery.claimed'))
    throw new Error('PILOT_ENVIRONMENT_RECOVERY_ALREADY_CLAIMED');
  const call = calls[0];
  if (calls.length !== 1 || run.budget.callCount !== 1 || !call || call.operationId !== 'build-1' || call.ownerId !== run.ownerId || call.runId !== run.runId
    || call.status !== 'completed' || call.actualMicros === null || !Number.isSafeInteger(call.actualMicros) || call.actualMicros < 0 || call.actualMicros !== run.budget.spentMicros)
    throw new Error('PILOT_ENVIRONMENT_RECOVERY_CALL_HISTORY_MISMATCH');
  const original = saved[0];
  if (saved.length !== 1 || !original || original.snapshot.revision !== 'build-1' || original.snapshot.parent
    || original.snapshot.hash !== authorization.sourceHash || original.candidate.runtimeDigest !== authorization.runtimeDigest || !sameCandidate(original.candidate, run.candidate)
    || original.snapshot.files.length !== 3 || original.snapshot.files.some(file => !SUPABASE_PILOT_INITIAL_PATHS.includes(file.path as typeof SUPABASE_PILOT_INITIAL_PATHS[number])))
    throw new Error('PILOT_ENVIRONMENT_RECOVERY_SOURCE_MISMATCH');
  validatePilotSnapshot(run.contract, original.snapshot, original.candidate);
  const failures = events.filter(item => item.type === 'run.error');
  const failure = failures[0];
  if (failures.length !== 1 || !failure || !failure.message.includes('all predefined address pools have been fully subnetted') || details.error !== failure.message
    || !events.some(item => item.type === 'verification.environment' && item.sequence < failure.sequence && (item.details as Record<string, unknown> | null)?.revision === 'build-1')
    || !events.some(item => item.type === 'run.failed' && item.sequence === run.sequence && item.sequence > failure.sequence)
    || events.some(item => ['verification.environment-ready', 'verification.finished', 'verification.runtime', 'benchmark.initial-passed'].includes(item.type)))
    throw new Error('PILOT_ENVIRONMENT_RECOVERY_FAILURE_EVIDENCE_MISMATCH');
  return authorization;
}

/** One operator opt-in after fixing environment allocation; no new source, runtime or budget authority. */
export async function claimPrivateboardEnvironmentRecovery(runId: string, ownerId: string, workerId: string, expectedSequence: number, reason: string, input: PrivateboardEnvironmentRecovery, duration = 120): Promise<PilotLease> {
  scope(runId, ownerId); scopedId.parse(workerId); integer(expectedSequence, 'expected recovery sequence'); text(reason, 1800); leaseSeconds(duration);
  const authorization = privateboardEnvironmentRecoverySchema.parse(input);
  return database().begin(async tx => {
    const row = await lockRun(tx, runId, ownerId);
    if (!row || row.lease_valid) throw new Error('PILOT_ENVIRONMENT_RECOVERY_NOT_ALLOWED');
    if (Number(row.sequence) !== expectedSequence) throw new Error('PILOT_RECOVERY_SEQUENCE_CONFLICT');
    const run = (await readRun(tx, runId, ownerId))!;
    const snapshots = await tx`select snapshot,candidate,created_at from dk_generator_v2.snapshots where owner_id=${ownerId} and run_id=${runId}`;
    const calls = await tx`select * from dk_generator_v2.calls where owner_id=${ownerId} and run_id=${runId}`;
    const events = await tx`select sequence,type,message,details,created_at from dk_generator_v2.events where owner_id=${ownerId} and run_id=${runId} order by sequence`;
    const [clock] = await tx`select (extract(epoch from clock_timestamp())*1000)::bigint as now_ms`;
    validatePrivateboardEnvironmentRecovery(run, snapshots.map(item => ({ snapshot: item.snapshot, candidate: item.candidate, createdAt: iso(item.created_at) })), calls.map(mapCall),
      events.map(item => ({ sequence: Number(item.sequence), type: item.type, message: item.message, details: item.details, createdAt: iso(item.created_at) })), authorization, Number(clock.now_ms));
    const active = await tx`select id from dk_generator_v2.runs where owner_id=${ownerId} and campaign_id=${row.campaign_id} and id<>${runId} and status not in ('ready','failed','cancelled') limit 1`;
    if (active.length) throw new Error('PILOT_CAMPAIGN_BUSY');
    const recovery = { recoveryMode: 'environment-recovery', environmentRecovery: authorization, recoveryReason: reason, recoveryExpectedSequence: expectedSequence, recoveryWorkerId: workerId };
    const [claimed] = await tx`update dk_generator_v2.runs set status='verifying',fence=fence+1,worker_id=${workerId},lease_until=clock_timestamp()+(${duration}*interval '1 second'),
      details=(case when jsonb_typeof(details)='object' then details else jsonb_build_object('priorDetails',details) end)||${jsonParameter(tx, json(recovery))}::jsonb,
      updated_at=clock_timestamp() where owner_id=${ownerId} and id=${runId} and sequence=${expectedSequence} and status='failed' returning fence,lease_until`;
    if (!claimed) throw new Error('PILOT_RECOVERY_SEQUENCE_CONFLICT');
    await event(tx, runId, ownerId, 'recovery.claimed', 'Operator authorized resuming the exact recorded build after a pre-verification network allocation failure. Source, runtime and all existing budget limits are unchanged.', recovery);
    return { runId, ownerId, workerId, fence: Number(claimed.fence), leaseUntil: new Date(claimed.lease_until).getTime() };
  });
}

/** New calls remain sequential and bounded to the original operation plan. Recorded calls are read separately. */
export function validatePrivateboardEnvironmentRecoveryCall(contract: GenerationContract, input: PrivateboardEnvironmentRecovery, candidate: CandidateBinding | null, operationId: string, calls: readonly PilotCall[]): void {
  const authorization = privateboardEnvironmentRecoverySchema.parse(input);
  if (!candidate || candidate.runtimeDigest !== authorization.runtimeDigest || candidate.contractHash !== contractFingerprint(contract) || !sameIdentity(candidate.identity, contract.identity)
    || (candidate.revision === 'build-1' && candidate.sourceHash !== authorization.sourceHash)) throw new Error('PILOT_ENVIRONMENT_RECOVERY_CALL_SCOPE_MISMATCH');
  const initial = ['build-1', 'repair-1', 'repair-2'];
  const expected = operationId === 'repair-1' && candidate.revision === 'build-1' ? ['build-1']
    : operationId === 'repair-2' && candidate.revision === 'repair-1' ? initial.slice(0, 2)
    : operationId === 'upgrade-1' && initial.includes(candidate.revision) ? initial.slice(0, initial.indexOf(candidate.revision) + 1)
    : operationId === 'refine-1' && candidate.revision === 'upgrade-1' ? [...initial.slice(0, calls.some(call => call.operationId === 'repair-2') ? 3 : calls.some(call => call.operationId === 'repair-1') ? 2 : 1), 'upgrade-1'] : null;
  if (!expected || calls.length !== expected.length || new Set(calls.map(call => call.operationId)).size !== calls.length
    || calls.some(call => !expected.includes(call.operationId) || call.ownerId !== contract.identity.ownerId || call.runId !== contract.identity.missionId || call.status !== 'completed' || call.actualMicros === null))
    throw new Error('PILOT_ENVIRONMENT_RECOVERY_CALL_SCOPE_MISMATCH');
}
export async function heartbeatPilotRun(lease: PilotLease, duration = 120): Promise<PilotLease> {
  leaseSeconds(duration);
  return withLease(lease, async tx => {
    const [row] = await tx`update dk_generator_v2.runs set lease_until=clock_timestamp()+(${duration}*interval '1 second') where owner_id=${lease.ownerId} and id=${lease.runId} returning lease_until`;
    return { ...lease, leaseUntil: new Date(row.lease_until).getTime() };
  });
}
export async function appendPilotEvent(lease: PilotLease, type: string, message: string, details: unknown = {}): Promise<PilotEvent> {
  return withLease(lease, tx => event(tx, lease.runId, lease.ownerId, type, message, details));
}
export async function getPilotEvents(runId: string, ownerId: string, afterSequence = 0): Promise<PilotEvent[]> {
  scope(runId, ownerId); integer(afterSequence, 'event cursor');
  const rows = await database()`select sequence,type,message,details,created_at from dk_generator_v2.events where owner_id=${ownerId} and run_id=${runId} and sequence>${afterSequence} order by sequence limit 500`;
  return rows.map(row => ({ sequence: Number(row.sequence), type: row.type, message: row.message, details: row.details, createdAt: iso(row.created_at) }));
}
const transitions: Record<string, readonly string[]> = {
  queued: ['planning','failed'], planning: ['building','awaiting_input','failed'], building: ['verifying','awaiting_input','failed'],
  verifying: ['building','awaiting_input','failed'], awaiting_input: ['planning','failed'],
};
export async function updatePilotState(lease: PilotLease, status: GeneratorStatus, details: unknown = {}): Promise<PilotRun> {
  return withLease(lease, async (tx, row) => {
    if (status === 'ready' || status === 'cancelled' || status === 'cancelling' || (status !== row.status && !transitions[row.status]?.includes(status))) throw new Error('PILOT_INVALID_TRANSITION');
    const storedDetails = row.details?.recoveryMode
      ? { ...row.details, latestRecoveryDetails: details } : details;
    await tx`update dk_generator_v2.runs set status=${status},details=${jsonParameter(tx, json(storedDetails))}::jsonb where owner_id=${lease.ownerId} and id=${lease.runId}`;
    await event(tx, lease.runId, lease.ownerId, `run.${status}`, `Pilot phase: ${status}.`, details);
    return (await readRun(tx, lease.runId, lease.ownerId))!;
  });
}
export async function cancelPilotRun(runId: string, ownerId: string): Promise<PilotRun | null> {
  scope(runId, ownerId);
  return database().begin(async tx => {
    const row = await lockRun(tx, runId, ownerId);
    if (!row) return null;
    if (!terminal(row.status)) {
      await tx`update dk_generator_v2.runs set status='cancelled',fence=fence+1,worker_id=null,lease_until=null where owner_id=${ownerId} and id=${runId}`;
      await event(tx, runId, ownerId, 'run.cancelled', 'Local run stopped. Unconfirmed provider reservations remain held; remote responses may need reconciliation.');
    }
    return readRun(tx, runId, ownerId);
  });
}

export async function getPilotCall(runId: string, ownerId: string, operationId: string): Promise<PilotCall | null> {
  scope(runId, ownerId); scopedId.parse(operationId);
  const [row] = await database()`select * from dk_generator_v2.calls where owner_id=${ownerId} and run_id=${runId} and operation_id=${operationId}`;
  return row ? mapCall(row) : null;
}
/** created:false never authorizes POST again, even when the existing status is still reserved. */
export async function reservePilotCall(lease: PilotLease, input: ReservePilotCallInput): Promise<{ call: PilotCall; created: boolean }> {
  scopedId.parse(input.operationId); digest.parse(input.requestHash); text(input.model); integer(input.reservedMicros, 'reservation', true);
  const request = json(input.request);
  return withLease(lease, async (tx, run) => {
    const [existing] = await tx`select * from dk_generator_v2.calls where owner_id=${lease.ownerId} and run_id=${lease.runId} and operation_id=${input.operationId}`;
    if (existing) {
      if (existing.request_hash !== input.requestHash || existing.model !== input.model || Number(existing.reserved_micros) !== input.reservedMicros || canonical(existing.request) !== canonical(JSON.parse(request))) throw new Error('PILOT_OPERATION_CONFLICT');
      return { call: mapCall(existing), created: false };
    }
    if (run.details?.recoveryMode === 'recorded-output-only') throw new Error('PILOT_RECORDED_RECOVERY_NO_NEW_CALLS');
    if (run.details?.recoveryMode === 'runtime-requalification') {
      validatePrivateboardRuntimeRequalificationCall(run.details.runtimeRequalification, run.candidate, input.operationId);
    } else if (run.details?.recoveryMode === 'environment-recovery') {
      const calls = await tx`select * from dk_generator_v2.calls where owner_id=${lease.ownerId} and run_id=${lease.runId}`;
      validatePrivateboardEnvironmentRecoveryCall(contractSchema.parse(run.contract), run.details.environmentRecovery, run.candidate, input.operationId, calls.map(mapCall));
    } else if (run.details?.recoveryMode && (run.details.recoveryMode !== 'scoped-refinement-repair'
      || input.operationId !== run.details.allowedOperationId || input.requestHash !== run.details.allowedRequestHash)) throw new Error('PILOT_REFINEMENT_REPAIR_SCOPE_MISMATCH');
    if (!['planning','building','verifying'].includes(run.status)) throw new Error('PILOT_CALL_NOT_ALLOWED');
    const [campaign] = await tx`select * from dk_generator_v2.campaigns where owner_id=${lease.ownerId} and campaign_id=${run.campaign_id}`;
    const nextRun = reservePilotBudget(budgetFrom(run), input.reservedMicros);
    const nextCampaign = reservePilotBudget(budgetFrom(campaign, true), input.reservedMicros);
    await tx`update dk_generator_v2.runs set reserved_micros=${nextRun.reservedMicros},call_count=${nextRun.callCount} where owner_id=${lease.ownerId} and id=${lease.runId}`;
    await tx`update dk_generator_v2.campaigns set reserved_micros=${nextCampaign.reservedMicros},call_count=${nextCampaign.callCount} where owner_id=${lease.ownerId} and campaign_id=${run.campaign_id}`;
    const [call] = await tx`insert into dk_generator_v2.calls(owner_id,run_id,operation_id,request_hash,model,reserved_micros,request)
      values(${lease.ownerId},${lease.runId},${input.operationId},${input.requestHash},${input.model},${input.reservedMicros},${jsonParameter(tx, request)}::jsonb) returning *`;
    await event(tx, lease.runId, lease.ownerId, 'provider.reserved', 'Provider call reserved before submission.', { operationId: input.operationId, reservedMicros: input.reservedMicros, model: input.model });
    return { call: mapCall(call), created: true };
  });
}
export async function markPilotSubmitted(lease: PilotLease, operationId: string, responseId: string, lastResponseStatus = 'submitted'): Promise<PilotCall> {
  scopedId.parse(operationId); text(responseId); text(lastResponseStatus, 100);
  return withLease(lease, async tx => {
    const [prior] = await tx`select * from dk_generator_v2.calls where owner_id=${lease.ownerId} and run_id=${lease.runId} and operation_id=${operationId} for update`;
    if (!prior) throw new Error('PILOT_CALL_NOT_FOUND');
    if (prior.response_id && prior.response_id !== responseId) throw new Error('PILOT_RESPONSE_CONFLICT');
    if (['completed','failed'].includes(prior.status)) { if (prior.response_id !== responseId) throw new Error('PILOT_RESPONSE_CONFLICT'); return mapCall(prior); }
    const [row] = await tx`update dk_generator_v2.calls set status='submitted',response_id=${responseId},last_response_status=${lastResponseStatus},updated_at=clock_timestamp() where owner_id=${lease.ownerId} and run_id=${lease.runId} and operation_id=${operationId} returning *`;
    await event(tx, lease.runId, lease.ownerId, 'provider.submitted', 'Provider response identifier recorded.', { operationId, responseId, status: lastResponseStatus });
    return mapCall(row);
  });
}
export async function markPilotCallUncertain(lease: PilotLease, operationId: string, lastResponseStatus = 'uncertain', partial?: { usage?: unknown; result?: unknown }): Promise<PilotCall> {
  scopedId.parse(operationId); text(lastResponseStatus, 100);
  const partialUsage = partial?.usage === undefined ? undefined : json(partial.usage);
  const partialResult = partial?.result === undefined ? undefined : json(partial.result);
  return withLease(lease, async tx => {
    const [prior] = await tx`select * from dk_generator_v2.calls where owner_id=${lease.ownerId} and run_id=${lease.runId} and operation_id=${operationId} for update`;
    if (!prior) throw new Error('PILOT_CALL_NOT_FOUND');
    if (['completed','failed'].includes(prior.status)) return mapCall(prior);
    const [row] = await tx`update dk_generator_v2.calls set status='uncertain',last_response_status=${lastResponseStatus},usage=${jsonParameter(tx, partialUsage ?? json(prior.usage))}::jsonb,result=${jsonParameter(tx, partialResult ?? json(prior.result))}::jsonb,updated_at=clock_timestamp() where owner_id=${lease.ownerId} and run_id=${lease.runId} and operation_id=${operationId} returning *`;
    await event(tx, lease.runId, lease.ownerId, 'provider.uncertain', 'Provider outcome uncertain. Reservation retained; no automatic resubmission.', { operationId, status: lastResponseStatus });
    return mapCall(row);
  });
}
export async function settlePilotCall(lease: PilotLease, operationId: string, input: SettlePilotCallInput): Promise<PilotCall> {
  scopedId.parse(operationId); integer(input.actualMicros, 'actual cost');
  if (!['completed','failed'].includes(input.status)) throw new Error('PILOT_INVALID_CALL_STATUS');
  if (input.lastResponseStatus !== undefined) text(input.lastResponseStatus, 100);
  const usage = json(input.usage), result = json(input.result);
  return withLease(lease, async (tx, run) => {
    const [prior] = await tx`select * from dk_generator_v2.calls where owner_id=${lease.ownerId} and run_id=${lease.runId} and operation_id=${operationId} for update`;
    if (!prior) throw new Error('PILOT_CALL_NOT_FOUND');
    if (prior.actual_micros !== null) {
      if (Number(prior.actual_micros) !== input.actualMicros || prior.status !== input.status || canonical(prior.result) !== canonical(JSON.parse(result)) || canonical(prior.usage) !== canonical(JSON.parse(usage))) throw new Error('PILOT_SETTLEMENT_CONFLICT');
      return mapCall(prior);
    }
    const [campaign] = await tx`select * from dk_generator_v2.campaigns where owner_id=${lease.ownerId} and campaign_id=${run.campaign_id}`;
    const nextRun = settlePilotBudget(budgetFrom(run), Number(prior.reserved_micros), input.actualMicros);
    const nextCampaign = settlePilotBudget(budgetFrom(campaign, true), Number(prior.reserved_micros), input.actualMicros);
    await tx`update dk_generator_v2.runs set reserved_micros=${nextRun.reservedMicros},spent_micros=${nextRun.spentMicros} where owner_id=${lease.ownerId} and id=${lease.runId}`;
    await tx`update dk_generator_v2.campaigns set reserved_micros=${nextCampaign.reservedMicros},spent_micros=${nextCampaign.spentMicros} where owner_id=${lease.ownerId} and campaign_id=${run.campaign_id}`;
    const [row] = await tx`update dk_generator_v2.calls set status=${input.status},actual_micros=${input.actualMicros},usage=${jsonParameter(tx, usage)}::jsonb,result=${jsonParameter(tx, result)}::jsonb,last_response_status=${input.lastResponseStatus ?? input.status},updated_at=clock_timestamp() where owner_id=${lease.ownerId} and run_id=${lease.runId} and operation_id=${operationId} returning *`;
    await event(tx, lease.runId, lease.ownerId, 'provider.settled', 'Provider cost and result recorded.', { operationId, actualMicros: input.actualMicros, overReservation: input.actualMicros > Number(prior.reserved_micros) });
    return mapCall(row);
  });
}

/** Operator-only reconciliation of a recorded GET result. The trusted caller must validate provider usage and pricing first.
 * This method never calls the provider, claims a worker, changes the run phase, or authorizes another provider operation. */
export async function reconcilePilotTerminalCall(runId: string, ownerId: string, operationId: string, input: ReconcilePilotTerminalCallInput): Promise<PilotCall> {
  scope(runId, ownerId); scopedId.parse(operationId); digest.parse(input.requestHash); text(input.responseId); integer(input.actualMicros, 'actual cost');
  if (!['completed','failed'].includes(input.status)) throw new Error('PILOT_INVALID_CALL_STATUS');
  if (!['completed','failed','cancelled','incomplete'].includes(input.lastResponseStatus)) throw new Error('PILOT_RECONCILIATION_PROOF_INVALID');
  const result = json(input.result), usage = json(input.usage);
  const proof = JSON.parse(result), counters = JSON.parse(usage);
  if (!proof || Array.isArray(proof) || proof.id !== input.responseId || proof.status !== input.lastResponseStatus
    || (input.status === 'completed' && proof.status !== 'completed') || !proof.usage || !counters || Array.isArray(counters)
    || !Number.isSafeInteger(proof.usage.input_tokens) || proof.usage.input_tokens < 0
    || !Number.isSafeInteger(proof.usage.output_tokens) || proof.usage.output_tokens < 0
    || counters.inputTokens !== proof.usage.input_tokens || counters.outputTokens !== proof.usage.output_tokens
    || typeof counters.cacheWriteTokensObserved !== 'boolean') throw new Error('PILOT_RECONCILIATION_PROOF_INVALID');
  for (const name of ['inputTokens','outputTokens','cachedInputTokens','cacheWriteTokens','reasoningTokens']) {
    if (!Number.isSafeInteger(counters[name]) || counters[name] < 0) throw new Error('PILOT_RECONCILIATION_PROOF_INVALID');
  }
  if (counters.cachedInputTokens + counters.cacheWriteTokens > counters.inputTokens || counters.reasoningTokens > counters.outputTokens) throw new Error('PILOT_RECONCILIATION_PROOF_INVALID');
  return database().begin(async tx => {
    const run = await lockRun(tx, runId, ownerId);
    if (!run || !terminal(run.status) || run.lease_valid) throw new Error('PILOT_TERMINAL_RECONCILIATION_NOT_ALLOWED');
    const [prior] = await tx`select * from dk_generator_v2.calls where owner_id=${ownerId} and run_id=${runId} and operation_id=${operationId} for update`;
    if (!prior) throw new Error('PILOT_CALL_NOT_FOUND');
    if (prior.request_hash !== input.requestHash || !prior.response_id || prior.response_id !== input.responseId || prior.model !== proof.model) throw new Error('PILOT_RECONCILIATION_BINDING_MISMATCH');
    if (input.actualMicros > Number(prior.reserved_micros)) throw new Error('PILOT_RECONCILIATION_COST_OUT_OF_BOUND');
    if (prior.actual_micros !== null) {
      if (Number(prior.actual_micros) !== input.actualMicros || prior.status !== input.status || prior.last_response_status !== input.lastResponseStatus
        || canonical(prior.result) !== canonical(proof) || canonical(prior.usage) !== canonical(counters)) throw new Error('PILOT_SETTLEMENT_CONFLICT');
      return mapCall(prior);
    }
    if (!['uncertain','submitted'].includes(prior.status)) throw new Error('PILOT_RECONCILIATION_CALL_NOT_ALLOWED');
    const [campaign] = await tx`select * from dk_generator_v2.campaigns where owner_id=${ownerId} and campaign_id=${run.campaign_id}`;
    const nextRun = settlePilotBudget(budgetFrom(run), Number(prior.reserved_micros), input.actualMicros);
    const nextCampaign = settlePilotBudget(budgetFrom(campaign, true), Number(prior.reserved_micros), input.actualMicros);
    await tx`update dk_generator_v2.runs set reserved_micros=${nextRun.reservedMicros},spent_micros=${nextRun.spentMicros} where owner_id=${ownerId} and id=${runId}`;
    await tx`update dk_generator_v2.campaigns set reserved_micros=${nextCampaign.reservedMicros},spent_micros=${nextCampaign.spentMicros} where owner_id=${ownerId} and campaign_id=${run.campaign_id}`;
    const [row] = await tx`update dk_generator_v2.calls set status=${input.status},actual_micros=${input.actualMicros},usage=${jsonParameter(tx, usage)}::jsonb,result=${jsonParameter(tx, result)}::jsonb,last_response_status=${input.lastResponseStatus},updated_at=clock_timestamp()
      where owner_id=${ownerId} and run_id=${runId} and operation_id=${operationId} returning *`;
    await event(tx, runId, ownerId, 'provider.reconciled', 'Operator reconciled a recorded terminal provider response. Run status and call count are unchanged.', {
      operationId, responseId: input.responseId, requestHash: input.requestHash, actualMicros: input.actualMicros, releasedMicros: Number(prior.reserved_micros) - input.actualMicros, status: input.lastResponseStatus,
    });
    return mapCall(row);
  });
}

export function validatePilotSnapshot(contract: GenerationContract, snapshot: GeneratorSnapshot, input: CandidateBinding): CandidateBinding {
  const candidate = candidateBindingSchema.parse(input);
  const verified = createGeneratorSnapshot(snapshot);
  if (!sameIdentity(contract.identity, snapshot.scope) || !sameIdentity(contract.identity, candidate.identity) || candidate.contractHash !== contractFingerprint(contract)
    || snapshot.schemaVersion !== 1 || verified.hash !== snapshot.hash || verified.totalBytes !== snapshot.totalBytes
    || candidate.sourceHash !== snapshot.hash || candidate.revision !== snapshot.revision
    || snapshot.files.some(file => verified.files.find(found => found.path === file.path)?.hash !== file.hash)) throw new Error('PILOT_SNAPSHOT_SCOPE_OR_HASH_MISMATCH');
  if (snapshot.parent) { scopedId.parse(snapshot.parent.revision); digest.parse(snapshot.parent.hash); }
  return candidate;
}
/** The new runtime begins an additive lineage; it cannot relabel or replace historical candidates. */
export function validatePrivateboardRuntimeRequalificationSnapshot(contract: GenerationContract, input: PrivateboardRuntimeRequalification, snapshot: GeneratorSnapshot, candidate: CandidateBinding, parent: PilotSavedSnapshot | undefined): void {
  const authorization = privateboardRuntimeRequalificationSchema.parse(input);
  validatePilotSnapshot(contract, snapshot, candidate);
  const expectedParent = snapshot.revision === 'runtime-1' ? authorization.sourceRevision
    : snapshot.revision === 'upgrade-1' ? 'runtime-1' : snapshot.revision === 'refine-1' ? 'upgrade-1' : undefined;
  if (!expectedParent || !parent || candidate.runtimeDigest !== authorization.toRuntimeDigest
    || snapshot.parent?.revision !== expectedParent || parent.snapshot.revision !== expectedParent || snapshot.parent.hash !== parent.snapshot.hash
    || parent.candidate.runtimeDigest !== (snapshot.revision === 'runtime-1' ? authorization.fromRuntimeDigest : authorization.toRuntimeDigest))
    throw new Error('PILOT_RUNTIME_REQUALIFICATION_SNAPSHOT_SCOPE_MISMATCH');
  validatePilotSnapshot(contract, parent.snapshot, parent.candidate);
  if (snapshot.revision === 'runtime-1') {
    if (snapshot.hash !== authorization.sourceHash || canonical(snapshot) !== canonical({ ...parent.snapshot, revision: 'runtime-1', parent: { revision: authorization.sourceRevision, hash: authorization.sourceHash } }))
      throw new Error('PILOT_RUNTIME_REQUALIFICATION_SOURCE_MISMATCH');
  } else if (snapshot.revision === 'upgrade-1') {
    if (parent.snapshot.hash !== authorization.sourceHash || snapshot.files.length !== parent.snapshot.files.length + 1
      || !snapshot.files.some(file => file.path === 'supabase/migrations/002_priority.sql')
      || parent.snapshot.files.some(file => canonical(snapshot.files.find(next => next.path === file.path)) !== canonical(file)))
      throw new Error('PILOT_RUNTIME_REQUALIFICATION_SOURCE_MISMATCH');
  } else if (snapshot.files.length !== parent.snapshot.files.length || parent.snapshot.files.some(file => {
    const next = snapshot.files.find(item => item.path === file.path);
    return !next || (file.path !== 'src/styles.css' && canonical(next) !== canonical(file));
  })) throw new Error('PILOT_RUNTIME_REQUALIFICATION_SOURCE_MISMATCH');
}

/** Environment recovery keeps the original runtime and normal build/repair/upgrade/refine lineage. */
export function validatePrivateboardEnvironmentRecoverySnapshot(contract: GenerationContract, input: PrivateboardEnvironmentRecovery, snapshot: GeneratorSnapshot, candidate: CandidateBinding, parent: PilotSavedSnapshot | undefined): void {
  const authorization = privateboardEnvironmentRecoverySchema.parse(input);
  validatePilotSnapshot(contract, snapshot, candidate);
  if (candidate.runtimeDigest !== authorization.runtimeDigest) throw new Error('PILOT_ENVIRONMENT_RECOVERY_SNAPSHOT_SCOPE_MISMATCH');
  if (snapshot.revision === 'build-1') {
    if (snapshot.hash !== authorization.sourceHash || snapshot.parent) throw new Error('PILOT_ENVIRONMENT_RECOVERY_SOURCE_MISMATCH');
    return;
  }
  const parentRevisions = snapshot.revision === 'repair-1' ? ['build-1'] : snapshot.revision === 'repair-2' ? ['repair-1']
    : snapshot.revision === 'upgrade-1' ? ['build-1', 'repair-1', 'repair-2'] : snapshot.revision === 'refine-1' ? ['upgrade-1'] : [];
  if (!parent || !parentRevisions.includes(parent.snapshot.revision) || snapshot.parent?.revision !== parent.snapshot.revision || snapshot.parent.hash !== parent.snapshot.hash
    || parent.candidate.runtimeDigest !== authorization.runtimeDigest || (parent.snapshot.revision === 'build-1' && parent.snapshot.hash !== authorization.sourceHash))
    throw new Error('PILOT_ENVIRONMENT_RECOVERY_SNAPSHOT_SCOPE_MISMATCH');
  validatePilotSnapshot(contract, parent.snapshot, parent.candidate);
  if (snapshot.revision === 'repair-1' || snapshot.revision === 'repair-2') {
    if (snapshot.files.length !== 3 || snapshot.files.some(file => !SUPABASE_PILOT_INITIAL_PATHS.includes(file.path as typeof SUPABASE_PILOT_INITIAL_PATHS[number])))
      throw new Error('PILOT_ENVIRONMENT_RECOVERY_SOURCE_MISMATCH');
  } else if (snapshot.revision === 'upgrade-1') {
    if (snapshot.files.length !== parent.snapshot.files.length + 1 || !snapshot.files.some(file => file.path === 'supabase/migrations/002_priority.sql')
      || parent.snapshot.files.some(file => canonical(snapshot.files.find(next => next.path === file.path)) !== canonical(file)))
      throw new Error('PILOT_ENVIRONMENT_RECOVERY_SOURCE_MISMATCH');
  } else if (snapshot.files.length !== parent.snapshot.files.length || parent.snapshot.files.some(file => {
    const next = snapshot.files.find(item => item.path === file.path);
    return !next || (file.path !== 'src/styles.css' && canonical(next) !== canonical(file));
  })) throw new Error('PILOT_ENVIRONMENT_RECOVERY_SOURCE_MISMATCH');
}
export async function savePilotSnapshot(lease: PilotLease, snapshot: GeneratorSnapshot, input: CandidateBinding): Promise<PilotSavedSnapshot> {
  return withLease(lease, async (tx, run) => {
    if (!['building','verifying'].includes(run.status)) throw new Error('PILOT_SNAPSHOT_NOT_ALLOWED');
    const candidate = validatePilotSnapshot(contractSchema.parse(run.contract), snapshot, input);
    if (run.details?.recoveryMode === 'runtime-requalification') {
      const [parent] = await tx`select snapshot,candidate,created_at from dk_generator_v2.snapshots where owner_id=${lease.ownerId} and run_id=${lease.runId} and revision=${snapshot.parent?.revision ?? ''}`;
      validatePrivateboardRuntimeRequalificationSnapshot(contractSchema.parse(run.contract), run.details.runtimeRequalification, snapshot, candidate,
        parent ? { snapshot: parent.snapshot, candidate: parent.candidate, createdAt: iso(parent.created_at) } : undefined);
      if (snapshot.revision !== 'runtime-1') {
        const [call] = await tx`select status,actual_micros from dk_generator_v2.calls where owner_id=${lease.ownerId} and run_id=${lease.runId} and operation_id=${snapshot.revision}`;
        if (!call || call.status !== 'completed' || call.actual_micros === null) throw new Error('PILOT_RUNTIME_REQUALIFICATION_CALL_HISTORY_MISMATCH');
      }
    } else if (run.details?.recoveryMode === 'environment-recovery') {
      const [parent] = await tx`select snapshot,candidate,created_at from dk_generator_v2.snapshots where owner_id=${lease.ownerId} and run_id=${lease.runId} and revision=${snapshot.parent?.revision ?? ''}`;
      validatePrivateboardEnvironmentRecoverySnapshot(contractSchema.parse(run.contract), run.details.environmentRecovery, snapshot, candidate,
        parent ? { snapshot: parent.snapshot, candidate: parent.candidate, createdAt: iso(parent.created_at) } : undefined);
      const [call] = await tx`select status,actual_micros from dk_generator_v2.calls where owner_id=${lease.ownerId} and run_id=${lease.runId} and operation_id=${snapshot.revision}`;
      if (!call || call.status !== 'completed' || call.actual_micros === null) throw new Error('PILOT_ENVIRONMENT_RECOVERY_CALL_HISTORY_MISMATCH');
    }
    const [existing] = await tx`select * from dk_generator_v2.snapshots where owner_id=${lease.ownerId} and run_id=${lease.runId} and revision=${candidate.revision}`;
    if (existing) {
      if (!sameCandidate(existing.candidate, candidate) || canonical(existing.snapshot) !== canonical(snapshot)) throw new Error('PILOT_SNAPSHOT_CONFLICT');
      await tx`update dk_generator_v2.runs set candidate=${jsonParameter(tx, json(candidate))}::jsonb,status='verifying' where owner_id=${lease.ownerId} and id=${lease.runId}`;
      await event(tx, lease.runId, lease.ownerId, 'candidate.reused', 'Existing immutable candidate selected for verification.', { revision: candidate.revision, sourceHash: candidate.sourceHash });
      return { snapshot: existing.snapshot, candidate: existing.candidate, createdAt: iso(existing.created_at) };
    }
    if (snapshot.parent) {
      const [parent] = await tx`select source_hash from dk_generator_v2.snapshots where owner_id=${lease.ownerId} and run_id=${lease.runId} and revision=${snapshot.parent.revision}`;
      if (!parent || parent.source_hash !== snapshot.parent.hash) throw new Error('PILOT_SNAPSHOT_PARENT_MISSING');
    }
    const [row] = await tx`insert into dk_generator_v2.snapshots(owner_id,run_id,revision,source_hash,snapshot,candidate)
      values(${lease.ownerId},${lease.runId},${candidate.revision},${candidate.sourceHash},${jsonParameter(tx, json(snapshot))}::jsonb,${jsonParameter(tx, json(candidate))}::jsonb) returning *`;
    await tx`update dk_generator_v2.runs set candidate=${jsonParameter(tx, json(candidate))}::jsonb,status='verifying' where owner_id=${lease.ownerId} and id=${lease.runId}`;
    await event(tx, lease.runId, lease.ownerId, 'candidate.saved', 'Immutable candidate saved for verification.', { revision: candidate.revision, sourceHash: candidate.sourceHash });
    return { snapshot: row.snapshot, candidate: row.candidate, createdAt: iso(row.created_at) };
  });
}
export async function getPilotSnapshots(runId: string, ownerId: string): Promise<PilotSavedSnapshot[]> {
  scope(runId, ownerId);
  const rows = await database()`select snapshot,candidate,created_at from dk_generator_v2.snapshots where owner_id=${ownerId} and run_id=${runId} order by created_at,revision`;
  return rows.map(row => ({ snapshot: row.snapshot, candidate: row.candidate, createdAt: iso(row.created_at) }));
}
/** Checkpoints and final delivery share the same exact-candidate gate; neither is a weaker preview approval. */
async function publishPilotDelivery(lease: PilotLease, candidate: CandidateBinding, evidence: VerificationEvidence[], allowedVerifierVersions: Readonly<Record<string, readonly string[]>>, final: boolean): Promise<PilotRun> {
  return withLease(lease, async (tx, run) => {
    if (run.status !== 'verifying' || !run.candidate || !sameCandidate(run.candidate, candidateBindingSchema.parse(candidate))) throw new Error('PILOT_ACCEPTED_CANDIDATE_STALE');
    if (run.details?.recoveryMode === 'runtime-requalification') {
      const authorization = privateboardRuntimeRequalificationSchema.parse(run.details.runtimeRequalification);
      if (candidate.runtimeDigest !== authorization.toRuntimeDigest || !['runtime-1', 'upgrade-1', 'refine-1'].includes(candidate.revision)
        || evidence.some(item => item.verifierVersion !== authorization.verifierVersion)) throw new Error('PILOT_RUNTIME_REQUALIFICATION_DELIVERY_SCOPE_MISMATCH');
    } else if (run.details?.recoveryMode === 'environment-recovery') {
      const authorization = privateboardEnvironmentRecoverySchema.parse(run.details.environmentRecovery);
      if (candidate.runtimeDigest !== authorization.runtimeDigest || !['build-1', 'repair-1', 'repair-2', 'upgrade-1', 'refine-1'].includes(candidate.revision)
        || (candidate.revision === 'build-1' && candidate.sourceHash !== authorization.sourceHash)) throw new Error('PILOT_ENVIRONMENT_RECOVERY_DELIVERY_SCOPE_MISMATCH');
    }
    if (Number(run.reserved_micros) !== 0) throw new Error('PILOT_PROVIDER_UNRESOLVED');
    const [clock] = await tx`select (extract(epoch from clock_timestamp())*1000)::bigint as now_ms`;
    const checked = evaluateRelease({ contract: contractSchema.parse(run.contract), candidate, evidence, allowedVerifierVersions, now: Number(clock.now_ms) });
    if (checked.status !== 'passed') throw new Error('PILOT_DELIVERY_CHECKS_FAILED');
    const [snapshot] = await tx`select candidate from dk_generator_v2.snapshots where owner_id=${lease.ownerId} and run_id=${lease.runId} and revision=${candidate.revision}`;
    if (!snapshot || !sameCandidate(snapshot.candidate, candidate)) throw new Error('PILOT_SNAPSHOT_MISSING');
    await tx`update dk_generator_v2.runs set accepted=${jsonParameter(tx, json(candidate))}::jsonb,status=${final ? 'ready' : 'verifying'} where owner_id=${lease.ownerId} and id=${lease.runId}`;
    await event(tx, lease.runId, lease.ownerId, final ? 'run.ready' : 'delivery.checkpoint', final
      ? 'The exact candidate passed all required delivery checks.'
      : 'A verified checkpoint is available while work continues. Later unverified changes cannot replace it.', { candidate, evidence });
    return (await readRun(tx, lease.runId, lease.ownerId))!;
  });
}
export async function acceptPilotSnapshot(lease: PilotLease, candidate: CandidateBinding, evidence: VerificationEvidence[], allowedVerifierVersions: Readonly<Record<string, readonly string[]>>): Promise<PilotRun> {
  return publishPilotDelivery(lease, candidate, evidence, allowedVerifierVersions, true);
}
/** Exposes only a fully verified immutable candidate, preserving the live worker lease and ongoing phase. */
export async function publishPilotCheckpoint(lease: PilotLease, candidate: CandidateBinding, evidence: VerificationEvidence[], allowedVerifierVersions: Readonly<Record<string, readonly string[]>>): Promise<PilotRun> {
  return publishPilotDelivery(lease, candidate, evidence, allowedVerifierVersions, false);
}
