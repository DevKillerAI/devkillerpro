import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { requiredCheckIds } from './contract';
import { assertPrivateboardContract, SUPABASE_PILOT_INITIAL_PATHS, SUPABASE_PILOT_PATHS, privateboardEnvironmentIdentity } from './supabasePilotContract';
import { callPilotJson } from './pilotProvider';
import { getPilotRun, getPilotCall, getPilotSnapshots, appendPilotEvent, savePilotSnapshot, updatePilotState, acceptPilotSnapshot, type PilotLease } from './pilotStore';
import type { GeneratorSnapshot } from './versionedEdits';
import { bindSourceCandidate } from './operationPolicy';
import { inspectPrivateboardRuntime } from './supabasePilotRuntime';
import { pilotArtifactDirectory } from './pilotRuntime';
import { exportPilotZip, pilotBundleHash, writePilotDelivery, type PilotDelivery } from './pilotDelivery';
import { evaluateRelease, type VerificationEvidence } from './releaseGate';
import { ensureSupabasePilotEnvironment, applySupabasePilotMigrations, inspectSupabasePilotPrerequisites, type SupabasePilotEnvironment } from './supabasePilotEnvironment';
import { verifyPrivateboardPilot, validatePrivateboardBaseline, type PrivateboardMigrationBaseline } from './supabasePilotVerifier';
import type { PilotVerification } from './pilotVerifier';
import { classifyPilotPatchFailure, describePilotPatchFailure } from './pilotPatchRecovery';
import { privateboardRuntimeRequalificationSchema } from './supabasePilotRequalification';
import { PRIVATEBOARD_OPERATIONS, PRIVATEBOARD_STYLE_REQUEST, privateboardBuildRequest, privateboardPatchRequest, privateboardUpgradeRequest,
  replayPrivateboardCalls, applyPrivateboardRecordedOutput, privateboardSourceRepairFailures, planPrivateboardStyleCorrection, type PrivateboardOperation } from './supabasePilotReplay';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const safeError = (error: unknown) => (error instanceof Error ? error.message : 'Unknown failure').replace(/sk-[\w-]+/g, '[REDACTED]').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[REDACTED_TOKEN]').slice(0, 2200);

