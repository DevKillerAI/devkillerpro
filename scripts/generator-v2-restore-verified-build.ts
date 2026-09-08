import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { database, closeDatabase } from '../src/lib/server/database';
import { getPilotRun, getPilotSnapshots, claimPilotRecordedRecovery, heartbeatPilotRun, appendPilotEvent, savePilotSnapshot, acceptPilotSnapshot } from '../src/lib/server/generator/pilotStore';
import { assertPilotContract, PILOT_CAMPAIGN } from '../src/lib/server/generator/pilotContract';
import { inspectBriefboardRuntime, pilotArtifactDirectory, verifyBriefboardPilot } from '../src/lib/server/generator/pilotVerifier';
import { bindSourceCandidate } from '../src/lib/server/generator/operationPolicy';
import { exportPilotZip, pilotBundleHash, writePilotDelivery, type PilotDelivery } from '../src/lib/server/generator/pilotDelivery';
import { requiredCheckIds } from '../src/lib/server/generator/contract';
import { evaluateRelease, type VerificationEvidence } from '../src/lib/server/generator/releaseGate';
import { failBriefboardPilot } from '../src/lib/server/generator/pilotSupervisor';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function main() {
  const [runId, sequenceText, apply] = process.argv.slice(2);
  if (!runId || !/^\d+$/.test(sequenceText || '') || apply !== '--apply') throw new Error('Usage: generator-v2-restore-verified-build.ts RUN_ID EXPECTED_SEQUENCE --apply');
  const [owner] = await database()`select u.id from auth.users u join profiles p on p.id=u.id where lower(u.email)=lower(${process.env.DEVKILLER_PILOT_EMAIL || ''}) and p.role='admin'`;
  if (!owner) throw new Error('Configured owner administrator not found.');
  const run = await getPilotRun(runId, owner.id);
  if (!run || run.campaignId !== PILOT_CAMPAIGN || run.status !== 'failed' || run.sequence !== Number(sequenceText)) throw new Error('Run is not the reviewed failed pilot state.');
  assertPilotContract(run.contract);
  const saved = await getPilotSnapshots(runId, owner.id);
  const base = saved.at(-1);
  if (!base || base.snapshot.revision.startsWith('refine')) throw new Error('An unchanged initial build snapshot is required.');
  const runtime = await inspectBriefboardRuntime();
  if (!runtime.available) throw new Error(runtime.reason);
  const runtimeDigest = hash(`${runtime.imageId}:${runtime.verifierVersion}`);
  if (runtimeDigest !== base.candidate.runtimeDigest) throw new Error('Restoration runtime differs from the source candidate.');
  const lease = await claimPilotRecordedRecovery(runId, owner.id, `v2-restore-${randomUUID()}`, Number(sequenceText), 'Reverify and expose the already-generated initial application. The style-refinement trial failed/was cancelled and is explicitly not approved. No source edits or provider calls.');
  const controller = new AbortController(); const timer = setInterval(() => { void heartbeatPilotRun(lease).catch(() => controller.abort()); }, 15_000);
  try {
    const candidate = bindSourceCandidate(base.snapshot, run.contract, runtimeDigest);
    await savePilotSnapshot(lease, base.snapshot, candidate);
    const result = await verifyBriefboardPilot({ snapshot: base.snapshot, expectedRuntimeImageId: runtime.imageId, signal: controller.signal,
      outputDirectory: path.join(pilotArtifactDirectory(base.snapshot), `attempt-${randomUUID()}`) });
    if (result.sourceHash !== base.snapshot.hash || result.runtimeImageId !== runtime.imageId || result.status !== 'passed') throw new Error(`Initial build re-verification failed: ${result.failures.join(' ')}`);
    const delivery: PilotDelivery = { candidate, compiledFiles: result.compiledFiles, compiledHash: pilotBundleHash(result.compiledFiles), checks: [...result.checks], limitations: [...result.limitations, 'The first style-refinement trial did not complete. Only the initial application is approved.'],
      initialRevision: base.snapshot.revision, finalRevision: base.snapshot.revision, refinementVerified: false, durationMs: Date.now() - Date.parse(run.createdAt) };
    await exportPilotZip(base.snapshot, delivery);
    delivery.checks.push({ id: 'platform:source-export', passed: true, details: 'Exact generated sources and compiled output round-trip through the export ZIP.' });
    const now = Date.now();
    const evidence: VerificationEvidence[] = delivery.checks.map((check, index) => ({ id: `restore-proof-${index + 1}`, sequence: index + 1, binding: candidate, checkId: check.id,
      producer: 'platform-runner', verifierVersion: runtime.verifierVersion, executed: true, status: check.passed ? 'passed' : 'failed', completedAt: now, artifactHash: hash(JSON.stringify(check)) }));
    const allow = Object.fromEntries(requiredCheckIds(run.contract).map(id => [id, [runtime.verifierVersion]]));
    if (evaluateRelease({ contract: run.contract, candidate, evidence, allowedVerifierVersions: allow, now }).status !== 'passed') throw new Error('Initial build did not pass the release gate.');
    await writePilotDelivery(base.snapshot, delivery);
    await appendPilotEvent(lease, 'benchmark.partial', 'The initial application is verified and available. The style-refinement trial was not approved; no generated source was changed by the operator.', { refinementVerified: false, checks: delivery.checks });
    await acceptPilotSnapshot(lease, candidate, evidence, allow);
    console.log(JSON.stringify({ runId, appStatus: 'ready', fullBenchmarkPassed: false, refinementVerified: false, newProviderCalls: 0, checks: delivery.checks.length }, null, 2));
  } catch (error) { await failBriefboardPilot(lease, error); throw error; }
  finally { clearInterval(timer); }
}
main().catch(error => { console.error(error instanceof Error ? error.message.replace(/sk-[\w-]+/g, '[REDACTED]') : 'Build restoration failed'); process.exitCode = 1; }).finally(closeDatabase);
