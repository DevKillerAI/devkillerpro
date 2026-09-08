'use strict';
// Trusted platform runner for PC Service Fullstack benchmark inside Docker container.
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const ROOT = '/candidate', OUTPUT = '/output';
const DIGEST = value => crypto.createHash('sha256').update(value).digest('hex');
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'none'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none';";
const INDEX = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PC Service</title><link rel="stylesheet" href="/assets/app.css"><script src="/runtime-config.js"></script><script src="/assets/app.js" defer></script></head><body><div id="root"></div></body></html>';
const ENTRY = "import React from 'react'; import {createRoot} from 'react-dom/client'; import App from '/candidate/src/App.tsx'; import '/candidate/src/styles.css'; createRoot(document.getElementById('root')).render(<App/>);";

async function compile() {
  const esbuild = require('/opt/generator-v2-supabase/node_modules/esbuild');
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
        if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@supabase/supabase-js'].includes(args.path)) {
          return { path: require.resolve(args.path, { paths: ['/opt/generator-v2-supabase/node_modules'] }) };
        }
        if (args.path === './styles.css' && args.importer === ROOT + '/src/App.tsx') return { path: ROOT + '/src/styles.css' };
        if (args.path.startsWith('.')) {
          const resolved = path.resolve(path.dirname(args.importer), args.path);
          for (const ext of ['', '.tsx', '.ts', '.jsx', '.js']) {
            if (require('node:fs').existsSync(resolved + ext)) return { path: resolved + ext };
          }
        }
        return { errors: [{ text: `Cannot resolve import: ${args.path}` }] };
      });
    } }],
  });

  const files = [{ path: 'index.html', content: INDEX }];
  for (const built of build.outputFiles) {
    const name = path.posix.basename(built.path);
    files.push({ path: 'assets/' + name, content: built.text });
  }
  if (!files.some(file => file.path === 'assets/app.css')) files.push({ path: 'assets/app.css', content: '' });
  for (const file of files) {
    await fs.mkdir(path.dirname(path.join(OUTPUT, file.path)), { recursive: true });
    await fs.writeFile(path.join(OUTPUT, file.path), file.content);
  }
}

async function proxy(req, res, config, targetUrl) {
  const destination = new URL(targetUrl.pathname.replace(/^\/supabase/, '') + targetUrl.search, config.internalApiUrl);
  const outgoing = http.request(destination, {
    method: req.method,
    headers: { ...req.headers, host: destination.host, apikey: config.anonKey, authorization: req.headers.authorization || `Bearer ${config.anonKey}` },
  }, incoming => {
    res.writeHead(incoming.statusCode || 500, incoming.headers);
    incoming.pipe(res);
  });
  outgoing.on('error', err => {
    if (!res.headersSent) { res.writeHead(502); res.end('Gateway Error: ' + err.message); }
  });
  req.pipe(outgoing);
}

async function startServer(config) {
  const allowed = new Map([
    ['/', 'index.html'],
    ['/index.html', 'index.html'],
    ['/assets/app.js', 'assets/app.js'],
    ['/assets/app.css', 'assets/app.css'],
  ]);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1:3000');
      if (url.pathname.startsWith('/supabase/')) {
        await proxy(req, res, config, url);
        return;
      }
      if (url.pathname === '/runtime-config.js') {
        const publicConfig = { anonKey: config.anonKey, schema: 'app', storageKey: config.storageKey || 'dk-pc-service' };
        res.writeHead(200, { 'Content-Type': 'text/javascript', 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' });
        res.end('window.__DK_SUPABASE__=Object.freeze(Object.assign(' + JSON.stringify(publicConfig) + ',{url:window.location.origin+"/supabase"}));');
        return;
      }
      const file = allowed.get(url.pathname);
      if (!file) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, {
        'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html',
        'Content-Security-Policy': CSP,
        'Cache-Control': 'no-store',
      });
      res.end(await fs.readFile(path.join(OUTPUT, file)));
    } catch (e) {
      if (!res.headersSent) { res.writeHead(500); res.end('Server error: ' + e.message); }
    }
  });

  await new Promise(resolve => server.listen(3000, '0.0.0.0', resolve));
  return server;
}

