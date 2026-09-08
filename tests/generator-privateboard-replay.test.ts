import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createPrivateboardContract, SUPABASE_PILOT_INITIAL_PATHS } from '../src/lib/server/generator/supabasePilotContract';
import { bindSourceCandidate } from '../src/lib/server/generator/operationPolicy';
import { PILOT_MODEL, PILOT_BILLING_BASIS, preparePilotRequest, parsePilotUsage, estimatePilotCostMicros, type PilotProviderInput } from '../src/lib/server/generator/pilotProvider';
import { PRIVATEBOARD_STYLE_REQUEST, privateboardBuildRequest, privateboardPatchRequest, privateboardUpgradeRequest,
  applyPrivateboardRecordedOutput, replayPrivateboardCalls, privateboardSourceRepairFailures, planPrivateboardStyleCorrection, evaluatePrivateboardStylePatch, type PrivateboardOperation } from '../src/lib/server/generator/supabasePilotReplay';
import { classifyPilotPatchFailure } from '../src/lib/server/generator/pilotPatchRecovery';
import type { PilotCall, PilotSavedSnapshot } from '../src/lib/server/generator/pilotStore';
import type { PilotVerification } from '../src/lib/server/generator/pilotVerifier';
import type { GeneratorSnapshot } from '../src/lib/server/generator/versionedEdits';
import { requalifyPrivateboardSnapshot, type PrivateboardRuntimeRequalification } from '../src/lib/server/generator/supabasePilotRequalification';

const contract = createPrivateboardContract('replay-fixture-owner', '12345678-1234-4234-8234-123456789abc');
const runtimeDigest = 'd'.repeat(64);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function settled(operationId: PrivateboardOperation, input: PilotProviderInput, output: unknown): PilotCall {
  const request = preparePilotRequest(input);
  const rawUsage = { input_tokens: 50, output_tokens: 20, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };
  const usage = parsePilotUsage(rawUsage)!;
  const responseId = `resp_fixture_${operationId}`;
  return { operationId, ownerId: contract.identity.ownerId, runId: contract.identity.missionId, requestHash: request.requestHash,
    model: PILOT_MODEL, reservedMicros: request.reservedMicros, actualMicros: estimatePilotCostMicros(usage), status: 'completed', responseId,
    request: request.body, usage: { ...usage, billingBasis: PILOT_BILLING_BASIS }, lastResponseStatus: 'completed',
    result: { id: responseId, model: PILOT_MODEL, service_tier: 'default', status: 'completed', usage: rawUsage,
      output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }] } };
}
function fixture(twoRepairs = false) {
  const calls: PilotCall[] = [], snapshots: GeneratorSnapshot[] = [];
  let base: GeneratorSnapshot | null = null;
  const add = (operationId: PrivateboardOperation, input: PilotProviderInput, output: unknown) => {
    calls.push(settled(operationId, input, output));
    base = applyPrivateboardRecordedOutput(contract, base, operationId, output); snapshots.push(base);
    return base;
  };
  add('build-1', privateboardBuildRequest(), { summary: 'Test fixture, not a runnable delivered app.', files: [
    { path: 'src/App.tsx', content: 'export default function App(){return <p>Replay fixture</p>}' },
    { path: 'src/styles.css', content: ':root { --accent: #00abcd; }' },
    { path: 'supabase/migrations/001_init.sql', content: 'create table app.tasks (id uuid);' },
  ] });
  const request = 'Fix only these executed failures. Preserve all working behavior.\n' + JSON.stringify([{ id: 'requirement:responsive:mobile', passed: false, details: 'Recorded original failure at attempt 1.' }]);
  add('repair-1', privateboardPatchRequest(base!, request, SUPABASE_PILOT_INITIAL_PATHS), { summary: 'Fixture repair', edits: [{ path: 'src/styles.css', search: '#00abcd', replacement: '#00ccee' }] });
  if (twoRepairs) add('repair-2', privateboardPatchRequest(base!, request, SUPABASE_PILOT_INITIAL_PATHS), { summary: 'Second fixture repair', edits: [{ path: 'src/App.tsx', search: 'Replay fixture', replacement: 'Repaired fixture' }] });
  add('upgrade-1', privateboardUpgradeRequest(base!), { summary: 'Add fixture priority', sql: 'alter table app.tasks add column priority smallint not null default 0 check (priority in (0,1,2));' });
  add('refine-1', privateboardPatchRequest(base!, PRIVATEBOARD_STYLE_REQUEST, ['src/styles.css']), { summary: 'Fixture style edit', edits: [{ path: 'src/styles.css', search: '#00ccee', replacement: '#8b5cf6' }] });
  const saved: PilotSavedSnapshot[] = snapshots.map(snapshot => ({ snapshot, candidate: bindSourceCandidate(snapshot, contract, runtimeDigest), createdAt: '2026-09-03T12:00:00.000Z' }));
  return { calls, snapshots, saved };
}

