import { createHash } from 'node:crypto';
import type { PilotCall, PilotLease } from './pilotStore';

// Operator-only, process-scoped experiment. Normal workers keep Terra.
export const PILOT_MODEL = process.env.DEVKILLER_ASTRA_EXPERIMENT === '1' ? 'gpt-6-astra' as const : 'gpt-5.6-terra' as const;
export const PILOT_MAX_REQUEST_BYTES = 256 * 1024;
export const PILOT_DEFAULT_OUTPUT_TOKENS = 8000;
export const PILOT_MAX_OUTPUT_TOKENS = 16000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const ENDPOINT = 'https://api.openai.com/v1/responses';
const RESPONSE_ID = /^resp_[A-Za-z0-9_-]{1,200}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,179}$/;
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'incomplete']);

export const PILOT_BILLING_BASIS = Object.freeze({
  kind: 'estimate-not-invoice',
  verifiedAt: '2026-09-07',
  source: 'https://developers.openai.com/api/docs/pricing',
  model: PILOT_MODEL,
  serviceTier: 'default',
  // USD per million tokens equals micro-USD per token. No paid tools are enabled.
  shortContext: PILOT_MODEL === 'gpt-6-astra' ? { input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50 } : { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 12 },
  reservation: { inputByteUpperBound: PILOT_MODEL === 'gpt-6-astra' ? 25 : 5, output: PILOT_MODEL === 'gpt-6-astra' ? 75 : 18, overheadTokens: 4096 },
} as const);

export class PilotProviderError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'PilotProviderError';
  }
}

export type PilotUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  cacheWriteTokensObserved: boolean;
  outputTokens: number;
  reasoningTokens: number;
};
export type PilotJsonResult<T> = {
  data: T;
  usage: PilotUsage;
  actualMicros: number;
  responseId: string;
  model: typeof PILOT_MODEL;
  billingBasis: typeof PILOT_BILLING_BASIS;
};

export type PilotProviderInput = {
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
  transport?: 'background' | 'foreground-stream';
};

function providerError(code: string, message: string): never { throw new PilotProviderError(code, message); }
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function counter(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function losslessText(value: unknown): value is string {
  return typeof value === 'string' && Buffer.from(value, 'utf8').toString('utf8') === value;
}

/** Pure request construction: no caller-selected endpoint/model/tools/tier/secret fields. */
export function preparePilotRequest(input: PilotProviderInput) {
  if (!losslessText(input.instructions) || !input.instructions.trim() || !losslessText(input.input) || !input.input.trim()) {
    providerError('PILOT_REQUEST_INVALID', 'Instructions and input must be nonempty UTF-8 text.');
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.schemaName) || !record(input.schema)) {
    providerError('PILOT_REQUEST_INVALID', 'A named JSON schema is required.');
  }
  const maxOutputTokens = input.maxOutputTokens ?? PILOT_DEFAULT_OUTPUT_TOKENS;
  if (input.transport !== undefined && !['background','foreground-stream'].includes(input.transport)) providerError('PILOT_REQUEST_INVALID', 'Unsupported transport.');
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > PILOT_MAX_OUTPUT_TOKENS) {
    providerError('PILOT_OUTPUT_LIMIT', 'Output tokens exceed the reviewed pilot limit.');
  }
  let serialized: string;
  try {
    serialized = JSON.stringify({
      model: PILOT_MODEL,
      instructions: input.instructions,
      input: input.input,
      background: input.transport !== 'foreground-stream',
      ...(input.transport === 'foreground-stream' ? { stream: true } : {}),
      store: true,
      max_output_tokens: maxOutputTokens,
      reasoning: { effort: 'low' },
      service_tier: 'default',
      tools: [],
      tool_choice: 'none',
      truncation: 'disabled',
      text: { format: { type: 'json_schema', name: input.schemaName, strict: true, schema: input.schema } },
    });
  } catch { return providerError('PILOT_REQUEST_INVALID', 'Request must be JSON serializable.'); }
  const bodyBytes = Buffer.byteLength(serialized, 'utf8');
  if (bodyBytes > PILOT_MAX_REQUEST_BYTES) providerError('PILOT_CONTEXT_LIMIT', 'Request exceeds the reviewed 256 KiB pilot context limit.');
  const inputTokenUpperBound = bodyBytes + PILOT_BILLING_BASIS.reservation.overheadTokens;
  // Byte count is intentionally more conservative than a token estimate. The
  // higher long-context/cache-write rates remain reserved even for this short request.
  const reservedMicros = inputTokenUpperBound * PILOT_BILLING_BASIS.reservation.inputByteUpperBound + maxOutputTokens * PILOT_BILLING_BASIS.reservation.output;
  return {
    body: JSON.parse(serialized) as Record<string, unknown>, serialized, bodyBytes,
    requestHash: createHash('sha256').update(serialized).digest('hex'),
    inputTokenUpperBound, maxOutputTokens, reservedMicros,
  };
}

