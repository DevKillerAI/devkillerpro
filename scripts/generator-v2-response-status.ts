import { database, closeDatabase } from '../src/lib/server/database';
import { getPilotCall, getPilotRun } from '../src/lib/server/generator/pilotStore';
import { PILOT_CAMPAIGN } from '../src/lib/server/generator/pilotContract';

/** Read-only provider GET for one exact recorded owner/run/operation. Never creates a response. */
async function main() {
  const [runId, operationId] = process.argv.slice(2);
  const [owner] = await database()`select u.id from auth.users u join profiles p on p.id=u.id where lower(u.email)=lower(${process.env.DEVKILLER_PILOT_EMAIL || ''}) and p.role='admin'`;
  if (!owner || !runId || !operationId) throw new Error('Configured owner, run and operation are required.');
  const run = await getPilotRun(runId, owner.id);
  const call = await getPilotCall(runId, owner.id, operationId);
  if (!run || run.campaignId !== PILOT_CAMPAIGN || !call?.responseId || !/^resp_[\w-]+$/.test(call.responseId)) throw new Error('An exact recorded pilot response is required.');
  const response = await fetch(`https://api.openai.com/v1/responses/${call.responseId}`, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (!response.ok) { console.log(JSON.stringify({ operationId, httpStatus: response.status })); return; }
  const data = await response.json();
  console.log(JSON.stringify({ operationId, observedAt: new Date().toISOString(), status: data.status, model: data.model, createdAt: data.created_at, completedAt: data.completed_at,
    errorCode: data.error?.code ?? null, incompleteReason: data.incomplete_details?.reason ?? null, usage: data.usage ? { input: data.usage.input_tokens, output: data.usage.output_tokens } : null }, null, 2));
}
main().catch(() => { console.error('Recorded response status unavailable.'); process.exitCode = 1; }).finally(closeDatabase);
