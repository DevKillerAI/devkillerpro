import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  callPilotJson, estimatePilotCostMicros, parsePilotOutput, parsePilotUsage,
  PILOT_MAX_OUTPUT_TOKENS, PILOT_MAX_REQUEST_BYTES, PILOT_MODEL, PilotProviderError, preparePilotRequest,
  type PilotProviderInput, type PilotProviderStore,
} from '../src/lib/server/generator/pilotProvider';
import type { PilotCall, PilotLease } from '../src/lib/server/generator/pilotStore';

const lease: PilotLease = { runId: 'pilot-run', ownerId: 'owner-a', workerId: 'worker-a', fence: 1, leaseUntil: 100_000 };
const input = (): PilotProviderInput => ({
  instructions: 'Return the requested JSON. Do not call tools.', input: 'Create a tiny sample.', schemaName: 'pilot_result',
  schema: { type: 'object', additionalProperties: false, properties: { answer: { type: 'string' } }, required: ['answer'] },
});
const usage = { input_tokens: 100, input_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 }, output_tokens: 30, output_tokens_details: { reasoning_tokens: 5 }, total_tokens: 130 };
const terminal = (overrides: Record<string, unknown> = {}) => ({
  id: 'resp_test_owned', model: PILOT_MODEL, status: 'completed', service_tier: 'default', usage,
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"answer":"done"}' }] }],
  ...overrides,
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const eventStream = (...chunks: string[]) => new Response(new ReadableStream({
  start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); },
}), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

function fakeStore() {
  let call: PilotCall | null = null;
  let settlements = 0;
  let uncertainCount = 0;
  const methods: PilotProviderStore = {
    async reservePilotCall(l, args) {
      if (call) {
        if (call.requestHash !== args.requestHash) throw new Error('Changed request');
        return { call: { ...call }, created: false };
      }
      call = {
        operationId: args.operationId, runId: l.runId, ownerId: l.ownerId,
        requestHash: args.requestHash, model: args.model, reservedMicros: args.reservedMicros,
        actualMicros: null, status: 'reserved', responseId: null, request: args.request,
        result: null, usage: null, lastResponseStatus: null,
      };
      return { call: { ...call }, created: true };
    },
    async getPilotCall(runId, ownerId, operationId) {
      return call && call.runId === runId && call.ownerId === ownerId && call.operationId === operationId ? { ...call } : null;
    },
    async markPilotSubmitted(_l, _op, responseId, status) {
      assert.ok(call); call = { ...call, responseId, status: 'submitted', lastResponseStatus: status ?? null }; return { ...call };
    },
    async settlePilotCall(_l, _op, args) {
      assert.ok(call); settlements++; call = { ...call, ...args, lastResponseStatus: args.lastResponseStatus ?? null }; return { ...call };
    },
    async markPilotCallUncertain(_l, _op, lastResponseStatus, observation) {
      assert.ok(call); uncertainCount++; call = { ...call, status: 'uncertain', lastResponseStatus: lastResponseStatus ?? null, ...observation }; return { ...call };
    },
  };
  return { methods, get call() { return call; }, get settlements() { return settlements; }, get uncertainCount() { return uncertainCount; } };
}

function harness(responses: (Response | Error)[]) {
  const store = fakeStore();
  let clock = 1000;
  const requests: { url: string; method: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), method: init?.method ?? 'GET', init });
    const next = responses.shift();
    if (!next) throw new Error('Unexpected network request');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { store, requests, deps: { store: store.methods, apiKey: 'unit-test-key-not-real', fetch: fetcher, now: () => clock, sleep: async (ms: number) => { clock += ms; } } };
}
const args = () => ({ ...input(), lease, operationId: 'build-1' });

test('pilot request fixes model, service tier, no tools, output cap and explicit truncation policy', () => {
  const prepared = preparePilotRequest(input());
  assert.equal(prepared.body.model, PILOT_MODEL);
  assert.equal(prepared.body.service_tier, 'default');
  assert.deepEqual(prepared.body.tools, []);
  assert.equal(prepared.body.background, true);
  assert.equal(prepared.body.store, true);
  assert.equal(prepared.body.truncation, 'disabled');
  assert.equal(prepared.body.max_output_tokens, 8000);
  assert.equal(prepared.reservedMicros, (prepared.bodyBytes + 4096) * 5 + 8000 * 18);
  assert.equal(prepared.requestHash, preparePilotRequest(input()).requestHash);
  assert.ok(!prepared.serialized.includes('OPENAI_API_KEY'));
});