/** Rejects incomplete/malformed accounting. Missing cache-write breakdown uses
 * the conservative write price for every uncached input token, not a claimed saving. */
export function parsePilotUsage(value: unknown): PilotUsage | null {
  if (!record(value) || !counter(value.input_tokens) || !counter(value.output_tokens)) return null;
  const details = record(value.input_tokens_details) ? value.input_tokens_details : {};
  const outputDetails = record(value.output_tokens_details) ? value.output_tokens_details : {};
  const cached = details.cached_tokens === undefined ? 0 : details.cached_tokens;
  const writeObserved = details.cache_write_tokens !== undefined;
  const writes = writeObserved ? details.cache_write_tokens : (counter(cached) ? value.input_tokens - cached : -1);
  const reasoning = outputDetails.reasoning_tokens === undefined ? 0 : outputDetails.reasoning_tokens;
  if (!counter(cached) || !counter(writes) || !counter(reasoning) || cached + writes > value.input_tokens || reasoning > value.output_tokens) return null;
  if (value.total_tokens !== undefined && (!counter(value.total_tokens) || value.total_tokens !== value.input_tokens + value.output_tokens)) return null;
  return {
    inputTokens: value.input_tokens, cachedInputTokens: cached, cacheWriteTokens: writes,
    cacheWriteTokensObserved: writeObserved, outputTokens: value.output_tokens, reasoningTokens: reasoning,
  };
}

export function estimatePilotCostMicros(usage: PilotUsage): number {
  for (const value of [usage.inputTokens, usage.cachedInputTokens, usage.cacheWriteTokens, usage.outputTokens, usage.reasoningTokens]) {
    if (!counter(value)) providerError('PILOT_USAGE_INVALID', 'Token accounting is invalid.');
  }
  if (usage.cachedInputTokens + usage.cacheWriteTokens > usage.inputTokens || usage.reasoningTokens > usage.outputTokens) {
    providerError('PILOT_USAGE_INVALID', 'Token accounting is inconsistent.');
  }
  const uncached = usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens;
  // Scale rates by ten to avoid truncating fractional micro-USD prices.
  const rates = PILOT_BILLING_BASIS.shortContext;
  const tenths = uncached * (rates.input * 10) + usage.cachedInputTokens * (rates.cachedInput * 10) + usage.cacheWriteTokens * (rates.cacheWrite * 10) + usage.outputTokens * (rates.output * 10);
  if (!Number.isSafeInteger(tenths)) providerError('PILOT_USAGE_INVALID', 'Token accounting exceeds its numeric bound.');
  return Math.ceil(tenths / 10);
}

