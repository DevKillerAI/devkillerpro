import { database, closeDatabase } from '../src/lib/server/database';
import { getPilotCall, getPilotRun, reconcilePilotTerminalCall } from '../src/lib/server/generator/pilotStore';
import { PILOT_CAMPAIGN } from '../src/lib/server/generator/pilotContract';
import { parsePilotUsage, estimatePilotCostMicros, PILOT_BILLING_BASIS, PILOT_MODEL, preparePilotRequest } from '../src/lib/server/generator/pilotProvider';

async function main() {
  const [runId, operationId, apply] = process.argv.slice(2);
  if (!runId || !operationId || apply !== '--apply') throw new Error('Usage: generator-v2-reconcile-call.ts RUN_ID OPERATION_ID --apply');
  const [owner] = await database()`select u.id from auth.users u join profiles p on p.id=u.id where lower(u.email)=lower(${process.env.DEVKILLER_PILOT_EMAIL || ''}) and p.role='admin'`;
  if (!owner) throw new Error('Configured owner administrator not found.');
  const run = await getPilotRun(runId, owner.id), call = await getPilotCall(runId, owner.id, operationId);
  if (!run || run.campaignId !== PILOT_CAMPAIGN || !['failed','cancelled','ready'].includes(run.status) || !call?.responseId || !/^resp_[\w-]+$/.test(call.responseId)) throw new Error('An exact terminal pilot operation is required.');
  const response = await fetch(`https://api.openai.com/v1/responses/${call.responseId}`, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (!response.ok) throw new Error(`Recorded response unavailable (${response.status}).`);
  const raw = await response.json();
  if (raw.id !== call.responseId || raw.model !== PILOT_MODEL || (raw.service_tier !== undefined && raw.service_tier !== 'default') || !['completed','cancelled','failed','incomplete'].includes(raw.status)) throw new Error('Recorded response is not a matching terminal result.');
  const usage = parsePilotUsage(raw.usage); const request = call.request as any;
  const bound = preparePilotRequest({ instructions: request.instructions, input: request.input, schemaName: request.text.format.name, schema: request.text.format.schema, maxOutputTokens: request.max_output_tokens });
  if (!usage || usage.inputTokens > bound.inputTokenUpperBound || usage.outputTokens > bound.maxOutputTokens) throw new Error('Terminal usage remains unavailable or out of bounds.');
  const actualMicros = estimatePilotCostMicros(usage);
  if (actualMicros > call.reservedMicros) throw new Error('Usage exceeds the retained reservation.');
  await reconcilePilotTerminalCall(runId, owner.id, operationId, { requestHash: call.requestHash, responseId: call.responseId, actualMicros,
    status: raw.status === 'completed' ? 'completed' : 'failed', usage: { ...usage, billingBasis: PILOT_BILLING_BASIS }, result: raw, lastResponseStatus: raw.status });
  console.log(JSON.stringify({ runId, operationId, providerStatus: raw.status, actualMicros, newProviderCalls: 0, runStateChanged: false }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message.replace(/sk-[\w-]+/g, '[REDACTED]') : 'Terminal reconciliation failed'); process.exitCode = 1; }).finally(closeDatabase);
