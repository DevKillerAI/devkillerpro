import { database } from "@/lib/server/database";
import { currentPolicy } from '../modelPolicy';

export type MissionJobPayload = {
  prompt: string;
  selectedAgentIds: string[];
  classification?: unknown;
  brief?: unknown;
  resumeCandidateArtifact?: string;
};

export type ClaimedMissionJob = {
  id: string;
  missionId: string;
  attempts: number;
  maxAttempts: number;
  workerId: string;
  checkpoint: { meeting?: { meeting?: { appTitle?: string; decision?: unknown } } };
  payload: MissionJobPayload;
};

export async function enqueueMissionJob(input: {
  missionId: string;
  payload: MissionJobPayload;
  ownerId?: string;
  resumeCheckpoint?: ClaimedMissionJob['checkpoint'];
}) {
  const sql = database();
  const snapshot=await currentPolicy();
  return sql.begin(async (tx) => {
    // Serialize requests for one mission, including its first creation.
    await tx`select pg_advisory_xact_lock(hashtextextended(${input.missionId}, 0))`;
    const [existing] = await tx`select owner_id, status from missions where id=${input.missionId} for update`;
    if (existing && input.ownerId && existing.owner_id !== input.ownerId) throw new Error("FORBIDDEN");
    if (existing && !["failed", "cancelled"].includes(existing.status)) throw new Error("MISSION_ACTIVE");
    let charge = false;
    if (input.ownerId) {
      const [profile] = await tx`select credit_limit, credits_used from profiles where id=${input.ownerId} for update`;
      const [priorCharge] = await tx`select id from credit_ledger where owner_id=${input.ownerId} and mission_id=${input.missionId} and reason='mission.created' limit 1`;
      charge = !priorCharge;
      if (!profile || (charge && profile.credit_limit !== null && Number(profile.credits_used) >= Number(profile.credit_limit))) throw new Error("CREDIT_LIMIT");
    }
    await tx`
      insert into public.missions (id, owner_id, prompt, status, phase, progress)
      values (${input.missionId}, ${input.ownerId || null}, ${input.payload.prompt}, 'queued', 'council', 0)
      on conflict (id) do update set
        prompt = excluded.prompt,
        status = case when missions.status in ('failed', 'cancelled') then 'queued' else missions.status end,
        error_message = null,
        phase = 'council', progress = 0, completed_at = null
    `;
    await tx`update missions set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('modelPolicy',${tx.json(snapshot.policy)}::jsonb,'modelPolicyVersion',${snapshot.id}::text) where id=${input.missionId} and not (coalesce(metadata,'{}'::jsonb) ? 'modelPolicy')`;
    const [job] = await tx`
      insert into public.mission_jobs (mission_id, payload, checkpoint)
      values (${input.missionId}, ${tx.json(input.payload as never)}, ${tx.json((input.resumeCheckpoint || {}) as never)})
      returning id, mission_id, status, created_at
    `;
    if (charge && input.ownerId) {
      await tx`update profiles set credits_used=credits_used+1 where id=${input.ownerId}`;
      await tx`insert into credit_ledger(owner_id,mission_id,amount,reason) values(${input.ownerId},${input.missionId},-1,'mission.created')`;
    }
    await tx`
      insert into public.mission_events (mission_id, job_id, event_type, phase, message, progress)
      values (${input.missionId}, ${job.id}, 'mission.queued', 'council', 'Mission accepted for processing.', 0)
    `;
    return job;
  });
}