async function runBrowserChecks(config) {
  const { chromium } = require('/runner/node_modules/playwright');
  const browser = await chromium.launch({ headless: true });
  const results = { checks: [], screenshots: [] };
  const record = (id, passed, details) => results.checks.push({ id, passed, details });

  try {
    // --- CENÁRIO B: Criar cliente pela interface ---
    const contextB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pageB = await contextB.newPage();
    pageB.setDefaultTimeout(6000);

    await pageB.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle' });

    // Navegar até clientes
    await pageB.getByTestId('nav-clients').click();
    await pageB.waitForTimeout(300);

    // Preencher formulário
    await pageB.getByTestId('client-name').fill('Carlos Alberto');
    await pageB.getByTestId('client-phone').fill('(11) 98765-4321');
    await pageB.getByTestId('client-email').fill('carlos@exemplo.com.br');

    // Submeter
    await pageB.getByTestId('save-client').click();

    // Confirmar mensagem de sucesso
    const successMsg = pageB.getByTestId('client-success');
    await successMsg.waitFor({ state: 'visible', timeout: 6000 });
    const successText = await successMsg.innerText();
    record('scenario-b:client-success-visible', successText.length > 0, `Success message rendered: "${successText}"`);

    // Confirmar que o cliente aparece na lista da UI
    const clientRows = pageB.getByTestId('client-row');
    await clientRows.first().waitFor({ state: 'visible', timeout: 4000 });
    const rowText = await clientRows.first().innerText();
    const hasCarlos = rowText.includes('Carlos Alberto') && rowText.includes('(11) 98765-4321');
    record('scenario-b:client-row-rendered', hasCarlos, `Client Carlos Alberto rendered in list: "${rowText.replace(/\n/g, ' ')}"`);

    await pageB.screenshot({ path: path.join(OUTPUT, 'scenario-b-created.png') });
    results.screenshots.push('scenario-b-created.png');
    await contextB.close();

    // --- CENÁRIO C: Abrir outro contexto sem localStorage e recuperar pelo backend ---
    const contextC = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const pageC = await contextC.newPage();
    pageC.setDefaultTimeout(6000);

    await pageC.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle' });

    // Provar isolamento de storage
    const storageKeys = await pageC.evaluate(() => Object.keys(localStorage));
    const hasCachedClients = await pageC.evaluate(() => localStorage.getItem('clients') || localStorage.getItem('pc_service_clients'));
    record('scenario-c:no-localstorage-clients', hasCachedClients === null, `Clean context has no client data in localStorage (keys: ${storageKeys.join(', ') || 'none'})`);

    // Navegar até clientes no mobile
    await pageC.getByTestId('nav-clients').click();
    await pageC.waitForTimeout(400);

    // Recuperar cliente do PostgreSQL
    const rowsC = pageC.getByTestId('client-row');
    await rowsC.first().waitFor({ state: 'visible', timeout: 6000 });
    const rowTextC = await rowsC.first().innerText();
    record('scenario-c:recovered-from-backend', rowTextC.includes('Carlos Alberto'), `Client Carlos Alberto retrieved from backend in clean browser context: "${rowTextC.replace(/\n/g, ' ')}"`);

    await pageC.screenshot({ path: path.join(OUTPUT, 'scenario-c-isolated.png') });
    results.screenshots.push('scenario-c-isolated.png');
    await contextC.close();

    // --- CENÁRIO F: Jornadas negativas no frontend ---
    const contextF = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pageF = await contextF.newPage();
    pageF.setDefaultTimeout(6000);

    await pageF.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle' });
    await pageF.getByTestId('nav-clients').click();
    await pageF.waitForTimeout(300);

    // F.1: Submeter formulário vazio -> deve exibir erro e não submeter
    await pageF.getByTestId('client-name').fill('');
    await pageF.getByTestId('client-phone').fill('');
    await pageF.getByTestId('save-client').click();

    const emptyErrorMsg = pageF.getByTestId('client-error');
    await emptyErrorMsg.waitFor({ state: 'visible', timeout: 3000 });
    const emptyErrText = await emptyErrorMsg.innerText();
    record('scenario-f:empty-form-rejected', emptyErrText.includes('obrigatório'), `Empty form rejected with message: "${emptyErrText}"`);

    // F.2: Simular falha de gravação na API PostgREST

    // Interceptar e falhar gravações na API PostgREST
    await pageF.route('**/supabase/rest/v1/clients*', route => {
      if (route.request().method() === 'POST') {
        route.abort('failed');
      } else {
        route.continue();
      }
    });

    await pageF.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle' });
    await pageF.getByTestId('nav-clients').click();
    await pageF.waitForTimeout(300);

    // Tentar cadastrar "Maria Falha"
    await pageF.getByTestId('client-name').fill('Maria Falha');
    await pageF.getByTestId('client-phone').fill('(11) 91111-2222');
    await pageF.getByTestId('client-email').fill('maria@falha.test');
    await pageF.getByTestId('save-client').click();

    // Esperar erro visível
    const errorMsg = pageF.getByTestId('client-error');
    await errorMsg.waitFor({ state: 'visible', timeout: 5000 });
    const errText = await errorMsg.innerText();
    record('scenario-f:visible-error-on-failure', errText.length > 0, `Visible error rendered on failed write: "${errText}"`);

    // Confirmar que client-success NÃO está visível
    const successF = pageF.getByTestId('client-success');
    const successVisible = await successF.isVisible().catch(() => false);
    record('scenario-f:no-false-success', !successVisible, 'No success message displayed when write failed');

    // Confirmar que "Maria Falha" NÃO foi adicionada na lista da interface
    const rowsFText = await pageF.evaluate(() => document.body.innerText);
    const hasMaria = rowsFText.includes('Maria Falha');
    record('scenario-f:no-ghost-record', !hasMaria, 'Ghost record "Maria Falha" was not rendered in list on write failure');

    await pageF.screenshot({ path: path.join(OUTPUT, 'scenario-f-failure.png') });
    results.screenshots.push('scenario-f-failure.png');
    await contextF.close();

  } finally {
    await browser.close();
  }

  return results;
}

async function main() {
  console.log('[runner] Compiling candidate application...');
  await compile();
  console.log('[runner] Reading runtime configuration...');
  const config = JSON.parse(await fs.readFile('/config/runtime.json', 'utf8'));
  console.log('[runner] Starting preview & API gateway server...');
  const server = await startServer(config);
  try {
    console.log('[runner] Running Playwright browser check suite...');
    const report = await runBrowserChecks(config);
    await fs.writeFile(path.join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2));
    console.log('[runner] Finished browser checks. Report saved.');
  } finally {
    server.close();
  }
}

main().catch(err => {
  console.error('[runner] FATAL:', err.message);
  process.exitCode = 1;
});
