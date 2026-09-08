import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRIVATEBOARD_PREVIEW_SANDBOX, isAcceptedPrivateboardDelivery, privateboardPreviewUrl, pilotBenchmarkForRuntime, pilotBenchmarkLabel, pilotPreviewState, readPilotCheckReport } from '../src/lib/workspace/pilotBenchmarks';
import { createBriefboardContract } from '../src/lib/server/generator/pilotContract';
import { createPrivateboardContract } from '../src/lib/server/generator/supabasePilotContract';
import { contractFingerprint } from '../src/lib/server/generator/contract';
import { INITIAL_PILOT_UI_ERRORS, pilotUiErrors } from '../src/lib/workspace/pilotUiErrors';

test('benchmark presentation recognizes exact runtime versions and fails closed for unknown runtimes', () => {
  assert.equal(pilotBenchmarkForRuntime({ id: 'react-static-pilot', version: 'v1' }), 'briefboard');
  assert.equal(pilotBenchmarkForRuntime({ id: 'react-supabase-pilot', version: 'v1' }), 'privateboard');
  assert.equal(pilotBenchmarkForRuntime({ id: 'react-supabase-pilot', version: 'v2' }), null);
  assert.equal(pilotBenchmarkLabel({ id: 'unexpected', version: 'v1' }), 'Unknown benchmark');
});

test('database and unknown candidates never receive the static browser-storage preview', () => {
  assert.deepEqual(pilotPreviewState({ id: 'react-static-pilot', version: 'v1' }), { kind: 'browser-local', url: null, reason: null });
  const database = pilotPreviewState({ id: 'react-supabase-pilot', version: 'v1' });
  assert.equal(database.kind, 'database');
  assert.equal(database.url, null);
  assert.match(database.reason!, /Database preview requires runtime startup/);
  assert.equal(pilotPreviewState({ id: 'other', version: 'v1' }).kind, 'unsupported');
});

test('database preview URLs allow only isolated app loopback hosts on bounded ports', () => {
  const hostname = `dk-v2-${'a'.repeat(24)}.localhost`, parentOrigin = 'http://localhost:3000';
  assert.equal(privateboardPreviewUrl(`http://${hostname}:1024`, parentOrigin), `http://${hostname}:1024/`);
  assert.equal(privateboardPreviewUrl(`http://${hostname}:65535/`, parentOrigin), `http://${hostname}:65535/`);
  for (const url of [
    'http://localhost:3000/', 'http://127.0.0.1:5555/', `https://${hostname}:5555/`, `http://${hostname}/`,
    `http://${hostname}:1023/`, `http://${hostname}:65536/`, `http://${hostname}:5555/not-root`,
    `http://${hostname}:5555/?token=secret`, `http://${hostname}:5555/#token`, `http://user:secret@${hostname}:5555/`,
    `http://${hostname}.evil.test:5555/`, `http://dk-v2-${'a'.repeat(23)}.localhost:5555/`,
    `http://dk-v2-${'g'.repeat(24)}.localhost:5555/`, ` http://${hostname}:5555/`, `http://${hostname}:55\n55/`,
    `//${hostname}:5555/`, 'javascript:alert(1)', 'data:text/html,preview',
  ]) assert.equal(privateboardPreviewUrl(url, parentOrigin), null, url);
  assert.equal(privateboardPreviewUrl(`http://${hostname}:5555/`, `http://${hostname}:5555`), null);
  assert.equal(privateboardPreviewUrl({ url: `http://${hostname}:5555/` }, parentOrigin), null);
  assert.equal(privateboardPreviewUrl(`http://${hostname}:5555/`, 'invalid-parent'), null);
  assert.deepEqual(PRIVATEBOARD_PREVIEW_SANDBOX.split(' '), ['allow-scripts', 'allow-forms', 'allow-same-origin']);
});

