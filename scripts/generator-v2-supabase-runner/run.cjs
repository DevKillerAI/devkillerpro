'use strict';
// Reviewed platform code. Candidate TSX is only parsed/bundled here, never evaluated by Node.
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const ROOT = '/candidate', OUTPUT = '/output';
const DIGEST = value => crypto.createHash('sha256').update(value).digest('hex');
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'none'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; frame-ancestors http://localhost:3000 http://127.0.0.1:3000";
const INDEX = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Privateboard</title><link rel="stylesheet" href="/assets/app.css"><script src="/runtime-config.js"></script><script src="/assets/app.js" defer></script></head><body><div id="root"></div></body></html>';
const ENTRY = "import React from 'react'; import {createRoot} from 'react-dom/client'; import App from '/candidate/src/App.tsx'; import '/candidate/src/styles.css'; createRoot(document.getElementById('root')).render(<App/>);";
const BASE_COLUMNS = ['id', 'owner_id', 'title', 'done', 'request_id', 'created_at'];
const PRIVATE_VALUES = new Set();
const rememberPrivate = (...values) => values.filter(value => typeof value === 'string' && value.length >= 8).forEach(value => PRIVATE_VALUES.add(value));
const VERIFY = (condition, message) => { if (!condition) throw new Error(message); };
const unavailable = message => { const error = new Error(message); error.infrastructureUnavailable = true; return error; };
const taskBase = row => Object.fromEntries(BASE_COLUMNS.map(key => [key, row[key]]));
const rowsHash = rows => DIGEST(JSON.stringify(rows.map(taskBase).sort((a, b) => a.id.localeCompare(b.id))));
const safeError = error => {
  let message = String(error.message || error);
  for (const value of PRIVATE_VALUES) message = message.replaceAll(value, '[redacted verifier credential]');
  return message.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted token]').slice(0, 1400);
};
const isUuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
async function waitForTruth(predicate, message, timeoutMs = 6500) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error(message);
}
async function verifyCompletionControl(control, original, readTask, timeoutMs = 6500) {
  VERIFY(await control.getAttribute('type') === 'checkbox', 'Completion control must be a native checkbox.');
  VERIFY(original && isUuid(original.id) && original.done === false, 'Toggle proof needs the exact initially open persisted task.');
  // A server-authoritative controlled input may restore its old value until the
  // asynchronous write finishes. Playwright.check() asserts too early for it.
  await control.click();
  await waitForTruth(async () => {
    if (!await control.isChecked()) return false;
    const persisted = await readTask(original.id);
    return persisted?.id === original.id && persisted.owner_id === original.owner_id && persisted.done === true;
  }, 'Completion did not become checked and persist on the exact owned database task.', timeoutMs);
  return 'One native-checkbox click reached checked state and independent API readback confirmed done=true on the exact owned task.';
}
async function verifyDeletionControl(control, target, originalRows, isVisible, readTasks, timeoutMs = 6500) {
  VERIFY(target && originalRows.some(row => row.id === target.id) && isUuid(target.id), 'Deletion proof needs the exact persisted target.');
  const expected = originalRows.filter(row => row.id !== target.id);
  await control.click();
  await waitForTruth(async () => {
    if (await isVisible()) return false;
    const persisted = await readTasks();
    return Array.isArray(persisted) && rowsHash(persisted) === rowsHash(expected);
  }, 'Deletion did not remove the exact owned task from both UI and database while preserving the other rows.', timeoutMs);
  return 'The selected task disappeared from the UI and independent API readback confirmed only that exact owned row was removed.';
}
function validateAmbiguousWriteEvidence(evidence) {
  const first = evidence.attempts[0], row = evidence.storedRows?.[0];
  VERIFY(first && isUuid(first.requestId) && first.upstreamStatus >= 200 && first.upstreamStatus < 300 && first.responseLost,
    'The ambiguous-write fixture did not first commit successfully before its response was lost.');
  VERIFY(!evidence.baselineRequestIds.includes(first.requestId), 'A new logical creation reused an existing task request_id.');
  VERIFY(evidence.attempts.every(attempt => attempt.requestId === first.requestId),
    'Retry generated a different request_id for the same ambiguous logical creation.');
  VERIFY(evidence.storedRows.length === 1 && row.owner_id === evidence.ownerId && row.request_id === first.requestId &&
    row.title === evidence.title && isUuid(row.id), 'Independent API readback did not confirm exactly one matching owned task.');
  const matching = observed => observed.status >= 200 && observed.status < 300 && observed.rows.some(item =>
    item.id === row.id && item.owner_id === row.owner_id && item.request_id === row.request_id && item.title === row.title);
  VERIFY(evidence.readbacks.some(matching) || evidence.attempts.slice(1).some(attempt =>
    !attempt.responseLost && matching({ status: attempt.upstreamStatus, rows: attempt.responseRows })),
  'The browser claimed recovered success without an observed matching server response or authenticated readback.');
  if (evidence.forceUnknown || evidence.initialOutcome === 'retry-required') {
    VERIFY(evidence.initialOutcome === 'retry-required' && evidence.preservedDraft === evidence.title && evidence.errorVisible,
      'A genuinely unconfirmed write must show an error and preserve the retry draft.');
    VERIFY(evidence.attempts.length >= 2, 'The unconfirmed logical request was not retried.');
  }
  VERIFY(evidence.renderedCount === 1 && evidence.finalDraft === '' && !evidence.finalError,
    'Confirmed recovery did not render exactly one task and clear the settled creation draft/error.');
  return (evidence.forceUnknown ? 'Readback-blocked retry' : 'Response-loss recovery') +
    ': first upstream HTTP ' + first.upstreamStatus + ', ' + evidence.attempts.length + ' same-ID POST attempt(s), ' +
    evidence.readbacks.filter(matching).length + ' matching authenticated readback(s), ' + evidence.blockedReadbacks +
    ' intentionally blocked readback(s); independent API confirmed exactly one owned record.';
}
async function withCapturedTaskCleanup({ account, requestIds, baselineRows, api, work, beforeCleanup, afterCleanup, cleanupFailure }) {
  let value, primaryError;
  try { value = await work(); } catch (error) { primaryError = error; }
  try {
    if (beforeCleanup) await beforeCleanup();
    VERIFY(isUuid(account.ownerId), 'Fixture cleanup requires an exact verified account.');
    const baselineIds = new Set(baselineRows.map(row => row.id)), baselineRequests = new Set(baselineRows.map(row => row.request_id));
    for (const requestId of requestIds) {
      VERIFY(isUuid(requestId), 'Refusing cleanup for a malformed captured request ID.');
      // Never delete a preexisting fixture, even if broken candidate code reuses its ID.
      if (baselineRequests.has(requestId)) continue;
      const query = '?owner_id=eq.' + account.ownerId + '&request_id=eq.' + requestId;
      const before = await api.tasks(account, 'GET', undefined, query);
      VERIFY(before.ok && Array.isArray(before.data) && before.data.every(row => row.owner_id === account.ownerId &&
        row.request_id === requestId && !baselineIds.has(row.id)), 'Cleanup readback escaped the exact captured owned fixture.');
      if (before.data.length) {
        const deleted = await api.tasks(account, 'DELETE', undefined, query);
        VERIFY(deleted.ok, 'The exact captured fixture could not be cleaned up.');
      }
      const remaining = await api.tasks(account, 'GET', undefined, query);
      VERIFY(remaining.ok && Array.isArray(remaining.data) && remaining.data.length === 0, 'A captured fixture survived cleanup.');
    }
    const restored = await api.tasks(account);
    VERIFY(restored.ok && Array.isArray(restored.data) && rowsHash(restored.data) === rowsHash(baselineRows),
      'Fixture cleanup did not restore the unchanged pre-case owned row set.');
    if (afterCleanup) await afterCleanup();
  } catch (error) {
    if (cleanupFailure) cleanupFailure(error);
    if (!primaryError) primaryError = unavailable('Verifier fixture cleanup failed: ' + safeError(error));
  }
  if (primaryError) throw primaryError;
  return value;
}

