import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { database, closeDatabase } from '../../src/lib/server/database';
import { contractFingerprint, type GenerationContract } from '../../src/lib/server/generator/contract';
import { createPrivateboardContract } from '../../src/lib/server/generator/supabasePilotContract';
import { requalifyPrivateboardSnapshot, type PrivateboardRuntimeRequalification } from '../../src/lib/server/generator/supabasePilotRequalification';
import { createGeneratorSnapshot, type GeneratorSnapshot } from '../../src/lib/server/generator/versionedEdits';
import {
  PILOT_CAMPAIGN_ID, createPilotRun, getPilotRun, claimPilotRun, claimPilotRecordedRecovery, claimPilotRefinementRepair,
  claimPrivateboardRuntimeRequalification, updatePilotState, reservePilotCall, markPilotSubmitted, settlePilotCall,
  savePilotSnapshot, getPilotSnapshots, getPilotCall, getPilotEvents, cancelPilotRun, publishPilotCheckpoint, type PilotSavedSnapshot,
} from '../../src/lib/server/generator/pilotStore';

test('Privateboard runtime requalification: explicit opt-in, local SQL-only QA fixtures', {
  skip: process.env.RUN_PRIVATEBOARD_RUNTIME_STORE_TESTS !== '1',
}, async t => {
  const url = new URL(process.env.DATABASE_URL || '');
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname), 'Never write these fixtures to a remote database.');
  const sql = database();
  const owners = new Set<string>();
  const fromImageId = `sha256:${'1'.repeat(64)}`, toImageId = `sha256:${'2'.repeat(64)}`, verifierVersion = 'privateboard-v1';
  const runtimeHash = (imageId: string) => createHash('sha256').update(`${imageId}:${verifierVersion}`).digest('hex');
  const reservation = (operationId: string, reservedMicros = 100_000) => ({ operationId, reservedMicros,
    requestHash: createHash('sha256').update(operationId).digest('hex'), model: 'qa-no-provider', request: { fixture: true, operationId } });
  const fixture = async (options: { lastCall?: 'completed' | 'failed' | 'held'; actualMicros?: number; staticRuntime?: boolean } = {}) => {
    const ownerId = `qa-runtime-${randomUUID()}`, campaignId = `qa-runtime-${randomUUID()}`;
    assert.match(ownerId, /^qa-runtime-[a-f0-9-]{36}$/); assert.notEqual(campaignId, PILOT_CAMPAIGN_ID);
    owners.add(ownerId);
    const base = createPrivateboardContract(ownerId, randomUUID());
    const contract: GenerationContract = options.staticRuntime ? { ...base, runtime: { id: 'react-static-pilot', version: 'v1' } } : base;
    await createPilotRun(contract, campaignId);
    const lease = await claimPilotRun(contract.identity.missionId, ownerId, `qa-worker-${randomUUID()}`);
    assert.ok(lease);
    await updatePilotState(lease, 'planning'); await updatePilotState(lease, 'building');
    const saved: PilotSavedSnapshot[] = [];
    for (const [index, operationId] of ['build-1', 'repair-1', 'repair-2'].entries()) {
      const actualMicros = options.actualMicros ?? 30_000;
      await reservePilotCall(lease, reservation(operationId, Math.max(100_000, actualMicros)));
      await markPilotSubmitted(lease, operationId, `qa-response-${randomUUID()}`);
      if (index !== 2 || options.lastCall !== 'held') await settlePilotCall(lease, operationId, {
        actualMicros, status: index === 2 && options.lastCall === 'failed' ? 'failed' : 'completed', result: { fixture: true, index }, usage: { fixture: true },
      });
      const parent = saved.at(-1)?.snapshot;
      const snapshot: GeneratorSnapshot = { ...createGeneratorSnapshot({ scope: contract.identity, revision: operationId, files: [
        { path: 'src/App.tsx', content: `export const App = () => ${index};` },
        { path: 'src/styles.css', content: 'body { color: red; }' },
        { path: 'supabase/migrations/001_init.sql', content: 'create table app.tasks(id uuid);' },
      ] }), ...(parent ? { parent: { revision: parent.revision, hash: parent.hash } } : {}) };
      saved.push(await savePilotSnapshot(lease, snapshot, { identity: contract.identity, revision: operationId,
        sourceHash: snapshot.hash, contractHash: contractFingerprint(contract), runtimeDigest: runtimeHash(fromImageId) }));
    }
    const original = saved.at(-1)!;
    const failed = await updatePilotState(lease, 'failed', { error: 'Disposable QA runtime failure; no model or app was started.' });
    const authorization: PrivateboardRuntimeRequalification = {
      sourceRevision: 'repair-2', sourceHash: original.snapshot.hash, fromRuntimeDigest: runtimeHash(fromImageId), toRuntimeDigest: runtimeHash(toImageId),
      fromImageId, toImageId, verifierVersion, requalificationRevision: 'runtime-1',
    };
    const qualify = (sequence = failed.sequence, input = authorization, workerId = 'qa-requalify') =>
      claimPrivateboardRuntimeRequalification(lease.runId, ownerId, workerId, sequence, 'Explicit SQL fixture runtime requalification only.', input);
    return { ownerId, campaignId, contract, lease, failed, saved, original, authorization, qualify };
  };
  const nextSnapshot = (contract: GenerationContract, parent: PilotSavedSnapshot, revision: string, files: { path: string; content: string }[], runtimeDigest: string) => {
    const snapshot = { ...createGeneratorSnapshot({ scope: contract.identity, revision, files }), parent: { revision: parent.snapshot.revision, hash: parent.snapshot.hash } };
    return { snapshot, candidate: { ...parent.candidate, revision, sourceHash: snapshot.hash, runtimeDigest } };
  };
  try {
    await t.test('claim preserves history and budget; only unchanged runtime copy then original final operations are allowed', async () => {
      const f = await fixture();
      const originalCalls = await Promise.all(['build-1', 'repair-1', 'repair-2'].map(id => getPilotCall(f.lease.runId, f.ownerId, id)));
      await assert.rejects(f.qualify(f.failed.sequence - 1), /PILOT_RECOVERY_SEQUENCE_CONFLICT/);
      await assert.rejects(f.qualify(f.failed.sequence, { ...f.authorization, sourceHash: 'f'.repeat(64) }), /SOURCE_MISMATCH/);
      await assert.rejects(claimPrivateboardRuntimeRequalification(f.lease.runId, 'qa-another-owner', 'qa-foreign', f.failed.sequence, 'Wrong fixture owner.', f.authorization), /NOT_ALLOWED/);
      const recovery = await f.qualify();
      let run = (await getPilotRun(f.lease.runId, f.ownerId))!;
      assert.equal(recovery.fence, f.lease.fence + 1); assert.equal(run.status, 'verifying'); assert.equal(run.accepted, null);
      assert.deepEqual(run.budget, f.failed.budget); assert.deepEqual(run.campaignBudget, f.failed.campaignBudget);
      assert.deepEqual(run.candidate, f.original.candidate);
      assert.deepEqual(run.details, { ...(f.failed.details as object), recoveryMode: 'runtime-requalification', runtimeRequalification: f.authorization,
        recoveryReason: 'Explicit SQL fixture runtime requalification only.', recoveryExpectedSequence: f.failed.sequence, recoveryWorkerId: 'qa-requalify' });
      await assert.rejects(updatePilotState(f.lease, 'building'), /PILOT_LEASE_LOST/);
      assert.equal((await reservePilotCall(recovery, reservation('build-1'))).created, false, 'Existing output can be read but never POSTed again.');
      for (const operation of ['upgrade-1', 'refine-1', 'build-2', 'repair-3', 'refine-repair-1'])
        await assert.rejects(reservePilotCall(recovery, reservation(operation)), /CALL_SCOPE_MISMATCH/);
      await assert.rejects(publishPilotCheckpoint(recovery, f.original.candidate, [], {}), /DELIVERY_SCOPE_MISMATCH/);

      const snapshot = requalifyPrivateboardSnapshot(f.original.snapshot, f.authorization, f.authorization.toRuntimeDigest);
      const candidate = { ...f.original.candidate, revision: snapshot.revision, runtimeDigest: f.authorization.toRuntimeDigest };
      await assert.rejects(savePilotSnapshot(recovery, snapshot, { ...candidate, runtimeDigest: f.authorization.fromRuntimeDigest }), /SNAPSHOT_SCOPE_MISMATCH/);
      await assert.rejects(savePilotSnapshot(recovery, f.original.snapshot, f.original.candidate), /SNAPSHOT_SCOPE_MISMATCH/);
      const requalified = await savePilotSnapshot(recovery, snapshot, candidate);
      assert.deepEqual((await getPilotSnapshots(f.lease.runId, f.ownerId)).filter(item => item.snapshot.revision !== 'runtime-1'), f.saved);
      assert.equal((await getPilotRun(f.lease.runId, f.ownerId))!.accepted, null, 'Copying a runtime revision does not approve delivery.');
      assert.equal((await reservePilotCall(recovery, reservation('upgrade-1'))).created, true);
      assert.equal((await reservePilotCall(recovery, reservation('upgrade-1'))).created, false);
      await assert.rejects(reservePilotCall(recovery, { ...reservation('upgrade-1'), requestHash: 'e'.repeat(64) }), /PILOT_OPERATION_CONFLICT/);
      const upgrade = nextSnapshot(f.contract, requalified, 'upgrade-1', [...snapshot.files, { path: 'supabase/migrations/002_priority.sql', content: 'alter table app.tasks add column priority integer;' }], f.authorization.toRuntimeDigest);
      await assert.rejects(savePilotSnapshot(recovery, upgrade.snapshot, upgrade.candidate), /CALL_HISTORY_MISMATCH/);
      await settlePilotCall(recovery, 'upgrade-1', { actualMicros: 20_000, status: 'completed', result: { fixture: 'upgrade' } });
      const upgraded = await savePilotSnapshot(recovery, upgrade.snapshot, upgrade.candidate);
      await updatePilotState(recovery, 'building', { recoveryMode: 'normal', runtimeRequalification: null });
      assert.equal(((await getPilotRun(f.lease.runId, f.ownerId))!.details as Record<string, unknown>).recoveryMode, 'runtime-requalification');
      assert.equal((await reservePilotCall(recovery, reservation('refine-1'))).created, true);
      await settlePilotCall(recovery, 'refine-1', { actualMicros: 20_000, status: 'completed', result: { fixture: 'refine' } });
      const refined = nextSnapshot(f.contract, upgraded, 'refine-1', upgraded.snapshot.files.map(file => file.path === 'src/styles.css' ? { ...file, content: 'body { color: blue; }' } : file), f.authorization.toRuntimeDigest);
      await savePilotSnapshot(recovery, refined.snapshot, refined.candidate);
      run = (await getPilotRun(f.lease.runId, f.ownerId))!;
      assert.equal(run.budget.callCount, 5); assert.equal(run.budget.spentMicros, 130_000); assert.equal(run.budget.reservedMicros, 0);
      assert.equal(run.campaignBudget.callCount, 5); assert.equal(run.campaignBudget.spentMicros, 130_000);
      for (const operation of ['build-2', 'repair-3', 'refine-repair-1', 'refine-2'])
        await assert.rejects(reservePilotCall(recovery, reservation(operation)), /CALL_SCOPE_MISMATCH/);
      assert.deepEqual(await Promise.all(['build-1', 'repair-1', 'repair-2'].map(id => getPilotCall(f.lease.runId, f.ownerId, id))), originalCalls);
      assert.deepEqual((await getPilotSnapshots(f.lease.runId, f.ownerId)).filter(item => ['build-1', 'repair-1', 'repair-2'].includes(item.snapshot.revision)), f.saved);
      assert.equal((await getPilotEvents(f.lease.runId, f.ownerId)).filter(event => event.type === 'recovery.claimed').length, 1);
    });

    await t.test('held, failed-call, accepted, wrong runtime and missing saved source cannot qualify', async () => {
      for (const options of [{ lastCall: 'held' as const }, { lastCall: 'failed' as const }, { staticRuntime: true }]) {
        const f = await fixture(options);
        await assert.rejects(f.qualify(), /PILOT_RUNTIME_REQUALIFICATION_(?:NOT_ALLOWED|CALL_HISTORY_MISMATCH)/);
        assert.deepEqual((await getPilotRun(f.lease.runId, f.ownerId))!.budget, f.failed.budget);
      }
      const accepted = await fixture();
      await sql`update dk_generator_v2.runs set accepted=candidate where owner_id=${accepted.ownerId} and id=${accepted.lease.runId}`;
      await assert.rejects(accepted.qualify(), /NOT_ALLOWED/);
      const missing = await fixture();
      await sql`delete from dk_generator_v2.snapshots where owner_id=${missing.ownerId} and run_id=${missing.lease.runId} and revision='repair-2'`;
      await assert.rejects(missing.qualify(), /SOURCE_MISMATCH/);
      const missingBuild = await fixture();
      await sql`delete from dk_generator_v2.snapshots where owner_id=${missingBuild.ownerId} and run_id=${missingBuild.lease.runId} and revision='build-1'`;
      await assert.rejects(missingBuild.qualify(), /SOURCE_MISMATCH/, 'The current failed repair-2 exists, but incomplete immutable history cannot qualify.');
      assert.equal((await getPilotRun(missingBuild.lease.runId, missingBuild.ownerId))!.status, 'failed');
      const unsettled = await fixture({ lastCall: 'held' });
      // Fault injection proves settled call records remain mandatory even if fixture counters are corrupt.
      await sql`update dk_generator_v2.runs set reserved_micros=0 where owner_id=${unsettled.ownerId} and id=${unsettled.lease.runId}`;
      await sql`update dk_generator_v2.campaigns set reserved_micros=0 where owner_id=${unsettled.ownerId} and campaign_id=${unsettled.campaignId}`;
      await assert.rejects(unsettled.qualify(), /CALL_HISTORY_MISMATCH/);
    });

    await t.test('other active runs block requalification and simultaneous operator claims have one winner', async () => {
      const f = await fixture();
      const other = createPrivateboardContract(f.ownerId, randomUUID());
      await createPilotRun(other, f.campaignId);
      await assert.rejects(f.qualify(), /PILOT_CAMPAIGN_BUSY/);
      await cancelPilotRun(other.identity.missionId, f.ownerId);
      const outcomes = await Promise.allSettled([f.qualify(f.failed.sequence, f.authorization, 'qa-operator-one'), f.qualify(f.failed.sequence, f.authorization, 'qa-operator-two')]);
      assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
      assert.equal(outcomes.filter(outcome => outcome.status === 'rejected').length, 1);
    });

    await t.test('ordinary workers and older recovery modes cannot remove the one-time runtime restriction', async () => {
      const f = await fixture(), recovery = await f.qualify();
      const failed = await updatePilotState(recovery, 'failed', { error: 'Disposable second failure.' });
      await assert.rejects(f.qualify(failed.sequence), /ALREADY_CLAIMED/);
      await assert.rejects(claimPilotRecordedRecovery(f.lease.runId, f.ownerId, 'qa-downgrade', failed.sequence, 'Do not replace authorization.'), /ALREADY_CLAIMED/);
      await assert.rejects(claimPilotRefinementRepair(f.lease.runId, f.ownerId, 'qa-downgrade', failed.sequence, 'Do not replace authorization.', 'a'.repeat(64)), /ALREADY_CLAIMED/);
      await sql`update dk_generator_v2.runs set details='{}'::jsonb where owner_id=${f.ownerId} and id=${f.lease.runId}`;
      await assert.rejects(f.qualify(failed.sequence), /ALREADY_CLAIMED/, 'Historical claim event remains authoritative if details are lost.');
      const expired = await fixture(); await expired.qualify();
      await sql`update dk_generator_v2.runs set lease_until=clock_timestamp()-interval '1 second' where owner_id=${expired.ownerId} and id=${expired.lease.runId}`;
      assert.equal(await claimPilotRun(expired.lease.runId, expired.ownerId, 'qa-ordinary-worker'), null);
    });

    await t.test('requalification cannot replenish an exhausted three-dollar budget', async () => {
      const f = await fixture({ actualMicros: 1_000_000 });
      const recovery = await f.qualify();
      const snapshot = requalifyPrivateboardSnapshot(f.original.snapshot, f.authorization, f.authorization.toRuntimeDigest);
      await savePilotSnapshot(recovery, snapshot, { ...f.original.candidate, revision: 'runtime-1', runtimeDigest: f.authorization.toRuntimeDigest });
      await assert.rejects(reservePilotCall(recovery, reservation('upgrade-1', 1)), /PILOT_BUDGET_LIMIT/);
      const run = (await getPilotRun(f.lease.runId, f.ownerId))!;
      assert.deepEqual(run.budget, f.failed.budget); assert.deepEqual(run.campaignBudget, f.failed.campaignBudget);
    });
  } finally {
    try {
      // These exact invocation-owned namespaces cannot include a real pilot owner or shared campaign.
      for (const ownerId of owners) {
        assert.match(ownerId, /^qa-runtime-[a-f0-9-]{36}$/);
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
        assert.equal(Number(remaining.count), 0, 'All exact QA fixture records must be removed.');
      }
    } finally { await closeDatabase(); }
  }
});