export async function claimMissionJob(workerId: string, leaseSeconds = 300) {
  const sql = database();
  await sql`
    with exhausted as (
      update public.mission_jobs set status = 'failed', completed_at = now(),
        lease_expires_at = null, last_error = 'Worker lease expired after the final attempt.'
      where status = 'running' and lease_expires_at < now() and attempts >= max_attempts
      returning mission_id
    )
    update public.missions set status = 'failed', error_message = 'Worker recovery attempts exhausted.'
    where id in (select mission_id from exhausted)
  `;
  const [row] = await sql`
    with candidate as (
      select id from public.mission_jobs
      where attempts < max_attempts and ((
        status in ('queued', 'retrying') and available_at <= now()
      ) or (
        status = 'running' and lease_expires_at < now()
      ))
      order by priority asc, created_at asc
      for update skip locked
      limit 1
    )
    update public.mission_jobs j set
      status = 'running',
      worker_id = ${workerId},
      attempts = attempts + 1,
      started_at = coalesce(started_at, now()),
      lease_expires_at = now() + (${leaseSeconds} * interval '1 second'),
      last_error = null
    from candidate where j.id = candidate.id
    returning j.id, j.mission_id, j.attempts, j.max_attempts, j.payload, j.checkpoint
  `;
  if (!row) return null;
  await sql`
    update public.missions set status = 'running', phase = 'council', progress = 5
    where id = ${row.mission_id}
  `;
  return {
    id: String(row.id),
    missionId: String(row.mission_id),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    workerId,
    checkpoint: row.checkpoint as ClaimedMissionJob["checkpoint"],
    payload: row.payload as MissionJobPayload,
  } satisfies ClaimedMissionJob;
}

export async function renewJobLease(job: ClaimedMissionJob) {
  const sql = database();
  const rows = await sql`
    update public.mission_jobs set lease_expires_at = now() + interval '5 minutes'
    where id = ${job.id} and worker_id = ${job.workerId}
      and attempts = ${job.attempts} and status = 'running' and lease_expires_at > now()
    returning id
  `;
  return rows.length === 1;
}

export async function saveJobCheckpoint(job: ClaimedMissionJob, checkpoint: ClaimedMissionJob["checkpoint"]) {
  const sql = database();
  const rows = await sql`
    update public.mission_jobs set checkpoint = ${sql.json(checkpoint as never)}
    where id = ${job.id} and worker_id = ${job.workerId}
      and attempts = ${job.attempts} and status = 'running' and lease_expires_at > now()
    returning id
  `;
  if (!rows.length) throw new Error('Worker no longer owns this job.');
  const appTitle=checkpoint.meeting?.meeting?.appTitle;
  if(appTitle) await sql`update missions set app_title=${appTitle} where id=${job.missionId}`;
}

export async function recordJobProgress(
  job: ClaimedMissionJob,
  phase: string,
  progress: number,
  message: string,
) {
  const sql = database();
  await sql.begin(async (tx) => {
    const owned = await tx`select id from mission_jobs where id=${job.id} and worker_id=${job.workerId} and attempts=${job.attempts} and status='running' for update`;
    if (!owned.length) throw new Error('Worker no longer owns this job.');
    await tx`
      update public.missions set phase = ${phase}, progress = ${progress}
      where id = ${job.missionId}
    `;
    await tx`
      insert into public.mission_events (mission_id, job_id, event_type, phase, message, progress)
      values (${job.missionId}, ${job.id}, 'mission.progress', ${phase}, ${message}, ${progress})
    `;
  });
}

export async function completeMissionJob(job: ClaimedMissionJob, appTitle?: string) {
  const sql = database();
  await sql.begin(async (tx) => {
    const updated = await tx`
      update public.mission_jobs set status = 'completed', completed_at = now(), lease_expires_at = null
      where id = ${job.id} and worker_id = ${job.workerId}
        and attempts = ${job.attempts} and status = 'running' and lease_expires_at > now()
      returning id
    `;
    if (!updated.length) throw new Error('Worker no longer owns this job.');
    await tx`
      update public.missions set status = 'verified', phase = 'delivery', progress = 100,
        completed_at = now(), app_title = coalesce(${appTitle || null}, app_title), error_message = null
      where id = ${job.missionId}
    `;
    await tx`
      insert into public.mission_events (mission_id, job_id, event_type, phase, message, progress)
      values (${job.missionId}, ${job.id}, 'mission.completed', 'delivery', 'Mission passed its delivery gates.', 100)
    `;
    await tx`
      insert into public.notifications (owner_id, mission_id, kind, title, body)
      select owner_id, id, 'mission.ready', 'Your DevKiller app is ready',
        coalesce(app_title, 'Your application') || ' passed the delivery gates.'
      from public.missions where id = ${job.missionId} and owner_id is not null
    `;
  });
}

