'use strict';
// Platform-owned compiler and acceptance harness. Generated source is never required/evaluated by Node.
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const root = '/candidate';
const output = '/output';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https: blob:; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self' http://localhost:54321 http://127.0.0.1:54321; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'";
const INDEX = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet"><meta http-equiv="Content-Security-Policy" content="${CSP}"><title>Briefboard</title><link rel="stylesheet" href="/assets/app.css"><script src="/assets/app.js" defer></script></head><body><div id="root"></div></body></html>`;
const ENTRY = "import React from 'react'; import {createRoot} from 'react-dom/client'; import App from '/candidate/src/App.tsx'; import '/candidate/src/styles.css'; createRoot(document.getElementById('root')).render(<App/>);";

async function getCandidateFiles(dir) {
  const results = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await getCandidateFiles(full)));
      } else if (entry.isFile() && !entry.isSymbolicLink()) {
        results.push(full);
      }
    }
  } catch {}
  return results;
}

async function compile() {
  const esbuild = require('esbuild');
  const sourceFileHashes = {};
  const allSourceFiles = await getCandidateFiles(root);
  for (const full of allSourceFiles) {
    const rel = path.relative(root, full).replace(/\\/g, '/');
    const stat = await fs.lstat(full);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) throw new Error('Unsupported source file.');
    sourceFileHashes[rel] = digest(await fs.readFile(full));
  }
  const result = await esbuild.build({
    stdin: { contents: ENTRY, loader: 'tsx', sourcefile: 'platform-entry.tsx', resolveDir: '/opt/generator-v2' },
    bundle: true, packages: 'bundle', platform: 'browser', format: 'iife', target: ['es2022'],
    jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
    nodePaths: ['/opt/generator-v2/node_modules'], outfile: '/virtual/assets/app.js',
    write: false, metafile: true, minify: true, legalComments: 'none', sourcemap: false,
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', target: 'ES2022', useDefineForClassFields: true } },
    plugins: [{ name: 'platform-import-boundary', setup(build) {
      build.onResolve({ filter: /.*/ }, async args => {
        if (args.importer.startsWith(root + '/')) {
          if (args.kind === 'dynamic-import' || args.kind === 'url-token' || args.kind === 'import-rule') {
            return { errors: [{ text: 'Dynamic imports and remote/embedded CSS assets are outside the pilot contract.' }] };
          }
          if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'lucide-react', '@supabase/supabase-js'].includes(args.path)) {
            return { path: require.resolve(args.path, { paths: ['/opt/generator-v2'] }) };
          }
          if (args.path.startsWith('.')) {
            const dir = path.dirname(args.importer);
            const resolvedBase = path.resolve(dir, args.path);
            const candidates = [
              resolvedBase,
              resolvedBase + '.tsx',
              resolvedBase + '.ts',
              resolvedBase + '.jsx',
              resolvedBase + '.js',
              resolvedBase + '.css',
              path.join(resolvedBase, 'index.tsx'),
              path.join(resolvedBase, 'index.ts'),
              path.join(resolvedBase, 'index.jsx'),
              path.join(resolvedBase, 'index.js'),
            ];
            for (const c of candidates) {
              try {
                const s = await fs.stat(c);
                if (s.isFile() && c.startsWith(root + '/src/')) {
                  return { path: c };
                }
              } catch {}
            }
          }
          return { errors: [{ text: `Cannot resolve import '${args.path}' from '${path.relative(root, args.importer)}'. Only local relative modules within src/, React, and Lucide icons are supported.` }] };
        }
        return undefined;
      });
    } }],
  });

  const files = [{ path: 'index.html', content: INDEX }];
  for (const built of result.outputFiles) {
    const name = path.posix.basename(built.path);
    if (!['app.js', 'app.css'].includes(name) || built.contents.length > 2 * 1024 * 1024) throw new Error('Unexpected compiler output.');
    files.push({ path: 'assets/' + name, content: built.text });
  }
  if (!files.some(file => file.path === 'assets/app.css')) files.push({ path: 'assets/app.css', content: '' });
  const dependencies = { react: require('react/package.json').version, 'react-dom': require('react-dom/package.json').version, esbuild: esbuild.version, 'lucide-react': require('lucide-react/package.json').version };
  for (const file of files) {
    await fs.mkdir(path.dirname(path.join(output, file.path)), { recursive: true });
    await fs.writeFile(path.join(output, file.path), file.content, { flag: 'wx' });
  }
  await fs.writeFile(path.join(output, 'build.json'), JSON.stringify({
    version: 1, compiler: 'esbuild', semanticTypecheck: false, sourceFileHashes, dependencies,
    artifacts: files.map(file => ({ path: file.path, hash: digest(file.content), bytes: Buffer.byteLength(file.content) })),
    warnings: result.warnings.map(warning => warning.text).slice(0, 20),
  }), { flag: 'wx' });
}