test('offline replay chooses the complete upgraded/refined candidate, not a 001-only recheck', () => {
  const { calls, snapshots, saved } = fixture(); const before = JSON.stringify({ calls, snapshots, saved });
  const replay = replayPrivateboardCalls(contract, calls, saved, runtimeDigest);
  assert.deepEqual(replay.snapshot, snapshots.at(-1));
  assert.equal(replay.snapshot!.revision, 'refine-1');
  assert.equal(replay.snapshot!.files.length, 4);
  assert.ok(replay.snapshot!.files.some(file => file.path === 'supabase/migrations/002_priority.sql'));
  assert.equal(replay.initialRevision, 'repair-1');
  assert.equal(replay.repairs, 1); assert.equal(replay.upgraded, true); assert.equal(replay.refined, true);
  assert.equal(replay.pending, null);
  assert.equal(JSON.stringify({ calls, snapshots, saved }), before);
});

test('all five recorded operations preserve the original five-call/two-repair ceiling', () => {
  const { calls, saved } = fixture(true);
  const replay = replayPrivateboardCalls(contract, calls, saved, runtimeDigest);
  assert.equal(calls.length, 5); assert.equal(replay.repairs, 2); assert.equal(replay.initialRevision, 'repair-2');
  assert.throws(() => replayPrivateboardCalls(contract, [...calls, calls[0]], saved, runtimeDigest), /Unexpected or duplicate/);
});