test('database preview admission requires the exact accepted identity, source, contract and runtime', () => {
  const contract = createPrivateboardContract('owner-one', '12345678-1234-4234-8234-123456789abc');
  const candidate = { identity: contract.identity, revision: 'upgrade-1', sourceHash: 'a'.repeat(64), contractHash: contractFingerprint(contract), runtimeDigest: 'b'.repeat(64) };
  const run = { contract, identity: contract.identity, contractHash: candidate.contractHash, accepted: candidate };
  const delivery = { candidate, runtime: { id: 'react-supabase-pilot', version: 'v1' } as const };
  assert.equal(isAcceptedPrivateboardDelivery(run, delivery), true);
  assert.equal(isAcceptedPrivateboardDelivery({ ...run, accepted: null }, delivery), false);
  assert.equal(isAcceptedPrivateboardDelivery(run, null), false);
  assert.equal(isAcceptedPrivateboardDelivery(run, { candidate }), false);
  assert.equal(isAcceptedPrivateboardDelivery(run, { ...delivery, runtime: { id: 'react-static-pilot', version: 'v1' } }), false);
  assert.equal(isAcceptedPrivateboardDelivery({ ...run, contractHash: 'c'.repeat(64) }, delivery), false);
  for (const key of ['revision', 'sourceHash', 'contractHash', 'runtimeDigest'] as const) {
    assert.equal(isAcceptedPrivateboardDelivery(run, { ...delivery, candidate: { ...candidate, [key]: 'different' } }), false, key);
  }
  for (const key of ['ownerId', 'projectId', 'missionId', 'environmentId'] as const) {
    assert.equal(isAcceptedPrivateboardDelivery(run, { ...delivery, candidate: { ...candidate, identity: { ...candidate.identity, [key]: 'other' } } }), false, key);
  }
});

test('a request UUID keeps its owner-bound identity when benchmark changes and changes the immutable contract', () => {
  const requestId = '12345678-1234-4234-8234-123456789abc';
  const briefboard = createBriefboardContract('owner-one', requestId), privateboard = createPrivateboardContract('owner-one', requestId);
  assert.deepEqual(briefboard.identity, privateboard.identity);
  assert.notEqual(contractFingerprint(briefboard), contractFingerprint(privateboard));
  assert.equal(briefboard.budget.maxCostMicros, 3_000_000);
  assert.equal(privateboard.budget.maxCostMicros, 3_000_000);
  assert.notEqual(createPrivateboardContract('owner-two', requestId).identity.missionId, privateboard.identity.missionId);
});

test('recorded checks require real boolean outcomes and retain observed limitations', () => {
  const check = { id: 'platform:build', passed: false, details: 'Compilation failed.' };
  assert.deepEqual(readPilotCheckReport({ revision: 'build-1', checks: [check], failures: ['Actual compiler error'], limitations: ['No semantic typecheck'] }), {
    revision: 'build-1', checks: [check], failures: ['Actual compiler error'], limitations: ['No semantic typecheck'],
  });
  assert.equal(readPilotCheckReport({ checks: [{ ...check, passed: 'passed' }] }), null);
  assert.equal(readPilotCheckReport({ checks: [null] }), null);
  assert.equal(readPilotCheckReport({ message: 'All checks passed' }), null);
});

test('pilot API retains owner/same-origin boundaries and defaults a strict request to Briefboard', () => {
  const source = readFileSync(new URL('../src/app/api/generator/pilot/route.ts', import.meta.url), 'utf8');
  assert.equal((source.match(/await requireOwnerAdmin\(req\)/g) || []).length, 3);
  assert.equal((source.match(/sameOrigin\(req\);/g) || []).length, 2);
  assert.match(source, /requestId: z\.string\(\)\.uuid\(\), benchmark: z\.enum\(PILOT_BENCHMARKS\)\.default\('briefboard'\)/);
  assert.match(source, /\.strict\(\)\.parse\(await boundedBody\(req\)\)/);
  assert.match(source, /enforceRateLimit\(access, 'generator:pilot:create', 6, 60\)/);
  assert.ok(source.indexOf('if (await getPilotRun(contract.identity.missionId, access.userId))') < source.indexOf('const runtime = await inspectRuntimeForBenchmark[body.benchmark]()'));
  assert.match(source, /run\.accepted && snapshots\.find/);
  assert.match(source, /item\.candidate\.sourceHash === run\.accepted\?\.sourceHash/);
});

test('pilot UI submits only the clicked benchmark and guards the legacy static preview', () => {
  const source = readFileSync(new URL('../src/components/admin/GeneratorPilotStudio.tsx', import.meta.url), 'utf8');
  assert.match(source, /benchmark: requestedBenchmark/);
  assert.match(source, /requestIds\.current\[requestedBenchmark\]/);
  assert.match(source, /onClick=\{\(\) => void start\(\)\}/);
  assert.match(source, /detail\.delivery && selectedBenchmark === 'briefboard' && preview\?\.kind === 'browser-local'/);
  assert.match(source, /Fixed technical benchmarks exercise real builds/);
  assert.match(source, /file\.path\.endsWith\('\.sql'\)/);
});

