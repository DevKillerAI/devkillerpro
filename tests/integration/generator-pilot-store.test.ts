import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, closeDatabase } from '../../src/lib/server/database';
import { contractFingerprint, contractSchema, requiredCheckIds, type GenerationContract } from '../../src/lib/server/generator/contract';
import { createGeneratorSnapshot } from '../../src/lib/server/generator/versionedEdits';
import type { VerificationEvidence } from '../../src/lib/server/generator/releaseGate';
import {
  PILOT_CAMPAIGN_ID, createPilotRun, getPilotRun, listPilotRuns, claimPilotRun, claimPilotRecordedRecovery, claimPilotRefinementRepair, heartbeatPilotRun,
  appendPilotEvent, getPilotEvents, updatePilotState, cancelPilotRun, reservePilotCall, getPilotCall,
  markPilotSubmitted, markPilotCallUncertain, settlePilotCall, reconcilePilotTerminalCall, savePilotSnapshot, getPilotSnapshots,
  acceptPilotSnapshot, publishPilotCheckpoint, type PilotLease,
} from '../../src/lib/server/generator/pilotStore';

function assertLocalDatabase() {
  let url: URL;
  try { url = new URL(process.env.DATABASE_URL || ''); } catch { throw new Error('A local PostgreSQL URL is required for pilot store integration tests.'); }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'Only PostgreSQL is supported.');
  assert.ok(['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname), 'Refusing to run fixture writes against a non-loopback database.');
}

test('v2 pilot store: real local PostgreSQL transactions in isolated QA owner namespaces', { skip: !process.env.DATABASE_URL }, async t => {
  assertLocalDatabase();
  const sql = database();
  const owners = new Set<string>();
  const fixture = () => {
    const ownerId = `qa-pilot-${randomUUID()}`;
    const campaignId = `qa-${randomUUID()}`;
    assert.match(ownerId, /^qa-pilot-[a-f0-9-]{36}$/);
    assert.match(campaignId, /^qa-[a-f0-9-]{36}$/);
    assert.notEqual(campaignId, PILOT_CAMPAIGN_ID);
    owners.add(ownerId);
    const contract = (runId = `qa-run-${randomUUID()}`, maxCostMicros = 3_000_000, maxProviderCalls = 5): GenerationContract => contractSchema.parse({
      version: 1, engine: 'v2', identity: { ownerId, projectId: `qa-project-${randomUUID()}`, missionId: runId, environmentId: `qa-env-${randomUUID()}` },
      briefingMode: 'simple', prompt: 'SQL-only fixture. Never invoke a model or launch an application.', outputLocale: 'en', delivery: 'local_preview',
      runtime: { id: 'qa-static', version: 'v1' }, capabilities: ['react'],
      requirements: [{ id: 'fixture', description: 'Exercise the store only.', acceptanceChecks: [{ id: 'store-journey', kind: 'browser', description: 'Gate input fixture, not real browser certification.' }] }],
      budget: { currency: 'USD', maxCostMicros, maxProviderCalls, maxRepairAttempts: 2 },
    });
    const start = async (spec = contract()) => {
      await createPilotRun(spec, campaignId);
      const lease = await claimPilotRun(spec.identity.missionId, ownerId, `qa-worker-${randomUUID()}`, 120);
      assert.ok(lease);
      await updatePilotState(lease, 'planning');
      return { spec, lease };
    };
    return { ownerId, campaignId, contract, start };
  };
  const reservation = (operationId = `qa-op-${randomUUID()}`, reservedMicros = 100_000) => ({
    operationId, requestHash: 'a'.repeat(64), reservedMicros, model: 'qa-no-provider', request: { fixture: true },
  });

  try {
    await t.test('creation is idempotent, immutable in scope and limited to one live run per campaign', async () => {
      const f = fixture(), spec = f.contract();
      const [first, second] = await Promise.all([createPilotRun(spec, f.campaignId), createPilotRun(spec, f.campaignId)]);
      assert.equal(first.id, second.id);
      assert.equal((await listPilotRuns(f.ownerId, f.campaignId)).length, 1);
      assert.equal((await getPilotEvents(first.id, f.ownerId)).filter(event => event.type === 'run.created').length, 1);
      await assert.rejects(createPilotRun({ ...spec, prompt: 'Conflicting scope' }, f.campaignId), /PILOT_RUN_CONFLICT/);
      await assert.rejects(createPilotRun(f.contract(), f.campaignId), /PILOT_CAMPAIGN_BUSY/);
      assert.equal((await listPilotRuns(f.ownerId)).length, 1);
    });

    await t.test('creating or retrying a run cannot raise or replace the campaign spending ceiling', async () => {
      const f = fixture(), spec = f.contract();
      const created = await createPilotRun(spec, f.campaignId, 1_000_000);
      assert.equal(created.campaignBudget.maxCostMicros, 1_000_000);
      await assert.rejects(createPilotRun(spec, f.campaignId, 2_000_000), /PILOT_CAMPAIGN_BUDGET_CONFLICT/);
      await assert.rejects(createPilotRun(f.contract(), f.campaignId, 500_000), /PILOT_CAMPAIGN_BUDGET_CONFLICT/);
      assert.equal((await getPilotRun(spec.identity.missionId, f.ownerId))!.campaignBudget.maxCostMicros, 1_000_000);
      assert.equal((await createPilotRun(spec, f.campaignId, 1_000_000)).id, created.id);
    });

    await t.test('claims are exclusive, expired leases can be recovered and old fences cannot write', async () => {
      const f = fixture(), spec = f.contract();
      await createPilotRun(spec, f.campaignId);
      const claims = await Promise.all([
        claimPilotRun(spec.identity.missionId, f.ownerId, 'qa-worker-one', 120),
        claimPilotRun(spec.identity.missionId, f.ownerId, 'qa-worker-two', 120),
      ]);
      assert.equal(claims.filter(Boolean).length, 1);
      const first = claims.find(Boolean)!;
      const renewed = await heartbeatPilotRun(first, 180);
      assert.ok(renewed.leaseUntil >= first.leaseUntil);
      assert.match(f.ownerId, /^qa-pilot-[a-f0-9-]{36}$/);
      await sql`update dk_generator_v2.runs set lease_until=clock_timestamp()-interval '1 second' where owner_id=${f.ownerId} and id=${first.runId}`;
      await assert.rejects(heartbeatPilotRun(first), /PILOT_LEASE_LOST/);
      const next = await claimPilotRun(first.runId, f.ownerId, 'qa-worker-recovered');
      assert.ok(next);
      assert.equal(next.fence, first.fence + 1);
      await assert.rejects(appendPilotEvent(first, 'qa.stale', 'This event must not persist.'), /PILOT_LEASE_LOST/);
      await assert.rejects(updatePilotState(first, 'planning'), /PILOT_LEASE_LOST/);
      await updatePilotState(next, 'planning');
      await appendPilotEvent(next, 'qa.live', 'Controlled QA event.');
      const events = await getPilotEvents(first.runId, f.ownerId);
      assert.equal(new Set(events.map(event => event.sequence)).size, events.length);
      assert.deepEqual(events.map(event => event.sequence), events.map(event => event.sequence).toSorted((a, b) => a - b));
      assert.ok(events.every(event => event.type !== 'qa.stale'));
      assert.equal((await getPilotEvents(first.runId, f.ownerId, events.at(-2)!.sequence)).length, 1);
    });

    await t.test('duplicate reservations charge once; request conflicts, run limits and settlement replay are enforced', async () => {
      const f = fixture(), { lease } = await f.start(f.contract(undefined, 800_000, 2));
      const input = reservation(undefined, 600_000);
      const reserved = await Promise.all([reservePilotCall(lease, input), reservePilotCall(lease, input)]);
      assert.deepEqual(reserved.map(item => item.created).sort(), [false, true]);
      assert.deepEqual(reserved[0].call.request, { fixture: true }, 'JSON must round-trip as an object, not a doubly encoded string.');
      let run = (await getPilotRun(lease.runId, f.ownerId))!;
      assert.equal(run.budget.callCount, 1);
      assert.equal(run.campaignBudget.callCount, 1);
      assert.equal(run.budget.reservedMicros, 600_000);
      await assert.rejects(reservePilotCall(lease, { ...input, requestHash: 'b'.repeat(64) }), /PILOT_OPERATION_CONFLICT/);
      await assert.rejects(reservePilotCall(lease, reservation(undefined, 300_000)), /PILOT_BUDGET_LIMIT/);
      const responseId = `resp_qa_${randomUUID()}`;
      await markPilotSubmitted(lease, input.operationId, responseId, 'in_progress');
      await assert.rejects(markPilotSubmitted(lease, input.operationId, `${responseId}_wrong`), /PILOT_RESPONSE_CONFLICT/);
      await markPilotCallUncertain(lease, input.operationId, 'completed_without_usage', { result: { output: 'fixture' } });
      assert.equal((await getPilotCall(lease.runId, f.ownerId, input.operationId))!.status, 'uncertain');
      assert.deepEqual((await getPilotCall(lease.runId, f.ownerId, input.operationId))!.result, { output: 'fixture' });
      assert.equal((await getPilotRun(lease.runId, f.ownerId))!.budget.reservedMicros, 600_000);
      const settled = { actualMicros: 250_000, status: 'completed' as const, result: { output: 'fixture' }, usage: { fixture: true }, lastResponseStatus: 'completed' };
      await settlePilotCall(lease, input.operationId, settled);
      await settlePilotCall(lease, input.operationId, settled);
      await assert.rejects(settlePilotCall(lease, input.operationId, { ...settled, actualMicros: 1 }), /PILOT_SETTLEMENT_CONFLICT/);
      run = (await getPilotRun(lease.runId, f.ownerId))!;
      assert.equal(run.budget.spentMicros, 250_000);
      assert.equal(run.budget.reservedMicros, 0);
      assert.equal(run.budget.callCount, 1);
      await reservePilotCall(lease, reservation(undefined, 1));
      await assert.rejects(reservePilotCall(lease, reservation(undefined, 1)), /PILOT_CALL_LIMIT/);
      assert.equal((await getPilotRun(lease.runId, f.ownerId))!.budget.callCount, 2);
    });

    await t.test('terminal reconciliation requires an exact recorded proof and releases a held reservation only once', async () => {
      const f = fixture(), foreign = fixture(), { lease } = await f.start();
      const original = reservation();
      await reservePilotCall(lease, original);
      await settlePilotCall(lease, original.operationId, { actualMicros: 30_000, status: 'completed' });
      const input = reservation(), responseId = `resp_qa_${randomUUID()}`;
      await reservePilotCall(lease, input);
      await markPilotSubmitted(lease, input.operationId, responseId);
      await markPilotCallUncertain(lease, input.operationId, 'cancellation-unconfirmed');
      const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, cacheWriteTokensObserved: false, reasoningTokens: 0 };
      const result = { id: responseId, model: input.model, status: 'cancelled', usage: { input_tokens: 0, output_tokens: 0 } };
      const proof = { requestHash: input.requestHash, responseId, actualMicros: 0, status: 'failed' as const, usage, result, lastResponseStatus: 'cancelled' };
      await assert.rejects(reconcilePilotTerminalCall(lease.runId, f.ownerId, input.operationId, proof), /PILOT_TERMINAL_RECONCILIATION_NOT_ALLOWED/);
      const before = await updatePilotState(lease, 'failed', { error: 'Controlled timeout, no retry authorized.' });
      await assert.rejects(reconcilePilotTerminalCall(lease.runId, f.ownerId, input.operationId, proof), /PILOT_TERMINAL_RECONCILIATION_NOT_ALLOWED/);
      await sql`update dk_generator_v2.runs set lease_until=clock_timestamp()-interval '1 second' where owner_id=${f.ownerId} and id=${lease.runId}`;
      await assert.rejects(reconcilePilotTerminalCall(lease.runId, foreign.ownerId, input.operationId, proof), /PILOT_TERMINAL_RECONCILIATION_NOT_ALLOWED/);
      await assert.rejects(reconcilePilotTerminalCall(lease.runId, f.ownerId, input.operationId, { ...proof, requestHash: 'b'.repeat(64) }), /PILOT_RECONCILIATION_BINDING_MISMATCH/);
      await assert.rejects(reconcilePilotTerminalCall(lease.runId, f.ownerId, input.operationId, { ...proof, responseId: 'resp_other', result: { ...result, id: 'resp_other' } }), /PILOT_RECONCILIATION_BINDING_MISMATCH/);
      await assert.rejects(reconcilePilotTerminalCall(lease.runId, f.ownerId, input.operationId, { ...proof, result: { ...result, model: 'qa-other-model' } }), /PILOT_RECONCILIATION_BINDING_MISMATCH/);
      await assert.rejects(reconcilePilotTerminalCall(lease.runId, f.ownerId, input.operationId, { ...proof, result: { ...result, usage: null } }), /PILOT_RECONCILIATION_PROOF_INVALID/);
      await assert.rejects(reconcilePilotTerminalCall(lease.runId, f.ownerId, input.operationId, { ...proof, usage: { ...usage, inputTokens: 1 } }), /PILOT_RECONCILIATION_PROOF_INVALID/);
      await assert.rejects(reconcilePilotTerminalCall(lease.runId, f.ownerId, input.operationId, { ...proof, actualMicros: input.reservedMicros + 1 }), /PILOT_RECONCILIATION_COST_OUT_OF_BOUND/);
      assert.deepEqual((await getPilotRun(lease.runId, f.ownerId))!.budget, before.budget);
      const reconciled = await Promise.all([
        reconcilePilotTerminalCall(lease.runId, f.ownerId, input.operationId, proof),
        reconcilePilotTerminalCall(lease.runId, f.ownerId, input.operationId, proof),
      ]);
      assert.ok(reconciled.every(call => call.actualMicros === 0 && call.status === 'failed'));
      const after = (await getPilotRun(lease.runId, f.ownerId))!;
      assert.equal(after.status, 'failed');
      assert.deepEqual(after.details, before.details);
      assert.equal(after.fence, before.fence);
      assert.equal(after.budget.spentMicros, 30_000);
      assert.equal(after.budget.reservedMicros, 0);
      assert.equal(after.budget.callCount, 2);
      assert.equal(after.campaignBudget.spentMicros, 30_000);
      assert.equal(after.campaignBudget.reservedMicros, 0);
      assert.equal(after.campaignBudget.callCount, 2);
      assert.equal((await getPilotEvents(lease.runId, f.ownerId)).filter(event => event.type === 'provider.reconciled').length, 1);
      await assert.rejects(reconcilePilotTerminalCall(lease.runId, f.ownerId, input.operationId, { ...proof, actualMicros: 1 }), /PILOT_SETTLEMENT_CONFLICT/);
      assert.equal(await claimPilotRun(lease.runId, f.ownerId, 'qa-no-restart'), null);
    });

    await t.test('terminal reconciliation settles submitted work after cancellation without reviving the run', async () => {
      const f = fixture(), { lease } = await f.start(), input = reservation(), responseId = `resp_qa_${randomUUID()}`;
      await reservePilotCall(lease, input);
      await markPilotSubmitted(lease, input.operationId, responseId);
      await cancelPilotRun(lease.runId, f.ownerId);
      const proof = { requestHash: input.requestHash, responseId, actualMicros: 20, status: 'completed' as const,
        usage: { inputTokens: 10, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, cacheWriteTokensObserved: true, reasoningTokens: 0 },
        result: { id: responseId, model: input.model, status: 'completed', usage: { input_tokens: 10, output_tokens: 0, input_tokens_details: { cache_write_tokens: 0 } } }, lastResponseStatus: 'completed' };
      await reconcilePilotTerminalCall(lease.runId, f.ownerId, input.operationId, proof);
      const after = (await getPilotRun(lease.runId, f.ownerId))!;
      assert.equal(after.status, 'cancelled');
      assert.equal(after.accepted, null);
      assert.equal(after.workerId, null);
      assert.equal(after.budget.spentMicros, 20);
      assert.equal(after.budget.reservedMicros, 0);
      assert.equal(after.campaignBudget.spentMicros, 20);
      await assert.rejects(reservePilotCall(lease, reservation()), /PILOT_LEASE_LOST/);
    });

    await t.test('distinct concurrent provider operations cannot oversubscribe the run budget', async () => {
      const f = fixture(), { lease } = await f.start(f.contract(undefined, 800_000));
      const outcomes = await Promise.allSettled([
        reservePilotCall(lease, reservation(undefined, 500_000)),
        reservePilotCall(lease, reservation(undefined, 500_000)),
      ]);
      assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
      const denied = outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult;
      assert.match(String(denied.reason), /PILOT_BUDGET_LIMIT/);
      const run = (await getPilotRun(lease.runId, f.ownerId))!;
      assert.equal(run.budget.callCount, 1);
      assert.equal(run.budget.reservedMicros, 500_000);
      assert.equal(run.campaignBudget.reservedMicros, 500_000);
    });

    await t.test('campaign ceiling survives new run IDs, cancellation and unresolved reservations', async () => {
      const f = fixture(), first = await f.start();
      const input = reservation(undefined, 2_700_000);
      await reservePilotCall(first.lease, input);
      await settlePilotCall(first.lease, input.operationId, { actualMicros: 2_700_000, status: 'failed', result: { fixture: true } });
      await updatePilotState(first.lease, 'failed', { reason: 'Controlled terminal fixture.' });
      const second = await f.start();
      assert.equal((await getPilotRun(second.lease.runId, f.ownerId))!.campaignBudget.spentMicros, 2_700_000);
      await assert.rejects(reservePilotCall(second.lease, reservation(undefined, 300_001)), /PILOT_BUDGET_LIMIT/);
      await reservePilotCall(second.lease, reservation(undefined, 300_000));
      const cancelled = await cancelPilotRun(second.lease.runId, f.ownerId);
      assert.equal(cancelled!.status, 'cancelled');
      assert.equal(cancelled!.campaignBudget.reservedMicros, 300_000);
      assert.equal(cancelled!.fence, second.lease.fence + 1);
      assert.equal(await claimPilotRun(second.lease.runId, f.ownerId, 'qa-after-cancel'), null);
      await assert.rejects(appendPilotEvent(second.lease, 'qa.late', 'Must not be recorded.'), /PILOT_LEASE_LOST/);
      const third = await f.start();
      await assert.rejects(reservePilotCall(third.lease, reservation(undefined, 1)), /PILOT_BUDGET_LIMIT/);
      assert.equal((await getPilotRun(first.lease.runId, f.ownerId))!.campaignBudget.callCount, 2);
    });

    await t.test('every store read and lease write is scoped to the owning fixture', async () => {
      const f = fixture(), foreign = fixture(), { lease } = await f.start();
      const input = reservation();
      await reservePilotCall(lease, input);
      assert.equal(await getPilotRun(lease.runId, foreign.ownerId), null);
      assert.deepEqual(await listPilotRuns(foreign.ownerId), []);
      assert.deepEqual(await getPilotEvents(lease.runId, foreign.ownerId), []);
      assert.deepEqual(await getPilotSnapshots(lease.runId, foreign.ownerId), []);
      assert.equal(await getPilotCall(lease.runId, foreign.ownerId, input.operationId), null);
      assert.equal(await claimPilotRun(lease.runId, foreign.ownerId, 'qa-cross-owner'), null);
      assert.equal(await cancelPilotRun(lease.runId, foreign.ownerId), null);
      const forged: PilotLease = { ...lease, ownerId: foreign.ownerId };
      await assert.rejects(reservePilotCall(forged, reservation()), /PILOT_LEASE_LOST/);
      await assert.rejects(updatePilotState(forged, 'building'), /PILOT_LEASE_LOST/);
      assert.equal((await getPilotRun(lease.runId, f.ownerId))!.status, 'planning');
    });

    await t.test('immutable snapshots, exact-candidate gates and trusted evidence govern the accepted pointer', async () => {
      const f = fixture(), { lease, spec } = await f.start();
      await updatePilotState(lease, 'building');
      const snapshot = createGeneratorSnapshot({ scope: spec.identity, revision: 'qa-v1', files: [{ path: 'src/App.tsx', content: 'export const App = () => null;' }] });
      const candidate = { identity: spec.identity, revision: snapshot.revision, sourceHash: snapshot.hash, contractHash: contractFingerprint(spec), runtimeDigest: 'a'.repeat(64) };
      await savePilotSnapshot(lease, snapshot, candidate);
      await assert.rejects(sql`update dk_generator_v2.snapshots set source_hash=source_hash where owner_id=${f.ownerId} and run_id=${lease.runId} and revision=${snapshot.revision}`, /immutable/i);
      await assert.rejects(savePilotSnapshot(lease, snapshot, { ...candidate, sourceHash: 'b'.repeat(64) }), /MISMATCH/);
      const nextSource = createGeneratorSnapshot({ scope: spec.identity, revision: 'qa-v2', files: [{ path: 'src/App.tsx', content: 'export const App = () => "fixture";' }] });
      const nextSnapshot = { ...nextSource, parent: { revision: snapshot.revision, hash: snapshot.hash } };
      const nextCandidate = { ...candidate, revision: nextSnapshot.revision, sourceHash: nextSnapshot.hash };
      await savePilotSnapshot(lease, nextSnapshot, nextCandidate);
      await savePilotSnapshot(lease, snapshot, candidate);
      assert.equal((await getPilotRun(lease.runId, f.ownerId))!.candidate!.revision, snapshot.revision);
      assert.equal((await getPilotSnapshots(lease.runId, f.ownerId)).length, 2);

      // Artificial QA reports exercise gate enforcement only; no app/browser was executed by this test.
      const evidence: VerificationEvidence[] = requiredCheckIds(spec).map((checkId, index) => ({
        id: `qa-proof-${index}`, sequence: index + 1, binding: candidate, checkId, producer: 'platform-runner',
        verifierVersion: 'qa-store-fixture-v1', executed: true, status: 'passed', completedAt: Date.now() - 1000, artifactHash: 'c'.repeat(64),
      }));
      const allowed = Object.fromEntries(evidence.map(item => [item.checkId, ['qa-store-fixture-v1']]));
      await assert.rejects(updatePilotState(lease, 'ready'), /PILOT_INVALID_TRANSITION/);
      await assert.rejects(acceptPilotSnapshot(lease, nextCandidate, evidence, allowed), /PILOT_ACCEPTED_CANDIDATE_STALE/);
      await assert.rejects(acceptPilotSnapshot(lease, candidate, [], allowed), /PILOT_DELIVERY_CHECKS_FAILED/);
      await assert.rejects(acceptPilotSnapshot(lease, candidate, evidence.map(item => ({ ...item, producer: 'model' })), allowed), /PILOT_DELIVERY_CHECKS_FAILED/);
      await assert.rejects(acceptPilotSnapshot(lease, candidate, evidence, {}), /PILOT_DELIVERY_CHECKS_FAILED/);
      const input = reservation();
      await reservePilotCall(lease, input);
      await assert.rejects(acceptPilotSnapshot(lease, candidate, evidence, allowed), /PILOT_PROVIDER_UNRESOLVED/);
      await settlePilotCall(lease, input.operationId, { actualMicros: 0, status: 'completed', result: { fixture: true } });
      const ready = await acceptPilotSnapshot(lease, candidate, evidence, allowed);
      assert.equal(ready.status, 'ready');
      assert.deepEqual(ready.accepted, candidate);
      await assert.rejects(appendPilotEvent(lease, 'qa.after-ready', 'Must not mutate final run.'), /PILOT_LEASE_LOST/);
      assert.equal((await cancelPilotRun(lease.runId, f.ownerId))!.status, 'ready');
      await assert.rejects(claimPilotRecordedRecovery(lease.runId, f.ownerId, 'qa-ready-recovery', ready.sequence, 'Must not recover ready output.'), /PILOT_RECORDED_RECOVERY_NOT_ALLOWED/);
    });

    await t.test('checkpoints require the full delivery gate and retain the live lease while exposing only verified source', async () => {
      const f = fixture(), { lease, spec } = await f.start();
      await updatePilotState(lease, 'building');
      const snapshot = createGeneratorSnapshot({ scope: spec.identity, revision: 'qa-checkpoint-1', files: [{ path: 'src/App.tsx', content: 'export const App = () => null;' }] });
      const candidate = { identity: spec.identity, revision: snapshot.revision, sourceHash: snapshot.hash, contractHash: contractFingerprint(spec), runtimeDigest: 'a'.repeat(64) };
      await savePilotSnapshot(lease, snapshot, candidate);
      // Gate fixtures only: these records do not certify that a real application or browser was executed.
      const evidence: VerificationEvidence[] = requiredCheckIds(spec).map((checkId, index) => ({
        id: `qa-checkpoint-proof-${index}`, sequence: index + 1, binding: candidate, checkId, producer: 'platform-runner',
        verifierVersion: 'qa-store-fixture-v1', executed: true, status: 'passed', completedAt: Date.now() - 1000, artifactHash: 'c'.repeat(64),
      }));
      const allowed = Object.fromEntries(evidence.map(item => [item.checkId, ['qa-store-fixture-v1']]));
      await assert.rejects(publishPilotCheckpoint(lease, candidate, [], allowed), /PILOT_DELIVERY_CHECKS_FAILED/);
      await assert.rejects(publishPilotCheckpoint(lease, candidate, evidence.slice(1), allowed), /PILOT_DELIVERY_CHECKS_FAILED/);
      await assert.rejects(publishPilotCheckpoint(lease, candidate, evidence.map(item => ({ ...item, producer: 'model' })), allowed), /PILOT_DELIVERY_CHECKS_FAILED/);
      await assert.rejects(publishPilotCheckpoint(lease, candidate, evidence.map(item => ({ ...item, executed: false })), allowed), /PILOT_DELIVERY_CHECKS_FAILED/);
      await assert.rejects(publishPilotCheckpoint(lease, candidate, evidence, {}), /PILOT_DELIVERY_CHECKS_FAILED/);
      assert.equal((await getPilotRun(lease.runId, f.ownerId))!.accepted, null);
      const input = reservation();
      await reservePilotCall(lease, input);
      await assert.rejects(publishPilotCheckpoint(lease, candidate, evidence, allowed), /PILOT_PROVIDER_UNRESOLVED/);
      await settlePilotCall(lease, input.operationId, { actualMicros: 20_000, status: 'completed' });
      const before = (await getPilotRun(lease.runId, f.ownerId))!;
      const checkpoint = await publishPilotCheckpoint(lease, candidate, evidence, allowed);
      assert.equal(checkpoint.status, 'verifying');
      assert.equal(checkpoint.workerId, lease.workerId);
      assert.equal(checkpoint.fence, lease.fence);
      assert.equal(checkpoint.leaseUntil, before.leaseUntil);
      assert.deepEqual(checkpoint.budget, before.budget);
      assert.deepEqual(checkpoint.campaignBudget, before.campaignBudget);
      assert.deepEqual(checkpoint.accepted, candidate);
      const events = await getPilotEvents(lease.runId, f.ownerId);
      assert.equal(events.filter(event => event.type === 'delivery.checkpoint').length, 1);
      assert.equal(events.filter(event => event.type === 'run.ready').length, 0);
      await heartbeatPilotRun(lease);
      await updatePilotState(lease, 'building');
      const nextSource = createGeneratorSnapshot({ scope: spec.identity, revision: 'qa-checkpoint-2', files: [{ path: 'src/App.tsx', content: 'export const App = () => "unverified";' }] });
      const nextSnapshot = { ...nextSource, parent: { revision: snapshot.revision, hash: snapshot.hash } };
      const nextCandidate = { ...candidate, revision: nextSnapshot.revision, sourceHash: nextSnapshot.hash };
      await savePilotSnapshot(lease, nextSnapshot, nextCandidate);
      await assert.rejects(publishPilotCheckpoint(lease, candidate, evidence, allowed), /PILOT_ACCEPTED_CANDIDATE_STALE/);
      await assert.rejects(publishPilotCheckpoint(lease, nextCandidate, evidence, allowed), /PILOT_DELIVERY_CHECKS_FAILED/);
      await assert.rejects(acceptPilotSnapshot(lease, nextCandidate, evidence, allowed), /PILOT_DELIVERY_CHECKS_FAILED/);
      const failed = await updatePilotState(lease, 'failed', { error: 'Controlled later refinement failure.' });
      assert.deepEqual(failed.accepted, candidate);
      assert.deepEqual(failed.candidate, nextCandidate);
      assert.deepEqual((await getPilotSnapshots(lease.runId, f.ownerId)).find(item => item.candidate.revision === candidate.revision)!.snapshot, snapshot);
      await assert.rejects(claimPilotRecordedRecovery(lease.runId, f.ownerId, 'qa-recover-checkpoint', failed.sequence, 'Checkpoint recovery remains forbidden.'), /PILOT_RECORDED_RECOVERY_NOT_ALLOWED/);
    });

    await t.test('cancellation preserves an already approved checkpoint while revoking further writes', async () => {
      const f = fixture(), { lease, spec } = await f.start();
      await updatePilotState(lease, 'building');
      const snapshot = createGeneratorSnapshot({ scope: spec.identity, revision: 'qa-cancel-checkpoint', files: [{ path: 'src/App.tsx', content: 'export const App = () => null;' }] });
      const candidate = { identity: spec.identity, revision: snapshot.revision, sourceHash: snapshot.hash, contractHash: contractFingerprint(spec), runtimeDigest: 'a'.repeat(64) };
      await savePilotSnapshot(lease, snapshot, candidate);
      // Synthetic evidence tests store enforcement only, not real browser execution.
      const evidence: VerificationEvidence[] = requiredCheckIds(spec).map((checkId, index) => ({
        id: `qa-cancel-proof-${index}`, sequence: index + 1, binding: candidate, checkId, producer: 'platform-runner',
        verifierVersion: 'qa-store-fixture-v1', executed: true, status: 'passed', completedAt: Date.now() - 1000, artifactHash: 'c'.repeat(64),
      }));
      const allowed = Object.fromEntries(evidence.map(item => [item.checkId, ['qa-store-fixture-v1']]));
      await publishPilotCheckpoint(lease, candidate, evidence, allowed);
      await updatePilotState(lease, 'building');
      const cancelled = (await cancelPilotRun(lease.runId, f.ownerId))!;
      assert.equal(cancelled.status, 'cancelled');
      assert.deepEqual(cancelled.accepted, candidate);
      assert.equal(cancelled.workerId, null);
      assert.equal(cancelled.leaseUntil, null);
      await assert.rejects(publishPilotCheckpoint(lease, candidate, evidence, allowed), /PILOT_LEASE_LOST/);
    });

    await t.test('recorded recovery requires exact sequence and preserves costs, history and original failure', async () => {
      const f = fixture(), { lease } = await f.start();
      const input = reservation();
      await reservePilotCall(lease, input);
      await settlePilotCall(lease, input.operationId, { actualMicros: 30_000, status: 'completed', result: { fixture: 'recorded-output' } });
      const before = await updatePilotState(lease, 'failed', { error: 'Original controlled failure.' });
      await assert.rejects(claimPilotRecordedRecovery(lease.runId, f.ownerId, 'qa-recovery', before.sequence - 1, 'Stale operator snapshot.'), /PILOT_RECOVERY_SEQUENCE_CONFLICT/);
      const recovered = await claimPilotRecordedRecovery(lease.runId, f.ownerId, 'qa-recovery', before.sequence, 'Replay existing fixture output only.');
      assert.equal(recovered.fence, lease.fence + 1);
      let run = (await getPilotRun(lease.runId, f.ownerId))!;
      assert.equal(run.status, 'verifying');
      assert.deepEqual(run.budget, before.budget);
      assert.deepEqual(run.campaignBudget, before.campaignBudget);
      assert.deepEqual((run.details as Record<string, unknown>).error, 'Original controlled failure.');
      assert.equal((run.details as Record<string, unknown>).recoveryMode, 'recorded-output-only');
      assert.equal((await getPilotEvents(lease.runId, f.ownerId)).filter(event => event.type === 'recovery.claimed').length, 1);
      await assert.rejects(appendPilotEvent(lease, 'qa.old-worker', 'Old fence cannot write.'), /PILOT_LEASE_LOST/);
      assert.equal((await reservePilotCall(recovered, input)).created, false, 'Recorded operation can be read idempotently, not resubmitted.');
      await assert.rejects(reservePilotCall(recovered, reservation()), /PILOT_RECORDED_RECOVERY_NO_NEW_CALLS/);
      await updatePilotState(recovered, 'building', { recoveryMode: 'normal', error: 'This must not replace the original failure.' });
      run = (await getPilotRun(lease.runId, f.ownerId))!;
      assert.equal((run.details as Record<string, unknown>).recoveryMode, 'recorded-output-only');
      assert.equal((run.details as Record<string, unknown>).error, 'Original controlled failure.');
      await assert.rejects(reservePilotCall(recovered, reservation()), /PILOT_RECORDED_RECOVERY_NO_NEW_CALLS/);
      await sql`update dk_generator_v2.runs set lease_until=clock_timestamp()-interval '1 second' where owner_id=${f.ownerId} and id=${lease.runId}`;
      assert.equal(await claimPilotRun(lease.runId, f.ownerId, 'qa-default-worker'), null, 'Default worker must never pick up a recorded-only recovery after a crash.');
    });

    await t.test('recorded recovery cannot overtake another run or race a second operator claim', async () => {
      const f = fixture(), { lease } = await f.start();
      const failed = await updatePilotState(lease, 'failed');
      const other = f.contract();
      await createPilotRun(other, f.campaignId);
      await assert.rejects(claimPilotRecordedRecovery(lease.runId, f.ownerId, 'qa-recovery', failed.sequence, 'Busy campaign.'), /PILOT_CAMPAIGN_BUSY/);
      const cancelled = (await cancelPilotRun(other.identity.missionId, f.ownerId))!;
      await assert.rejects(claimPilotRecordedRecovery(other.identity.missionId, f.ownerId, 'qa-cancelled-recovery', cancelled.sequence, 'Cannot revive cancellation.'), /PILOT_RECORDED_RECOVERY_NOT_ALLOWED/);
      const outcomes = await Promise.allSettled([
        claimPilotRecordedRecovery(lease.runId, f.ownerId, 'qa-recovery-one', failed.sequence, 'Explicit replay one.'),
        claimPilotRecordedRecovery(lease.runId, f.ownerId, 'qa-recovery-two', failed.sequence, 'Explicit replay two.'),
      ]);
      assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
      assert.equal(outcomes.filter(outcome => outcome.status === 'rejected').length, 1);
    });

    await t.test('recorded recovery rejects held or uncertain provider operations and any accepted pointer', async () => {
      const f = fixture(), { lease } = await f.start();
      await reservePilotCall(lease, reservation());
      const failed = await updatePilotState(lease, 'failed');
      await assert.rejects(claimPilotRecordedRecovery(lease.runId, f.ownerId, 'qa-recovery', failed.sequence, 'Unresolved cost.'), /PILOT_RECORDED_RECOVERY_NOT_ALLOWED/);
      // Fault injection is restricted to this exact disposable owner/run: call records still govern safety if a counter is corrupt.
      await sql`update dk_generator_v2.runs set reserved_micros=0 where owner_id=${f.ownerId} and id=${lease.runId}`;
      await assert.rejects(claimPilotRecordedRecovery(lease.runId, f.ownerId, 'qa-recovery', failed.sequence, 'Unsettled call remains.'), /PILOT_RECOVERY_HAS_UNSETTLED_CALLS/);
      await sql`update dk_generator_v2.runs set accepted='{}'::jsonb where owner_id=${f.ownerId} and id=${lease.runId}`;
      await assert.rejects(claimPilotRecordedRecovery(lease.runId, f.ownerId, 'qa-recovery', failed.sequence, 'Accepted pointer present.'), /PILOT_RECORDED_RECOVERY_NOT_ALLOWED/);
    });

    await t.test('scoped refinement recovery authorizes exactly one request hash without resetting cost or reopening the builder', async () => {
      const f = fixture(), { lease } = await f.start();
      const initialCall = reservation();
      await reservePilotCall(lease, initialCall);
      await settlePilotCall(lease, initialCall.operationId, { actualMicros: 50_000, status: 'completed', result: { fixture: true } });
      const failed = await updatePilotState(lease, 'failed', { error: 'Controlled ambiguous source edit.' });
      const requestHash = 'd'.repeat(64);
      const recovery = await claimPilotRefinementRepair(lease.runId, f.ownerId, 'qa-scoped-repair', failed.sequence, 'One CSS repair with a prepared request.', requestHash);
      let run = (await getPilotRun(lease.runId, f.ownerId))!;
      assert.deepEqual(run.budget, failed.budget);
      assert.deepEqual(run.campaignBudget, failed.campaignBudget);
      assert.equal((run.details as Record<string, unknown>).recoveryMode, 'scoped-refinement-repair');
      const allowed = { ...reservation('refine-repair-1', 80_000), requestHash };
      await assert.rejects(reservePilotCall(recovery, { ...allowed, operationId: 'build-2' }), /PILOT_REFINEMENT_REPAIR_SCOPE_MISMATCH/);
      await assert.rejects(reservePilotCall(recovery, { ...allowed, requestHash: 'e'.repeat(64) }), /PILOT_REFINEMENT_REPAIR_SCOPE_MISMATCH/);
      await updatePilotState(recovery, 'building', { recoveryMode: 'normal', allowedOperationId: 'anything', allowedRequestHash: 'e'.repeat(64) });
      run = (await getPilotRun(lease.runId, f.ownerId))!;
      assert.equal((run.details as Record<string, unknown>).allowedOperationId, 'refine-repair-1');
      assert.equal((run.details as Record<string, unknown>).allowedRequestHash, requestHash);
      assert.equal((await reservePilotCall(recovery, allowed)).created, true);
      assert.equal((await reservePilotCall(recovery, allowed)).created, false);
      await settlePilotCall(recovery, allowed.operationId, { actualMicros: 20_000, status: 'completed', result: { fixture: 'repaired' } });
      run = (await getPilotRun(lease.runId, f.ownerId))!;
      assert.equal(run.budget.callCount, 2);
      assert.equal(run.budget.spentMicros, 70_000);
      assert.equal(run.campaignBudget.spentMicros, 70_000);
      await assert.rejects(reservePilotCall(recovery, { ...allowed, operationId: 'refine-repair-2' }), /PILOT_REFINEMENT_REPAIR_SCOPE_MISMATCH/);
      await sql`update dk_generator_v2.runs set lease_until=clock_timestamp()-interval '1 second' where owner_id=${f.ownerId} and id=${lease.runId}`;
      assert.equal(await claimPilotRun(lease.runId, f.ownerId, 'qa-default-worker'), null);
    });

    await t.test('browser database roles cannot access the isolated pilot tables', async () => {
      await assert.rejects(sql.begin(async tx => {
        await tx`set local role anon`;
        await tx`select id from dk_generator_v2.runs limit 1`;
      }), /permission denied/);
      await assert.rejects(sql.begin(async tx => {
        await tx`set local role authenticated`;
        await tx`select operation_id from dk_generator_v2.calls limit 1`;
      }), /permission denied/);
    });
  } finally {
    try {
      // Delete only exact owners generated by this invocation. No shared campaign or real owner is eligible.
      for (const ownerId of owners) {
        assert.match(ownerId, /^qa-pilot-[a-f0-9-]{36}$/);
        await sql.begin(async tx => {
          await tx`delete from dk_generator_v2.calls where owner_id=${ownerId}`;
          await tx`delete from dk_generator_v2.events where owner_id=${ownerId}`;
          await tx`delete from dk_generator_v2.snapshots where owner_id=${ownerId}`;
          await tx`delete from dk_generator_v2.runs where owner_id=${ownerId}`;
          await tx`delete from dk_generator_v2.campaigns where owner_id=${ownerId}`;
        });
        const [remaining] = await sql`select
          (select count(*) from dk_generator_v2.calls where owner_id=${ownerId})+
          (select count(*) from dk_generator_v2.events where owner_id=${ownerId})+
          (select count(*) from dk_generator_v2.snapshots where owner_id=${ownerId})+
          (select count(*) from dk_generator_v2.runs where owner_id=${ownerId})+
          (select count(*) from dk_generator_v2.campaigns where owner_id=${ownerId}) as count`;
        assert.equal(Number(remaining.count), 0, 'All exact QA fixture rows must be removed.');
      }
    } finally { await closeDatabase(); }
  }
});