test('explicit runtime requalification preserves old candidates, source and billing without replaying a build', () => {
  const f = fixture(true), calls = f.calls.slice(0, 3), base = f.snapshots[2];
  const fromImageId = 'sha256:' + '1'.repeat(64), toImageId = 'sha256:' + '2'.repeat(64);
  const digest = (image: string) => createHash('sha256').update(image + ':privateboard-v1').digest('hex');
  const authority: PrivateboardRuntimeRequalification = { sourceRevision: 'repair-2', sourceHash: base.hash,
    fromImageId, toImageId, fromRuntimeDigest: digest(fromImageId), toRuntimeDigest: digest(toImageId),
    verifierVersion: 'privateboard-v1', requalificationRevision: 'runtime-1' };
  const saved = f.saved.slice(0, 3).map(item => ({ ...item, candidate: bindSourceCandidate(item.snapshot, contract, authority.fromRuntimeDigest) }));
  const before = JSON.stringify({ calls, saved });
  assert.throws(() => replayPrivateboardCalls(contract, calls, saved, authority.toRuntimeDigest), /pinned runtime/);
  assert.throws(() => replayPrivateboardCalls(contract, calls, saved.slice(1), authority.toRuntimeDigest, authority), /all original immutable/);
  const replay = replayPrivateboardCalls(contract, calls, saved, authority.toRuntimeDigest, authority);
  assert.equal(replay.repairs, 2); assert.equal(replay.pending, null);
  assert.equal(replay.snapshot!.revision, 'runtime-1'); assert.equal(replay.snapshot!.hash, base.hash);
  assert.deepEqual(replay.snapshot!.files, base.files); assert.deepEqual(replay.snapshot!.parent, { revision: base.revision, hash: base.hash });
  assert.equal(JSON.stringify({ calls, saved }), before);
  const qualified = replay.snapshot!;
  saved.push({ snapshot: qualified, candidate: bindSourceCandidate(qualified, contract, authority.toRuntimeDigest), createdAt: saved[0].createdAt });
  calls.push(settled('upgrade-1', privateboardUpgradeRequest(qualified), { summary: 'Fixture additive migration', sql: 'alter table app.tasks add column priority smallint not null default 0 check (priority in (0,1,2));' }));
  const upgraded = replayPrivateboardCalls(contract, calls, saved, authority.toRuntimeDigest, authority);
  assert.equal(upgraded.initialRevision, 'runtime-1'); assert.equal(upgraded.snapshot!.parent?.revision, 'runtime-1');
  calls.push(settled('refine-1', privateboardPatchRequest(upgraded.snapshot!, PRIVATEBOARD_STYLE_REQUEST, ['src/styles.css']),
    { summary: 'Fixture refinement', edits: [{ path: 'src/styles.css', search: '#00ccee', replacement: '#8b5cf6' }] }));
  assert.equal(replayPrivateboardCalls(contract, calls, saved, authority.toRuntimeDigest, authority).refined, true);
  assert.equal(calls.length, 5);
  for (const bad of [{ ...authority, sourceHash: 'a'.repeat(64) }, { ...authority, sourceRevision: 'repair-1' as const },
    { ...authority, toRuntimeDigest: 'b'.repeat(64) }, { ...authority, fromImageId: toImageId }]) {
    assert.throws(() => replayPrivateboardCalls(contract, calls, saved, authority.toRuntimeDigest, bad));
  }
  const modified = clone(saved); modified[3].snapshot = { ...qualified, files: [{ ...qualified.files[0], content: 'changed' }, ...qualified.files.slice(1)] };
  assert.throws(() => replayPrivateboardCalls(contract, calls, modified, authority.toRuntimeDigest, authority), /Stored candidate/);
  assert.throws(() => requalifyPrivateboardSnapshot(upgraded.snapshot!, authority, authority.toRuntimeDigest));
});

test('crash after settled upgrade before snapshot persistence still reconstructs append-only lineage', () => {
  const { calls, snapshots, saved } = fixture();
  const replay = replayPrivateboardCalls(contract, calls.slice(0, 3), saved.slice(0, 2), runtimeDigest);
  assert.equal(replay.snapshot!.revision, 'upgrade-1'); assert.equal(replay.upgraded, true); assert.equal(replay.refined, false);
  assert.deepEqual(replay.snapshot!.parent, { revision: snapshots[1].revision, hash: snapshots[1].hash });
  assert.deepEqual(replay.snapshot, snapshots[2]);
});

test('pending upgrade/style/repair retain exact original requests for response-ID resumption', () => {
  const fixtureData = fixture();
  for (const operation of ['repair-1', 'upgrade-1', 'refine-1']) {
    const calls = clone(fixtureData.calls), index = calls.findIndex(call => call.operationId === operation);
    calls[index] = { ...calls[index], status: 'submitted', actualMicros: null, usage: null, result: null };
    const replay = replayPrivateboardCalls(contract, calls.slice(0, index + 1), fixtureData.saved.slice(0, index), runtimeDigest);
    assert.equal(replay.pending?.operationId, operation);
    assert.equal(preparePilotRequest(replay.pending!.input).requestHash, calls[index].requestHash);
    assert.equal(replay.snapshot!.revision, fixtureData.snapshots[index - 1].revision);
  }
});

