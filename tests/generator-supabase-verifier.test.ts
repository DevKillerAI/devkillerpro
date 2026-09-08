import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGeneratorSnapshot } from '../src/lib/server/generator/versionedEdits';
import { PRIVATEBOARD_RUNNER_IMAGE, createPrivateboardSourceExport, privateboardBaselineRowsHash,
  privateboardCompilerExitIsSourceFailure, validatePrivateboardBaseline, validatePrivateboardMigrationEvidence, validatePrivateboardSource, verifyPrivateboardPilot,
  type PrivateboardMigrationBaseline } from '../src/lib/server/generator/supabasePilotVerifier';
import { applySupabasePilotMigrations, ensureSupabasePilotEnvironment, readSupabasePilotEnvironment, supabasePilotScopeHash,
  type SupabasePilotEnvironment, type SupabasePilotMigrationEvidence } from '../src/lib/server/generator/supabasePilotEnvironment';

const exec = promisify(execFile);
const semantics = createRequire(import.meta.url)('../scripts/generator-v2-supabase-runner/run.cjs');
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const scope = { ownerId: 'unit-owner', projectId: 'unit-privateboard', missionId: 'unit-mission', environmentId: 'unit-env' };
// Deliberately nonfunctional rendering/SQL fixtures, never a hand-authored generated pilot.
const fixture = (app = 'export default function App(){return <main>Negative compiler fixture</main>}', css = 'body{margin:0}') =>
  createGeneratorSnapshot({ scope, revision: 'r1', files: [
    { path: 'src/App.tsx', content: app }, { path: 'src/styles.css', content: css },
    { path: 'supabase/migrations/001_init.sql', content: '-- Negative fixture: not a working app migration.\nCREATE TABLE app.incomplete_fixture (id integer);' },
  ] });