function newReport() {
  return { version: 1, checks: [], failures: [], limitations: [], screenshots: [], executedAt: new Date().toISOString() };
}
function recorder(report) {
  const record = (id, passed, details) => {
    report.checks.push({ id, passed, details });
    if (!passed) report.failures.push(id + ': ' + details);
  };
  return { record, run: async (id, work) => {
    try { record(id, true, await work() || 'Executed successfully.'); return true; }
    catch (error) {
      if (error.infrastructureUnavailable) report.unavailable = true;
      record(id, false, safeError(error)); return false;
    }
  } };
}
async function readConfig() {
  const stat = await fs.lstat('/config/runtime.json');
  VERIFY(stat.isFile() && !stat.isSymbolicLink() && stat.size < 256 * 1024, 'Invalid trusted runtime configuration.');
  const config = JSON.parse(await fs.readFile('/config/runtime.json', 'utf8'));
  rememberPrivate(config.migrationBaseline?.password, config.foreignSession?.accessToken, config.foreignSession?.refreshToken);
  const url = new URL(config.internalApiUrl);
  VERIFY(url.protocol === 'http:' && !url.username && !url.password && url.pathname === '/' &&
    /^dk-v2-api-[a-f0-9]{32}$/.test(url.hostname) && url.port === '8000', 'Runtime URL must name the scoped local Supabase gateway.');
  VERIFY(typeof config.anonKey === 'string' && config.anonKey.length < 4096 && typeof config.storageKey === 'string' &&
    /^[a-zA-Z0-9_-]{1,180}$/.test(config.storageKey) && config.schema === 'app', 'Invalid public runtime settings.');
  return config;
}
async function writeReport(report) {
  report.executedAt = new Date().toISOString();
  await fs.writeFile(path.join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  if (report.failures.length) process.exitCode = 1;
}
async function compile() {
  const esbuild = require('esbuild'), sourceFileHashes = {};
  for (const file of ['src/App.tsx', 'src/styles.css', 'supabase/migrations/001_init.sql', 'supabase/migrations/002_priority.sql']) {
    const full = path.join(ROOT, file);
    const stat = await fs.lstat(full).catch(error => error.code === 'ENOENT' && file.endsWith('002_priority.sql') ? null : Promise.reject(error));
    if (!stat) continue;
    VERIFY(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 128 * 1024, 'Unsupported source file.');
    sourceFileHashes[file] = DIGEST(await fs.readFile(full));
  }
  const build = await esbuild.build({
    stdin: { contents: ENTRY, loader: 'tsx', sourcefile: 'platform-entry.tsx', resolveDir: '/opt/generator-v2-supabase' },
    bundle: true, packages: 'bundle', platform: 'browser', format: 'iife', target: ['es2022'],
    jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
    nodePaths: ['/opt/generator-v2-supabase/node_modules'], outfile: '/virtual/assets/app.js',
    write: false, metafile: true, minify: true, legalComments: 'none', sourcemap: false,
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', target: 'ES2022', useDefineForClassFields: true } },
    plugins: [{ name: 'platform-import-boundary', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (!args.importer.startsWith(ROOT + '/')) return undefined;
        if (['dynamic-import', 'url-token', 'import-rule', 'require-call', 'require-resolve'].includes(args.kind)) {
          return { errors: [{ text: 'Dynamic imports, CommonJS calls and CSS assets are outside the pilot contract.' }] };
        }
        if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@supabase/supabase-js'].includes(args.path)) {
          return { path: require.resolve(args.path, { paths: ['/opt/generator-v2-supabase'] }) };
        }
        if (args.path === './styles.css' && args.importer === ROOT + '/src/App.tsx') return { path: ROOT + '/src/styles.css' };
        return { errors: [{ text: 'Candidate imports are limited to React, the pinned Supabase SDK and ./styles.css.' }] };
      });
    } }],
  });
  const files = [{ path: 'index.html', content: INDEX }];
  for (const built of build.outputFiles) {
    const name = path.posix.basename(built.path);
    VERIFY(['app.js', 'app.css'].includes(name) && built.contents.length < 2 * 1024 * 1024, 'Unexpected compiler output.');
    files.push({ path: 'assets/' + name, content: built.text });
  }
  if (!files.some(file => file.path === 'assets/app.css')) files.push({ path: 'assets/app.css', content: '' });
  for (const file of files) {
    await fs.mkdir(path.dirname(path.join(OUTPUT, file.path)), { recursive: true });
    await fs.writeFile(path.join(OUTPUT, file.path), file.content, { flag: 'wx' });
  }
  await fs.writeFile(path.join(OUTPUT, 'build.json'), JSON.stringify({
    version: 1, compiler: 'esbuild', semanticTypecheck: false, sourceFileHashes,
    dependencies: { react: require('react/package.json').version, 'react-dom': require('react-dom/package.json').version,
      esbuild: esbuild.version, '@supabase/supabase-js': require('@supabase/supabase-js/package.json').version },
    artifacts: files.map(file => ({ path: file.path, hash: DIGEST(file.content), bytes: Buffer.byteLength(file.content) })),
    warnings: build.warnings.map(warning => warning.text).slice(0, 20),
  }), { flag: 'wx' });
}

function apiClient(config) {
  const request = async (route, { token, method = 'GET', body, schema = false } = {}) => {
    const response = await fetch(config.internalApiUrl.replace(/\/$/, '') + route, {
      method, signal: AbortSignal.timeout(12000), headers: {
        apikey: config.anonKey, Authorization: 'Bearer ' + (token || config.anonKey),
        ...(schema ? { 'Accept-Profile': 'app', 'Content-Profile': 'app', Prefer: 'return=representation' } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }).catch(() => { throw unavailable('The isolated Supabase service is unreachable.'); });
    if (response.status >= 500 || response.status === 429)
      throw unavailable('The isolated Supabase service returned a server or rate-limit error (HTTP ' + response.status + ').');
    const text = await response.text();
    VERIFY(text.length < 256 * 1024, 'API response exceeds the evidence safety limit.');
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { status: response.status, ok: response.ok, data };
  };
  const login = async credentials => {
    rememberPrivate(credentials.password);
    const response = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: credentials.email, password: credentials.password } });
    if (!response.ok || !response.data?.access_token || !response.data?.refresh_token || !response.data?.user?.id)
      throw unavailable('The fixed verifier account could not obtain a real session (HTTP ' + response.status + '); generated source cannot repair GoTrue authentication.');
    rememberPrivate(response.data.access_token, response.data.refresh_token);
    return { email: credentials.email, password: credentials.password, ownerId: response.data.user.id,
      accessToken: response.data.access_token, refreshToken: response.data.refresh_token };
  };
  const signup = async label => {
    const credentials = { email: 'dk-' + label + '-' + crypto.randomUUID() + '@example.test', password: 'Dk!' + crypto.randomUUID() + '9a' };
    rememberPrivate(credentials.password);
    const response = await request('/auth/v1/signup', { method: 'POST', body: credentials });
    if (!response.ok || !response.data?.user?.id)
      throw unavailable('The fixed verifier signup did not create a local test account (HTTP ' + response.status + '); generated source cannot repair GoTrue provisioning.');
    return login(credentials);
  };
  const tasks = (account, method = 'GET', body, query = '') => request('/rest/v1/tasks' + query, { token: account?.accessToken, method, body, schema: true });
  return { request, signup, login, tasks };
}