test('foreground stream records the response ID before terminal output and handles split CRLF frames', async () => {
  const created = { type: 'response.created', response: { id: 'resp_test_owned', model: PILOT_MODEL, status: 'in_progress' } };
  const completed = { type: 'response.completed', response: terminal() };
  const h = harness([eventStream(`data: ${JSON.stringify(created)}\r`, `\n\r\ndata: ${JSON.stringify(completed)}\r\n\r\n`)]);
  const statuses: string[] = [];
  const result = await callPilotJson<{ answer: string }>({ ...args(), transport: 'foreground-stream', onStatus: status => { statuses.push(status); } }, h.deps);
  assert.equal(result.data.answer, 'done');
  assert.equal(h.requests.length, 1);
  assert.equal(JSON.parse(String(h.requests[0].init?.body)).background, false);
  assert.equal(JSON.parse(String(h.requests[0].init?.body)).stream, true);
  assert.deepEqual(statuses, ['in_progress']);
  assert.equal(h.store.call?.responseId, 'resp_test_owned');
  assert.equal(h.store.call?.status, 'completed');
  assert.equal(h.store.settlements, 1);
});

test('interrupted foreground stream with a known response ID remains reconcilable and is never reposted', async () => {
  const created = { type: 'response.created', response: { id: 'resp_test_owned', model: PILOT_MODEL, status: 'in_progress' } };
  const h = harness([eventStream(`data: ${JSON.stringify(created)}\n\n`)]);
  await assert.rejects(callPilotJson({ ...args(), transport: 'foreground-stream' }, h.deps), /PILOT_SUBMISSION_UNCERTAIN/);
  assert.equal(h.store.call?.responseId, 'resp_test_owned');
  assert.equal(h.store.call?.status, 'uncertain');
  await assert.rejects(callPilotJson({ ...args(), transport: 'foreground-stream' }, h.deps));
  assert.equal(h.requests.filter(request => request.method === 'POST').length, 1);
});

test('request rejects excess output, oversized UTF-8 context, malformed text and schema', () => {
  assert.equal(preparePilotRequest({ ...input(), maxOutputTokens: PILOT_MAX_OUTPUT_TOKENS }).body.max_output_tokens, PILOT_MAX_OUTPUT_TOKENS);
  assert.throws(() => preparePilotRequest({ ...input(), maxOutputTokens: PILOT_MAX_OUTPUT_TOKENS+1 }), /PILOT_OUTPUT_LIMIT/);
  assert.throws(() => preparePilotRequest({ ...input(), maxOutputTokens: NaN }), /PILOT_OUTPUT_LIMIT/);
  assert.throws(() => preparePilotRequest({ ...input(), input: '🌎'.repeat(PILOT_MAX_REQUEST_BYTES) }), /PILOT_CONTEXT_LIMIT/);
  assert.throws(() => preparePilotRequest({ ...input(), input: '\ud800' }), /PILOT_REQUEST_INVALID/);
  assert.throws(() => preparePilotRequest({ ...input(), schemaName: '../bad' }), /PILOT_REQUEST_INVALID/);
  assert.throws(() => preparePilotRequest({ ...input(), schema: [] as never }), /PILOT_REQUEST_INVALID/);
});

