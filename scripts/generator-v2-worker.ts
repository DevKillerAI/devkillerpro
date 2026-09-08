import { randomUUID } from 'node:crypto';
import { database, closeDatabase } from '../src/lib/server/database';
import { claimPilotRun, heartbeatPilotRun, listPilotRuns } from '../src/lib/server/generator/pilotStore';
import { PILOT_CAMPAIGN } from '../src/lib/server/generator/pilotContract';
import { failBriefboardPilot, runBriefboardPilot } from '../src/lib/server/generator/pilotSupervisor';
import { runPrivateboardPilot } from '../src/lib/server/generator/supabasePilotSupervisor';
import { runWorkbench } from '../src/lib/server/generator/workbenchSupervisor';
import { WORKBENCH_PROTOCOL_VERSION } from '../src/lib/server/generator/workbenchContract';
import { workbenchWorkerHeartbeat } from '../src/lib/server/generator/workbenchStore';

const workerId = `v2-worker-${WORKBENCH_PROTOCOL_VERSION}-${randomUUID()}`;
let stopping = false;
let active: AbortController | null = null;
for (const name of ['SIGINT', 'SIGTERM'] as const) process.on(name, () => { stopping = true; active?.abort(new Error('Worker stopped.')); });
const pause = () => new Promise(resolve => setTimeout(resolve, 2000));

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error('Server OpenAI credentials are required.');
  console.log('[v2-worker] Ready. Enabled v2 accounts are isolated by owner; legacy jobs are not claimed.');
  do {
    await workbenchWorkerHeartbeat(workerId);
    const owners = await database()`select id::text as id from profiles where access_enabled=true and generator_enabled=true order by (role='admin') desc,created_at`;
    for(const owner of owners){
      const runs = await listPilotRuns(owner.id, PILOT_CAMPAIGN);
      // awaiting_input is intentionally dormant until an explicit resume action;
      // reclaiming it automatically would turn capability negotiation into a loop.
      const runnable = runs.filter(run => !['awaiting_input', 'ready', 'failed', 'cancelled', 'cancelling'].includes(run.status));
      for (const run of runnable) {
        if (stopping) break;
        const lease = await claimPilotRun(run.runId, owner.id, workerId);
        if (!lease) continue;
        const controller = new AbortController(); active = controller;
        const heartbeat = setInterval(() => {
          void workbenchWorkerHeartbeat(workerId).catch(() => undefined);
          void heartbeatPilotRun(lease).catch(() => controller.abort(new Error('Worker lease lost, account access was cut, or the run was cancelled.')));
        }, 15_000);
        console.log(`[v2-worker] Running ${run.runId}`);
        try {
          if (run.contract.runtime.id === 'react-workbench') await runWorkbench(lease, controller.signal);
          else if (run.contract.runtime.id === 'react-supabase-pilot') await runPrivateboardPilot(lease, controller.signal);
          else await runBriefboardPilot(lease, controller.signal);
          const completed=await (await import('../src/lib/server/generator/pilotStore')).getPilotRun(run.runId,owner.id);
          const statusLabel = completed?.status === 'awaiting_input' ? 'paused_capability_negotiation' : (completed?.status || 'unavailable');
          console.log(`[v2-worker] ${completed?.status === 'ready' ? 'Ready' : 'Stopped'} ${run.runId}: ${statusLabel}`);
        }
        catch (error) { console.error(`[v2-worker] Stopped ${run.runId}: ${error instanceof Error ? error.message.replace(/sk-[\w-]+/g, '[REDACTED]').slice(0, 1000) : 'Failure'}`); if (!stopping) await failBriefboardPilot(lease, error); }
        finally { clearInterval(heartbeat); active = null; }
      }
    }
    if (process.argv.includes('--once')) break;
    if (!stopping) await pause();
  } while (!stopping);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Pilot worker failed'); process.exitCode = 1; }).finally(closeDatabase);
