import { database, closeDatabase } from '../src/lib/server/database';
import { PILOT_CAMPAIGN_ID } from '../src/lib/server/generator/pilotStore';

// Read-only diagnosis: no worker, provider request, cancellation, artifact read or mutation.
function localConfiguration() {
  let url: URL;
  try { url = new URL(process.env.DATABASE_URL || ''); } catch { throw new Error('LOCAL_DATABASE_REQUIRED'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) throw new Error('LOCAL_DATABASE_REQUIRED');
  const email = process.env.DEVKILLER_PILOT_EMAIL?.trim();
  if (!email) throw new Error('CONFIGURED_OWNER_REQUIRED');
  return email;
}
function count(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
const usd = (value: unknown) => { const micros = count(value); return micros === null ? null : Number((micros / 1_000_000).toFixed(6)); };
const stamp = (value: unknown) => { if (!value) return null; const date = new Date(value as string); return Number.isFinite(date.getTime()) ? date.toISOString() : null; };
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
const revision = (value: unknown) => typeof value === 'string' && /^(build|repair|upgrade|refine|refine-repair|runtime)-[1-9][0-9]?$/.test(value) ? value : null;
const runStatus = (value: unknown) => ['queued', 'planning', 'building', 'verifying', 'awaiting_input', 'ready', 'failed', 'cancelling', 'cancelled'].includes(String(value)) ? String(value) : 'unknown';
const callStatus = (value: unknown) => ['reserved', 'submitted', 'uncertain', 'completed', 'failed'].includes(String(value)) ? String(value) : 'unknown';
const eventTypes = new Set([
  'run.created', 'worker.claimed', 'run.planning', 'run.building', 'run.verifying', 'run.awaiting_input', 'run.failed', 'run.cancelled', 'run.ready', 'run.error',
  'provider.reserved', 'provider.submitted', 'provider.uncertain', 'provider.settled', 'provider.reconciled', 'provider.progress',
  'candidate.saved', 'candidate.reused', 'delivery.checkpoint', 'recovery.claimed', 'plan.confirmed', 'verification.started', 'verification.finished', 'source.edited', 'source.replayed', 'source.patch-rejected', 'benchmark.initial-passed', 'benchmark.summary',
  'verification.environment', 'verification.environment-ready', 'verification.runtime',
]);
const observedStatuses = new Set([
  'submitted', 'queued', 'in_progress', 'completed', 'failed', 'cancelled', 'incomplete', 'uncertain', 'unknown',
  'identity-or-price-mismatch', 'terminal-usage-unavailable-or-out-of-bound', 'terminal-cost-out-of-bound', 'submission-unknown-no-response-id',
  'create-post-transport-uncertain', 'create-response-unreadable', 'create-response-id-missing', 'cancellation-unconfirmed', 'unexpected-response-state',
]);
function responseStatus(value: unknown) {
  const status = String(value ?? 'unknown');
  return observedStatuses.has(status) || /^(?:create-)?http-[1-5][0-9]{2}$/.test(status) ? status : 'other-observed-state';
}

async function main() {
  const email = localConfiguration();
  const report = await database().begin('read only', async tx => {
    const owners = await tx`select u.id from auth.users u join public.profiles p on p.id=u.id where lower(u.email)=lower(${email}) and p.role='admin'`;
    if (owners.length !== 1) throw new Error('CONFIGURED_OWNER_NOT_UNIQUE');
    const ownerId = String(owners[0].id);
    const [campaign] = await tx`select max_cost_micros,spent_micros,reserved_micros,call_count from dk_generator_v2.campaigns where owner_id=${ownerId} and campaign_id=${PILOT_CAMPAIGN_ID}`;
    const runs = await tx`select id,status,sequence,fence,lease_until,lease_until>clock_timestamp() as lease_active,
      max_cost_micros,spent_micros,reserved_micros,call_count,created_at,updated_at,
      details->>'recoveryMode' as recovery_mode,
      candidate->>'revision' as candidate_revision,candidate->>'sourceHash' as candidate_hash,
      accepted->>'revision' as accepted_revision,accepted->>'sourceHash' as accepted_hash
      from dk_generator_v2.runs where owner_id=${ownerId} and campaign_id=${PILOT_CAMPAIGN_ID} order by created_at desc limit 20`;
    const calls = await tx`select c.run_id,c.operation_id,c.model,c.status,c.reserved_micros,c.actual_micros,c.response_id is not null as has_response_id,
      c.last_response_status,c.created_at,c.updated_at,
      c.usage->>'inputTokens' as input_tokens,c.usage->>'outputTokens' as output_tokens,c.usage->>'cachedInputTokens' as cached_tokens,
      c.usage->>'cacheWriteTokens' as cache_write_tokens,c.usage->>'cacheWriteTokensObserved' as cache_write_observed,c.usage->>'reasoningTokens' as reasoning_tokens
      from dk_generator_v2.calls c join dk_generator_v2.runs r on r.owner_id=c.owner_id and r.id=c.run_id
      where c.owner_id=${ownerId} and r.campaign_id=${PILOT_CAMPAIGN_ID} order by c.created_at desc limit 200`;
    const events = await tx`select * from (
      select e.run_id,e.sequence,e.type,e.created_at,e.details->>'revision' as revision,
        row_number() over (partition by e.run_id order by e.sequence desc) as ordinal
      from dk_generator_v2.events e join dk_generator_v2.runs r on r.owner_id=e.owner_id and r.id=e.run_id
      where e.owner_id=${ownerId} and r.campaign_id=${PILOT_CAMPAIGN_ID}
    ) recent where ordinal<=12 order by run_id,sequence`;
    const safeCalls = calls.map(call => ({
      runId: call.run_id, operationId: revision(call.operation_id), model: call.model === 'gpt-5.6-terra' ? call.model : 'other-model',
      status: callStatus(call.status), hasResponseId: Boolean(call.has_response_id), lastResponseStatus: responseStatus(call.last_response_status),
      reservedMicros: count(call.reserved_micros), usageBasedEstimateMicros: count(call.actual_micros), usageBasedEstimateUsd: usd(call.actual_micros),
      tokens: { input: count(call.input_tokens), output: count(call.output_tokens), cachedInput: count(call.cached_tokens),
        cacheWrites: call.cache_write_observed === 'true' ? count(call.cache_write_tokens) : null,
        cacheWritesObserved: call.cache_write_observed === null ? null : call.cache_write_observed === 'true', reasoning: count(call.reasoning_tokens) },
      createdAt: stamp(call.created_at), updatedAt: stamp(call.updated_at),
    }));
    const measured = safeCalls.filter(call => call.tokens.input !== null && call.tokens.output !== null);
    const total = (field: 'input' | 'output' | 'cachedInput' | 'reasoning') => measured.length ? measured.reduce((sum, call) => sum + (call.tokens[field] ?? 0), 0) : null;
    return {
      observedAt: new Date().toISOString(), readOnly: true, configuredOwnerFound: true, campaignId: PILOT_CAMPAIGN_ID,
      accounting: 'USD estimates from recorded token usage, not an invoice. Uncertain operations retain their conservative reservation.',
      campaign: campaign ? { ceilingMicros: count(campaign.max_cost_micros), ceilingUsd: usd(campaign.max_cost_micros),
        usageBasedEstimateMicros: count(campaign.spent_micros), usageBasedEstimateUsd: usd(campaign.spent_micros),
        reservedMicros: count(campaign.reserved_micros), reservedUsd: usd(campaign.reserved_micros), callCount: count(campaign.call_count) } : null,
      runs: runs.map(run => ({ runId: run.id, status: runStatus(run.status), sequence: count(run.sequence), fence: count(run.fence),
        leaseActive: !['ready', 'failed', 'cancelled'].includes(run.status) && Boolean(run.lease_active), leaseUntil: stamp(run.lease_until),
        recoveryMode: ['recorded-output-only', 'scoped-refinement-repair', 'runtime-requalification', 'environment-recovery'].includes(run.recovery_mode) ? run.recovery_mode : null,
        automaticWorkerEligible: !['ready', 'failed', 'cancelled', 'cancelling'].includes(run.status) && !run.recovery_mode,
        callCount: count(run.call_count), usageBasedEstimateUsd: usd(run.spent_micros), reservedUsd: usd(run.reserved_micros),
        candidate: { revision: revision(run.candidate_revision), hash: hash(run.candidate_hash) }, accepted: { revision: revision(run.accepted_revision), hash: hash(run.accepted_hash) },
        createdAt: stamp(run.created_at), updatedAt: stamp(run.updated_at),
        recentEvents: events.filter(event => event.run_id === run.id).map(event => ({ sequence: count(event.sequence), type: eventTypes.has(event.type) ? event.type : 'other-event', revision: revision(event.revision), at: stamp(event.created_at) })),
      })),
      calls: safeCalls,
      tokensForShownCalls: { measuredCalls: measured.length, callsWithoutCompleteUsage: safeCalls.length - measured.length, input: total('input'), output: total('output'), cachedInput: total('cachedInput'), reasoning: total('reasoning') },
      displayLimits: { runs: 20, calls: 200, eventsPerRun: 12, callsTruncated: count(campaign?.call_count) !== null && Number(campaign.call_count) > safeCalls.length },
      omitted: ['email', 'ownerId', 'credentials', 'prompts', 'provider requests/results', 'source files', 'event messages/details'],
    };
  });
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => {
  const known = new Set(['LOCAL_DATABASE_REQUIRED', 'CONFIGURED_OWNER_REQUIRED', 'CONFIGURED_OWNER_NOT_UNIQUE']);
  console.error(JSON.stringify({ readOnly: true, error: known.has(error?.message) ? error.message : 'PILOT_STATUS_UNAVAILABLE',
    databaseCode: typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : null }));
  process.exitCode = 1;
}).finally(closeDatabase);
