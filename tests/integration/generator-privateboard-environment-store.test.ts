import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { database, closeDatabase } from '../../src/lib/server/database';
import { contractFingerprint } from '../../src/lib/server/generator/contract';
import { createPrivateboardContract } from '../../src/lib/server/generator/supabasePilotContract';
import { createGeneratorSnapshot } from '../../src/lib/server/generator/versionedEdits';
import {
  PILOT_CAMPAIGN_ID, createPilotRun, getPilotRun, claimPilotRun, claimPrivateboardEnvironmentRecovery,
  claimPilotRecordedRecovery, claimPilotRefinementRepair, claimPrivateboardRuntimeRequalification, updatePilotState,
  reservePilotCall, markPilotSubmitted, settlePilotCall, savePilotSnapshot, getPilotSnapshots, getPilotCall,
  appendPilotEvent, getPilotEvents, cancelPilotRun, acceptPilotSnapshot, type PilotSavedSnapshot,
} from '../../src/lib/server/generator/pilotStore';

const poolFailure = 'Command failed: docker network create qa-only\nError response from daemon: all predefined address pools have been fully subnetted';
test('Privateboard environment recovery: explicit opt-in SQL-only local QA transactions', {
  skip: process.env.RUN_PRIVATEBOARD_ENVIRONMENT_STORE_TESTS !== '1',
}, async t => {
  const url = new URL(process.env.DATABASE_URL || '');
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname), 'Refusing remote fixture writes.');
  const sql = database(), owners = new Set<string>();
  const fromImageId = `sha256:${'1'.repeat(64)}`, toImageId = `sha256:${'2'.repeat(64)}`, verifierVersion = 'privateboard-v1';
  const runtimeHash = (imageId: string) => createHash('sha256').update(`${imageId}:${verifierVersion}`).digest('hex');
  const reservation = (operationId: string, reservedMicros = 100_000) => ({ operationId, reservedMicros,
    requestHash: createHash('sha256').update(operationId).digest('hex'), model: 'qa-no-provider', request: { fixture: true, operationId } });
  const fixture = async (options: { held?: boolean; failedCall?: boolean; liveLease?: boolean; noStart?: boolean; afterReady?: boolean; afterFinished?: boolean; message?: string; changedContract?: boolean; actualMicros?: number } = {}) => {
    const ownerId = `qa-env-store-${randomUUID()}`, campaignId = `qa-env-store-${randomUUID()}`;
    assert.match(ownerId, /^qa-env-store-[a-f0-9-]{36}$/); assert.notEqual(campaignId, PILOT_CAMPAIGN_ID); owners.add(ownerId);
    const base = createPrivateboardContract(ownerId, randomUUID());
    const contract = options.changedContract ? { ...base, prompt: 'Different disposable QA contract.' } : base;
    await createPilotRun(contract, campaignId);
    const lease = await claimPilotRun(contract.identity.missionId, ownerId, `qa-worker-${randomUUID()}`); assert.ok(lease);
    await updatePilotState(lease, 'planning'); await updatePilotState(lease, 'building');
    const actualMicros = options.actualMicros ?? 64_372;
    const input = reservation('build-1', Math.max(100_000, actualMicros));
    await reservePilotCall(lease, input); await markPilotSubmitted(lease, 'build-1', `qa-response-${randomUUID()}`);
    if (!options.held) await settlePilotCall(lease, 'build-1', { actualMicros, status: options.failedCall ? 'failed' : 'completed', result: { fixture: true }, usage: { fixture: true } });
    const snapshot = createGeneratorSnapshot({ scope: contract.identity, revision: 'build-1', files: [
      { path: 'src/App.tsx', content: 'export const App = () => null;' }, { path: 'src/styles.css', content: 'body { color: red; }' },
      { path: 'supabase/migrations/001_init.sql', content: 'create table app.tasks(id uuid);' },
    ] });
    const original = await savePilotSnapshot(lease, snapshot, { identity: contract.identity, revision: 'build-1', sourceHash: snapshot.hash,
      contractHash: contractFingerprint(contract), runtimeDigest: runtimeHash(fromImageId) });
    if (!options.noStart) await appendPilotEvent(lease, 'verification.environment', 'Preparing a disposable QA environment.', { revision: 'build-1' });
    if (options.afterReady) await appendPilotEvent(lease, 'verification.environment-ready', 'QA environment already ready.', { revision: 'build-1' });
    if (options.afterFinished) await appendPilotEvent(lease, 'verification.finished', 'QA verification already finished.', { revision: 'build-1' });
    const message = options.message ?? poolFailure;
    await appendPilotEvent(lease, 'run.error', message); await updatePilotState(lease, 'failed', { error: message });
    if (!options.liveLease) await sql`update dk_generator_v2.runs set lease_until=clock_timestamp()-interval '1 second' where owner_id=${ownerId} and id=${lease.runId}`;
    const failed = (await getPilotRun(lease.runId, ownerId))!;
    const authorization = { sourceHash: snapshot.hash, runtimeDigest: runtimeHash(fromImageId) };
    const claim = (sequence = failed.sequence, input = authorization, workerId = 'qa-env-recovery') =>
      claimPrivateboardEnvironmentRecovery(lease.runId, ownerId, workerId, sequence, 'Explicit disposable QA network recovery.', input);
    return { ownerId, campaignId, contract, lease, failed, original, input, authorization, claim };
  };
  const makeNext = (parent: PilotSavedSnapshot, revision: string, files: readonly { path: string; content: string }[]) => {
    const snapshot = { ...createGeneratorSnapshot({ scope: parent.snapshot.scope, revision, files }), parent: { revision: parent.snapshot.revision, hash: parent.snapshot.hash } };
    return { snapshot, candidate: { ...parent.candidate, revision, sourceHash: snapshot.hash } };
  };
  try {
    await t.test('same build/runtime/budgets resume; exact original calls alone can finish within five total operations', async () => {
      const f = await fixture(), beforeCall = await getPilotCall(f.lease.runId, f.ownerId, 'build-1');
      await assert.rejects(f.claim(f.failed.sequence - 1), /PILOT_RECOVERY_SEQUENCE_CONFLICT/);
      await assert.rejects(f.claim(f.failed.sequence, { ...f.authorization, sourceHash: 'f'.repeat(64) }), /SOURCE_MISMATCH/);
      await assert.rejects(f.claim(f.failed.sequence, { ...f.authorization, runtimeDigest: 'f'.repeat(64) }), /SOURCE_MISMATCH/);
      const lease = await f.claim();
      let run = (await getPilotRun(lease.runId, f.ownerId))!;
      assert.equal(run.status, 'verifying'); assert.equal(run.accepted, null); assert.deepEqual(run.candidate, f.original.candidate);
      assert.deepEqual(run.budget, f.failed.budget); assert.deepEqual(run.campaignBudget, f.failed.campaignBudget);
      assert.equal((run.details as Record<string, unknown>).recoveryMode, 'environment-recovery');
      assert.deepEqual((run.details as Record<string, unknown>).environmentRecovery, f.authorization);
      assert.equal((run.details as Record<string, unknown>).error, poolFailure);
      assert.equal((await reservePilotCall(lease, f.input)).created, false, 'Recorded build remains idempotent, never a second provider submission.');
      await assert.rejects(reservePilotCall(lease, { ...f.input, requestHash: 'e'.repeat(64) }), /PILOT_OPERATION_CONFLICT/);
      for (const op of ['build-2', 'repair-2', 'repair-3', 'runtime-1', 'refine-1', 'refine-repair-1'])
        await assert.rejects(reservePilotCall(lease, reservation(op)), /CALL_SCOPE_MISMATCH/);
      await assert.rejects(savePilotSnapshot(lease, f.original.snapshot, { ...f.original.candidate, runtimeDigest: 'f'.repeat(64) }), /SNAPSHOT_SCOPE_MISMATCH/);
      await savePilotSnapshot(lease, f.original.snapshot, f.original.candidate);
      let current = f.original;
      for (const op of ['repair-1', 'repair-2', 'upgrade-1', 'refine-1']) {
        assert.equal((await reservePilotCall(lease, reservation(op))).created, true);
        assert.equal((await reservePilotCall(lease, reservation(op))).created, false);
        let files: readonly { path: string; content: string }[] = current.snapshot.files;
        if (op.startsWith('repair')) files = files.map(file => file.path === 'src/App.tsx' ? { ...file, content: `export const App = () => '${op}';` } : file);
        if (op === 'upgrade-1') files = [...files, { path: 'supabase/migrations/002_priority.sql', content: 'alter table app.tasks add column priority integer;' }];
        if (op === 'refine-1') files = files.map(file => file.path === 'src/styles.css' ? { ...file, content: 'body { color: blue; }' } : file);
        const next = makeNext(current, op, files);
        await assert.rejects(savePilotSnapshot(lease, next.snapshot, next.candidate), /CALL_HISTORY_MISMATCH/);
        await settlePilotCall(lease, op, { actualMicros: 20_000, status: 'completed', result: { fixture: op } });
        if (op === 'repair-2') {
          const wrong = makeNext(f.original, op, files);
          await assert.rejects(savePilotSnapshot(lease, wrong.snapshot, wrong.candidate), /SNAPSHOT_SCOPE_MISMATCH/);
        }
        if (op === 'refine-1') {
          const wrong = makeNext(current, op, files.map(file => file.path === 'src/App.tsx' ? { ...file, content: 'Unauthorized edit.' } : file));
          await assert.rejects(savePilotSnapshot(lease, wrong.snapshot, wrong.candidate), /SOURCE_MISMATCH/);
        }
        current = await savePilotSnapshot(lease, next.snapshot, next.candidate);
      }
      run = (await getPilotRun(lease.runId, f.ownerId))!;
      assert.equal(run.budget.callCount, 5); assert.equal(run.budget.spentMicros, 144_372); assert.equal(run.budget.reservedMicros, 0);
      assert.equal(run.campaignBudget.callCount, 5); assert.equal(run.campaignBudget.spentMicros, 144_372);
      await assert.rejects(reservePilotCall(lease, reservation('refine-repair-1')), /CALL_SCOPE_MISMATCH/);
      await assert.rejects(acceptPilotSnapshot(lease, current.candidate, [], {}), /PILOT_DELIVERY_CHECKS_FAILED/, 'Resuming infrastructure does not relax the delivery proof.');
      assert.deepEqual(await getPilotCall(lease.runId, f.ownerId, 'build-1'), beforeCall);
      assert.deepEqual((await getPilotSnapshots(lease.runId, f.ownerId))[0], f.original);
      assert.equal((await getPilotEvents(lease.runId, f.ownerId)).filter(event => event.type === 'recovery.claimed').length, 1);
    });

    await t.test('live/held/failed-call/nonfixed and post-environment failures cannot consume recovery authority', async () => {
      for (const options of [{ liveLease: true }, { held: true }, { failedCall: true }, { changedContract: true }, { noStart: true }, { afterReady: true }, { afterFinished: true }, { message: 'Database source verification failed.' }]) {
        const f = await fixture(options);
        await assert.rejects(f.claim(), /PILOT_ENVIRONMENT_RECOVERY_(?:NOT_ALLOWED|CALL_HISTORY_MISMATCH|FAILURE_EVIDENCE_MISMATCH)/);
        assert.equal((await getPilotRun(f.lease.runId, f.ownerId))!.status, 'failed');
        assert.deepEqual((await getPilotRun(f.lease.runId, f.ownerId))!.budget, f.failed.budget);
      }
      const accepted = await fixture();
      await sql`update dk_generator_v2.runs set accepted=candidate where owner_id=${accepted.ownerId} and id=${accepted.lease.runId}`;
      await assert.rejects(accepted.claim(), /NOT_ALLOWED/);
      const missing = await fixture();
      await sql`delete from dk_generator_v2.snapshots where owner_id=${missing.ownerId} and run_id=${missing.lease.runId}`;
      await assert.rejects(missing.claim(), /SOURCE_MISMATCH/);
    });

    await t.test('other active campaign run, wrong owner and concurrent operators cannot bypass the exclusive claim', async () => {
      const f = await fixture(), other = createPrivateboardContract(f.ownerId, randomUUID());
      await assert.rejects(claimPrivateboardEnvironmentRecovery(f.lease.runId, 'qa-other-owner', 'qa-other-worker', f.failed.sequence, 'Wrong owner.', f.authorization), /NOT_ALLOWED/);
      await createPilotRun(other, f.campaignId); await assert.rejects(f.claim(), /PILOT_CAMPAIGN_BUSY/); await cancelPilotRun(other.identity.missionId, f.ownerId);
      const claims = await Promise.allSettled([f.claim(f.failed.sequence, f.authorization, 'qa-operator-one'), f.claim(f.failed.sequence, f.authorization, 'qa-operator-two')]);
      assert.equal(claims.filter(item => item.status === 'fulfilled').length, 1); assert.equal(claims.filter(item => item.status === 'rejected').length, 1);
    });

    await t.test('one-shot authority survives state updates, excludes ordinary workers and blocks every older recovery mode', async () => {
      const f = await fixture(), lease = await f.claim();
      await updatePilotState(lease, 'building', { recoveryMode: 'normal', environmentRecovery: null });
      assert.equal(((await getPilotRun(lease.runId, f.ownerId))!.details as Record<string, unknown>).recoveryMode, 'environment-recovery');
      const failed = await updatePilotState(lease, 'failed', { error: 'Second controlled QA failure.' });
      await sql`update dk_generator_v2.runs set lease_until=clock_timestamp()-interval '1 second' where owner_id=${f.ownerId} and id=${lease.runId}`;
      await assert.rejects(f.claim(failed.sequence), /ALREADY_CLAIMED/);
      await assert.rejects(claimPilotRecordedRecovery(lease.runId, f.ownerId, 'qa-old', failed.sequence, 'No downgrade.'), /ALREADY_CLAIMED/);
      await assert.rejects(claimPilotRefinementRepair(lease.runId, f.ownerId, 'qa-old', failed.sequence, 'No downgrade.', 'a'.repeat(64)), /ALREADY_CLAIMED/);
      await assert.rejects(claimPrivateboardRuntimeRequalification(lease.runId, f.ownerId, 'qa-old', failed.sequence, 'No runtime change.', {
        sourceRevision: 'build-1', sourceHash: f.authorization.sourceHash, fromRuntimeDigest: runtimeHash(fromImageId), toRuntimeDigest: runtimeHash(toImageId),
        fromImageId, toImageId, verifierVersion, requalificationRevision: 'runtime-1',
      }), /ALREADY_CLAIMED/);
      await sql`update dk_generator_v2.runs set details='{}'::jsonb where owner_id=${f.ownerId} and id=${lease.runId}`;
      await assert.rejects(f.claim(failed.sequence), /ALREADY_CLAIMED/, 'Recorded claim event still prevents a second authorization.');
      await assert.rejects(claimPilotRecordedRecovery(lease.runId, f.ownerId, 'qa-old', failed.sequence, 'No erased-details downgrade.'), /ALREADY_CLAIMED/);
      const expired = await fixture(); await expired.claim();
      await sql`update dk_generator_v2.runs set lease_until=clock_timestamp()-interval '1 second' where owner_id=${expired.ownerId} and id=${expired.lease.runId}`;
      assert.equal(await claimPilotRun(expired.lease.runId, expired.ownerId, 'qa-ordinary'), null);
    });

    await t.test('no budget reset is possible even when the environment can now be prepared', async () => {
      const f = await fixture({ actualMicros: 3_000_000 }), lease = await f.claim();
      await assert.rejects(reservePilotCall(lease, reservation('upgrade-1', 1)), /PILOT_BUDGET_LIMIT/);
      const run = (await getPilotRun(lease.runId, f.ownerId))!;
      assert.deepEqual(run.budget, f.failed.budget); assert.deepEqual(run.campaignBudget, f.failed.campaignBudget);
    });
  } finally {
    try {
      for (const ownerId of owners) {
        assert.match(ownerId, /^qa-env-store-[a-f0-9-]{36}$/);
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
        assert.equal(Number(remaining.count), 0, 'Exact invocation-owned QA records are all removed.');
      }
    } finally { await closeDatabase(); }
  }
});