async function apiChecks() {
  const config = await readConfig(), report = newReport(), { run, record } = recorder(report);
  const api = apiClient(config);
  let first, second, baseline;
  try {
    const auth = await run('platform:auth-two-users', async () => {
      first = config.migrationBaseline ? await api.login(config.migrationBaseline) : await api.signup('owner-a');
      second = await api.signup('owner-b');
      VERIFY(first.ownerId !== second.ownerId, 'Two credentials unexpectedly refer to the same user.');
      const badLogin = await api.request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: first.email, password: 'not-the-password' } });
      VERIFY([400, 401, 403].includes(badLogin.status) && !badLogin.data?.access_token, 'Invalid password produced an authenticated session.');
      return 'Two independent users signed in through real GoTrue email/password endpoints; invalid password was rejected.';
    });
    if (auth) {
      if (config.migrationBaseline) {
        await run(config.verifyUpgrade ? 'platform:migration-upgrade' : 'platform:baseline-preserved', async () => {
          const previous = config.migrationBaseline;
          VERIFY(previous.ownerId === first.ownerId && Array.isArray(previous.rows) && previous.rows.length >= 2 &&
            previous.rowsHash === rowsHash(previous.rows), 'The pre-upgrade fixture is invalid.');
          const response = await api.tasks(first, 'GET', undefined, '?select=*&order=id');
          VERIFY(response.ok && Array.isArray(response.data), 'Upgraded task table is not readable.');
          const restored = response.data.filter(row => previous.rows.some(old => old.id === row.id));
          VERIFY(restored.length === previous.rows.length && rowsHash(restored) === previous.rowsHash,
            'The migration deleted or changed previously persisted task data.');
          if (config.verifyUpgrade) {
            VERIFY(restored.every(row => Object.hasOwn(row, 'priority') && Number.isInteger(row.priority) && row.priority === 0),
              'The upgrade did not add integer priority default 0 to all existing rows.');
            // Never mutate the immutable baseline, even temporarily: a killed verifier must remain replayable.
            const probe = await api.tasks(first, 'POST', { title: 'Disposable priority probe', request_id: crypto.randomUUID() });
            VERIFY(probe.ok && probe.data?.length === 1 && probe.data[0].priority === 0, 'New tasks do not receive priority default 0.');
            const probeId = probe.data[0].id;
            try {
              const changed = await api.tasks(first, 'PATCH', { priority: 1 }, '?id=eq.' + probeId);
              VERIFY(changed.ok && changed.data?.length === 1 && changed.data[0].priority === 1, 'An owner cannot update the new priority field.');
              for (const priority of [-1, 3, null]) {
                const badPriority = await api.tasks(first, 'PATCH', { priority }, '?id=eq.' + probeId);
                VERIFY([400, 409, 422].includes(badPriority.status), 'The priority migration accepted a null or out-of-range value.');
              }
            } finally { await api.tasks(first, 'DELETE', undefined, '?id=eq.' + probeId); }
          }
          baseline = { ...previous, rows: previous.rows.map(taskBase) };
          return config.verifyUpgrade ? 'Upgrade added default-0 owner-writable priority with enforced 0/1/2 range; every pre-upgrade task ID and original field is unchanged.' :
            'Pre-upgrade persisted fixture remains unchanged during the initial-source recheck; no upgrade is claimed.';
        });
      }
      if (!config.verifyUpgrade) {
        report.limitations.push('Migration upgrade was not executed in this initial verification; an additive 002 migration and preserved baseline are still required.');
      }
      let protectedRow;
      const ownCrud = await run('platform:persistence', async () => {
        const created = await api.tasks(first, 'POST', { title: 'Persisted API fixture ' + crypto.randomUUID(), request_id: crypto.randomUUID() });
        VERIFY(created.ok && created.data?.length === 1, 'Owner task creation failed.');
        protectedRow = created.data[0];
        VERIFY(protectedRow.owner_id === first.ownerId && protectedRow.id && protectedRow.created_at, 'Database defaults did not bind identity and stable task fields.');
        const edited = await api.tasks(first, 'PATCH', { title: 'Preserved owner fixture', done: true }, '?id=eq.' + protectedRow.id);
        VERIFY(edited.ok && edited.data?.length === 1 && edited.data[0].done === true && edited.data[0].title === 'Preserved owner fixture', 'Owner task edit failed.');
        protectedRow = edited.data[0];
        const reread = await api.tasks(await api.login(first), 'GET', undefined, '?id=eq.' + protectedRow.id);
        VERIFY(reread.ok && reread.data?.length === 1 && rowsHash(reread.data) === rowsHash([protectedRow]),
          'A fresh real session did not retrieve the same persisted task.');
        const temporary = await api.tasks(first, 'POST', { title: 'Deletion fixture', request_id: crypto.randomUUID() });
        VERIFY(temporary.ok && temporary.data?.length === 1, 'Delete fixture creation failed.');
        const deleted = await api.tasks(first, 'DELETE', undefined, '?id=eq.' + temporary.data[0].id);
        const missing = await api.tasks(first, 'GET', undefined, '?id=eq.' + temporary.data[0].id);
        VERIFY(deleted.ok && deleted.data?.length === 1 && missing.ok && missing.data?.length === 0, 'Owner delete did not persist.');
        return 'Owner create/update/delete reached Postgres; a newly authenticated session reread the same persisted record.';
      });
      if (ownCrud) {
        const preserved = async () => {
          const response = await api.tasks(first, 'GET', undefined, '?id=eq.' + protectedRow.id);
          VERIFY(response.ok && response.data?.length === 1 && rowsHash(response.data) === rowsHash([protectedRow]), 'A forbidden request changed the original owner record.');
        };
        await run('platform:authorization-anonymous', async () => {
          const read = await api.tasks(undefined, 'GET', undefined, '?id=eq.' + protectedRow.id);
          VERIFY(([401, 403].includes(read.status)) || (read.ok && Array.isArray(read.data) && read.data.length === 0), 'Anonymous access exposed a private task.');
          const create = await api.tasks(undefined, 'POST', { title: 'Anonymous forbidden', owner_id: first.ownerId, request_id: crypto.randomUUID() });
          VERIFY([400, 401, 403].includes(create.status), 'Anonymous task creation was not rejected.');
          for (const method of ['PATCH', 'DELETE']) {
            const denied = await api.tasks(undefined, method, method === 'PATCH' ? { title: 'Anonymous tamper' } : undefined, '?id=eq.' + protectedRow.id);
            VERIFY([401, 403].includes(denied.status) || (denied.ok && Array.isArray(denied.data) && denied.data.length === 0),
              'Anonymous ' + method + ' affected a private task.');
          }
          await preserved();
          return 'Anonymous select/insert/update/delete cannot expose or change an authenticated owner record.';
        });
        await run('platform:authorization-cross-owner', async () => {
          const read = await api.tasks(second, 'GET', undefined, '?id=eq.' + protectedRow.id);
          VERIFY(read.ok && Array.isArray(read.data) && read.data.length === 0, 'User B can read user A task.');
          for (const method of ['PATCH', 'DELETE']) {
            const denied = await api.tasks(second, method, method === 'PATCH' ? { title: 'Cross-owner tamper' } : undefined, '?id=eq.' + protectedRow.id);
            VERIFY([401, 403].includes(denied.status) || (denied.ok && Array.isArray(denied.data) && denied.data.length === 0), 'User B can change user A task.');
          }
          const forged = await api.tasks(second, 'POST', { title: 'Forged owner', owner_id: first.ownerId, request_id: crypto.randomUUID() });
          VERIFY([401, 403].includes(forged.status), 'A client can insert a task for a different owner.');
          const transferred = await api.tasks(first, 'PATCH', { owner_id: second.ownerId }, '?id=eq.' + protectedRow.id);
          VERIFY([400, 401, 403].includes(transferred.status) || (transferred.ok && transferred.data?.length === 0), 'A client can transfer task ownership.');
          await preserved();
          return 'User B read/update/delete, forged-owner insert and owner transfer were rejected; the original row remains unchanged.';
        });
        await run('platform:database-validation', async () => {
          for (const title of ['', '   ', null, 'a'.repeat(201)]) {
            const bad = await api.tasks(first, 'POST', { title, request_id: crypto.randomUUID() });
            VERIFY([400, 409, 422].includes(bad.status), 'Postgres accepted a null, blank or over-200-character title.');
          }
          const blankEdit = await api.tasks(first, 'PATCH', { title: '   ' }, '?id=eq.' + protectedRow.id);
          VERIFY([400, 409, 422].includes(blankEdit.status), 'Postgres accepted a whitespace-only edited title.');
          await preserved();
          return 'Required-title validation is enforced by the database for writes, not only by browser controls.';
        });
        await run('platform:database-concurrency', async () => {
          const requestId = crypto.randomUUID();
          const body = { title: 'Concurrent request fixture', request_id: requestId };
          const responses = await Promise.all([api.tasks(first, 'POST', body), api.tasks(first, 'POST', body)]);
          VERIFY(responses.filter(response => response.ok).length === 1 &&
            responses.filter(response => response.status === 409).length === 1, 'Concurrent identical request IDs did not produce one success and one uniqueness rejection.');
          const selected = await api.tasks(first, 'GET', undefined, '?request_id=eq.' + requestId);
          VERIFY(selected.ok && selected.data?.length === 1, 'Concurrent retry created more or fewer than one persisted row.');
          const secondOwner = await api.tasks(second, 'POST', body);
          VERIFY(secondOwner.ok && secondOwner.data?.length === 1 && secondOwner.data[0].owner_id === second.ownerId,
            'Request uniqueness is not scoped per owner.');
          if (!baseline && !config.migrationBaseline) {
            const rows = [protectedRow, selected.data[0]].map(taskBase);
            baseline = { email: first.email, password: first.password, ownerId: first.ownerId, rows, rowsHash: rowsHash(rows) };
          }
          return 'Two simultaneous writes with one request ID persist exactly one row; a different owner can independently use that request ID.';
        });
      }
      await run('platform:auth-session-lifecycle', async () => {
        const invalid = await api.request('/rest/v1/tasks', { token: 'invalid.jwt.value', schema: true });
        VERIFY([401, 403].includes(invalid.status), 'An invalid access token was accepted.');
        const session = await api.login(second);
        const logout = await api.request('/auth/v1/logout?scope=global', { token: session.accessToken, method: 'POST' });
        if (!logout.ok) throw unavailable('The fixed verifier real auth logout endpoint failed (HTTP ' + logout.status + ').');
        const refresh = await api.request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refreshToken } });
        VERIFY(!refresh.ok && [400, 401, 403].includes(refresh.status) && !refresh.data?.access_token, 'A signed-out refresh token still created a session.');
        const currentJwt = await api.request('/rest/v1/tasks', { token: session.accessToken, schema: true });
        const observation = currentJwt.ok ? 'Previously issued access JWT remains usable until expiration (normal stateless JWT behavior).' :
          'This environment also rejected the previously issued access JWT after logout.';
        report.limitations.push(observation + ' The verifier does not claim instant global access-token revocation.');
        return 'Invalid JWT rejected; real logout invalidated the refresh token. ' + observation;
      });
      await fs.writeFile(path.join(OUTPUT, 'private-state.json'), JSON.stringify({
        migrationBaseline: baseline, foreignSession: { accessToken: first.accessToken, refreshToken: first.refreshToken },
      }), { flag: 'wx' });
    }
  } catch (error) { record('harness:api', false, safeError(error)); }
  await writeReport(report);
}