test('an uncertain build without a response ID remains pending and never becomes a new build', () => {
  const { calls } = fixture();
  const uncertain = { ...calls[0], status: 'uncertain' as const, actualMicros: null, responseId: null, result: null, usage: null };
  const replay = replayPrivateboardCalls(contract, [uncertain], [], runtimeDigest);
  assert.equal(replay.snapshot, null); assert.equal(replay.pending?.operationId, 'build-1');
  assert.equal(replay.pending!.input.input, privateboardBuildRequest().input);
});

test('replay checks owner, operation, immutable request, response identity and settled accounting', () => {
  const mutations: ((call: PilotCall) => void)[] = [
    call => { call.ownerId = 'other'; }, call => { call.runId = 'other'; }, call => { call.model = 'other'; },
    call => { call.requestHash = 'a'.repeat(64); }, call => { call.reservedMicros++; }, call => { call.actualMicros = null; },
    call => { call.actualMicros = -1; }, call => { call.actualMicros = call.actualMicros! + 1; },
    call => { call.responseId = 'resp_other'; }, call => { call.status = 'failed'; },
    call => { (call.request as any).tools = [{ type: 'web_search' }]; },
    call => { (call.result as any).service_tier = 'priority'; },
    call => { (call.result as any).usage.output_tokens = 9000; },
    call => { (call.usage as any).outputTokens = 0; },
    call => { call.usage = {}; },
  ];
  for (const mutate of mutations) {
    const { calls } = fixture(); mutate(calls[0]);
    assert.throws(() => replayPrivateboardCalls(contract, calls, [], runtimeDigest));
  }
});

test('JSONB key ordering does not invalidate the canonical stored request', () => {
  const { calls } = fixture();
  for (const call of calls) call.request = Object.fromEntries(Object.entries(call.request as object).reverse());
  assert.equal(replayPrivateboardCalls(contract, calls, [], runtimeDigest).refined, true);
});

test('repair replay rejects altered source context even with a matching recomputed stored checksum', () => {
  const { calls } = fixture();
  const request = calls[1].request as any;
  request.input = request.input.replace('"baseRevision":"build-1"', '"baseRevision":"foreign-revision"');
  calls[1].requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  assert.throws(() => replayPrivateboardCalls(contract, calls, [], runtimeDigest), /exact source context/);
});

test('stored lineage, source and pinned-runtime mismatches cannot be silently replaced', () => {
  for (const mutate of [
    (saved: PilotSavedSnapshot[]) => { saved[1].candidate.runtimeDigest = 'e'.repeat(64); },
    (saved: PilotSavedSnapshot[]) => { (saved[1].snapshot as any).parent.hash = 'e'.repeat(64); },
    (saved: PilotSavedSnapshot[]) => { (saved[1].snapshot as any).files[0].content = 'changed'; },
  ]) {
    const { calls, saved } = fixture(); const mutable = clone(saved); mutate(mutable);
    assert.throws(() => replayPrivateboardCalls(contract, calls, mutable, runtimeDigest), /Stored candidate/);
  }
});

test('missing predecessors and recorded terminal failures never authorize replacement operations', () => {
  const { calls, saved } = fixture(true);
  assert.throws(() => replayPrivateboardCalls(contract, calls.slice(1), [], runtimeDigest), /predecessor/);
  assert.throws(() => replayPrivateboardCalls(contract, calls.filter(call => call.operationId !== 'repair-1'), [], runtimeDigest), /predecessor/);
  assert.throws(() => replayPrivateboardCalls(contract, calls.filter(call => call.operationId !== 'upgrade-1'), [], runtimeDigest), /predecessor/);
  assert.throws(() => replayPrivateboardCalls(contract, calls.slice(0, 1), saved, runtimeDigest), /Stored candidate/);
  const failed = { ...calls[1], status: 'failed' as const };
  assert.throws(() => replayPrivateboardCalls(contract, [calls[0], failed], [], runtimeDigest), /cannot be replayed or resubmitted/);
});