test('database preview startup is explicit, source-bound and separate from browser-storage bridging', () => {
  const source = readFileSync(new URL('../src/components/admin/GeneratorPilotStudio.tsx', import.meta.url), 'utf8');
  const databaseComponent = source.slice(source.indexOf('function PrivateboardPreview('), source.indexOf('function PilotLivePreview('));
  assert.match(databaseComponent, /fetch\('\/api\/generator\/pilot\/preview', \{ method: 'POST'/);
  assert.match(databaseComponent, /JSON\.stringify\(\{ runId, sourceHash \}\)/);
  assert.match(databaseComponent, /data\.sourceHash !== sourceHash/);
  assert.match(databaseComponent, /privateboardPreviewUrl\(data\.url, window\.location\.origin\)/);
  assert.match(databaseComponent, /onClick=\{\(\) => void startPreview\(\)\}/);
  assert.match(databaseComponent, /pending\.current\?\.abort\(\)/);
  assert.match(databaseComponent, /pending\.current !== controller \|\| controller\.signal\.aborted/);
  assert.match(databaseComponent, /target="_blank" rel="noopener noreferrer"/);
  assert.match(databaseComponent, /sandbox=\{PRIVATEBOARD_PREVIEW_SANDBOX\}/);
  assert.match(databaseComponent, /src=\{currentSession\.url\}/);
  assert.doesNotMatch(databaseComponent, /srcDoc|localStorage|pilotPreviewDocument/);
  assert.match(source, /key=\{privateboardCandidateKey\(detail\.run\.runId, detail\.delivery\)\}/);
});

test('successful polling clears only the matching refresh failure, not a real action failure', () => {
  let state = pilotUiErrors(INITIAL_PILOT_UI_ERRORS, { type: 'select-run', runId: 'run-a' });
  state = pilotUiErrors(state, { type: 'runs-result', error: 'Temporary list failure' });
  state = pilotUiErrors(state, { type: 'detail-result', runId: 'run-a', error: 'Temporary progress failure' });
  state = pilotUiErrors(state, { type: 'action-result', error: 'Stop request was denied' });
  state = pilotUiErrors(state, { type: 'runs-result', error: '' });
  assert.equal(state.runs, ''); assert.equal(state.detail, 'Temporary progress failure'); assert.equal(state.action, 'Stop request was denied');
  state = pilotUiErrors(state, { type: 'detail-result', runId: 'run-a', error: '' });
  assert.equal(state.detail, ''); assert.equal(state.action, 'Stop request was denied');
  state = pilotUiErrors(state, { type: 'action-result', error: '' });
  assert.equal(state.action, '');
});

test('switching runs removes only the old run error and ignores late results from it', () => {
  let state = pilotUiErrors(INITIAL_PILOT_UI_ERRORS, { type: 'select-run', runId: 'run-a' });
  state = pilotUiErrors(state, { type: 'runs-result', error: 'List still unavailable' });
  state = pilotUiErrors(state, { type: 'detail-result', runId: 'run-a', error: 'Old run unavailable' });
  state = pilotUiErrors(state, { type: 'select-run', runId: 'run-b' });
  assert.equal(state.detail, ''); assert.equal(state.runs, 'List still unavailable');
  state = pilotUiErrors(state, { type: 'detail-result', runId: 'run-b', error: 'Current run unavailable' });
  state = pilotUiErrors(state, { type: 'detail-result', runId: 'run-a', error: '' });
  assert.equal(state.detail, 'Current run unavailable');
  state = pilotUiErrors(state, { type: 'detail-result', runId: 'run-a', error: 'Late old failure' });
  assert.equal(state.detail, 'Current run unavailable');
});

test('UI explains explicit operator requests and resolves refresh errors at their own success paths', () => {
  const source = readFileSync(new URL('../src/components/admin/GeneratorPilotStudio.tsx', import.meta.url), 'utf8');
  assert.match(source, /reportError\(\{ type: 'runs-result', error: '' \}\)/);
  assert.match(source, /reportError\(\{ type: 'detail-result', runId: selected, error: '' \}\)/);
  assert.match(source, /Previous action notice/);
  assert.match(source, /explicit request through this button or an authorized operator command/);
  assert.match(source, /Opening this page never starts a test or provider call/);
  assert.doesNotMatch(source, /A paid test starts only when you click its button/);
});