/** Parses only assistant output_text, never hidden reasoning or a refusal. */
export function parsePilotOutput<T>(response: unknown): T {
  if (!record(response) || response.status !== 'completed' || !Array.isArray(response.output)) {
    const reason = record(response) && record(response.incomplete_details) && typeof response.incomplete_details.reason === 'string'
      ? ` (reason: ${response.incomplete_details.reason})`
      : '';
    providerError('PILOT_OUTPUT_INCOMPLETE', `The response did not complete with structured output${reason}.`);
  }
  const text: string[] = [];
  for (const item of response.output) {
    if (!record(item)) providerError('PILOT_OUTPUT_INVALID', 'Unexpected output item.');
    if (item.type === 'reasoning') continue;
    if (item.type !== 'message') providerError('PILOT_OUTPUT_INVALID', 'Only reasoning and assistant text are permitted for this tool-free call.');
    if (item.role !== 'assistant' || !Array.isArray(item.content)) providerError('PILOT_OUTPUT_INVALID', 'Unexpected output message.');
    if (item.status !== undefined && item.status !== 'completed') {
      const itemReason = record(item.incomplete_details) && typeof item.incomplete_details.reason === 'string'
        ? ` (reason: ${item.incomplete_details.reason})`
        : '';
      providerError('PILOT_OUTPUT_INCOMPLETE', `The output message is incomplete${itemReason}.`);
    }
    for (const part of item.content) {
      if (!record(part)) providerError('PILOT_OUTPUT_INVALID', 'Invalid output content.');
      if (part.type === 'refusal') providerError('PILOT_REFUSAL', 'The provider declined this request.');
      if (part.type === 'output_text' && typeof part.text === 'string') text.push(part.text);
    }
  }
  if (text.length !== 1 || !text[0].trim()) providerError('PILOT_OUTPUT_INVALID', 'Expected exactly one JSON output.');
  try { return JSON.parse(text[0]) as T; }
  catch { return providerError('PILOT_OUTPUT_INVALID', 'Structured output was not valid JSON.'); }
}

export const WorkbenchProviderError = PilotProviderError;
export type WorkbenchProviderError = PilotProviderError;
export const parseWorkbenchOutput = parsePilotOutput;

type UncertainObservation = { usage?: unknown; result?: unknown };
export type PilotProviderStore = {
  reservePilotCall: (lease: PilotLease, input: { operationId: string; requestHash: string; reservedMicros: number; model: string; request?: unknown }) => Promise<{ call: PilotCall; created: boolean }>;
  getPilotCall: (runId: string, ownerId: string, operationId: string) => Promise<PilotCall | null>;
  markPilotSubmitted: (lease: PilotLease, operationId: string, responseId: string, lastResponseStatus?: string) => Promise<PilotCall>;
  settlePilotCall: (lease: PilotLease, operationId: string, input: { actualMicros: number; status: 'completed' | 'failed'; usage?: unknown; result?: unknown; lastResponseStatus?: string }) => Promise<PilotCall>;
  markPilotCallUncertain: (lease: PilotLease, operationId: string, lastResponseStatus?: string, observation?: UncertainObservation) => Promise<PilotCall>;
};
export type PilotProviderDependencies = {
  store?: PilotProviderStore;
  fetch?: typeof fetch;
  apiKey?: string;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};
export type PilotCallInput = PilotProviderInput & {
  lease: PilotLease;
  operationId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onStatus?: (status: string) => void | Promise<void>;
};

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new PilotProviderError('PILOT_CANCELLED', 'The pilot was interrupted.')); return; }
    const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(done, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new PilotProviderError('PILOT_CANCELLED', 'The pilot was interrupted.')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) return providerError('PILOT_RESPONSE_INVALID', 'Empty provider response.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); return providerError('PILOT_RESPONSE_LIMIT', 'Provider response exceeds its bound.'); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  try {
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!record(data)) throw new Error();
    return data;
  } catch { return providerError('PILOT_RESPONSE_INVALID', 'Provider returned invalid JSON.'); }
}

function validateCallScope(call: PilotCall, lease: PilotLease, operationId: string, requestHash: string) {
  if (call.runId !== lease.runId || call.ownerId !== lease.ownerId || call.operationId !== operationId || call.requestHash !== requestHash || call.model !== PILOT_MODEL) {
    providerError('PILOT_CALL_SCOPE_MISMATCH', 'Saved call does not belong to this operation.');
  }
}

