import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, closeDatabase } from '../src/lib/server/database';
import { getPilotCall, getPilotRun, getPilotSnapshots, getPilotEvents, heartbeatPilotRun,
  claimPrivateboardEnvironmentRecovery, privateboardEnvironmentRecoverySchema,
  validatePrivateboardEnvironmentRecovery } from '../src/lib/server/generator/pilotStore';
import { inspectPrivateboardRuntime } from '../src/lib/server/generator/supabasePilotRuntime';
import { inspectSupabasePilotPrerequisites } from '../src/lib/server/generator/supabasePilotEnvironment';
import { PRIVATEBOARD_OPERATIONS, replayPrivateboardCalls } from '../src/lib/server/generator/supabasePilotReplay';
import { runPrivateboardPilot } from '../src/lib/server/generator/supabasePilotSupervisor';
import { failBriefboardPilot } from '../src/lib/server/generator/pilotSupervisor';

const argument = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
async function main() {
  const runId = z.string().regex(/^v2-pilot-[a-z0-9-]+$/).parse(argument('--run-id'));
  const expectedImage = z.string().regex(/^sha256:[a-f0-9]{64}$/).parse(argument('--runtime-image'));
  const dbUrl = new URL(process.env.DATABASE_URL || 'invalid');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(dbUrl.hostname)) throw new Error('Operator environment recovery is restricted to the local pilot.');
  if (!process.env.DEVKILLER_PILOT_EMAIL || !process.env.OPENAI_API_KEY) throw new Error('Configured owner and server credentials are required.');
  const [owner] = await database()`select u.id from auth.users u join profiles p on p.id=u.id where lower(u.email)=lower(${process.env.DEVKILLER_PILOT_EMAIL}) and p.role='admin'`;
  if (!owner) throw new Error('Configured owner not found.');
  const run = await getPilotRun(runId, owner.id);
  if (!run || run.status !== 'failed' || run.accepted || run.budget.reservedMicros || run.campaignBudget.reservedMicros)
    throw new Error('Only a failed, fully settled, unapproved pilot may resume its environment.');
  const [runtime, prerequisites] = await Promise.all([inspectPrivateboardRuntime(), inspectSupabasePilotPrerequisites()]);
  if (!runtime.available || runtime.imageId !== expectedImage || !prerequisites.available)
    throw new Error('The explicitly approved unchanged runtime and corrected environment prerequisites are required.');
  const runtimeDigest = createHash('sha256').update(runtime.imageId + ':' + runtime.verifierVersion).digest('hex');
  const saved = await getPilotSnapshots(runId, owner.id);
  const calls = (await Promise.all(PRIVATEBOARD_OPERATIONS.map(operation => getPilotCall(runId, owner.id, operation)))).filter(call => call !== null);
  // Reconstruct the original provider output and verify source, request, runtime,
  // accounting and immutable lineage. A resume cannot replace the first build.
  const replay = replayPrivateboardCalls(run.contract, calls, saved, runtimeDigest);
  if (!replay.snapshot || replay.snapshot.revision !== 'build-1' || replay.pending || replay.upgraded || replay.refined || calls.length !== 1)
    throw new Error('Environment recovery requires the exact single settled original build.');
  const authorization = privateboardEnvironmentRecoverySchema.parse({ sourceHash: replay.snapshot.hash, runtimeDigest });
  validatePrivateboardEnvironmentRecovery(run, saved, calls, await getPilotEvents(runId, owner.id), authorization);
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ readOnly: true, runId, sourceHash: replay.snapshot.hash, sourceRevision: 'build-1',
      runtimeUnchanged: true, recordedCalls: 1, originalBudgetsUnchanged: true,
      allowedRemainingOperations: ['repair-1', 'repair-2', 'upgrade-1', 'refine-1'],
      notice: 'Eligibility and exact recorded infrastructure failure are checked again under the claim lock.' }));
    return;
  }
  const lease = await claimPrivateboardEnvironmentRecovery(runId, owner.id, `environment-proof-${randomUUID()}`, run.sequence,
    'Docker automatic network pools were exhausted before this app environment was ready. Resume the exact paid build after new-only, collision-checked small subnet allocation. Preserve old networks, all source history, costs and original call/repair ceilings.', authorization);
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('Operator stopped environment recovery.'));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const heartbeat = setInterval(() => { void heartbeatPilotRun(lease).catch(() => controller.abort(new Error('Environment recovery lease lost.'))); }, 15_000);
  try {
    console.log(JSON.stringify({ runId, stage: 'resuming-recorded-source-environment', noNewBuild: true, sourceHash: replay.snapshot.hash }));
    await runPrivateboardPilot(lease, controller.signal);
    const completed = await getPilotRun(runId, owner.id);
    if (completed?.status !== 'ready' || !completed.accepted) throw new Error('The environment resume did not approve a delivery.');
    console.log(JSON.stringify({ runId, stage: 'ready', sourceWasGeneratedByDevKiller: true }));
  } catch (error) { await failBriefboardPilot(lease, error); throw error; }
  finally { clearInterval(heartbeat); process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
main().catch(error => {
  const message = error instanceof Error ? error.message : 'Environment recovery failed.';
  console.error(message.replace(/sk-[\w-]+/g, '[REDACTED]').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[REDACTED_TOKEN]').slice(0, 1800));
  process.exitCode = 1;
}).finally(closeDatabase);