async function crossAppChecks() {
  const config = await readConfig(), report = newReport(), { run } = recorder(report), api = apiClient(config);
  await run('platform:scope-isolation', async () => {
    VERIFY(config.foreignSession?.accessToken && config.foreignSession?.refreshToken, 'A real session from the other isolated app is required.');
    const owner = await api.signup('peer-owner');
    const created = await api.tasks(owner, 'POST', { title: 'Independent app B fixture', request_id: crypto.randomUUID() });
    VERIFY(created.ok && created.data?.length === 1 && created.data[0].owner_id === owner.ownerId, 'App B did not independently persist its own user record.');
    const user = await api.request('/auth/v1/user', { token: config.foreignSession.accessToken });
    VERIFY([401, 403].includes(user.status), 'App B accepted app A auth token.');
    const tasks = await api.request('/rest/v1/tasks', { token: config.foreignSession.accessToken, schema: true });
    VERIFY([401, 403].includes(tasks.status), 'App B accepted app A token for database access.');
    const refresh = await api.request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: config.foreignSession.refreshToken } });
    VERIFY(!refresh.ok && [400, 401, 403].includes(refresh.status) && !refresh.data?.access_token, 'App B accepted app A refresh token.');
    const read = await api.tasks(owner);
    VERIFY(read.ok && read.data?.length === 1 && read.data[0].id === created.data[0].id, 'App B owner data changed during foreign-session probes.');
    return 'App B independently signed in and persisted its own task; app A session was rejected by app B auth, database and refresh endpoints on a separate stack.';
  });
  await writeReport(report);
}

async function restartProof() {
  const config = await readConfig(), report = newReport(), { run } = recorder(report), api = apiClient(config);
  await run('requirement:persistence:server-restart', async () => {
    const receipt = config.restartReceipt, previous = config.migrationBaseline;
    const gatewayHash = new URL(config.internalApiUrl).hostname.slice('dk-v2-api-'.length);
    if (!receipt || receipt.databaseContainer !== 'supabase_db_dk_v2_' + gatewayHash ||
      !Number.isFinite(Date.parse(receipt.previousStartedAt)) || !Number.isFinite(Date.parse(receipt.startedAt)) ||
      Date.parse(receipt.startedAt) <= Date.parse(receipt.previousStartedAt))
      throw unavailable('A trusted exact-container stop/start receipt is required for restart proof.');
    VERIFY(previous && previous.rows?.length >= 2 && rowsHash(previous.rows) === previous.rowsHash, 'Restart proof needs an intact pre-restart fixture.');
    let session;
    const deadline = Date.now() + 30000;
    while (!session) {
      try { session = await api.login(previous); }
      catch (error) {
        if (!error.infrastructureUnavailable || Date.now() >= deadline) throw error;
        await new Promise(resolve => setTimeout(resolve, 750));
      }
    }
    const response = await api.tasks(session, 'GET', undefined, '?select=*&order=id');
    if (!response.ok) throw unavailable('The post-restart database API is not ready (HTTP ' + response.status + ').');
    VERIFY(Array.isArray(response.data), 'Post-restart tasks returned invalid data.');
    const restored = response.data.filter(row => previous.rows.some(old => old.id === row.id));
    VERIFY(restored.length === previous.rows.length && rowsHash(restored) === previous.rowsHash, 'Database restart changed or lost the immutable persisted fixture.');
    if (config.verifyUpgrade) VERIFY(restored.every(row => row.priority === 0), 'Database restart lost the upgraded priority defaults.');
    return 'The exact scoped Postgres container was stopped and started; a newly authenticated session retrieved every baseline task ID and original field unchanged.';
  });
  await writeReport(report);
}