/** One reserved operation submits at most one create POST. Lost POSTs are never
 * replayed. Saved response IDs resume through GET. This adapter does not spawn a
 * council, repair chain, generated tools, or an unbudgeted fallback model. */
export async function callPilotJson<T>(args: PilotCallInput, dependencies: PilotProviderDependencies = {}): Promise<PilotJsonResult<T>> {
  if (typeof window !== 'undefined') providerError('PILOT_SERVER_ONLY', 'Provider access is server-only.');
  const request = preparePilotRequest(args);
  if (!TOKEN.test(args.operationId)) providerError('PILOT_REQUEST_INVALID', 'Invalid provider operation identifier.');
  const timeoutMs = args.timeoutMs ?? 6 * 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10 * 60_000) providerError('PILOT_REQUEST_INVALID', 'Invalid provider deadline.');
  args.signal?.throwIfAborted();
  const store = dependencies.store ?? await import('./pilotStore');
  const fetcher = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? pause;
  const apiKey = dependencies.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) providerError('PILOT_CONFIGURATION_REQUIRED', 'The server OpenAI key is not configured.');
  const deadline = now() + timeoutMs;
  const network = async (url: string, method: 'POST' | 'GET', body?: string, cancellation = false) => {
    const timeout = AbortSignal.timeout(cancellation ? 15_000 : Math.max(1, Math.min(args.transport === 'foreground-stream' ? timeoutMs : 60_000, deadline - now())));
    const signal = !cancellation && args.signal ? AbortSignal.any([timeout, args.signal]) : timeout;
    return fetcher(url, { method, body, signal, redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` } });
  };
  const uncertain = async (status: string, result?: unknown) => {
    await store.markPilotCallUncertain(args.lease, args.operationId, status, result === undefined ? undefined : { result });
  };
  const reservation = await store.reservePilotCall(args.lease, {
    operationId: args.operationId, requestHash: request.requestHash, reservedMicros: request.reservedMicros,
    model: PILOT_MODEL, request: request.body,
  });
  let call = reservation.call;
  validateCallScope(call, args.lease, args.operationId, request.requestHash);
  let responseId: string | null = call.responseId;
  let response: Record<string, unknown> | null = null;

  const finish = async (raw: Record<string, unknown>, persist = true): Promise<PilotJsonResult<T>> => {
    if (raw.id !== responseId || raw.model !== PILOT_MODEL || (raw.service_tier !== undefined && raw.service_tier !== 'default')) {
      await uncertain('identity-or-price-mismatch', raw);
      return providerError('PILOT_RESPONSE_MISMATCH', 'Provider response identity or billing tier did not match.');
    }
    const usage = parsePilotUsage(raw.usage);
    if (!usage || usage.inputTokens > request.inputTokenUpperBound || usage.outputTokens > request.maxOutputTokens) {
      await uncertain('terminal-usage-unavailable-or-out-of-bound', raw);
      return providerError('PILOT_USAGE_UNCERTAIN', 'Terminal usage is unavailable or outside its reservation. The reservation remains held.');
    }
    const actualMicros = estimatePilotCostMicros(usage);
    if (actualMicros > call.reservedMicros) {
      await uncertain('terminal-cost-out-of-bound', raw);
      return providerError('PILOT_USAGE_UNCERTAIN', 'Usage exceeded the reserved bound. No further automatic calls are permitted.');
    }
    let data: T | undefined;
    let outputError: unknown;
    try { data = parsePilotOutput<T>(raw); } catch (error) { outputError = error; }
    // Persist terminal usage AND output before throwing or returning. No remote
    // deletion is performed here; a failed persistence remains resumable by ID.
    if (persist) await store.settlePilotCall(args.lease, args.operationId, {
      actualMicros, status: outputError ? 'failed' : 'completed',
      usage: { ...usage, billingBasis: PILOT_BILLING_BASIS }, result: raw, lastResponseStatus: String(raw.status),
    });
    if (outputError) throw outputError;
    return { data: data as T, usage, actualMicros, responseId: responseId!, model: PILOT_MODEL, billingBasis: PILOT_BILLING_BASIS };
  };

  if (!reservation.created) {
    if (call.status === 'completed' || call.status === 'failed') {
      if (call.status === 'failed') return providerError('PILOT_PREVIOUS_CALL_FAILED', 'This operation already failed. It will not be resubmitted.');
      if (!record(call.result) || !responseId || !RESPONSE_ID.test(responseId)) return providerError('PILOT_SAVED_RESULT_INVALID', 'The saved result is incomplete. No new request was submitted.');
      return finish(call.result, false);
    }
    if (!responseId) {
      await uncertain('submission-unknown-no-response-id');
      return providerError('PILOT_SUBMISSION_UNCERTAIN', 'The earlier submission has no recorded response ID. No duplicate POST was sent.');
    }
    if (!RESPONSE_ID.test(responseId)) return providerError('PILOT_RESPONSE_MISMATCH', 'Saved response identifier is invalid.');
  } else {
    let posted: Response;
    try { posted = await network(ENDPOINT, 'POST', request.serialized); }
    catch {
      await uncertain('create-post-transport-uncertain');
      return providerError('PILOT_SUBMISSION_UNCERTAIN', 'Submission outcome is unknown. Its budget is retained; no duplicate POST will be sent.');
    }
    if (!posted.ok) {
      await posted.body?.cancel();
      if ([400, 401, 403, 404, 413, 422, 429].includes(posted.status)) {
        await store.settlePilotCall(args.lease, args.operationId, { actualMicros: 0, status: 'failed', result: { httpStatus: posted.status, rejectedBeforeResponse: true }, lastResponseStatus: `http-${posted.status}` });
        return providerError('PILOT_SUBMISSION_REJECTED', `Provider rejected the request (HTTP ${posted.status}); it was not retried.`);
      }
      await uncertain(`create-http-${posted.status}`);
      return providerError('PILOT_SUBMISSION_UNCERTAIN', 'The provider did not confirm submission. No duplicate POST will be sent.');
    }
    try {
      if (args.transport === 'foreground-stream') {
        const reader = posted.body?.getReader();
        if (!reader) throw new Error('Empty stream.');
        const decoder = new TextDecoder(); let pending = '', total = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            total += part.value.byteLength;
            if (total > MAX_RESPONSE_BYTES * 2) throw new Error('Stream exceeds its bound.');
            pending = (pending + decoder.decode(part.value, { stream: true })).replace(/\r\n/g, '\n');
            let boundary: number;
            while ((boundary = pending.indexOf('\n\n')) >= 0) {
              const block = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
              const value = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
              if (!value || value === '[DONE]') continue;
              const event: unknown = JSON.parse(value);
              if (!record(event)) throw new Error('Invalid stream event.');
              if (record(event.response)) {
                const observed = event.response;
                if (typeof observed.id !== 'string' || !RESPONSE_ID.test(observed.id) || (responseId && observed.id !== responseId)) throw new Error('Stream response identity mismatch.');
                if (!responseId) {
                  responseId = observed.id;
                  call = await store.markPilotSubmitted(args.lease, args.operationId, responseId, String(observed.status || 'in_progress'));
                  await args.onStatus?.('in_progress');
                }
                if (TERMINAL.has(String(observed.status))) response = observed;
              }
            }
            if (response) break;
          }
        } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
        if (!response) throw new Error('Stream ended before terminal response.');
      } else response = await boundedJson(posted);
    }
    catch {
      await uncertain(responseId ? 'stream-interrupted-known-response' : 'create-response-unreadable');
      return providerError('PILOT_SUBMISSION_UNCERTAIN', 'The response could not be confirmed. The reservation remains held; no duplicate POST will be sent.');
    }
    if (typeof response.id !== 'string' || !RESPONSE_ID.test(response.id)) {
      await uncertain('create-response-id-missing');
      return providerError('PILOT_SUBMISSION_UNCERTAIN', 'No valid response identifier was returned.');
    }
    responseId = response.id;
    try { call = await store.markPilotSubmitted(args.lease, args.operationId, responseId, typeof response.status === 'string' ? response.status : 'unknown'); }
    catch (error) {
      // Exact ID came from this create POST. Prevent a known orphan if persistence
      // lost its lease; never clear its reservation or submit a replacement.
      if (args.transport !== 'foreground-stream') await network(`${ENDPOINT}/${responseId}/cancel`, 'POST', undefined, true).then(r => r.body?.cancel()).catch(() => undefined);
      throw error;
    }
  }

  const cancelOwnedResponse = async (): Promise<void> => {
    // The provider only supports cancellation for background responses. A
    // foreground interruption retains its exact ID and financial reservation.
    if (args.transport === 'foreground-stream') { await uncertain('foreground-interrupted-reconcile-by-id'); return; }
    // Recheck the persisted owner+operation binding before cancelling any ID.
    const saved = await store.getPilotCall(args.lease.runId, args.lease.ownerId, args.operationId);
    if (!saved) return;
    validateCallScope(saved, args.lease, args.operationId, request.requestHash);
    if (!responseId || saved.responseId !== responseId || !RESPONSE_ID.test(responseId)) return;
    try {
      const cancelled = await network(`${ENDPOINT}/${responseId}/cancel`, 'POST', undefined, true);
      if (cancelled.ok) {
        const raw = await boundedJson(cancelled);
        if (raw.id === responseId && TERMINAL.has(String(raw.status))) {
          try { await finish(raw); } catch { /* Failed/cancelled or accounting uncertain, already recorded when possible. */ }
          return;
        }
      } else await cancelled.body?.cancel();
    } catch { /* Reservation remains held when cancellation cannot be confirmed. */ }
    await uncertain('cancellation-unconfirmed');
  };

  let failedPolls = 0;
  let lastReportedStatus: string | null = null;
  while (true) {
    if (response && TERMINAL.has(String(response.status))) return finish(response);
    if (args.signal?.aborted || now() >= deadline) {
      await cancelOwnedResponse();
      return providerError(args.signal?.aborted ? 'PILOT_CANCELLED' : 'PILOT_WAIT_LIMIT', 'Processing was interrupted; cancellation was requested only for this operation.');
    }
    if (response) {
      if (response.id !== responseId || !['queued', 'in_progress'].includes(String(response.status))) {
        await uncertain('unexpected-response-state', response);
        await cancelOwnedResponse();
        return providerError('PILOT_RESPONSE_INVALID', 'The provider returned an unexpected response state.');
      }
      const status = String(response.status);
      if (status !== lastReportedStatus) { await args.onStatus?.(status); lastReportedStatus = status; }
    }
    try { await sleep(2000, args.signal); }
    catch { continue; }
    if (args.signal?.aborted || now() >= deadline) continue;
    try {
      const polled = await network(`${ENDPOINT}/${responseId}`, 'GET');
      if (!polled.ok) {
        await polled.body?.cancel();
        if ([401, 403, 404].includes(polled.status)) failedPolls = 3;
        else failedPolls++;
        response = null;
      } else {
        response = await boundedJson(polled);
        if (response.id !== responseId) providerError('PILOT_RESPONSE_MISMATCH', 'Retrieved response does not match the recorded identifier.');
        failedPolls = 0;
      }
    } catch { response = null; failedPolls++; }
    if (failedPolls >= 3) {
      await uncertain('poll-interrupted');
      return providerError('PILOT_POLL_INTERRUPTED', 'Response polling was interrupted. Resume the saved response ID; never resubmit the operation.');
    }
  }
}

export const callWorkbenchJson = callPilotJson;