test('usage accounting includes cache writes, cached reads and reasoning within output exactly once', () => {
  const parsed = parsePilotUsage({ input_tokens: 1000, input_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 }, output_tokens: 100, output_tokens_details: { reasoning_tokens: 20 } });
  assert.ok(parsed);
  assert.equal(estimatePilotCostMicros(parsed), 2890);
  assert.equal(parsed.cacheWriteTokensObserved, true);
  const unknownWrites = parsePilotUsage({ input_tokens: 10, output_tokens: 1 });
  assert.ok(unknownWrites);
  assert.equal(unknownWrites.cacheWriteTokensObserved, false);
  assert.equal(estimatePilotCostMicros(unknownWrites), 37);
  for (const malformed of [null, {}, { input_tokens: -1, output_tokens: 2 }, { input_tokens: 2 ** 53, output_tokens: 2 }, { input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 8, cache_write_tokens: 8 } }, { input_tokens: 10, output_tokens: 1, output_tokens_details: { reasoning_tokens: 2 } }, { input_tokens: 10, output_tokens: 1, input_tokens_details: { cache_write_tokens: null } }, { input_tokens: 10, output_tokens: 1, total_tokens: 12 }]) assert.equal(parsePilotUsage(malformed), null);
});

test('output parser rejects partial output, refusal, reasoning text and ambiguous JSON', () => {
  assert.deepEqual(parsePilotOutput(terminal()), { answer: 'done' });
  assert.throws(() => parsePilotOutput(terminal({ status: 'incomplete' })), /PILOT_OUTPUT_INCOMPLETE/);
  assert.throws(() => parsePilotOutput(terminal({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'No' }] }] })), /PILOT_REFUSAL/);
  assert.throws(() => parsePilotOutput(terminal({ output: [{ type: 'reasoning', summary: [{ type: 'summary_text', text: '{}' }] }] })), /PILOT_OUTPUT_INVALID/);
  assert.throws(() => parsePilotOutput(terminal({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{' }, { type: 'output_text', text: '}' }] }] })), /PILOT_OUTPUT_INVALID/);
  assert.throws(() => parsePilotOutput(terminal({ output: [...terminal().output, { type: 'function_call', name: 'surprise' }] })), /PILOT_OUTPUT_INVALID/);
});

test('one reserved POST polls the saved ID and persists output and usage; reread does not resubmit or resettle', async () => {
  const h = harness([json({ id: 'resp_test_owned', status: 'queued', model: PILOT_MODEL }), json(terminal())]);
  const result = await callPilotJson<{ answer: string }>(args(), h.deps);
  assert.equal(result.data.answer, 'done');
  assert.equal(result.billingBasis.kind, 'estimate-not-invoice');
  assert.equal(result.actualMicros, 529);
  assert.deepEqual(h.requests.map(r => r.method), ['POST', 'GET']);
  assert.equal(h.requests[1].url, 'https://api.openai.com/v1/responses/resp_test_owned');
  assert.equal(h.requests[0].init?.redirect, 'error');
  assert.ok(!JSON.stringify(h.store.call).includes('unit-test-key-not-real'));
  assert.equal(h.store.call?.status, 'completed');
  assert.equal(h.store.settlements, 1);
  assert.deepEqual((await callPilotJson(args(), h.deps)).data, { answer: 'done' });
  assert.equal(h.requests.length, 2);
  assert.equal(h.store.settlements, 1);
});

test('a lost POST retains its reservation and is never automatically resubmitted', async () => {
  const h = harness([new Error('secret-provider-transport-diagnostic')]);
  await assert.rejects(callPilotJson(args(), h.deps), (error: unknown) => error instanceof PilotProviderError && error.code === 'PILOT_SUBMISSION_UNCERTAIN' && !error.message.includes('secret-provider'));
  assert.equal(h.store.call?.status, 'uncertain');
  assert.equal(h.store.call?.actualMicros, null);
  await assert.rejects(callPilotJson(args(), h.deps), /PILOT_SUBMISSION_UNCERTAIN/);
  assert.equal(h.requests.length, 1);
  assert.equal(h.store.settlements, 0);
});

test('even an existing reserved record with no response ID cannot create another POST', async () => {
  const h = harness([]), prepared = preparePilotRequest(input());
  await h.store.methods.reservePilotCall(lease, { operationId: 'build-1', requestHash: prepared.requestHash, reservedMicros: prepared.reservedMicros, model: PILOT_MODEL });
  await assert.rejects(callPilotJson(args(), h.deps), /PILOT_SUBMISSION_UNCERTAIN/);
  assert.equal(h.requests.length, 0);
});

test('saved response ID resumes with GET after polling failure without repeating create', async () => {
  const h = harness([json({ id: 'resp_test_owned', status: 'in_progress', model: PILOT_MODEL }), new Error(), new Error(), new Error(), json(terminal())]);
  await assert.rejects(callPilotJson(args(), h.deps), /PILOT_POLL_INTERRUPTED/);
  assert.equal(h.store.call?.status, 'uncertain');
  const result = await callPilotJson(args(), h.deps);
  assert.deepEqual(result.data, { answer: 'done' });
  assert.equal(h.requests.filter(r => r.method === 'POST').length, 1);
});

test('missing terminal usage retains reservation and recorded response instead of claiming zero cost', async () => {
  const h = harness([json(terminal({ usage: null }))]);
  await assert.rejects(callPilotJson(args(), h.deps), /PILOT_USAGE_UNCERTAIN/);
  assert.equal(h.store.call?.status, 'uncertain');
  assert.equal(h.store.call?.actualMicros, null);
  assert.equal(h.store.call?.responseId, 'resp_test_owned');
  assert.deepEqual(h.store.call?.result, terminal({ usage: null }));
});

test('invalid JSON still persists consumed usage and terminal output before reporting failure', async () => {
  const h = harness([json(terminal({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'broken {' }] }] }))]);
  await assert.rejects(callPilotJson(args(), h.deps), /PILOT_OUTPUT_INVALID/);
  assert.equal(h.store.call?.status, 'failed');
  assert.equal(h.store.call?.actualMicros, 529);
  assert.ok(h.store.call?.result);
  await assert.rejects(callPilotJson(args(), h.deps), /PILOT_PREVIOUS_CALL_FAILED/);
  assert.equal(h.requests.length, 1);
});