// The browser receives only a same-origin API bridge and the public anon key. No internal
// hostname, privileged key, Docker socket, database password or harness credential reaches JS.
function allowProxyRoute(method, pathname) {
  return (pathname === '/rest/v1/tasks' && ['GET', 'POST', 'PATCH', 'DELETE', 'HEAD'].includes(method)) ||
    (['/auth/v1/signup', '/auth/v1/token', '/auth/v1/logout'].includes(pathname) && method === 'POST') ||
    (pathname === '/auth/v1/user' && ['GET', 'PUT'].includes(method));
}
function allowedJsonAccept(value) {
  // Preserve PostgREST cardinality: .single() requires the object media type.
  // No CSV, GeoJSON, execution plans, arbitrary parameters or mixed media lists.
  return value === undefined || (typeof value === 'string' && value.length <= 128 &&
    /^(?:\*\/\*|application\/json|application\/vnd\.pgrst\.(?:object|array)\+json(?:;nulls=stripped)?)$/i.test(value.trim()));
}
async function proxy(req, res, config, url, report) {
  const pathname = url.pathname.slice('/supabase'.length);
  if (!allowProxyRoute(req.method, pathname)) { res.writeHead(403); res.end('Outside application API surface'); return; }
  if (!allowedJsonAccept(req.headers.accept)) {
    res.writeHead(406, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify({ code: 'DK_API_ACCEPT_NOT_ALLOWED', message: 'Only the scoped SDK JSON response formats are supported.' }));
    return;
  }
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 64 * 1024) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
  const headers = {};
  for (const header of ['authorization', 'apikey', 'content-type', 'accept', 'accept-profile', 'content-profile', 'prefer', 'x-client-info', 'x-supabase-api-version']) {
    if (typeof req.headers[header] === 'string') headers[header] = req.headers[header];
  }
  const upstream = await fetch(config.internalApiUrl.replace(/\/$/, '') + pathname + url.search, {
    method: req.method, headers, redirect: 'error', signal: AbortSignal.timeout(12000),
    ...(!['GET', 'HEAD'].includes(req.method) && size ? { body: Buffer.concat(chunks) } : {}),
  });
  if (report && (upstream.status >= 500 || upstream.status === 429)) report.unavailable = true;
  const payload = Buffer.from(await upstream.arrayBuffer());
  VERIFY(payload.length <= 1024 * 1024, 'API response exceeds the bridge safety limit.');
  const responseHeaders = { 'Content-Type': upstream.headers.get('content-type') || 'application/json',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  for (const name of ['content-range', 'preference-applied']) if (upstream.headers.get(name)) responseHeaders[name] = upstream.headers.get(name);
  res.writeHead(upstream.status, responseHeaders); res.end(payload);
}
async function createServer(config, listenHost = '127.0.0.1', report) {
  const allowed = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/assets/app.js', 'assets/app.js'], ['/assets/app.css', 'assets/app.css']]);
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1:3000');
      if (url.pathname.startsWith('/supabase/')) { await proxy(req, res, config, url, report); return; }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      const relative = allowed.get(url.pathname);
      if (url.pathname !== '/runtime-config.js' && !relative) { res.writeHead(404); res.end(); return; }
      const headers = { 'Content-Type': url.pathname === '/runtime-config.js' ? types['.js'] : types[path.extname(relative)],
        'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
      res.writeHead(200, headers);
      if (url.pathname === '/runtime-config.js') {
        const publicConfig = { anonKey: config.anonKey, schema: 'app', storageKey: config.storageKey };
        res.end('window.__DK_SUPABASE__=Object.freeze(Object.assign(' + JSON.stringify(publicConfig).replace(/</g, '\\u003c') +
          ',{url:window.location.origin+"/supabase"}));');
      } else res.end(await fs.readFile(path.join(ROOT, relative)));
    } catch {
      if (report) report.unavailable = true;
      if (!res.headersSent) res.writeHead(502); res.end('Application service unavailable');
    }
  });
  server.on('upgrade', (_req, socket) => socket.destroy());
  await new Promise(resolve => server.listen(3000, listenHost, resolve));
  return server;
}