function fixtureFile(environment: SupabasePilotEnvironment) {
  if (!/^[a-f0-9]{64}$/.test(environment.scopeHash)) throw new Error('Invalid fixture scope.');
  return path.resolve('.devkiller/generator-v2/private-fixtures', `${environment.scopeHash}.json`);
}
async function readBaseline(environment: SupabasePilotEnvironment): Promise<PrivateboardMigrationBaseline | undefined> {
  try {
    const text = await readFile(fixtureFile(environment), 'utf8');
    if (Buffer.byteLength(text) > 128 * 1024) throw new Error('Private fixture exceeds its bound.');
    const value = JSON.parse(text);
    if (value.scopeHash !== environment.scopeHash) throw new Error('Private fixture identity mismatch.');
    return validatePrivateboardBaseline(value.baseline, environment.scopeHash);
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
async function saveBaseline(environment: SupabasePilotEnvironment, baseline: PrivateboardMigrationBaseline) {
  const file = fixtureFile(environment);
  validatePrivateboardBaseline(baseline, environment.scopeHash);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.pending`;
  try {
    await writeFile(temporary, JSON.stringify({ scopeHash: environment.scopeHash, baseline }), { flag: 'wx', mode: 0o600 });
    // Publish only a complete immutable fixture. A crash before the hard link
    // leaves an unused temporary file, never a truncated authoritative baseline.
    try { await link(temporary, file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (JSON.stringify(await readBaseline(environment)) !== JSON.stringify(baseline)) throw new Error('The immutable private baseline already contains different evidence.');
    }
  } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
}

/** Real generation only; source is supplied by the metered DK provider, never an operator-written app. */
export async function runPrivateboardPilot(lease: PilotLease, signal: AbortSignal) {
  const run = await getPilotRun(lease.runId, lease.ownerId);
  if (!run) throw new Error('Pilot not found.');
  const contract = run.contract;
  assertPrivateboardContract(contract);
  const runtime = await inspectPrivateboardRuntime(signal);
  if (!runtime.available) throw new Error(runtime.reason);
  const prerequisites = await inspectSupabasePilotPrerequisites(signal);
  if (!prerequisites.available) throw new Error(prerequisites.reason);
  const runtimeImageId = runtime.imageId;
  const verifierVersion = runtime.verifierVersion;
  const runtimeDigest = hash(runtimeImageId + ':' + verifierVersion);
  const recoveryDetails = run.details && typeof run.details === 'object' ? run.details as Record<string, unknown> : {};
  const requalification = recoveryDetails.recoveryMode === 'runtime-requalification'
    ? privateboardRuntimeRequalificationSchema.parse(recoveryDetails.runtimeRequalification) : undefined;
  if (requalification && (requalification.toImageId !== runtimeImageId || requalification.verifierVersion !== verifierVersion))
    throw new Error('The explicitly approved corrected runtime changed. No provider call was started.');
  if (['queued', 'awaiting_input'].includes(run.status)) await updatePilotState(lease, 'planning');
  await appendPilotEvent(lease, 'plan.confirmed', 'Privateboard: real app accounts, PostgreSQL tasks, cross-user checks, a data-preserving migration and a localized style edit.', {
    runtimeImageId, budgetMicros: contract.budget.maxCostMicros,
  });
  await updatePilotState(lease, 'building');
  const loadReplay = async () => {
    const [calls, saved, currentRun] = await Promise.all([
      Promise.all(PRIVATEBOARD_OPERATIONS.map(operationId => getPilotCall(lease.runId, lease.ownerId, operationId))),
      getPilotSnapshots(lease.runId, lease.ownerId), getPilotRun(lease.runId, lease.ownerId),
    ]);
    const recorded = calls.filter((call): call is NonNullable<typeof call> => call !== null);
    if (!currentRun || recorded.length !== currentRun.budget.callCount) throw new Error('Unexpected recorded provider operation; automatic replay stopped.');
    return { replay: replayPrivateboardCalls(contract, recorded, saved, runtimeDigest, requalification), saved, currentRun };
  };
  let restored = await loadReplay();
  if (!restored.replay.snapshot && !restored.replay.pending) {
    await callPilotJson({ lease, operationId: 'build-1', ...privateboardBuildRequest(), signal,
      onStatus: async status => { await appendPilotEvent(lease, 'provider.progress', `Builder response: ${status}.`); } });
    restored = await loadReplay();
  }
  while (restored.replay.pending) {
    const pending = restored.replay.pending;
    // The exact recorded input is validated against the reconstructed base.
    // Existing response IDs resume through GET; unknown POSTs are never resent.
    await callPilotJson({ lease, operationId: pending.operationId, ...pending.input, signal });
    restored = await loadReplay();
  }
  const replay = restored.replay;
  if (!replay.snapshot) throw new Error('No settled generated source is available.');
  for (const reconstructed of replay.snapshots) {
    if (!restored.saved.some(item => item.snapshot.revision === reconstructed.revision))
      await savePilotSnapshot(lease, reconstructed, bindSourceCandidate(reconstructed, contract,
        requalification && /^(build|repair)-[12]$/.test(reconstructed.revision) ? requalification.fromRuntimeDigest : runtimeDigest));
  }
  let snapshot = replay.snapshot;
  let repairs = replay.repairs;
  const knownSnapshots = [...replay.snapshots];
  if (replay.upgraded) await appendPilotEvent(lease, 'source.replayed', 'Resumed the exact recorded upgraded candidate. Older migration sets are not reapplied and no completed provider call is resubmitted.', { revision: snapshot.revision, sourceHash: snapshot.hash, repairs });
  let finalEnvironment: SupabasePilotEnvironment | undefined;
  let migrationFingerprint = '';

  async function patch(current: GeneratorSnapshot, operationId: PrivateboardOperation, request: string, allowedPaths: readonly string[]) {
    await updatePilotState(lease, 'building');
    const response = await callPilotJson({ lease, operationId, ...privateboardPatchRequest(current, request, allowedPaths), signal });
    let next: GeneratorSnapshot;
    try { next = applyPrivateboardRecordedOutput(contract, current, operationId, response.data); }
    catch (error) {
      // Only local rejection of the original style proposal is eligible. The
      // provider await above and the correction below are outside this catch.
      if (operationId !== 'refine-1' || !classifyPilotPatchFailure(error)) throw error;
      next = await correctStyle(current, error);
    }
    if (next.revision === operationId) await appendPilotEvent(lease, 'source.edited', 'The scoped generated patch was applied to its exact source base.', { revision: next.revision,
      changedFiles: allowedPaths.filter(p=>current.files.find(f=>f.path===p)?.hash!==next.files.find(f=>f.path===p)?.hash) });
    return next;
  }

  async function correctStyle(current: GeneratorSnapshot, localError: unknown) {
    if (!classifyPilotPatchFailure(localError)) throw localError;
    const recorded = await loadReplay(), rejected = recorded.replay.rejectedRefinement;
    if (!rejected || recorded.replay.refined || rejected.base.hash !== current.hash || rejected.base.revision !== current.revision ||
      classifyPilotPatchFailure(rejected.error) !== classifyPilotPatchFailure(localError)) throw new Error('Style correction does not match the settled rejected original and unchanged base.');
    const correctionAlreadyRecorded = recorded.replay.pending?.operationId === 'refine-repair-1';
    const plan = planPrivateboardStyleCorrection(current, rejected.proposal, rejected.error, 'refine-1', {
      repairsUsed: recorded.replay.repairs - (correctionAlreadyRecorded ? 1 : 0), maxRepairAttempts: contract.budget.maxRepairAttempts,
      providerCallsUsed: recorded.currentRun.budget.callCount, maxProviderCalls: contract.budget.maxProviderCalls,
      correctionAttempts: 0, correctionAlreadyRecorded,
    }, { runBudget: recorded.currentRun.budget, campaignBudget: recorded.currentRun.campaignBudget });
    if (!plan.allowed) throw new Error(`Privateboard style correction stopped: ${plan.reason}`);
    repairs = plan.repairsUsed;
    await appendPilotEvent(lease, 'source.patch-rejected', 'The style patch was rejected atomically. One bounded CSS-only correction uses the unchanged pre-refinement source.', {
      operationId: 'refine-1', correctionOperationId: plan.operationId, repairs, diagnosis: describePilotPatchFailure(rejected.error, current, rejected.proposal),
    });
    signal.throwIfAborted();
    const corrected = await callPilotJson({ lease, operationId: plan.operationId, ...plan.input, signal });
    // Deliberately no recovery catch: a failed correction cannot correct itself.
    const next = applyPrivateboardRecordedOutput(contract, current, plan.operationId, corrected.data);
    await appendPilotEvent(lease, 'source.edited', 'The single corrected style patch was applied; React source and SQL migrations are unchanged.', {
      revision: next.revision, changedFiles: ['src/styles.css'],
    });
    return next;
  }

  async function verify(current: GeneratorSnapshot): Promise<PilotVerification> {
    signal.throwIfAborted();
    await updatePilotState(lease, 'verifying');
    const candidate = bindSourceCandidate(current, contract, runtimeDigest);
    await savePilotSnapshot(lease, current, candidate);
    if (!knownSnapshots.some(item => item.hash === current.hash)) knownSnapshots.push(current);
    await appendPilotEvent(lease, 'verification.started', `Checking ${current.revision} with real isolated Supabase accounts and data.`, { revision: current.revision, sourceHash: current.hash });
    const identity = privateboardEnvironmentIdentity(current);
    const environmentStartedAt = Date.now();
    await appendPilotEvent(lease, 'verification.environment', 'Preparing the application’s own database and authentication environment. Existing records are preserved.', { revision: current.revision });
    const environment = await ensureSupabasePilotEnvironment(identity, signal);
    finalEnvironment = environment;
    await appendPilotEvent(lease, 'verification.environment-ready', 'The application environment is ready. Checking a separate deployment for isolation next.', { revision: current.revision, durationMs: Date.now() - environmentStartedAt });
    const comparisonIdentity = { ...identity, projectId: `${identity.projectId}-peer`, environmentId: `${identity.environmentId}-peer` };
    const comparison = await ensureSupabasePilotEnvironment(comparisonIdentity, signal);
    const baseline = await readBaseline(environment);
    if (baseline && !knownSnapshots.some(item => item.hash === baseline.sourceHash && !item.files.some(file => file.path === SUPABASE_PILOT_PATHS[3]) &&
      privateboardEnvironmentIdentity(item).environmentId === environment.identity.environmentId)) throw new Error('The private migration baseline is not bound to a recorded pre-upgrade candidate.');
    if (current.files.some(file => file.path === SUPABASE_PILOT_PATHS[3]) && !baseline) throw new Error('The pre-upgrade private baseline is missing. No migration is applied and no preservation claim is made.');
    let migrations;
    try {
      migrations = await applySupabasePilotMigrations(environment, current.files, signal);
      // A second isolated instance uses the model's same SQL. This tests deployment
      // isolation, not a second independently generated application's success rate.
      await applySupabasePilotMigrations(comparison, current.files, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof Error) || error.name !== 'SupabasePilotMigrationError') throw error;
      const details = safeError(error);
      const id = current.files.some(f=>f.path===SUPABASE_PILOT_PATHS[3]) ? 'platform:migration-upgrade' : 'platform:migration-fresh';
      const result: PilotVerification = {status:'failed',sourceHash:current.hash,runtimeImageId,verifierVersion,
        compiledFiles:[],checks:[{id,passed:false,details}],failures:[details],limitations:[],durationMs:0};
      await appendPilotEvent(lease,'verification.finished','The database rejected the executed migration.',{revision:current.revision,status:result.status,checks:result.checks});
      return result;
    }
    migrationFingerprint = migrations.fingerprint;
    await appendPilotEvent(lease, 'verification.runtime', 'Migrations are committed. Running real login, data-isolation, restart and browser checks on this exact revision.', { revision: current.revision, preparationMs: Date.now() - environmentStartedAt });
    const result = await verifyPrivateboardPilot({snapshot:current,environment,comparisonEnvironment:comparison,migrations,
      expectedEnvironmentIdentity:identity,expectedComparisonEnvironmentIdentity:comparisonIdentity,
      migrationBaseline:baseline,signal,expectedRuntimeImageId:runtimeImageId,outputDirectory:path.join(pilotArtifactDirectory(current),`attempt-${randomUUID()}`)});
    if(result.sourceHash!==current.hash||result.runtimeImageId!==runtimeImageId) throw new Error('Database verification candidate/runtime mismatch.');
    if (result.migrationBaseline && !baseline) await saveBaseline(environment, result.migrationBaseline);
    // Test fixture passwords/tokens NEVER enter events, source, deliveries or exports.
    if (result.compiledFiles.length) {
      await exportPilotZip(current,{candidate,compiledFiles:result.compiledFiles,compiledHash:pilotBundleHash(result.compiledFiles)});
      result.checks.push({id:'platform:source-export',passed:true,details:'Exact generated React/SQL sources and compiled assets round-trip through ZIP. No database records or secrets are exported.'});
    }
    await appendPilotEvent(lease,'verification.finished',`Verification ${result.status} for ${current.revision}.`,{
      revision:current.revision,status:result.status,checks:result.checks,failures:result.failures,limitations:result.limitations,durationMs:result.durationMs,
    });
    return result;
  }

  let report = await verify(snapshot);
  const seen = new Set(knownSnapshots.map(item => item.hash));
  while (!replay.upgraded && report.status === 'failed' && repairs < contract.budget.maxRepairAttempts) {
    const failures = privateboardSourceRepairFailures(report);
    repairs++;
    snapshot = await patch(snapshot,`repair-${repairs}` as 'repair-1' | 'repair-2',`Fix only these executed failures. Preserve all working behavior.\n${JSON.stringify(failures)}`,SUPABASE_PILOT_INITIAL_PATHS);
    if(seen.has(snapshot.hash)) throw new Error('Repeated source state; repair loop stopped.');
    seen.add(snapshot.hash);
    report = await verify(snapshot);
  }
  if(report.status!=='passed') throw new Error(`Database pilot verification ${report.status}; no delivery approved. ${report.failures.join(' ').slice(0,1500)}`);
  const initialRevision = replay.initialRevision || snapshot.revision;
  if (!replay.upgraded) {
    const initialRequired = requiredCheckIds(contract).filter(id=>id!=='platform:migration-upgrade');
    const missingInitial = initialRequired.filter(id=>!report.checks.some(check=>check.id===id&&check.passed));
    if(missingInitial.length) throw new Error(`Initial database proof is incomplete: ${missingInitial.join(', ')}. No speculative source repair.`);
    await appendPilotEvent(lease,'benchmark.initial-passed','Initial database/Auth checks passed. Testing a migration while preserving existing records next.',{revision:initialRevision,repairs});
    await updatePilotState(lease,'building');
    const upgrade = await callPilotJson({lease,operationId:'upgrade-1',...privateboardUpgradeRequest(snapshot),signal});
    snapshot = applyPrivateboardRecordedOutput(contract,snapshot,'upgrade-1',upgrade.data);
    await appendPilotEvent(lease,'source.edited','An additive priority migration was created. Existing source and the original migration are unchanged.',{revision:snapshot.revision,changedFiles:[SUPABASE_PILOT_PATHS[3]]});
    report = await verify(snapshot);
    if(report.status!=='passed') throw new Error(`The data-preserving upgrade did not pass (${report.status}). ${report.failures.join(' ').slice(0,1500)}`);
  }
  if (!replay.refined) {
    snapshot = replay.rejectedRefinement
      ? await correctStyle(snapshot, replay.rejectedRefinement.error)
      : await patch(snapshot,'refine-1',PRIVATEBOARD_STYLE_REQUEST,['src/styles.css']);
    report = await verify(snapshot);
  }
  if(report.status!=='passed'||!finalEnvironment) throw new Error(`Final database/Auth verification ${report.status}. No delivery approved.`);
  const candidate = bindSourceCandidate(snapshot,contract,runtimeDigest);
  const now=Date.now();
  const evidence:VerificationEvidence[]=report.checks.map((check,index)=>({id:`proof-${index+1}`,sequence:index+1,binding:candidate,checkId:check.id,producer:'platform-runner',verifierVersion,executed:true,status:check.passed?'passed':'failed',completedAt:now,artifactHash:hash(JSON.stringify(check))}));
  const allow=Object.fromEntries(requiredCheckIds(contract).map(id=>[id,[verifierVersion]]));
  const gate=evaluateRelease({contract,candidate,evidence,allowedVerifierVersions:allow,now});
  if(gate.status!=='passed') throw new Error(`Final proof incomplete: ${gate.blockers.map(b=>`${b.checkId}: ${b.reason}`).join(', ')}`);
  const delivery:PilotDelivery={candidate,compiledFiles:report.compiledFiles,compiledHash:pilotBundleHash(report.compiledFiles),checks:report.checks,
    limitations:[...report.limitations,'A fixed two-environment benchmark; not arbitrary multi-technology generation or public production certification.'],
    initialRevision,finalRevision:snapshot.revision,refinementVerified:true,durationMs:now-Date.parse(run.createdAt),runtime:{id:'react-supabase-pilot',version:'v1'},runtimeImageId,
    database:{scopeHash:finalEnvironment.scopeHash,stackId:finalEnvironment.stackId,migrationFingerprint,environmentId:finalEnvironment.identity.environmentId}};
  await writePilotDelivery(snapshot,delivery);
  await appendPilotEvent(lease,'benchmark.summary','Database/Auth, two isolated instances, data-preserving migration and style-only refinement passed the recorded checks.',{repairs,initialRevision,finalRevision:snapshot.revision,durationMs:delivery.durationMs});
  await acceptPilotSnapshot(lease,candidate,evidence,allow);
  return delivery;
}