test('source repair excludes infrastructure, harness and missing pre-upgrade baseline diagnoses', () => {
  const report = (id: string): PilotVerification => ({ status: 'failed', sourceHash: 'a'.repeat(64), verifierVersion: 'privateboard-v1',
    compiledFiles: [], checks: [{ id, passed: false, details: 'Observed failure.' }], failures: ['Observed failure.'], limitations: [], durationMs: 1 });
  assert.equal(privateboardSourceRepairFailures(report('requirement:items:create')).length, 1);
  for (const id of ['harness:browser', 'harness:api', 'platform:auth-two-users', 'platform:auth-session-lifecycle', 'platform:scope-isolation', 'platform:baseline-preserved', 'platform:migration-upgrade'])
    assert.throws(() => privateboardSourceRepairFailures(report(id)), /No paid source repair/);
  assert.throws(() => privateboardSourceRepairFailures({ ...report('platform:build'), status: 'unavailable' }), /No paid source repair/);
});

test('supervisor restores recorded lineage before verification and requires a baseline before migration', () => {
  const source = readFileSync(new URL('../src/lib/server/generator/supabasePilotSupervisor.ts', import.meta.url), 'utf8');
  assert.ok(source.indexOf('let snapshot = replay.snapshot') < source.indexOf('let report = await verify(snapshot)'));
  assert.match(source, /while \(!replay\.upgraded && report\.status === 'failed'/);
  assert.match(source, /if \(!replay\.upgraded\)/);
  assert.match(source, /if \(!replay\.refined\)/);
  assert.ok(source.indexOf('The pre-upgrade private baseline is missing') < source.indexOf('migrations = await applySupabasePilotMigrations'));
  assert.match(source, /await link\(temporary, file\)/);
});

const correctionBudget = { repairsUsed: 1, maxRepairAttempts: 2, providerCallsUsed: 4, maxProviderCalls: 5, correctionAttempts: 0, correctionAlreadyRecorded: false };
const funding = { runBudget: { spentMicros: 1000, reservedMicros: 0, maxCostMicros: 3_000_000 }, campaignBudget: { spentMicros: 2000, reservedMicros: 0, maxCostMicros: 3_000_000 } };
function rejectedStyleFixture() {
  const existing = fixture(), calls = existing.calls.slice(0, 3), saved = existing.saved.slice(0, 3), base = existing.snapshots[2];
  const proposal = { summary: 'Deliberately ambiguous test proposal', edits: [{ path: 'src/styles.css', search: ' ', replacement: ' #8b5cf6 ' }] };
  calls.push(settled('refine-1', privateboardPatchRequest(base, PRIVATEBOARD_STYLE_REQUEST, ['src/styles.css']), proposal));
  const replay = replayPrivateboardCalls(contract, calls, saved, runtimeDigest), rejection = replay.rejectedRefinement!;
  assert.ok(rejection);
  const correction = { summary: 'Unique fixture CSS correction', edits: [{ path: 'src/styles.css', search: ':root { --accent: #00ccee; }', replacement: ':root { --accent: #8b5cf6; }' }] };
  return { calls, saved, base, proposal, correction, replay, rejection };
}

test('an ambiguous Privateboard style proposal is rejected atomically without a phantom revision', () => {
  const { base, replay, rejection } = rejectedStyleFixture();
  assert.equal(classifyPilotPatchFailure(rejection.error), 'MATCH_NOT_UNIQUE');
  assert.equal(replay.refined, false); assert.equal(replay.upgraded, true); assert.equal(replay.repairs, 1);
  assert.deepEqual(replay.snapshot, base);
  assert.equal(replay.snapshots.some(snapshot => snapshot.revision === 'refine-1'), false);
  assert.ok(!base.files.find(file => file.path === 'src/styles.css')!.content.includes('#8b5cf6'));
});

test('the sole style correction needs remaining call, shared repair and monetary budget', () => {
  const { base, proposal, rejection } = rejectedStyleFixture();
  const plan = planPrivateboardStyleCorrection(base, proposal, rejection.error, 'refine-1', correctionBudget, funding);
  assert.equal(plan.allowed, true); if (!plan.allowed) return;
  assert.equal(plan.operationId, 'refine-repair-1'); assert.equal(plan.repairsUsed, 2);
  const reservation = preparePilotRequest(plan.input).reservedMicros;
  for (const budget of [
    { ...correctionBudget, repairsUsed: 2 }, { ...correctionBudget, providerCallsUsed: 5 }, { ...correctionBudget, correctionAttempts: 1 },
  ]) assert.equal(planPrivateboardStyleCorrection(base, proposal, rejection.error, 'refine-1', budget, funding).allowed, false);
  for (const exhausted of [
    { ...funding, runBudget: { spentMicros: 3_000_000 - reservation + 1, reservedMicros: 0, maxCostMicros: 3_000_000 } },
    { ...funding, campaignBudget: { spentMicros: 3_000_000 - reservation, reservedMicros: 1, maxCostMicros: 3_000_000 } },
  ]) assert.equal(planPrivateboardStyleCorrection(base, proposal, rejection.error, 'refine-1', correctionBudget, exhausted).allowed, false);
  assert.equal(planPrivateboardStyleCorrection(base, proposal, rejection.error, 'refine-1', correctionBudget).allowed, false);
  assert.equal(planPrivateboardStyleCorrection(base, proposal, rejection.error, 'refine-1', { ...correctionBudget, providerCallsUsed: 5, correctionAlreadyRecorded: true }).allowed, true);
});

test('provider/infra failures, initial repairs and a correction cannot request style correction', () => {
  const { base, proposal, rejection, correction } = rejectedStyleFixture();
  for (const operationId of ['repair-1', 'repair-2', 'refine-repair-1', 'refine-repair-2'])
    assert.equal(planPrivateboardStyleCorrection(base, proposal, rejection.error, operationId, correctionBudget, funding).allowed, false);
  assert.equal(planPrivateboardStyleCorrection(base, proposal, new Error('Provider polling interrupted'), 'refine-1', correctionBudget, funding).allowed, false);
  assert.equal(planPrivateboardStyleCorrection(base, proposal, new Error('Docker unavailable'), 'refine-1', correctionBudget, funding).allowed, false);
  assert.equal(planPrivateboardStyleCorrection(base, correction, rejection.error, 'refine-1', correctionBudget, funding).allowed, false, 'a valid original needs no correction');
  let scopeError: unknown;
  const forbidden = { ...proposal, edits: [{ path: 'supabase/migrations/001_init.sql', search: 'create', replacement: 'alter' }] };
  try { evaluatePrivateboardStylePatch(base, forbidden, 'refine-1'); } catch (error) { scopeError = error; }
  assert.equal(classifyPilotPatchFailure(scopeError), null);
  assert.equal(planPrivateboardStyleCorrection(base, forbidden, scopeError, 'refine-1', correctionBudget, funding).allowed, false);
});

test('completed correction replays from the unchanged upgrade base and retains the rejected original', () => {
  const { calls, saved, base, proposal, correction, rejection } = rejectedStyleFixture();
  const plan = planPrivateboardStyleCorrection(base, proposal, rejection.error, 'refine-1', correctionBudget, funding);
  assert.equal(plan.allowed, true); if (!plan.allowed) return;
  calls.push(settled(plan.operationId, plan.input, correction));
  const corrected = applyPrivateboardRecordedOutput(contract, base, plan.operationId, correction);
  saved.push({ snapshot: corrected, candidate: bindSourceCandidate(corrected, contract, runtimeDigest), createdAt: '2026-09-03T12:01:00.000Z' });
  const before = JSON.stringify({ calls, saved });
  const replay = replayPrivateboardCalls(contract, calls, saved, runtimeDigest);
  assert.equal(replay.refined, true); assert.equal(replay.repairs, 2); assert.equal(replay.pending, null);
  assert.equal(replay.snapshot!.revision, 'refine-repair-1'); assert.equal(replay.snapshot!.parent!.revision, 'upgrade-1');
  assert.equal(replay.rejectedRefinement!.base.hash, base.hash);
  assert.deepEqual(replay.rejectedRefinement!.proposal, proposal);
  assert.equal(replay.snapshots.some(snapshot => snapshot.revision === 'refine-1'), false);
  for (const file of base.files.filter(file => file.path !== 'src/styles.css')) assert.equal(replay.snapshot!.files.find(item => item.path === file.path)!.hash, file.hash);
  assert.equal(JSON.stringify({ calls, saved }), before);
});

test('pending style correction resumes the same exact request with no additional attempt', () => {
  const { calls, saved, base, proposal, correction, rejection } = rejectedStyleFixture();
  const plan = planPrivateboardStyleCorrection(base, proposal, rejection.error, 'refine-1', correctionBudget, funding);
  if (!plan.allowed) throw new Error(plan.reason);
  const call = settled(plan.operationId, plan.input, correction);
  calls.push({ ...call, status: 'submitted', actualMicros: null, usage: null, result: null });
  const replay = replayPrivateboardCalls(contract, calls, saved, runtimeDigest);
  assert.equal(replay.pending!.operationId, 'refine-repair-1'); assert.equal(replay.repairs, 2);
  assert.equal(replay.snapshot!.hash, base.hash); assert.equal(replay.refined, false);
  assert.equal(preparePilotRequest(replay.pending!.input).requestHash, call.requestHash);
});

test('correction replay refuses wrong base, owner, successful original or second failed correction', () => {
  const fixtureData = rejectedStyleFixture();
  const { base, proposal, correction, rejection } = fixtureData;
  const plan = planPrivateboardStyleCorrection(base, proposal, rejection.error, 'refine-1', correctionBudget, funding);
  if (!plan.allowed) throw new Error(plan.reason);
  const correctedCall = settled(plan.operationId, plan.input, correction);
  for (const mutate of [
    (calls: PilotCall[]) => { calls[4].ownerId = 'foreign-owner'; },
    (calls: PilotCall[]) => { const request = calls[4].request as any; request.input = request.input.replaceAll(base.hash, 'f'.repeat(64)); calls[4].requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex'); },
    (calls: PilotCall[]) => { calls[3] = settled('refine-1', privateboardPatchRequest(base, PRIVATEBOARD_STYLE_REQUEST, ['src/styles.css']), correction); },
    (calls: PilotCall[]) => { calls[4] = settled('refine-repair-1', plan.input, proposal); },
    (calls: PilotCall[]) => { calls[4].operationId = 'refine-repair-2'; },
  ]) {
    const calls = clone([...fixtureData.calls, correctedCall]); mutate(calls);
    assert.throws(() => replayPrivateboardCalls(contract, calls, fixtureData.saved, runtimeDigest));
  }
  assert.throws(() => replayPrivateboardCalls(contract, [...fixtureData.calls, correctedCall, correctedCall], fixtureData.saved, runtimeDigest), /Unexpected or duplicate/);
});

test('the supervisor catches only local original-style validation and never recursively corrects', () => {
  const source = readFileSync(new URL('../src/lib/server/generator/supabasePilotSupervisor.ts', import.meta.url), 'utf8');
  assert.ok(source.indexOf('const response = await callPilotJson') < source.indexOf('try { next = applyPrivateboardRecordedOutput'));
  assert.match(source, /operationId !== 'refine-1' \|\| !classifyPilotPatchFailure\(error\)/);
  assert.match(source, /replay\.rejectedRefinement\s*\? await correctStyle/);
  const correction = source.slice(source.indexOf('async function correctStyle('), source.indexOf('async function verify('));
  assert.doesNotMatch(correction, /catch\s*\(/);
  assert.match(correction, /campaignBudget: recorded\.currentRun\.campaignBudget/);
});
