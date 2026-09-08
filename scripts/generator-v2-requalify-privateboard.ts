import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, closeDatabase } from '../src/lib/server/database';
import { getPilotCall, getPilotRun, getPilotSnapshots, heartbeatPilotRun, claimPrivateboardRuntimeRequalification } from '../src/lib/server/generator/pilotStore';
import { inspectPrivateboardRuntime } from '../src/lib/server/generator/supabasePilotRuntime';
import { PRIVATEBOARD_OPERATIONS, replayPrivateboardCalls } from '../src/lib/server/generator/supabasePilotReplay';
import { privateboardRuntimeRequalificationSchema } from '../src/lib/server/generator/supabasePilotRequalification';
import { runPrivateboardPilot } from '../src/lib/server/generator/supabasePilotSupervisor';
import { failBriefboardPilot } from '../src/lib/server/generator/pilotSupervisor';

const argument = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
async function main() {
  const runId = z.string().regex(/^v2-pilot-[a-z0-9-]+$/).parse(argument('--run-id'));
  const fromImageId = z.string().regex(/^sha256:[a-f0-9]{64}$/).parse(argument('--from-image'));
  const toImageId = z.string().regex(/^sha256:[a-f0-9]{64}$/).parse(argument('--to-image'));
  const dbUrl = new URL(process.env.DATABASE_URL || 'invalid');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(dbUrl.hostname)) throw new Error('Operator requalification is restricted to the local pilot.');
  if (!process.env.DEVKILLER_PILOT_EMAIL || !process.env.OPENAI_API_KEY) throw new Error('Configured owner and server credentials are required.');
  const [owner] = await database()`select u.id from auth.users u join profiles p on p.id=u.id where lower(u.email)=lower(${process.env.DEVKILLER_PILOT_EMAIL}) and p.role='admin'`;
  if (!owner) throw new Error('Configured owner not found.');
  const run = await getPilotRun(runId, owner.id);
  if (!run || run.status !== 'failed' || run.accepted || run.budget.reservedMicros || run.campaignBudget.reservedMicros) throw new Error('Only a failed, fully settled, unapproved pilot may be requalified.');
  const runtime = await inspectPrivateboardRuntime();
  if (!runtime.available || runtime.imageId !== toImageId || fromImageId === toImageId) throw new Error('The inspected corrected runtime does not match the explicit image approval.');
  const digest = (image: string) => createHash('sha256').update(image + ':' + runtime.verifierVersion).digest('hex');
  const saved = await getPilotSnapshots(runId, owner.id);
  const calls = (await Promise.all(PRIVATEBOARD_OPERATIONS.map(operation => getPilotCall(runId, owner.id, operation)))).filter(call => call !== null);
  // Validate provenance/accounting against the original pinned runtime first.
  const original = replayPrivateboardCalls(run.contract, calls, saved, digest(fromImageId));
  if (!original.snapshot || original.pending || original.upgraded || original.refined) throw new Error('Only fully settled original pre-upgrade sources may be requalified.');
  const authorization = privateboardRuntimeRequalificationSchema.parse({ sourceRevision: original.snapshot.revision, sourceHash: original.snapshot.hash,
    fromImageId, toImageId, fromRuntimeDigest: digest(fromImageId), toRuntimeDigest: digest(toImageId),
    verifierVersion: runtime.verifierVersion, requalificationRevision: 'runtime-1' });
  const replay = replayPrivateboardCalls(run.contract, calls, saved, authorization.toRuntimeDigest, authorization);
  if (!replay.snapshot || replay.snapshot.hash !== original.snapshot.hash) throw new Error('Requalification changed source bytes.');
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ readOnly: true, runId, originalRevision: original.snapshot.revision, requalificationRevision: replay.snapshot.revision,
      sourceHashUnchanged: true, recordedCalls: calls.length, originalBudgetsUnchanged: true, allowedRemainingOperations: ['upgrade-1', 'refine-1'], toImageId }));
    return;
  }
  const lease = await claimPrivateboardRuntimeRequalification(runId, owner.id, `runtime-proof-${randomUUID()}`, run.sequence,
    'Corrected the platform Supabase response negotiation proxy. Reverify the exact DK-generated source before the originally authorized additive migration and CSS refinement. No build or repair restart; prior costs and evidence retained.', authorization);
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('Operator stopped runtime requalification.'));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const heartbeat = setInterval(() => { void heartbeatPilotRun(lease).catch(() => controller.abort(new Error('Runtime requalification lease lost.'))); }, 15_000);
  try {
    console.log(JSON.stringify({ runId, stage: 'requalifying-recorded-source', noNewBuild: true, sourceHash: original.snapshot.hash }));
    await runPrivateboardPilot(lease, controller.signal);
    console.log(JSON.stringify({ runId, stage: 'ready', sourceWasGeneratedByDevKiller: true }));
  } catch (error) { await failBriefboardPilot(lease, error); throw error; }
  finally { clearInterval(heartbeat); process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
main().catch(error => { console.error(error instanceof Error ? error.message.replace(/sk-[\w-]+/g, '[REDACTED]').slice(0, 1800) : 'Requalification failed.'); process.exitCode = 1; }).finally(closeDatabase);