async function verifyProxyProtocol(config) {
  const previous = config.migrationBaseline;
  VERIFY(previous && previous.rows?.length >= 2 && rowsHash(previous.rows) === previous.rowsHash,
    'Proxy protocol preflight needs the previously verified immutable API fixture.');
  // Reviewed SDK-only Node code. Candidate JS has not been loaded or executed.
  const { createClient } = require('@supabase/supabase-js');
  const client = createClient('http://127.0.0.1:3000/supabase', config.anonKey, {
    db: { schema: 'app' }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  let signedIn = false;
  try {
    const auth = await client.auth.signInWithPassword({ email: previous.email, password: previous.password });
    VERIFY(!auth.error && auth.data.user?.id === previous.ownerId && auth.data.session,
      'The trusted SDK could not authenticate the known verifier fixture through the hosted API bridge.');
    signedIn = true;
    rememberPrivate(auth.data.session.access_token, auth.data.session.refresh_token);
    const tasks = () => client.schema('app').from('tasks');
    const exact = previous.rows[0];
    for (const method of ['single', 'maybeSingle']) {
      const response = await tasks().select(BASE_COLUMNS.join(',')).eq('id', exact.id)[method]();
      VERIFY(!response.error && response.data && !Array.isArray(response.data) &&
        rowsHash([response.data]) === rowsHash([exact]),
      'The hosted bridge changed the pinned SDK .' + method + '() single-row response shape or content.');
    }
    const missing = await tasks().select('id').eq('id', crypto.randomUUID()).maybeSingle();
    VERIFY(!missing.error && missing.data === null, 'The hosted bridge changed the pinned SDK .maybeSingle() zero-row response.');
    const many = await tasks().select('id').in('id', previous.rows.map(row => row.id)).single();
    VERIFY(many.status === 406 && many.error && many.data === null,
      'The hosted bridge failed to preserve the pinned SDK .single() multiple-row rejection.');
    return 'The pinned SDK authenticated the existing private fixture through the actual hosted bridge; single/maybeSingle preserved exact object, zero-row and cardinality-error semantics before candidate JS ran.';
  } finally {
    if (signedIn) await client.auth.signOut({ scope: 'local' });
  }
}

function createAmbiguousCaseDriver({ origin, api, currentSession, main, byId, rowWith, add, until, count, page, report, record }) {
  return async forceUnknown => {
    const target = origin + '/supabase/rest/v1/tasks**';
    const title = forceUnknown ? 'Unconfirmed retry fixture' : 'Ambiguous recovery fixture';
    const before = await api.tasks(currentSession);
    VERIFY(before.ok && Array.isArray(before.data), 'Cannot bind an exact pre-case owned row set.');
    const requestIds = new Set(), attempts = [], readbacks = [];
    let committed = false, allowConfirmation = !forceUnknown, blockedReadbacks = 0, inFlight = 0, routeFailure;
    const responseRows = async response => {
      const data = await response.json().catch(() => null);
      return Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : [];
    };
    // The pinned SDK retries GET 503 responses. Keep every readback unavailable,
    // but explicitly exhaust those retries without adding its default 1+2+4s delay.
    const injectedFailure = route => route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Retry-After': '0' },
      body: '{"message":"Intentional unconfirmed write or readback response","code":"DK_TEST"}' });
    const ambiguous = async route => {
      inFlight++;
      try {
        const method = route.request().method();
        if (method === 'POST') {
          const raw = route.request().postDataJSON(), body = Array.isArray(raw) ? raw[0] : raw;
          VERIFY(body?.title === title && isUuid(body?.request_id), 'Creation did not send the expected title and a valid logical request ID.');
          VERIFY(attempts.length < 6, 'The logical creation issued an unbounded number of retries.');
          requestIds.add(body.request_id);
          const attempt = { requestId: body.request_id, upstreamStatus: 0, responseRows: [], responseLost: false };
          attempts.push(attempt);
          const response = await route.fetch({ timeout: 15000 });
          attempt.upstreamStatus = response.status();
          attempt.responseRows = await responseRows(response);
          if ((attempts.length === 1 && response.ok()) || (forceUnknown && committed && !allowConfirmation)) {
            committed = committed || response.ok();
            attempt.responseLost = true;
            await injectedFailure(route);
          } else await route.fulfill({ response });
        } else if (committed && ['GET', 'HEAD'].includes(method)) {
          if (!allowConfirmation) { blockedReadbacks++; await injectedFailure(route); }
          else {
            const response = await route.fetch({ timeout: 15000 });
            readbacks.push({ status: response.status(), rows: await responseRows(response) });
            await route.fulfill({ response });
          }
        } else await route.continue();
      } catch (error) { routeFailure = routeFailure || error; await route.abort().catch(() => undefined); }
      finally { inFlight--; }
    };
    return withCapturedTaskCleanup({
      account: currentSession, requestIds, baselineRows: before.data, api,
      work: async () => {
        await main.context.route(target, ambiguous);
        await add(title);
        let initialOutcome, preservedDraft, errorVisible;
        await until(async () => {
          if (routeFailure) throw routeFailure;
          if (!attempts.length || inFlight) return false;
          const draft = await byId('item-title').inputValue(), error = await byId('app-error').isVisible();
          if (await rowWith(title).count() === 1 && draft === '' && !error) {
            initialOutcome = 'server-recovered'; return true;
          }
          if (error && draft === title && await byId('add-item').isEnabled()) {
            initialOutcome = 'retry-required'; preservedDraft = draft; errorVisible = error; return true;
          }
          return false;
        }, 'The lost write response produced neither confirmed recovery nor an honest retryable draft.');
        if (forceUnknown) VERIFY(initialOutcome === 'retry-required',
          'The app claimed success while both the committed write response and server readbacks were unavailable.');
        if (initialOutcome === 'retry-required') {
          VERIFY(await rowWith(title).count() === 0, 'An unconfirmed creation was rendered as persisted success.');
          allowConfirmation = true;
          await byId('add-item').click();
        }
        await until(async () => {
          if (routeFailure) throw routeFailure;
          return !inFlight && await rowWith(title).count() === 1 && await byId('item-title').inputValue() === '' &&
            !await byId('app-error').isVisible();
        }, 'The confirmed logical creation did not settle as exactly one visible task.');
        const firstId = attempts[0]?.requestId;
        VERIFY(isUuid(firstId), 'No valid creation request ID was captured.');
        const stored = await api.tasks(currentSession, 'GET', undefined,
          '?owner_id=eq.' + currentSession.ownerId + '&request_id=eq.' + firstId);
        VERIFY(stored.ok && Array.isArray(stored.data), 'Independent owned-row confirmation is unavailable.');
        return validateAmbiguousWriteEvidence({ attempts, readbacks, storedRows: stored.data,
          ownerId: currentSession.ownerId, title, forceUnknown, initialOutcome, preservedDraft, errorVisible, blockedReadbacks,
          baselineRequestIds: before.data.map(row => row.request_id), renderedCount: await rowWith(title).count(),
          finalDraft: await byId('item-title').inputValue(), finalError: await byId('app-error').isVisible() });
      },
      beforeCleanup: async () => {
        await main.context.unroute(target, ambiguous);
        await waitForTruth(() => inFlight === 0, 'Intercepted fixture requests did not settle before cleanup.', 16000);
      },
      afterCleanup: async () => {
        await page.reload({ waitUntil: 'networkidle' }); await byId('filter-all').click(); await count(before.data.length);
        VERIFY(await rowWith(title).count() === 0, 'The cleaned-up fixture remained visible.');
      },
      cleanupFailure: error => {
        report.unavailable = true;
        record('harness:fixture-cleanup', false, safeError(error));
      },
    });
  };
}