async function browserChecks() {
  const { chromium } = require('/runner/node_modules/playwright');
  const report = { version: 1, checks: [], failures: [], limitations: [
    'A fixed browser-only Briefboard acceptance suite. No database, app login, live AI, deployment or exhaustive accessibility proof.',
    'Storage isolation checks use two independent browser contexts; DevKiller account authorization and the embedded preview bridge require separate verification.',
  ], screenshots: [], consoleErrors: [], pageErrors: [] };
  const allowed = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/assets/app.js', 'assets/app.js'], ['/assets/app.css', 'assets/app.css']]);
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  const server = http.createServer(async (req, res) => {
    try {
      const relative = allowed.get(new URL(req.url, 'http://127.0.0.1').pathname);
      if (!relative || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(relative)], 'Content-Security-Policy': CSP,
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      res.end(await fs.readFile(path.join(root, relative)));
    } catch { res.writeHead(500); res.end('Unavailable'); }
  });
  let browser;
  const record = (id, passed, details) => {
    report.checks.push({ id, passed, details });
    if (!passed) report.failures.push(`${id}: ${details}`);
  };
  const run = async (id, work) => {
    try { const details = await work(); record(id, true, details || 'Executed successfully.'); return true; }
    catch (error) { record(id, false, String(error.message || error).slice(0, 1600)); return false; }
  };
  const captureBrowserError = (collection, message) => {
    if (collection.length < 50) collection.push(message.slice(0, 600));
    else if (collection.length === 50) collection.push('Additional browser errors omitted after the 50-event safety limit.');
  };
  const verify = (condition, message) => { if (!condition) throw new Error(message); };
  try {
    await new Promise(resolve => server.listen(3000, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true });
    report.browserVersion = browser.version();
    const newPage = async (width = 1440) => {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, serviceWorkers: 'block' });
      await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:3000' ? route.continue() : route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(3500);
      page.on('pageerror', error => captureBrowserError(report.pageErrors, error.message));
      page.on('console', message => { if (message.type() === 'error') captureBrowserError(report.consoleErrors, message.text()); });
      await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle', timeout: 10000 });
      return { context, page };
    };
    const primary = await newPage();
    const page = primary.page;
    const byId = id => page.getByTestId(id);
    const rows = () => byId('item-row');
    const count = async n => {
      const until = Date.now() + 3500;
      while (Date.now() < until) { if (await rows().count() === n) return; await page.waitForTimeout(50); }
      verify(false, `Expected ${n} item rows, found ${await rows().count()}.`);
    };
    const add = async title => { await byId('item-title').fill(title); await byId('add-item').click(); };
    const rowWith = title => rows().filter({ has: page.getByTestId('item-title-text').filter({ hasText: title }) });
    await run('platform:startup', async () => {
      verify((await page.locator('body').innerText()).trim().length > 0, 'The compiled application is empty.');
      verify(report.pageErrors.length === 0, report.pageErrors.join('; '));
      return 'The compiled React application booted in Chromium over isolated HTTP.';
    });
    let layouts = true;
    for (const width of [1440, 390]) {
      const passed = await run(width === 390 ? 'layout:mobile' : 'layout:desktop', async () => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        const metrics = await page.evaluate(() => ({ text: document.body.innerText.trim().length, overflow: document.documentElement.scrollWidth > innerWidth + 2 }));
        verify(metrics.text > 0 && !metrics.overflow, `Empty page or horizontal overflow at ${width}px.`);
        const filename = `layout-${width}.png`;
        await page.screenshot({ path: path.join(output, filename), fullPage: false });
        report.screenshots.push(filename);
        return `Visible layout without horizontal overflow at ${width}px; screenshot recorded. Aesthetic quality is not certified.`;
      });
      layouts = layouts && passed;
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const controlsPresent = await run('contract:controls', async () => {
      for (const id of ['item-title', 'add-item', 'filter-all', 'filter-open', 'filter-done']) {
        verify(await byId(id).count() === 1, `Missing or duplicated required control ${id}.`);
        verify(await byId(id).isVisible(), `Required control ${id} is not visible.`);
      }
      verify(await rows().count() === 0, 'A fresh browser context must not contain automatically inserted sample items.');
    });
    if (controlsPresent) {
      await run('requirement:items:empty-title', async () => {
        await byId('item-title').fill('   ');
        if (await byId('add-item').isEnabled()) await byId('add-item').click();
        await count(0);
      });
      await run('requirement:items:create', async () => {
        await add('Draft a clear brief'); await count(1);
        verify(await rowWith('Draft a clear brief').count() === 1, 'The new title was not rendered as an item.');
        await add('Review the release'); await count(2);
      });
      await run('requirement:items:edit', async () => {
        await rowWith('Draft a clear brief').getByTestId('edit-item').click();
        await byId('edit-title').fill('Draft the final brief');
        await byId('save-item').click();
        verify(await rowWith('Draft the final brief').count() === 1, 'Edited title was not applied.');
        verify(await rowWith('Draft a clear brief').count() === 0, 'Old title remains after save.');
      });
      await run('requirement:items:toggle', async () => {
        const checkbox = rowWith('Draft the final brief').getByTestId('toggle-item');
        verify(await checkbox.getAttribute('type') === 'checkbox', 'Completion must use a native checkbox.');
        await checkbox.check();
        verify(await checkbox.isChecked(), 'The completion checkbox did not update.');
      });
      await run('requirement:filters:done', async () => {
        await byId('filter-done').click(); await count(1);
        verify(await rowWith('Draft the final brief').count() === 1, 'Done filter did not select the completed item.');
      });
      await run('requirement:filters:open', async () => {
        await byId('filter-open').click(); await count(1);
        verify(await rowWith('Review the release').count() === 1, 'Open filter did not select the incomplete item.');
      });
      await run('requirement:filters:all', async () => { await byId('filter-all').click(); await count(2); });
      await run('requirement:persistence:reload', async () => {
        await page.reload({ waitUntil: 'networkidle' });
        await byId('filter-all').click(); await count(2);
        verify(await rowWith('Draft the final brief').getByTestId('toggle-item').isChecked(), 'Completion did not persist.');
        verify(await rowWith('Review the release').count() === 1, 'Created items did not persist after reload.');
      });
      await run('platform:scope-isolation', async () => {
        const second = await newPage();
        try {
          verify(await second.page.getByTestId('item-row').count() === 0, 'A separate browser storage context received another context\'s items.');
          verify(await rows().count() === 2, 'The independent context modified the original context.');
        } finally { await second.context.close(); }
        return 'Two browser storage contexts remain independent. This is not multi-user server-authorization proof.';
      });
      await run('requirement:items:delete', async () => {
        page.once('dialog', dialog => dialog.type() === 'confirm' ? dialog.accept() : dialog.dismiss());
        await rowWith('Review the release').getByTestId('delete-item').click(); await count(1);
        verify(await rowWith('Review the release').count() === 0, 'Deleted item remains visible.');
        await page.reload({ waitUntil: 'networkidle' }); await byId('filter-all').click(); await count(1);
      });
      await run('requirement:responsive:mobile', async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        await add('Mobile follow-up'); await count(2);
        const metrics = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 2 }));
        verify(!metrics.overflow, 'Populated mobile layout overflows horizontally.');
        await page.screenshot({ path: path.join(output, 'journey-mobile.png'), fullPage: false });
        report.screenshots.push('journey-mobile.png');
      });
    }
    const mobileJourneyPassed = report.checks.some(check => check.id === 'requirement:responsive:mobile' && check.passed);
    record('platform:responsive-layout', layouts && mobileJourneyPassed, 'Desktop/mobile layout checks and a populated mobile creation journey are required.');
    const required = ['requirement:items:empty-title', 'requirement:items:create', 'requirement:items:edit', 'requirement:items:toggle',
      'requirement:items:delete', 'requirement:filters:all', 'requirement:filters:open', 'requirement:filters:done', 'requirement:persistence:reload'];
    const corePassed = required.every(id => report.checks.some(check => check.id === id && check.passed)) &&
      mobileJourneyPassed && report.pageErrors.length === 0 && report.consoleErrors.length === 0;
    record('platform:browser-core', corePassed, corePassed ? 'Fixed create/edit/toggle/filter/delete/reload journeys passed.' :
      'Required journeys or clean browser execution are missing. ' + [...report.pageErrors, ...report.consoleErrors].join('; ').slice(0, 1600));
    await primary.context.close();
  } catch (error) { record('harness:execution', false, String(error.message || error).slice(0, 1600)); }
  finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    report.executedAt = new Date().toISOString();
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  }
  if (report.failures.length) process.exitCode = 1;
}

(process.argv[2] === 'browser' ? browserChecks() : compile()).catch(error => {
  console.error(String(error.message || error).slice(0, 8000));
  process.exitCode = 1;
});