test('HTTP rejection fails once with no model output; server error retains uncertainty', async () => {
  const rejected = harness([json({ error: { message: 'secret detail' } }, 400)]);
  await assert.rejects(callPilotJson(args(), rejected.deps), /PILOT_SUBMISSION_REJECTED/);
  assert.equal(rejected.store.call?.actualMicros, 0);
  assert.equal(rejected.store.call?.status, 'failed');
  const server = harness([json({}, 500)]);
  await assert.rejects(callPilotJson(args(), server.deps), /PILOT_SUBMISSION_UNCERTAIN/);
  assert.equal(server.store.call?.actualMicros, null);
});

test('timeout cancels only the recorded response and retains unknown cancellation cost', async () => {
  const h = harness([json({ id: 'resp_test_owned', status: 'in_progress', model: PILOT_MODEL }), json(terminal({ status: 'cancelled', usage: null, output: [] }))]);
  await assert.rejects(callPilotJson({ ...args(), timeoutMs: 1000 }, h.deps), /PILOT_WAIT_LIMIT/);
  assert.deepEqual(h.requests.map(r => [r.method, r.url]), [
    ['POST', 'https://api.openai.com/v1/responses'],
    ['POST', 'https://api.openai.com/v1/responses/resp_test_owned/cancel'],
  ]);
  assert.equal(h.store.call?.status, 'uncertain');
  assert.equal(h.store.call?.actualMicros, null);
});

test('scope mismatch from a saved store record is rejected before provider I/O', async () => {
  const h = harness([]), prepared = preparePilotRequest(input());
  await h.store.methods.reservePilotCall({ ...lease, ownerId: 'someone-else' }, { operationId: 'build-1', requestHash: prepared.requestHash, reservedMicros: prepared.reservedMicros, model: PILOT_MODEL });
  await assert.rejects(callPilotJson(args(), h.deps), /PILOT_CALL_SCOPE_MISMATCH/);
  assert.equal(h.requests.length, 0);
});

test('unexpected model/tier and out-of-bound usage never release the conservative reservation', async () => {
  for (const change of [{ model: 'other-model' }, { service_tier: 'fast' }, { usage: { input_tokens: 100, output_tokens: 8001 } }]) {
    const h = harness([json(terminal(change))]);
    await assert.rejects(callPilotJson(args(), h.deps), /PILOT_RESPONSE_MISMATCH|PILOT_USAGE_UNCERTAIN/);
    assert.equal(h.store.call?.status, 'uncertain');
    assert.equal(h.store.settlements, 0);
  }
});