async function browserChecks() {
  const config = await readConfig(), report = newReport(), { run, record } = recorder(report), api = apiClient(config);
  const { chromium } = require('/runner/node_modules/playwright');
  report.pageErrors = []; report.consoleErrors = [];
  report.limitations.push('Fixed local two-user/database/browser checks, not deployment, password recovery, MFA, email delivery, exhaustive security or aesthetic certification.');
  report.limitations.push('Injected ambiguous-write/readback outages use Retry-After: 0 while denying every retry. They certify failure, confirmation and idempotency semantics, not a general network-error latency SLA.');
  let browser, server, intentionalApiFailure = false;
  try {
    server = await createServer(config, '127.0.0.1', report);
    if (config.migrationBaseline) {
      const protocol = await run('harness:supabase-sdk-protocol', async () => {
        try { return await verifyProxyProtocol(config); }
        catch (error) { throw unavailable('Hosted SDK protocol preflight failed: ' + safeError(error)); }
      });
      if (!protocol) return;
    } else report.limitations.push('Hosted SDK protocol preflight was not executed because no verified immutable API fixture was available.');
    browser = await chromium.launch({ headless: true });
    report.browserVersion = browser.version();
    const origin = 'http://127.0.0.1:3000';
    const newPage = async (width = 1440) => {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, serviceWorkers: 'block' });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        return url.origin === origin ? route.continue() : route.abort();
      });
      await context.routeWebSocket('**/*', socket => socket.close());
      const page = await context.newPage();
      page.setDefaultTimeout(6500);
      page.on('pageerror', error => { if (report.pageErrors.length < 30) report.pageErrors.push(safeError(error)); });
      page.on('console', message => {
        // HTTP errors are expected in intentional auth/save denial tests, but JS errors are not.
        if (!intentionalApiFailure && message.type() === 'error' && !/^Failed to load resource:/.test(message.text()) && report.consoleErrors.length < 30)
          report.consoleErrors.push(safeError({ message: message.text() }));
      });
      await page.goto(origin, { waitUntil: 'networkidle', timeout: 15000 });
      return { context, page };
    };
    const main = await newPage(), page = main.page, byId = id => page.getByTestId(id);
    const rows = () => byId('item-row');
    const rowWith = title => rows().filter({ has: page.getByTestId('item-title-text').filter({ hasText: title }) });
    const until = async (predicate, message) => {
      const end = Date.now() + 6500;
      while (Date.now() < end) { if (await predicate()) return; await page.waitForTimeout(60); }
      throw new Error(message);
    };
    const count = n => until(async () => await rows().count() === n, 'Expected ' + n + ' visible task rows.');
    const add = async title => { await byId('item-title').fill(title); await byId('add-item').click(); };
    const assertScopedStorage = async () => {
      const stores = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
      const keys = [...stores.local, ...stores.session], sdkKeys = [config.storageKey, config.storageKey + '-code-verifier', config.storageKey + '-user'];
      VERIFY(keys.includes(config.storageKey), 'Auth session does not use the supplied app-scoped storage key.');
      VERIFY(keys.every(key => sdkKeys.includes(key)), 'The app created browser storage outside its scoped SDK session; tasks must remain database-authoritative.');
    };
    const login = async (target, account, signup = false) => {
      await target.getByTestId('login-email').fill(account.email);
      await target.getByTestId('login-password').fill(account.password);
      await target.getByTestId(signup ? 'sign-up' : 'sign-in').click();
      await target.getByTestId('item-title').waitFor({ state: 'visible' });
    };
    await run('platform:startup', async () => {
      VERIFY((await page.locator('body').innerText()).trim().length > 0 && report.pageErrors.length === 0, 'The compiled app is empty or failed to start.');
      for (const id of ['login-email', 'login-password', 'sign-in', 'sign-up']) VERIFY(await byId(id).count() === 1 && await byId(id).isVisible(), 'Missing login control ' + id);
      VERIFY(await rows().count() === 0, 'Unauthenticated browser rendered private tasks.');
      return 'Compiled React application started in Chromium with real auth controls and no unauthenticated task exposure.';
    });
    const account = { email: 'dk-browser-' + crypto.randomUUID() + '@example.test', password: 'Dk!' + crypto.randomUUID() + '9a' };
    rememberPrivate(account.password);
    let currentSession, otherBrowserAccount;
    const auth = await run('browser:auth-signup-signin', async () => {
      intentionalApiFailure = true;
      try {
        await byId('login-email').fill(account.email); await byId('login-password').fill(account.password);
        await byId('sign-in').click(); await byId('auth-error').waitFor({ state: 'visible' });
        VERIFY(await byId('login-email').inputValue() === account.email, 'Failed login discarded the entered email.');
      } finally { intentionalApiFailure = false; }
      await login(page, account, true); await count(0);
      currentSession = await api.login(account);
      VERIFY(await byId('sign-out').isVisible(), 'Signed-in UI has no sign-out control.');
      await assertScopedStorage();
      return 'Invalid login displayed an error; real browser signup created a separately API-verifiable user and app-scoped persisted session.';
    });
    let layouts = true;
    for (const width of [1440, 390]) {
      layouts = await run(width === 390 ? 'layout:mobile' : 'layout:desktop', async () => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        VERIFY(await page.evaluate(() => document.body.innerText.trim().length > 0 && document.documentElement.scrollWidth <= innerWidth + 2),
          'Empty or horizontally overflowing layout at ' + width + 'px.');
        const name = 'layout-' + width + '.png';
        await page.screenshot({ path: path.join(OUTPUT, name), fullPage: false }); report.screenshots.push(name);
        return 'Visible layout with no horizontal overflow at ' + width + 'px.';
      }) && layouts;
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    if (auth) {
      await run('contract:controls', async () => {
        for (const id of ['item-title', 'add-item', 'filter-all', 'filter-open', 'filter-done']) {
          VERIFY(await byId(id).count() === 1 && await byId(id).isVisible(), 'Missing or duplicated task control ' + id);
        }
      });
      await run('requirement:items:empty-title', async () => {
        await byId('item-title').fill('   ');
        if (await byId('add-item').isEnabled()) await byId('add-item').click();
        await count(0);
        const response = await api.tasks(currentSession);
        VERIFY(response.ok && response.data?.length === 0, 'Blank title created a database row.');
      });
      await run('requirement:items:create', async () => {
        await add('Draft a private brief'); await count(1);
        await add('Review the private release'); await count(2);
        const response = await api.tasks(currentSession);
        VERIFY(response.ok && response.data?.length === 2 && response.data.some(row => row.title === 'Draft a private brief'), 'Browser tasks are not persisted under the real signed-in database user.');
        await assertScopedStorage();
      });
      await run('requirement:items:edit', async () => {
        await rowWith('Draft a private brief').getByTestId('edit-item').click();
        await byId('edit-title').fill('Draft the final private brief'); await byId('save-item').click();
        await until(async () => await rowWith('Draft the final private brief').count() === 1, 'Edited title was not rendered.');
        await rowWith('Draft the final private brief').getByTestId('edit-item').click();
        await byId('edit-title').fill('Cancelled change'); await byId('cancel-edit').click();
        VERIFY(await rowWith('Draft the final private brief').count() === 1 && await rowWith('Cancelled change').count() === 0, 'Cancel changed the stored task title.');
      });
      await run('requirement:items:toggle', async () => {
        const toggle = rowWith('Draft the final private brief').getByTestId('toggle-item');
        const before = await api.tasks(currentSession);
        const candidates = before.data?.filter(row => row.title === 'Draft the final private brief');
        VERIFY(before.ok && candidates?.length === 1, 'Toggle target is not one exact persisted task.');
        return verifyCompletionControl(toggle, candidates[0], async id => {
          const response = await api.tasks(currentSession, 'GET', undefined, '?id=eq.' + id);
          return response.ok && response.data?.length === 1 ? response.data[0] : null;
        });
      });
      await run('requirement:filters:done', async () => { await byId('filter-done').click(); await count(1); VERIFY(await rowWith('Draft the final private brief').count() === 1, 'Done filter selected the wrong task.'); });
      await run('requirement:filters:open', async () => { await byId('filter-open').click(); await count(1); VERIFY(await rowWith('Review the private release').count() === 1, 'Open filter selected the wrong task.'); });
      await run('requirement:filters:all', async () => { await byId('filter-all').click(); await count(2); });
      await run('requirement:persistence:reload', async () => {
        await page.reload({ waitUntil: 'networkidle' }); await byId('filter-all').click(); await count(2);
        VERIFY(await rowWith('Draft the final private brief').getByTestId('toggle-item').isChecked(), 'Completion did not persist.');
        // A completely empty browser storage context must retrieve the same records after real signin.
        const fresh = await newPage();
        try {
          await login(fresh.page, account);
          await fresh.page.getByTestId('item-row').filter({ hasText: 'Draft the final private brief' }).waitFor();
          VERIFY(await fresh.page.getByTestId('item-row').count() === 2, 'New browser context did not recover server data after signin.');
        } finally { await fresh.context.close(); }
        return 'Reload preserved tasks/session; a separate empty browser context recovered the same tasks by real signin, independent of browser task storage.';
      });
      await run('browser:two-users', async () => {
        const other = await api.signup('browser-other'), second = await newPage();
        otherBrowserAccount = other;
        try {
          await login(second.page, other);
          VERIFY(await second.page.getByTestId('item-row').count() === 0, 'Another user rendered the first user tasks.');
          await second.page.getByTestId('item-title').fill('Second user private task'); await second.page.getByTestId('add-item').click();
          await second.page.getByTestId('item-title-text').filter({ hasText: 'Second user private task' }).waitFor();
          await page.reload({ waitUntil: 'networkidle' }); await byId('filter-all').click(); await count(2);
          VERIFY(await rowWith('Second user private task').count() === 0, 'Second user task leaked to the original user.');
        } finally { await second.context.close(); }
        return 'Two browser users created independent private task collections against the same real database.';
      });
      await run('browser:failed-save-preserves-input', async () => {
        intentionalApiFailure = true;
        const target = origin + '/supabase/rest/v1/tasks**';
        const denyWrites = route => route.request().method() === 'POST' ?
          route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Intentional verifier write outage","code":"DK_TEST"}' }) : route.continue();
        await main.context.route(target, denyWrites);
        try {
          await add('Keep this unsaved draft');
          await byId('app-error').waitFor({ state: 'visible' });
          VERIFY(await byId('item-title').inputValue() === 'Keep this unsaved draft', 'Failed save cleared the entered title.');
          VERIFY(await rowWith('Keep this unsaved draft').count() === 0, 'Failed save appeared as a persisted task.');
          const response = await api.tasks(currentSession);
          VERIFY(response.ok && response.data?.length === 2, 'Failed save changed persisted task data.');
        } finally { await main.context.unroute(target, denyWrites); }
        await byId('item-title').fill('');
        const denyEdits = route => route.request().method() === 'PATCH' ?
          route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Intentional verifier edit outage","code":"DK_TEST"}' }) : route.continue();
        await main.context.route(target, denyEdits);
        try {
          await rowWith('Draft the final private brief').getByTestId('edit-item').click();
          await byId('edit-title').fill('Keep this unsaved edit'); await byId('save-item').click();
          await byId('app-error').waitFor({ state: 'visible' });
          VERIFY(await byId('edit-title').inputValue() === 'Keep this unsaved edit', 'Failed edit cleared or closed the entered draft.');
          const response = await api.tasks(currentSession);
          VERIFY(response.ok && response.data?.some(row => row.title === 'Draft the final private brief') &&
            !response.data.some(row => row.title === 'Keep this unsaved edit'), 'Failed edit changed server data.');
          await byId('cancel-edit').click();
        } finally { await main.context.unroute(target, denyEdits); intentionalApiFailure = false; }
        return 'An injected API write outage displayed an honest error, preserved the draft and did not invent persisted success.';
      });
      await run('browser:ambiguous-retry-idempotency', async () => {
        intentionalApiFailure = true;
        const oneCase = createAmbiguousCaseDriver({ origin, api, currentSession, main, byId, rowWith, add, until, count, page, report, record });
        try {
          const recovery = await oneCase(false), unknown = await oneCase(true);
          return recovery + ' ' + unknown;
        } finally { intentionalApiFailure = false; }
      });
      if (report.unavailable) return;
      await run('requirement:items:delete', async () => {
        page.once('dialog', dialog => dialog.type() === 'confirm' ? dialog.accept() : dialog.dismiss());
        const before = await api.tasks(currentSession);
        const matches = before.data?.filter(row => row.title === 'Review the private release');
        VERIFY(before.ok && matches?.length === 1, 'Deletion target is not one exact persisted task.');
        const details = await verifyDeletionControl(rowWith('Review the private release').getByTestId('delete-item'),
          matches[0], before.data, async () => await rowWith('Review the private release').count() !== 0, async () => {
            const response = await api.tasks(currentSession);
            return response.ok ? response.data : null;
          });
        await page.reload({ waitUntil: 'networkidle' }); await byId('filter-all').click(); await count(1);
        const response = await api.tasks(currentSession);
        VERIFY(response.ok && response.data?.length === 1 && response.data.every(row => row.id !== matches[0].id),
          'Browser deletion was not persisted by Postgres.');
        return details;
      });
      await run('requirement:responsive:mobile', async () => {
        const captured = [];
        const capture = request => {
          try {
            if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/supabase/rest/v1/tasks') return;
            const raw = request.postDataJSON(), body = Array.isArray(raw) ? raw[0] : raw;
            if (body?.title === 'Mobile private follow-up') captured.push(body.request_id);
          } catch { /* Invalid request bodies cannot provide positive creation evidence. */ }
        };
        page.on('request', capture);
        try {
          await page.setViewportSize({ width: 390, height: 844 }); await add('Mobile private follow-up');
          await until(async () => await rowWith('Mobile private follow-up').count() === 1, 'Mobile creation was not rendered.');
          await count(2);
          VERIFY(captured.length >= 1 && captured.every(id => isUuid(id) && id === captured[0]), 'Mobile creation has no stable captured logical request identity.');
          const response = await api.tasks(currentSession, 'GET', undefined,
            '?owner_id=eq.' + currentSession.ownerId + '&request_id=eq.' + captured[0]);
          VERIFY(response.ok && response.data?.length === 1 && isUuid(response.data[0].id) &&
            response.data[0].request_id === captured[0] && response.data[0].title === 'Mobile private follow-up' &&
            response.data[0].owner_id === currentSession.ownerId, 'The exact mobile creation was not independently persisted.');
        } finally { page.off('request', capture); }
        VERIFY(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Populated mobile layout overflows.');
        await page.screenshot({ path: path.join(OUTPUT, 'journey-mobile.png'), fullPage: false }); report.screenshots.push('journey-mobile.png');
      });
      await run('browser:auth-signout', async () => {
        await byId('sign-out').click(); await byId('login-email').waitFor({ state: 'visible' });
        VERIFY(await rows().count() === 0, 'Signout left private tasks visible.');
        await page.reload({ waitUntil: 'networkidle' }); await byId('login-email').waitFor({ state: 'visible' });
        VERIFY(await rows().count() === 0, 'Reload restored a signed-out UI session.');
        const authStored = await page.evaluate(key => localStorage.getItem(key) || sessionStorage.getItem(key), config.storageKey);
        VERIFY(!authStored, 'Signout left the app-scoped auth session in browser storage.');
        VERIFY(otherBrowserAccount, 'A separate real user is required to prove an account switch.');
        await login(page, otherBrowserAccount);
        await page.getByTestId('item-title-text').filter({ hasText: 'Second user private task' }).waitFor();
        await count(1);
        VERIFY(await rowWith('Draft the final private brief').count() === 0 && await rowWith('Mobile private follow-up').count() === 0,
          'The same browser leaked the previous account tasks after switching users.');
        await byId('sign-out').click(); await byId('login-email').waitFor({ state: 'visible' });
        return 'Real signout removed the scoped session across reload; signing in as the second user in the same browser exposed only that user tasks.';
      });
    }
    const passed = id => report.checks.some(check => check.id === id && check.passed);
    record('platform:responsive-layout', layouts && passed('requirement:responsive:mobile'), 'Both widths and a populated mobile creation journey are required.');
    const required = ['browser:auth-signup-signin', 'contract:controls', 'requirement:items:empty-title', 'requirement:items:create',
      'requirement:items:edit', 'requirement:items:toggle', 'requirement:items:delete', 'requirement:filters:all',
      'requirement:filters:open', 'requirement:filters:done', 'requirement:persistence:reload',
      'browser:two-users', 'browser:failed-save-preserves-input', 'browser:ambiguous-retry-idempotency', 'browser:auth-signout', 'requirement:responsive:mobile'];
    const core = required.every(passed) && report.pageErrors.length === 0 && report.consoleErrors.length === 0;
    record('platform:browser-core', core, core ? 'Real-auth CRUD/filter/reload/two-user/error/mobile/signout journeys passed.' :
      'Required browser journeys or clean JS execution are missing. ' + [...report.pageErrors, ...report.consoleErrors].join('; ').slice(0, 1200));
    await main.context.close();
  } catch (error) { record('harness:browser', false, safeError(error)); }
  finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    await writeReport(report);
  }
}

async function serve() {
  const config = await readConfig();
  VERIFY(!config.migrationBaseline && !config.foreignSession, 'Human preview must never receive verifier fixture credentials.');
  await createServer(config, '0.0.0.0');
  console.log('Privateboard exact-build preview ready on port 3000.');
}
const MODES = { compile, api: apiChecks, browser: browserChecks, 'cross-app': crossAppChecks, 'restart-proof': restartProof, serve };
if (require.main === module) {
  const mode = MODES[process.argv[2]];
  if (!mode) { console.error('A trusted runner mode is required.'); process.exitCode = 2; }
  else mode().catch(error => {
    console.error(safeError(error));
    // Only esbuild's explicit diagnostic list represents rejected candidate source.
    process.exitCode = process.argv[2] === 'compile' && !Array.isArray(error.errors) ? 70 : 1;
  });
} else {
  // Reviewed test helpers only; importing the harness never starts a runner mode.
  module.exports = { verifyCompletionControl, verifyDeletionControl, validateAmbiguousWriteEvidence, withCapturedTaskCleanup,
    createAmbiguousCaseDriver, waitForTruth };
}
