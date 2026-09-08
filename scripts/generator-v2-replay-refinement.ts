import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { database, closeDatabase } from '../src/lib/server/database';
import { getPilotRun, getPilotCall, getPilotSnapshots, claimPilotRecordedRecovery, heartbeatPilotRun, appendPilotEvent, savePilotSnapshot, acceptPilotSnapshot } from '../src/lib/server/generator/pilotStore';
import { assertPilotContract, PILOT_CAMPAIGN } from '../src/lib/server/generator/pilotContract';
import { applyRecordedPilotRefinement } from '../src/lib/server/generator/pilotRecordedRefinement';
import { inspectBriefboardRuntime, pilotArtifactDirectory, verifyBriefboardPilot } from '../src/lib/server/generator/pilotVerifier';
import { bindSourceCandidate } from '../src/lib/server/generator/operationPolicy';
import { exportPilotZip, pilotBundleHash, writePilotDelivery, type PilotDelivery } from '../src/lib/server/generator/pilotDelivery';
import { requiredCheckIds } from '../src/lib/server/generator/contract';
import { evaluateRelease, type VerificationEvidence } from '../src/lib/server/generator/releaseGate';
import { failBriefboardPilot } from '../src/lib/server/generator/pilotSupervisor';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function main() {
  // Explicit owner/run/CAS selection. No provider method is called by this recovery command.
  const [runId, expectedSequenceText, apply] = process.argv.slice(2);
  if (!runId || !/^\d+$/.test(expectedSequenceText || '') || apply !== '--apply') throw new Error('Usage: generator-v2-replay-refinement.ts RUN_ID EXPECTED_SEQUENCE --apply');
  const [owner] = await database()`select u.id from auth.users u join profiles p on p.id=u.id where lower(u.email)=lower(${process.env.DEVKILLER_PILOT_EMAIL || ''}) and p.role='admin'`;
  if (!owner) throw new Error('Configured owner administrator not found.');
  const run = await getPilotRun(runId, owner.id);
  if (!run || run.campaignId !== PILOT_CAMPAIGN || run.status !== 'failed' || run.sequence !== Number(expectedSequenceText)) throw new Error('Run is not the reviewed failed pilot state.');
  assertPilotContract(run.contract);
  const saved = await getPilotSnapshots(runId, owner.id);
  const base = saved.at(-1);
  const call = await getPilotCall(runId, owner.id, 'refine-1');
  if (!base || !call) throw new Error('Recorded refinement and source snapshot are required.');
  const replay = applyRecordedPilotRefinement(base.snapshot, call, Date.now());
  const runtime = await inspectBriefboardRuntime();
  if (!runtime.available) throw new Error(runtime.reason);
  const runtimeDigest = hash(`${runtime.imageId}:${runtime.verifierVersion}`);
  if (runtimeDigest !== base.candidate.runtimeDigest) throw new Error('Recovery runtime differs from the recorded candidate.');
  const lease = await claimPilotRecordedRecovery(runId, owner.id, `v2-replay-${randomUUID()}`, Number(expectedSequenceText), 'The recorded CSS refinement exceeded an inconsistent 8-edit local decoder limit. Revalidate the original paid response under the reviewed 16-edit limit, without a provider call.');
  const controller = new AbortController();
  const timer = setInterval(() => { void heartbeatPilotRun(lease).catch(() => controller.abort()); }, 15_000);
  try {
    const candidate = bindSourceCandidate(replay.snapshot, run.contract, runtimeDigest);
    await savePilotSnapshot(lease, replay.snapshot, candidate);
    await appendPilotEvent(lease, 'recovery.recorded-output', `Replaying ${replay.editCount} recorded CSS edits. No new AI call or generated app code was supplied by the operator.`);
    const result = await verifyBriefboardPilot({ snapshot: replay.snapshot, expectedRuntimeImageId: runtime.imageId, signal: controller.signal,
      outputDirectory: path.join(pilotArtifactDirectory(replay.snapshot), `attempt-${randomUUID()}`) });
    if (result.sourceHash !== replay.snapshot.hash || result.runtimeImageId !== runtime.imageId || result.status !== 'passed') throw new Error(`Recorded refinement verification did not pass: ${result.failures.join(' ')}`);
    const delivery: PilotDelivery = { candidate, compiledFiles: result.compiledFiles, compiledHash: pilotBundleHash(result.compiledFiles),
      checks: [...result.checks], limitations: result.limitations, initialRevision: base.snapshot.revision, finalRevision: replay.snapshot.revision,
      refinementVerified: true, durationMs: Date.now() - Date.parse(run.createdAt) };
    await exportPilotZip(replay.snapshot, delivery);
    delivery.checks.push({ id: 'platform:source-export', passed: true, details: 'Exact sources and compiled output round-trip through the export ZIP.' });
    const now = Date.now();
    const evidence: VerificationEvidence[] = delivery.checks.map((check, index) => ({ id: `recovery-proof-${index + 1}`, sequence: index + 1, binding: candidate,
      checkId: check.id, producer: 'platform-runner', verifierVersion: runtime.verifierVersion, executed: true,
      status: check.passed ? 'passed' : 'failed', completedAt: now, artifactHash: hash(JSON.stringify(check)) }));
    const allow = Object.fromEntries(requiredCheckIds(run.contract).map(id => [id, [runtime.verifierVersion]]));
    const gate = evaluateRelease({ contract: run.contract, candidate, evidence, allowedVerifierVersions: allow, now });
    if (gate.status !== 'passed') throw new Error('Recorded recovery did not satisfy the delivery gate.');
    await writePilotDelivery(replay.snapshot, delivery);
    await appendPilotEvent(lease, 'verification.finished', 'The recorded refinement passed all required checks after the decoder fix. No new provider call was made.', { checks: delivery.checks, durationMs: result.durationMs, sourceHash: replay.snapshot.hash });
    await acceptPilotSnapshot(lease, candidate, evidence, allow);
    console.log(JSON.stringify({ runId, status: 'ready', recovery: 'recorded-output-only', newProviderCalls: 0, checks: delivery.checks.length, initialRevision: delivery.initialRevision, finalRevision: delivery.finalRevision }, null, 2));
  } catch (error) { await failBriefboardPilot(lease, error); throw error; }
  finally { clearInterval(timer); }
}
main().catch(error => { console.error(error instanceof Error ? error.message.replace(/sk-[\w-]+/g, '[REDACTED]') : 'Recorded replay failed'); process.exitCode = 1; }).finally(closeDatabase);
