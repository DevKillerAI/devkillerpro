import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, closeDatabase } from '../../src/lib/server/database';
import { enqueueMissionJob, claimMissionJob, renewJobLease, saveJobCheckpoint, completeMissionJob, failMissionJob, cancelMissionJob, recordJobProgress } from '../../src/lib/server/jobs/queue';
import { assertMissionActive, cancellableMission, missionSignal } from '../../src/lib/server/jobs/cancellation';

test('PostgreSQL queue: duplicate prevention, leases, fencing, checkpoints and RLS', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const sql = database();
  const missionId = `infra-test-${randomUUID()}`;
  try {
    // Do not interfere with real queued work on a shared database.
    const [active] = await sql`select count(*)::int as count from public.mission_jobs where status in ('queued','retrying','running')`;
    assert.equal(active.count, 0, 'Run queue certification only when no real missions are active.');
    const request = { missionId, payload: { prompt: 'Queue certification fixture', selectedAgentIds: ['qa'] } };
    const attempts = await Promise.allSettled([enqueueMissionJob(request), enqueueMissionJob(request)]);
    assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
    const [snapshot] = await sql`select metadata->'modelPolicy' as policy, metadata->>'modelPolicyVersion' as version from missions where id=${missionId}`;
    assert.ok(snapshot.policy?.product, 'Enqueue persists the model policy without SQL inference errors.');
    assert.ok(snapshot.version);
    const claims = await Promise.all([claimMissionJob('test-a'), claimMissionJob('test-b')]);
    assert.equal(claims.filter(Boolean).length, 1);
    const first = claims.find(Boolean)!;
    assert.equal(first.missionId, missionId);
    assert.equal(await renewJobLease(first), true);
    await saveJobCheckpoint(first, { meeting: { meeting: { appTitle: 'Checkpoint title' } } });
    await sql`update public.mission_jobs set lease_expires_at = now() - interval '1 second' where id = ${first.id}`;
    const recovered = await claimMissionJob('test-recovered');
    assert.ok(recovered);
    assert.equal(recovered.attempts, 2);
    assert.equal(recovered.checkpoint.meeting?.meeting?.appTitle, 'Checkpoint title');
    assert.equal(await renewJobLease(first), false);
    await assert.rejects(completeMissionJob(first), /no longer owns/);
    await failMissionJob(recovered, 'controlled test failure');
    await sql`update public.mission_jobs set available_at = now() where id = ${first.id}`;
    const finalAttempt = await claimMissionJob('test-final');
    assert.ok(finalAttempt);
    assert.equal(finalAttempt.attempts, 3);
    await sql`update public.mission_jobs set lease_expires_at = now() - interval '1 second' where id = ${first.id}`;
    assert.equal(await claimMissionJob('test-exhausted'), null);
    const [job] = await sql`select status from public.mission_jobs where id = ${first.id}`;
    assert.equal(job.status, 'failed');
    await enqueueMissionJob(request);
    const cancelling = await claimMissionJob('test-cancellation');
    assert.ok(cancelling);
    const runningRequest = cancellableMission(new Request('http://localhost/api/test', {method:'POST', headers:{"x-devkiller-worker-token":process.env.DEVKILLER_WORKER_TOKEN!}, body:JSON.stringify({missionId})}), async () => {
      await new Promise((_, reject) => missionSignal()!.addEventListener('abort', () => reject(new Error('cancelled')), {once:true}));
      return new Response();
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await cancelMissionJob(missionId), true);
    assert.equal((await runningRequest).status, 409);
    await assert.rejects(assertMissionActive(missionId), /cancelled/);
    assert.equal(await renewJobLease(cancelling), false);
    await assert.rejects(recordJobProgress(cancelling, 'build', 50, 'stale progress'), /no longer owns/);
    await assert.rejects(completeMissionJob(cancelling), /no longer owns/);
    await failMissionJob(cancelling, 'late failure');
    assert.equal(await claimMissionJob('test-after-cancel'), null);
    const [cancelled] = await sql`select status from public.missions where id=${missionId}`;
    assert.equal(cancelled.status, 'cancelled');
    const [bucket] = await sql`select public from storage.buckets where id = 'mission-artifacts'`;
    assert.equal(bucket.public, false);
    await assert.rejects(sql.begin(async tx => {
      await tx`set local role anon`;
      await tx`select * from public.mission_jobs`;
    }), /permission denied/);
  } finally {
    await sql`delete from public.missions where id = ${missionId}`;
    await closeDatabase();
  }
});