export async function failMissionJob(job: ClaimedMissionJob, error: string) {
  const sql = database();
  // Do not multiply a completed repair cycle or an uncertain provider POST.
  // Poll interruptions are resumed inside the same worker operation.
  const unsafeToReplay = /PROVIDER_SUBMISSION_UNCERTAIN|PROVIDER_WAIT_LIMIT|OPENAI_SUBMISSION_REJECTED|OPENAI_RESPONSE_|OPENAI_REFUSAL|PROVIDER_BUDGET_EXHAUSTED|Recovery attempts exhausted|Recovery stopped|PIPELINE_RECONNECT_EXHAUSTED/i.test(error);
  const retry = !unsafeToReplay && !error.includes('VERIFICATION_REQUIRED') && job.attempts < job.maxAttempts;
  const retryDelay = Math.min(300, 15 * 2 ** Math.max(0, job.attempts - 1));
  await sql.begin(async (tx) => {
    const updated = await tx`
      update public.mission_jobs set
        status = ${retry ? "retrying" : "failed"}::public.job_status,
        available_at = case when ${retry} then now() + (${retryDelay} * interval '1 second') else available_at end,
        lease_expires_at = null,
        last_error = ${error.slice(0, 4000)},
        completed_at = case when ${retry} then null else now() end
      where id = ${job.id} and worker_id = ${job.workerId}
        and attempts = ${job.attempts} and status = 'running' and lease_expires_at > now()
      returning id
    `;
    if (!updated.length) return;
    await tx`
      update public.missions set
        status = ${retry ? "waiting" : "failed"}::public.mission_status,
        error_message = ${error.slice(0, 4000)}
      where id = ${job.missionId}
    `;
    await tx`
      insert into public.mission_events (mission_id, job_id, event_type, phase, message, progress, details)
      values (
        ${job.missionId}, ${job.id}, ${retry ? "mission.retry_scheduled" : "mission.failed"},
        'recovery', ${retry ? "A recovery attempt was scheduled." : "Mission requires attention."}, null,
        ${tx.json({ attempt: job.attempts, maxAttempts: job.maxAttempts, error: error.slice(0, 1000) } as never)}
      )
    `;
  });
}

export async function getMissionJob(missionId: string, ownerId?: string, admin = false) {
  const sql = database();
  const [row] = await sql`
    select j.id, j.status, j.attempts, j.max_attempts, j.last_error,
      m.phase, m.progress, m.app_title, m.updated_at
    from public.mission_jobs j join public.missions m on m.id = j.mission_id
    where j.mission_id = ${missionId} and (${admin} or ${ownerId || null}::uuid is null or m.owner_id=${ownerId || null})
    order by j.created_at desc limit 1
  `;
  return row || null;
}

export async function cancelMissionJob(missionId: string, ownerId?: string, admin = false) {
  return database().begin(async tx => {
    const jobs = await tx`update mission_jobs set status='cancelled', completed_at=now(), lease_expires_at=null
      where mission_id=${missionId} and status in ('queued','running','retrying') and exists(select 1 from missions m where m.id=${missionId} and (${admin} or ${ownerId || null}::uuid is null or m.owner_id=${ownerId || null})) returning id`;
    // A manually resumed pipeline can be active after its queue job ended.
    // Cancellation must reach the mission signal in that case too.
    const missions = await tx`update missions set status='cancelled', error_message='Cancelled by user.', phase='cancelled'
      where id=${missionId} and (${admin} or ${ownerId || null}::uuid is null or owner_id=${ownerId || null})
      and (status in ('running','queued','waiting') or ${jobs.length>0}) returning id`;
    return jobs.length>0 || missions.length>0;
  });
}

export async function listMissionQueueRecords(limit = 50, ownerId?: string, admin = false) {
  const sql = database();
  return sql`
    select id, prompt, app_title, status, phase, progress, created_at,
      updated_at, error_message, metadata
    from public.missions where (${admin} or ${ownerId || null}::uuid is null or owner_id=${ownerId || null})
    order by created_at desc
    limit ${Math.max(1, Math.min(100, limit))}
  `;
}