function environment(): SupabasePilotEnvironment {
  const scopeHash = supabasePilotScopeHash(scope), stackId = 'dk_v2_' + scopeHash.slice(0, 32);
  // Public-key-shaped negative fixture, not a real provisioned key.
  const anonKey = 'sb_publishable_' + Buffer.from(scopeHash, 'hex').toString('base64url');
  return { identity: scope, scopeHash, stackId, network: 'dk-v2-' + scopeHash.slice(0, 32), previewNetwork: 'dk-v2-' + scopeHash.slice(0, 32) + '-preview',
    dbContainer: 'supabase_db_' + stackId, apiUrl: 'http://127.0.0.1:55555',
    internalApiUrl: 'http://dk-v2-api-' + scopeHash.slice(0, 32) + ':8000', anonKey, schema: 'app', storageKey: 'dk-v2-auth-' + scopeHash };
}
function baseline(): PrivateboardMigrationBaseline {
  const ownerId = randomUUID(), rows = [1, 2].map(index => ({ id: randomUUID(), owner_id: ownerId,
    title: 'Preserved fixture ' + index, done: index === 1, request_id: randomUUID(), created_at: '2026-09-03T00:00:00.000Z' }));
  return { environmentScopeHash: environment().scopeHash, sourceHash: fixture().hash, email: 'dk-fixture-123@example.test',
    password: 'Only-A-Test-Password!', ownerId, rows, rowsHash: privateboardBaselineRowsHash(rows) };
}
test('Privateboard source surface rejects extra executable/config files and changed snapshot bytes', () => {
  const source = fixture();
  assert.equal(validatePrivateboardSource(source).hash, source.hash);
  for (const extraPath of ['package.json', 'server.js', 'supabase/config.toml', 'src/another.ts']) {
    assert.throws(() => validatePrivateboardSource(createGeneratorSnapshot({ scope, revision: 'r1', files: [...source.files, { path: extraPath, content: '{}' }] })));
  }
  assert.throws(() => validatePrivateboardSource({ ...source, hash: '0'.repeat(64) }));
  assert.throws(() => validatePrivateboardSource({ ...source, files: source.files.map((file, index) => index ? file : { ...file, hash: '0'.repeat(64) }) }));
});
test('compiler signal/OOM/exec/missing-runtime exits never become generated-source repair evidence', () => {
  assert.equal(privateboardCompilerExitIsSourceFailure(1), true);
  for (const code of [0, 2, 70, 125, 126, 127, 137, 139, 143, undefined, 'ENOENT', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'])
    assert.equal(privateboardCompilerExitIsSourceFailure(code), false);
  assert.equal(privateboardCompilerExitIsSourceFailure(1, true), false);
});
test('Privateboard export preserves exact source and migration bytes without runtime settings', () => {
  const source = fixture(), exported = createPrivateboardSourceExport(source), restored = JSON.parse(exported.content);
  assert.deepEqual(restored.scope, scope);
  assert.equal(createGeneratorSnapshot(restored).hash, source.hash);
  assert.deepEqual(restored.files, source.files.map(({ path: filePath, content }) => ({ path: filePath, content })));
  assert.equal(exported.hash, sha(exported.content));
  for (const value of [environment().anonKey, environment().internalApiUrl, 'migrationBaseline', 'password']) assert.ok(!exported.content.includes(value));
});
test('upgrade fixture is exact-row-hashed, environment-bound and rejects corrupt or duplicated baseline rows', () => {
  const valid = baseline();
  assert.equal(validatePrivateboardBaseline(valid, valid.environmentScopeHash), valid);
  assert.equal(privateboardBaselineRowsHash([...valid.rows].reverse()), valid.rowsHash);
  for (const invalid of [
    { ...valid, environmentScopeHash: '0'.repeat(64) },
    { ...valid, rows: valid.rows.map((row, index) => index ? row : { ...row, title: 'Mutated' }) },
    { ...valid, rows: [valid.rows[0], valid.rows[0]] },
    { ...valid, ownerId: randomUUID() },
    { ...valid, rowsHash: '1'.repeat(64) },
  ]) assert.throws(() => validatePrivateboardBaseline(invalid, valid.environmentScopeHash));
});
test('migration evidence binds exact ordered migration bytes and environment, not a claimed status', () => {
  const source = fixture(), env = environment();
  const expected = source.files.filter(file => file.path.startsWith('supabase/')).map(({ path: filePath, hash }) => ({ path: filePath, hash }));
  const valid: SupabasePilotMigrationEvidence = { scopeHash: env.scopeHash, fingerprint: sha(JSON.stringify(expected)),
    files: expected.map(file => ({ ...file, appliedAt: '2026-09-03T00:00:00.000Z', reused: false })), appliedAt: '2026-09-03T00:00:00.000Z' };
  assert.doesNotThrow(() => validatePrivateboardMigrationEvidence(source, env, valid));
  assert.throws(() => validatePrivateboardMigrationEvidence(source, env, { ...valid, scopeHash: '0'.repeat(64) }));
  assert.throws(() => validatePrivateboardMigrationEvidence(source, env, { ...valid, files: [] }));
  assert.throws(() => validatePrivateboardMigrationEvidence(source, env, { ...valid, files: valid.files.map(file => ({ ...file, hash: '0'.repeat(64) })) }));
});
test('verifier rejects scope, output path, comparison reuse and foreign baseline before running Docker', async () => {
  const snapshot = fixture(), env = environment();
  await assert.rejects(() => verifyPrivateboardPilot({ snapshot, environment: env, outputDirectory: 'C:/Windows' }), /outside this candidate/);
  await assert.rejects(() => verifyPrivateboardPilot({ snapshot, environment: env,
    expectedEnvironmentIdentity: { ...scope, ownerId: 'other-owner' } }), /outside this candidate/);
  await assert.rejects(() => verifyPrivateboardPilot({ snapshot, environment: env,
    comparisonEnvironment: env, expectedComparisonEnvironmentIdentity: scope }), /independent environments/);
  await assert.rejects(() => verifyPrivateboardPilot({ snapshot, environment: env,
    migrationBaseline: { ...baseline(), environmentScopeHash: '0'.repeat(64) } }), /another environment/);
});

test('ambiguous-write evidence permits confirmed recovery but rejects duplicate IDs, invented success and discarded unknown drafts', () => {
  const ownerId = randomUUID(), requestId = randomUUID(), row = { id: randomUUID(), owner_id: ownerId, request_id: requestId, title: 'Evidence fixture' };
  const good = { ownerId, title: row.title, attempts: [{ requestId, upstreamStatus: 201, responseLost: true, responseRows: [row] }],
    readbacks: [{ status: 200, rows: [row] }], storedRows: [row], baselineRequestIds: [],
    forceUnknown: false, initialOutcome: 'server-recovered', blockedReadbacks: 0, renderedCount: 1, finalDraft: '', finalError: false };
  assert.match(semantics.validateAmbiguousWriteEvidence(good), /Response-loss recovery/);
  const retry = { ...good, forceUnknown: true, initialOutcome: 'retry-required', preservedDraft: row.title, errorVisible: true,
    blockedReadbacks: 1, attempts: [...good.attempts, { requestId, upstreamStatus: 409, responseLost: false, responseRows: [] }] };
  assert.match(semantics.validateAmbiguousWriteEvidence(retry), /Readback-blocked retry/);
  for (const bad of [
    { ...retry, attempts: [...good.attempts, { requestId: randomUUID(), upstreamStatus: 201, responseLost: false, responseRows: [row] }] },
    { ...retry, preservedDraft: '' }, { ...retry, initialOutcome: 'server-recovered' },
    { ...good, readbacks: [] }, { ...good, storedRows: [row, { ...row, id: randomUUID() }] },
    { ...good, storedRows: [{ ...row, owner_id: randomUUID() }] }, { ...good, baselineRequestIds: [requestId] },
    { ...good, renderedCount: 2 }, { ...good, finalDraft: row.title },
  ]) assert.throws(() => semantics.validateAmbiguousWriteEvidence(bad));
});

test('captured-fixture cleanup preserves original failures and cannot delete preexisting or foreign-owner rows', async () => {
  const original = baseline(), account = { ownerId: original.ownerId }, captured = randomUUID(), calls: string[] = [];
  const primary = new Error('Original browser semantic failure');
  let cleanupError: Error | undefined;
  await assert.rejects(() => semantics.withCapturedTaskCleanup({ account, requestIds: new Set([captured]), baselineRows: original.rows,
    api: { tasks: async (_account: unknown, method: string, _body: unknown, query: string) => {
      calls.push(method + query); return { ok: false, data: null };
    } },
    work: async () => { throw primary; }, cleanupFailure: (error: Error) => { cleanupError = error; },
  }), error => error === primary);
  assert.ok(cleanupError); assert.equal(calls.length, 1); assert.ok(!calls.some(call => call.startsWith('DELETE')));
  calls.length = 0;
  await semantics.withCapturedTaskCleanup({ account, requestIds: new Set([original.rows[0].request_id]), baselineRows: original.rows,
    api: { tasks: async (_account: unknown, method?: string) => { calls.push(method ?? 'GET'); return { ok: true, data: original.rows }; } },
    work: async () => 'Preserve the baseline',
  });
  assert.deepEqual(calls, ['GET']);
  await assert.rejects(() => semantics.withCapturedTaskCleanup({ account, requestIds: new Set([captured]), baselineRows: original.rows,
    api: { tasks: async (_account: unknown, method: string) => {
      assert.notEqual(method, 'DELETE'); return { ok: true, data: [{ id: randomUUID(), owner_id: randomUUID(), request_id: captured }] };
    } }, work: async () => undefined,
  }), (error: Error & { infrastructureUnavailable?: boolean }) => error.infrastructureUnavailable === true);
});

const integration = process.env.DEVKILLER_V2_SUPABASE_RUNTIME_INTEGRATION === '1';
test('offline pinned compiler parses negative fixture and binds SQL bytes without executing generated Node', { skip: !integration }, async () => {
  const source = fixture("import {createClient} from '@supabase/supabase-js'; export default function App(){return <main data-sdk={typeof createClient}>Negative compiler fixture</main>}");
  await compileFixture(source, async (output, completed) => {
    assert.equal(completed, true);
    const metadata = JSON.parse(await readFile(path.join(output, 'build.json'), 'utf8'));
    assert.equal(metadata.dependencies['@supabase/supabase-js'], '2.112.4');
    assert.equal(metadata.semanticTypecheck, false);
    assert.equal(Object.keys(metadata.sourceFileHashes).length, 3);
    for (const file of source.files) assert.equal(metadata.sourceFileHashes[file.path], file.hash);
    const index = await readFile(path.join(output, 'index.html'), 'utf8');
    assert.match(index, /runtime-config\.js/);
    assert.ok(!index.includes('anonKey'));
  });
});
test('offline compiler rejects Node imports, generated dynamic imports and remote CSS assets', { skip: !integration }, async () => {
  for (const source of [
    fixture("import fs from 'node:fs'; export default function App(){return <p>{fs.readFileSync('/etc/passwd','utf8')}</p>}"),
    fixture("import('react'); export default function App(){return <p>Negative fixture</p>}"),
    fixture("const fs = require('fs'); export default function App(){return <p>{fs.existsSync('/etc/passwd')}</p>}"),
    fixture(undefined, "body{background-image:url('https://example.com/tracker')}"),
    fixture('export default function App(){return <main>broken }'),
  ]) await compileFixture(source, async (_output, completed) => assert.equal(completed, false));
});
test('trusted human-preview server exposes exact build/public settings and rejects privileged or unrelated routes', { skip: !integration }, async () => {
  await compileFixture(fixture(), async (output, completed) => {
    assert.equal(completed, true);
    const config = path.join(path.dirname(output), 'config'), name = 'dk-privateboard-serve-negative-' + randomUUID(), env = environment();
    await mkdir(config);
    await writeFile(path.join(config, 'runtime.json'), JSON.stringify({
      internalApiUrl: env.internalApiUrl, anonKey: env.anonKey, schema: 'app', storageKey: env.storageKey,
    }));
    try {
      await exec('docker', ['run', '-d', '--pull=never', '--name', name, '--network=none', '--read-only',
        '--user=1000:1000', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=128m', '--cpus=1', '--pids-limit=32',
        '--mount', 'type=bind,source=' + output + ',target=/candidate,readonly',
        '--mount', 'type=bind,source=' + config + ',target=/config,readonly', PRIVATEBOARD_RUNNER_IMAGE, 'serve'],
      { windowsHide: true, timeout: 15000 });
      const probe = "Promise.all(['/', '/runtime-config.js', '/supabase/auth/v1/admin/users', '/supabase/rest/v1/other', '/etc/passwd'].map(async p=>{const r=await fetch('http://127.0.0.1:3000'+p);return {path:p,status:r.status,body:await r.text(),csp:r.headers.get('content-security-policy')}})).then(r=>console.log(JSON.stringify(r)))";
      const outputProbe = await exec('docker', ['exec', name, 'node', '-e', probe], { windowsHide: true, timeout: 15000 });
      const responses = JSON.parse(outputProbe.stdout) as { path: string; status: number; body: string; csp: string | null }[];
      assert.equal(responses[0].body, await readFile(path.join(output, 'index.html'), 'utf8'));
      assert.match(responses[0].csp ?? '', /frame-ancestors http:\/\/localhost:3000 http:\/\/127\.0\.0\.1:3000/);
      assert.match(responses[0].csp ?? '', /worker-src 'none'/);
      assert.equal(responses[1].status, 200);
      assert.ok(responses[1].body.includes(env.storageKey));
      assert.ok(responses[1].body.includes(env.anonKey));
      assert.ok(!responses[1].body.includes(env.internalApiUrl));
      assert.ok(!responses[1].body.includes('migrationBaseline'));
      assert.deepEqual(responses.slice(2).map(response => response.status), [403, 403, 404]);
      // With networking disabled, these must be rejected locally, not sent upstream.
      const deniedFormats = "Promise.all(['text/csv','text/html','application/geo+json','application/vnd.pgrst.plan+json','application/vnd.pgrst.plan+text','application/json, application/vnd.pgrst.plan+json','application/vnd.pgrst.object+json;unexpected=1'].map(async accept=>{const r=await fetch('http://127.0.0.1:3000/supabase/rest/v1/tasks',{method:'PATCH',headers:{accept,'content-type':'application/json'},body:'{}'});return {status:r.status,body:await r.json()}})).then(r=>console.log(JSON.stringify(r)))";
      const deniedProbe = await exec('docker', ['exec', name, 'node', '-e', deniedFormats], { windowsHide: true, timeout: 15000 });
      for (const response of JSON.parse(deniedProbe.stdout)) {
        assert.equal(response.status, 406);
        assert.equal(response.body.code, 'DK_API_ACCEPT_NOT_ALLOWED');
      }
    } finally { await exec('docker', ['rm', '-f', name], { windowsHide: true, timeout: 15000 }).catch(() => undefined); }
  });
});
const liveProtocolIdentity = process.env.DEVKILLER_V2_SUPABASE_PROTOCOL_SMOKE_IDENTITY;
test('real Docker SDK single/maybeSingle preserve JSON cardinality through the preview bridge without broadening its API surface',
  { skip: !liveProtocolIdentity, timeout: 150000 }, async () => {
    const identity = JSON.parse(liveProtocolIdentity!);
    // Only the explicitly test-owned, previously migrated negative-control environment.
    // This does not provision, migrate, restart or inspect any generated pilot.
    assert.equal(identity.ownerId, 'v2-infrastructure-qa');
    assert.equal(identity.projectId, 'local-security-proof');
    assert.equal(identity.environmentId, 'verifier-negative');
    const env = await readSupabasePilotEnvironment(identity);
    const sdkOnlyFixture = fixture("import {createClient} from '@supabase/supabase-js'; (window as unknown as {__TRUSTED_QA_CREATE_CLIENT__: typeof createClient}).__TRUSTED_QA_CREATE_CLIENT__ = createClient; export default function App(){return <main>Trusted SDK test fixture only — not a generated app</main>}");
    await compileFixture(sdkOnlyFixture, async (output, completed) => {
      assert.equal(completed, true);
      const config = path.join(path.dirname(output), 'protocol-config'), name = 'dk-privateboard-protocol-qa-' + randomUUID();
      await mkdir(config);
      await writeFile(path.join(config, 'runtime.json'), JSON.stringify({
        internalApiUrl: env.internalApiUrl, anonKey: env.anonKey, schema: 'app', storageKey: env.storageKey,
      }), { mode: 0o600 });
      // Trusted test driver, executed by Node only inside the isolated QA container.
      // No candidate source is executed in Node and no fixture secret is printed.
      const probe = String.raw`
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createClient } = require('/opt/generator-v2-supabase/node_modules/@supabase/supabase-js');
const config = JSON.parse(require('node:fs').readFileSync('/config/runtime.json','utf8'));
const origin = 'http://127.0.0.1:3000', checks = [], secrets = [];
const client = createClient(origin + '/supabase', config.anonKey, {
  db: { schema: 'app' }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
let ownerId;
const tasks = () => client.schema('app').from('tasks');
const singleObject = (result, label, title) => {
  assert.equal(result.error, null, label + ' returned an error');
  assert.ok(result.data && !Array.isArray(result.data) && typeof result.data.id === 'string',
    label + ' must return one object, received ' + (Array.isArray(result.data) ? 'array' : typeof result.data));
  assert.equal(result.data.title, title, label + ' lost the title');
  checks.push(label);
  return result.data;
};
(async () => {
  try {
    const deadline = Date.now() + 5000;
    while (true) {
      try { assert.equal((await fetch(origin)).status, 200); break; }
      catch (error) { if (Date.now() >= deadline) throw error; await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    const email = 'dk-protocol-' + randomUUID() + '@example.test', password = 'Dk!Protocol' + randomUUID() + '9a';
    secrets.push(email, password);
    const auth = await client.auth.signUp({ email, password });
    assert.equal(auth.error, null, 'QA signup through the same preview bridge failed');
    assert.ok(auth.data.session && auth.data.user, 'QA signup must yield a real session');
    secrets.push(auth.data.session.access_token, auth.data.session.refresh_token);
    ownerId = auth.data.user.id;
    checks.push('real-sdk-auth');
    const first = singleObject(await tasks().insert({ title: 'SDK single fixture', request_id: randomUUID() }).select().single(),
      'insert.single', 'SDK single fixture');
    singleObject(await tasks().select().eq('id', first.id).single(), 'select.single', 'SDK single fixture');
    singleObject(await tasks().select().eq('id', first.id).maybeSingle(), 'select.maybeSingle', 'SDK single fixture');
    const absent = await tasks().select().eq('id', randomUUID()).maybeSingle();
    assert.equal(absent.error, null); assert.equal(absent.data, null); checks.push('select.maybeSingle.zero');
    singleObject(await tasks().insert({ title: 'SDK maybe fixture', request_id: randomUUID() }).select().maybeSingle(),
      'insert.maybeSingle', 'SDK maybe fixture');
    singleObject(await tasks().update({ title: 'SDK edited fixture' }).eq('id', first.id).select().single(),
      'update.single', 'SDK edited fixture');
    singleObject(await tasks().update({ done: true }).eq('id', first.id).select().maybeSingle(),
      'update.maybeSingle', 'SDK edited fixture');
    for (const [label, query] of [
      ['select.single.zero', tasks().select().eq('id', randomUUID()).single()],
      ['select.single.many', tasks().select().eq('owner_id', ownerId).single()],
      ['select.maybeSingle.many', tasks().select().eq('owner_id', ownerId).maybeSingle()],
    ]) {
      const result = await query;
      assert.equal(result.status, 406, label + ' must reject incorrect cardinality');
      assert.ok(result.error && result.data === null, label + ' must not expose an incorrectly shaped success');
      checks.push(label);
    }
    const headers = { apikey: config.anonKey, authorization: 'Bearer ' + auth.data.session.access_token,
      'accept-profile': 'app' };
    const rowUrl = origin + '/supabase/rest/v1/tasks?id=eq.' + first.id;
    for (const accept of ['*/*', 'application/json', 'application/vnd.pgrst.array+json',
      'application/vnd.pgrst.array+json;nulls=stripped']) {
      const response = await fetch(rowUrl, { headers: { ...headers, accept } });
      assert.equal(response.status, 200, accept);
      const rows = await response.json();
      assert.ok(Array.isArray(rows) && rows.length === 1 && rows[0].id === first.id, accept);
      checks.push('array-format:' + accept);
    }
    for (const accept of ['application/vnd.pgrst.object+json', 'application/vnd.pgrst.object+json;nulls=stripped']) {
      const response = await fetch(rowUrl, { headers: { ...headers, accept } });
      assert.equal(response.status, 200, accept);
      const row = await response.json();
      assert.ok(!Array.isArray(row) && row.id === first.id, accept);
      checks.push('object-format:' + accept);
    }
    for (const accept of ['text/html', 'text/csv', 'application/octet-stream', 'text/xml', 'application/geo+json',
      'application/vnd.pgrst.plan+json', 'application/vnd.pgrst.plan+text',
      'application/vnd.pgrst.plan+json;for="application/json";options=analyze|verbose',
      'application/json, text/html', 'application/json, application/vnd.pgrst.plan+json', 'application/json;q=1',
      'application/vnd.pgrst.object+json;unexpected=1', 'application/json;' + 'x'.repeat(256)]) {
      const response = await fetch(rowUrl, { headers: { ...headers, accept } });
      assert.equal(response.status, 406, 'Unsupported Accept escaped the bridge: ' + accept);
      assert.equal((await response.json()).code, 'DK_API_ACCEPT_NOT_ALLOWED');
      checks.push('blocked-format:' + accept);
    }
    const rejectedMutation = await fetch(rowUrl, { method: 'PATCH', headers: { ...headers,
      'content-profile': 'app', 'content-type': 'application/json', accept: 'text/csv',
    }, body: JSON.stringify({ title: 'This denied write must never execute' }) });
    assert.equal(rejectedMutation.status, 406);
    assert.equal((await rejectedMutation.json()).code, 'DK_API_ACCEPT_NOT_ALLOWED');
    checks.push('blocked-format-mutation');
    for (const [method, pathname] of [
      ['GET', '/auth/v1/admin/users'], ['POST', '/rest/v1/rpc/admin_function'],
      ['GET', '/rest/v1/other'], ['GET', '/storage/v1/bucket'], ['PUT', '/rest/v1/tasks'],
    ]) {
      const response = await fetch(origin + '/supabase' + pathname, { method, headers: {
        ...headers, accept: 'application/vnd.pgrst.object+json',
      } });
      assert.equal(response.status, 403, method + ' ' + pathname);
      checks.push('blocked-route:' + method + pathname);
    }
    const intact = await tasks().select('id,title,done').eq('owner_id', ownerId);
    assert.equal(intact.error, null); assert.equal(intact.data.length, 2);
    assert.ok(intact.data.some(row => row.id === first.id && row.title === 'SDK edited fixture' && row.done));
    checks.push('denial-probes-preserved-owned-rows');
    // Small, explicitly trusted browser fixtures. These are not generated app
    // source and are never counted as a completed Privateboard application.
    const { chromium } = require('/runner/node_modules/playwright');
    const { verifyCompletionControl, verifyDeletionControl, createAmbiguousCaseDriver, waitForTruth } =
      require('/opt/generator-v2-supabase/run.cjs');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block' }), page = await context.newPage();
    page.setDefaultTimeout(2500);
    const account = { ownerId };
    const api = { tasks: async (providedAccount, method = 'GET', body, query = '') => {
      assert.equal(providedAccount.ownerId, ownerId);
      const response = await fetch(origin + '/supabase/rest/v1/tasks' + query, { method, headers: {
        ...headers, 'content-profile': 'app', 'content-type': 'application/json', prefer: 'return=representation',
        accept: 'application/json',
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await response.text();
      return { ok: response.ok, status: response.status, data: text ? JSON.parse(text) : null };
    } };
    const readAll = async () => {
      const response = await api.tasks(account); assert.ok(response.ok); return response.data;
    };
    const readExact = async id => (await readAll()).find(row => row.id === id);
    try {
      await page.goto(origin);
      const toggleTask = singleObject(await tasks().insert({ title: 'Trusted asynchronous checkbox fixture', request_id: randomUUID() }).select().single(),
        'browser-fixture.create', 'Trusted asynchronous checkbox fixture');
      const installToggle = async mode => page.evaluate(({ mode, id, key, token }) => {
        document.body.innerHTML = '<h1>Trusted checkbox fixture, not a generated app</h1><input type="checkbox" data-testid="fixture-toggle">';
        const input = document.querySelector('input');
        input.addEventListener('click', event => {
          event.preventDefault();
          if (mode === 'no-op') return;
          setTimeout(async () => {
            const response = await fetch('/supabase/rest/v1/tasks?id=eq.' + id, { method: 'PATCH',
              headers: { apikey: key, authorization: 'Bearer ' + token, 'content-profile': 'app',
                'accept-profile': 'app', 'content-type': 'application/json', prefer: 'return=representation',
                accept: 'application/vnd.pgrst.object+json' }, body: '{"done":true}' });
            if (response.ok) input.checked = (await response.json()).done;
          }, 120);
        });
      }, { mode, id: toggleTask.id, key: config.anonKey, token: auth.data.session.access_token });
      await installToggle('async');
      await verifyCompletionControl(page.getByTestId('fixture-toggle'), toggleTask, readExact);
      checks.push('real-browser.delayed-server-checkbox');
      await tasks().update({ done: false }).eq('id', toggleTask.id);
      await installToggle('no-op');
      await assert.rejects(() => verifyCompletionControl(page.getByTestId('fixture-toggle'),
        { ...toggleTask, done: false }, readExact, 350), /Completion did not/);
      assert.equal((await readExact(toggleTask.id)).done, false);
      checks.push('real-browser.no-op-toggle-rejected');
      await page.evaluate(() => { document.querySelector('input').type = 'button'; });
      await assert.rejects(() => verifyCompletionControl(page.getByTestId('fixture-toggle'),
        { ...toggleTask, done: false }, readExact, 350), /native checkbox/);
      checks.push('real-browser.non-native-toggle-rejected');
      const installDelete = async persisted => page.evaluate(({ id, key, token, persisted }) => {
        document.body.innerHTML = '<h1>Trusted deletion fixture, not a generated app</h1><div data-testid="fixture-row">Target</div><button data-testid="fixture-delete">Delete</button>';
        document.querySelector('button').addEventListener('click', async () => {
          if (persisted) {
            await new Promise(resolve => setTimeout(resolve, 120));
            const response = await fetch('/supabase/rest/v1/tasks?id=eq.' + id, { method: 'DELETE',
              headers: { apikey: key, authorization: 'Bearer ' + token, 'content-profile': 'app' } });
            if (!response.ok) return;
          }
          document.querySelector('[data-testid="fixture-row"]').remove();
        });
      }, { id: toggleTask.id, key: config.anonKey, token: auth.data.session.access_token, persisted });
      await installDelete(false);
      await assert.rejects(async () => verifyDeletionControl(page.getByTestId('fixture-delete'), toggleTask, await readAll(),
        () => page.getByTestId('fixture-row').count(), readAll, 350), /Deletion did not/);
      assert.ok(await readExact(toggleTask.id));
      checks.push('real-browser.ui-only-delete-rejected');
      await installDelete(true);
      await verifyDeletionControl(page.getByTestId('fixture-delete'), toggleTask, await readAll(),
        () => page.getByTestId('fixture-row').count(), readAll);
      assert.equal(await readExact(toggleTask.id), undefined);
      checks.push('real-browser.delayed-persisted-delete');
      const installCreation = async mode => page.evaluate(async ({ key, token, refresh, mode }) => {
        document.body.innerHTML = '<h1>Trusted recovery fixture, not a generated app</h1><input data-testid="item-title"><button data-testid="add-item">Add</button><button data-testid="filter-all">All</button><p data-testid="app-error" hidden>Error</p><div id="fixture-list"></div>';
        const input = document.querySelector('input'), add = document.querySelector('[data-testid="add-item"]');
        const error = document.querySelector('[data-testid="app-error"]'), list = document.querySelector('#fixture-list');
        // The compiler-bundled SDK is the exact pinned browser SDK, not a mock.
        const sdk = window.__TRUSTED_QA_CREATE_CLIENT__(location.origin + '/supabase', key, {
          db: { schema: 'app' }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        const session = await sdk.auth.setSession({ access_token: token, refresh_token: refresh });
        if (session.error) throw new Error('Trusted browser SDK fixture could not set its real QA session');
        const table = () => sdk.schema('app').from('tasks');
        let pending, busy = false, rows = [];
        const render = () => {
          list.replaceChildren();
          for (const row of rows) {
            const item = document.createElement('div'), title = document.createElement('span');
            item.dataset.testid = 'item-row'; title.dataset.testid = 'item-title-text'; title.textContent = row.title;
            item.append(title); list.append(item);
          }
        };
        const load = async () => {
          const response = await table().select('*');
          if (!response.error) { rows = response.data; render(); }
        };
        document.querySelector('[data-testid="filter-all"]').addEventListener('click', load);
        input.addEventListener('input', () => { pending = null; });
        add.addEventListener('click', async () => {
          const title = input.value.trim(); if (!title || busy) return;
          const requestId = mode === 'changed-retry' ? crypto.randomUUID() : pending || crypto.randomUUID();
          busy = true; add.disabled = true; error.hidden = true;
          try {
            const response = await table().insert({ title, request_id: requestId }).select().single();
            let row;
            if (!response.error) row = response.data;
            else if (mode === 'invented-success') row = { id: crypto.randomUUID(), title, request_id: requestId };
            else if (mode !== 'discarded-draft') {
              const readback = await table().select('*').eq('request_id', requestId).maybeSingle();
              if (!readback.error) row = readback.data;
            }
            if (row) {
              if (!rows.some(old => old.id === row.id)) rows.push(row);
              render(); input.value = ''; pending = null;
            } else {
              pending = requestId; error.hidden = false;
              if (mode === 'discarded-draft') input.value = '';
            }
          } finally { busy = false; add.disabled = false; }
        });
        await load();
      }, { key: config.anonKey, token: auth.data.session.access_token, refresh: auth.data.session.refresh_token, mode });
      for (const [mode, forceUnknown, accepted] of [
        ['correct', false, true], ['correct', true, true], ['changed-retry', true, false],
        ['discarded-draft', true, false], ['invented-success', false, false],
      ]) {
        await installCreation(mode);
        const byId = id => page.getByTestId(id);
        const rowWith = title => byId('item-row').filter({ has: byId('item-title-text').filter({ hasText: title }) });
        const until = (predicate, message) => waitForTruth(predicate, message, 6500);
        const report = { unavailable: false, checks: [] };
        const oneCase = createAmbiguousCaseDriver({ origin, api, currentSession: account, main: { context }, byId, rowWith,
          add: async title => { await byId('item-title').fill(title); await byId('add-item').click(); }, until,
          count: n => until(async () => await byId('item-row').count() === n, 'Fixture count did not restore'),
          page: { reload: () => installCreation(mode) }, report,
          record: (id, passed, details) => report.checks.push({ id, passed, details }),
        });
        const beforeIds = (await readAll()).map(row => row.id).sort();
        if (accepted) assert.match(await oneCase(forceUnknown), /independent API confirmed exactly one/);
        else await assert.rejects(() => oneCase(forceUnknown));
        assert.equal(report.unavailable, false, JSON.stringify(report));
        assert.deepEqual((await readAll()).map(row => row.id).sort(), beforeIds, 'Browser regression leaked or removed a fixture row');
        checks.push('real-browser.' + mode + '.' + (forceUnknown ? 'readback-blocked' : 'readback-available') + '.' + (accepted ? 'accepted' : 'rejected'));
      }
    } finally { await context.close(); await browser.close(); }
  } finally {
    if (ownerId) {
      const cleanup = await tasks().delete().eq('owner_id', ownerId);
      assert.equal(cleanup.error, null, 'Only this QA account fixture cleanup must succeed');
      await client.auth.signOut();
    }
  }
  console.log(JSON.stringify({ passed: true, checks }));
})().catch(error => {
  let message = String(error.message || error);
  for (const value of secrets) if (value) message = message.split(value).join('[redacted]');
  console.log(JSON.stringify({ passed: false, error: message, checks }));
  process.exitCode = 1;
});`;
      try {
        await exec('docker', ['run', '-d', '--pull=never', '--name', name, '--network=' + env.network, '--read-only',
          '--user=1000:1000', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=768m', '--cpus=1', '--pids-limit=128',
          '--shm-size=128m', '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m',
          '--mount', 'type=bind,source=' + output + ',target=/candidate,readonly',
          '--mount', 'type=bind,source=' + config + ',target=/config,readonly', PRIVATEBOARD_RUNNER_IMAGE, 'serve'],
        { windowsHide: true, timeout: 15000 });
        const result = await exec('docker', ['exec', name, 'node', '-e', probe],
          { windowsHide: true, timeout: 120000, maxBuffer: 100000 }).catch(error => ({ stdout: error.stdout, stderr: error.stderr }));
        const report = JSON.parse(result.stdout);
        assert.equal(report.passed, true, JSON.stringify(report));
        assert.ok(report.checks.includes('insert.single'));
        assert.ok(report.checks.includes('insert.maybeSingle'));
        assert.ok(report.checks.includes('select.maybeSingle.zero'));
        assert.ok(report.checks.includes('denial-probes-preserved-owned-rows'));
      } finally { await exec('docker', ['rm', '-f', name], { windowsHide: true, timeout: 15000 }).catch(() => undefined); }
    });
  });

test('an unavailable isolated auth service is infrastructure evidence, never a successful auth or source proof', { skip: !integration }, async () => {
  await compileFixture(fixture(), async (compiled, completed) => {
    assert.equal(completed, true);
    const work = path.dirname(compiled), output = path.join(work, 'api-evidence'), config = path.join(work, 'api-config');
    const name = 'dk-privateboard-api-unavailable-' + randomUUID(), env = environment();
    await mkdir(output); await mkdir(config);
    await writeFile(path.join(config, 'runtime.json'), JSON.stringify({
      internalApiUrl: env.internalApiUrl, anonKey: env.anonKey, schema: 'app', storageKey: env.storageKey,
    }));
    try {
      await exec('docker', ['run', '--pull=never', '--name', name, '--network=none', '--read-only', '--user=1000:1000',
        '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=128m', '--cpus=1', '--pids-limit=32',
        '--mount', 'type=bind,source=' + compiled + ',target=/candidate,readonly',
        '--mount', 'type=bind,source=' + config + ',target=/config,readonly',
        '--mount', 'type=bind,source=' + output + ',target=/output', PRIVATEBOARD_RUNNER_IMAGE, 'api'],
      { windowsHide: true, timeout: 30000, maxBuffer: 100000 }).catch(error => assert.equal(error.code, 1));
      const report = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8'));
      assert.equal(report.unavailable, true);
      assert.ok(report.checks.every((check: { passed: boolean }) => !check.passed));
      assert.ok(report.failures.some((failure: string) => failure.includes('unreachable')));
      assert.ok(!JSON.stringify(report).includes('password'));
    } finally { await exec('docker', ['rm', '-f', name], { windowsHide: true, timeout: 15000 }).catch(() => undefined); }
  });
});
test('hosted SDK preflight failure stops before candidate browser checks and is unavailable infrastructure evidence',
  { skip: !integration }, async () => {
    await compileFixture(fixture(), async (compiled, completed) => {
      assert.equal(completed, true);
      const work = path.dirname(compiled), output = path.join(work, 'preflight-evidence'), config = path.join(work, 'preflight-config');
      const name = 'dk-privateboard-preflight-unavailable-' + randomUUID(), env = environment(), privateFixture = baseline();
      await mkdir(output); await mkdir(config);
      await writeFile(path.join(config, 'runtime.json'), JSON.stringify({
        internalApiUrl: env.internalApiUrl, anonKey: env.anonKey, schema: 'app', storageKey: env.storageKey,
        migrationBaseline: privateFixture,
      }), { mode: 0o600 });
      try {
        await exec('docker', ['run', '--pull=never', '--name', name, '--network=none', '--read-only', '--user=1000:1000',
          '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=256m', '--cpus=1', '--pids-limit=48',
          '--mount', 'type=bind,source=' + compiled + ',target=/candidate,readonly',
          '--mount', 'type=bind,source=' + config + ',target=/config,readonly',
          '--mount', 'type=bind,source=' + output + ',target=/output', PRIVATEBOARD_RUNNER_IMAGE, 'browser'],
        { windowsHide: true, timeout: 30000, maxBuffer: 100000 }).catch(error => assert.equal(error.code, 1));
        const report = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8'));
        assert.equal(report.unavailable, true);
        assert.deepEqual(report.checks.map((check: { id: string; passed: boolean }) => [check.id, check.passed]),
          [['harness:supabase-sdk-protocol', false]]);
        assert.equal(report.browserVersion, undefined);
        assert.deepEqual(report.screenshots, []);
        assert.ok(!JSON.stringify(report).includes(privateFixture.password));
      } finally { await exec('docker', ['rm', '-f', name], { windowsHide: true, timeout: 15000 }).catch(() => undefined); }
    });
  });
const liveAuthIdentity = process.env.DEVKILLER_V2_SUPABASE_AUTH_SMOKE_IDENTITY;
test('real isolated GoTrue signs in two trusted test users and invalidates a signed-out refresh token', { skip: !liveAuthIdentity }, async () => {
  const env = await readSupabasePilotEnvironment(JSON.parse(liveAuthIdentity!));
  const work = await mkdtemp(path.join(tmpdir(), 'dk-privateboard-auth-smoke-')), output = path.join(work, 'output'), config = path.join(work, 'config');
  const name = 'dk-privateboard-auth-smoke-' + randomUUID();
  try {
    await mkdir(output); await mkdir(config);
    await writeFile(path.join(config, 'runtime.json'), JSON.stringify({
      internalApiUrl: env.internalApiUrl, anonKey: env.anonKey, schema: 'app', storageKey: env.storageKey,
    }), { mode: 0o600 });
    await exec('docker', ['run', '--pull=never', '--name', name, '--network=' + env.network, '--read-only', '--user=1000:1000',
      '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=256m', '--cpus=1', '--pids-limit=32',
      '--mount', 'type=bind,source=' + config + ',target=/config,readonly',
      '--mount', 'type=bind,source=' + output + ',target=/output', PRIVATEBOARD_RUNNER_IMAGE, 'api'],
    { windowsHide: true, timeout: 120000, maxBuffer: 100000 }).catch(error => assert.equal(error.code, 1));
    const report = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8'));
    assert.ok(!report.unavailable, JSON.stringify(report));
    for (const id of ['platform:auth-two-users', 'platform:auth-session-lifecycle'])
      assert.ok(report.checks.some((check: { id: string; passed: boolean }) => check.id === id && check.passed), JSON.stringify(report));
    // This optional smoke checks platform Auth only. It never labels an absent business schema or hand-authored fixture a generated app success.
  } finally {
    await exec('docker', ['rm', '-f', name], { windowsHide: true, timeout: 15000 }).catch(() => undefined);
    const owned = path.resolve(work), temporaryRoot = path.resolve(tmpdir());
    assert.ok(owned.startsWith(temporaryRoot + path.sep) && path.basename(owned).startsWith('dk-privateboard-auth-smoke-'));
    await rm(owned, { recursive: true, force: true });
  }
});
const liveDatabaseIdentity = process.env.DEVKILLER_V2_SUPABASE_DATABASE_SMOKE_IDENTITY;
test('negative UI control passes real database/RLS/restart/upgrade harness but can never pass browser acceptance', { skip: !liveDatabaseIdentity, timeout: 360000 }, async () => {
  const identity = JSON.parse(liveDatabaseIdentity!);
  assert.equal(identity.ownerId, 'v2-infrastructure-qa');
  assert.equal(identity.projectId, 'local-security-proof');
  assert.equal(identity.environmentId, 'verifier-negative');
  const env = await ensureSupabasePilotEnvironment(identity);
  // Platform QA fixture only. This SQL is paired with a deliberately nonfunctional UI,
  // never presented as model-generated app source or counted as generated-app success.
  const sql = "-- TRUSTED NEGATIVE CONTROL SQL. NOT MODEL-GENERATED APP SOURCE.\n" +
    "CREATE TABLE app.tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id), title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200), done boolean NOT NULL DEFAULT false, request_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,request_id));\n" +
    "ALTER TABLE app.tasks ENABLE ROW LEVEL SECURITY;\nALTER TABLE app.tasks FORCE ROW LEVEL SECURITY;\n" +
    "GRANT SELECT,INSERT,UPDATE,DELETE ON app.tasks TO authenticated;\n" +
    "CREATE POLICY own_select ON app.tasks FOR SELECT TO authenticated USING(owner_id=auth.uid());\n" +
    "CREATE POLICY own_insert ON app.tasks FOR INSERT TO authenticated WITH CHECK(owner_id=auth.uid());\n" +
    "CREATE POLICY own_update ON app.tasks FOR UPDATE TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());\n" +
    "CREATE POLICY own_delete ON app.tasks FOR DELETE TO authenticated USING(owner_id=auth.uid());";
  const snapshot = createGeneratorSnapshot({ scope: identity, revision: 'negative-control-initial', files: [
    { path: 'src/App.tsx', content: 'export default function App(){return <main><h1>Negative verifier control: deliberately no application controls</h1></main>}' },
    { path: 'src/styles.css', content: 'body{margin:0;padding:16px;font-family:system-ui}' },
    { path: 'supabase/migrations/001_init.sql', content: sql },
  ] });
  const migrations = await applySupabasePilotMigrations(env, [...snapshot.files]);
  const initial = await verifyPrivateboardPilot({ snapshot, environment: env, migrations });
  assert.equal(initial.status, 'failed', JSON.stringify({ ...initial, compiledFiles: undefined, sourceExport: undefined, migrationBaseline: undefined }));
  for (const id of ['platform:build', 'platform:migration-fresh', 'platform:database-rls-schema', 'platform:auth-two-users',
    'platform:authorization-anonymous', 'platform:authorization-cross-owner', 'platform:database-validation',
    'platform:database-concurrency', 'platform:auth-session-lifecycle', 'platform:persistence', 'requirement:persistence:server-restart'])
    assert.ok(initial.checks.some(check => check.id === id && check.passed), JSON.stringify({ id, checks: initial.checks, failures: initial.failures, limitations: initial.limitations }));
  assert.ok(initial.checks.some(check => check.id === 'platform:browser-core' && !check.passed));
  assert.ok(initial.migrationBaseline);
  assert.ok(initial.environment.databaseRestart);
  const upgraded = createGeneratorSnapshot({ scope: identity, revision: 'negative-control-upgrade', files: [...snapshot.files, {
    path: 'supabase/migrations/002_priority.sql',
    content: '-- TRUSTED NEGATIVE CONTROL UPGRADE. NOT MODEL-GENERATED APP SOURCE.\nALTER TABLE app.tasks ADD COLUMN priority smallint NOT NULL DEFAULT 0 CHECK(priority IN (0,1,2));',
  }] });
  const upgradeMigrations = await applySupabasePilotMigrations(env, [...upgraded.files]);
  const upgrade = await verifyPrivateboardPilot({ snapshot: upgraded, environment: env, migrations: upgradeMigrations, migrationBaseline: initial.migrationBaseline });
  assert.equal(upgrade.status, 'failed', JSON.stringify({ checks: upgrade.checks, failures: upgrade.failures, limitations: upgrade.limitations }));
  for (const id of ['platform:migration-upgrade', 'requirement:persistence:server-restart'])
    assert.ok(upgrade.checks.some(check => check.id === id && check.passed), JSON.stringify({ id, checks: upgrade.checks, failures: upgrade.failures, limitations: upgrade.limitations }));
  assert.equal(upgrade.migrationBaseline?.rowsHash, initial.migrationBaseline?.rowsHash);
  assert.ok(upgrade.checks.some(check => check.id === 'platform:browser-core' && !check.passed));
});
async function compileFixture(snapshot: ReturnType<typeof fixture>, check: (output: string, completed: boolean) => Promise<void>) {
  const work = await mkdtemp(path.join(tmpdir(), 'dk-privateboard-negative-')), name = 'dk-privateboard-negative-' + randomUUID();
  const source = path.join(work, 'source'), output = path.join(work, 'output');
  try {
    await mkdir(output);
    for (const file of snapshot.files) { await mkdir(path.dirname(path.join(source, file.path)), { recursive: true }); await writeFile(path.join(source, file.path), file.content); }
    let completed = true;
    await exec('docker', ['run', '--pull=never', '--name', name, '--network=none', '--read-only', '--user=1000:1000', '--cap-drop=ALL',
      '--security-opt=no-new-privileges', '--memory=768m', '--cpus=1', '--pids-limit=128', '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m',
      '--mount', 'type=bind,source=' + source + ',target=/candidate,readonly',
      '--mount', 'type=bind,source=' + output + ',target=/output', PRIVATEBOARD_RUNNER_IMAGE, 'compile'],
    { windowsHide: true, timeout: 45000, maxBuffer: 100000 }).catch(() => { completed = false; });
    await check(output, completed);
  } finally {
    await exec('docker', ['rm', '-f', name], { windowsHide: true, timeout: 15000 }).catch(() => undefined);
    const owned = path.resolve(work), temporaryRoot = path.resolve(tmpdir());
    assert.ok(owned.startsWith(temporaryRoot + path.sep) && path.basename(owned).startsWith('dk-privateboard-negative-'));
    await rm(owned, { recursive: true, force: true });
  }
}
