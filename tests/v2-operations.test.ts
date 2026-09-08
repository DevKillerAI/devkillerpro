import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { GET, POST, DELETE } from '../src/app/api/jobs/route';
import { POST as intake } from '../src/app/api/intake/analyze/route';
import { POST as runtime } from '../src/app/api/runtime/route';
import { doctorExitCode, runDoctor, type DoctorDependencies, type DatabaseSnapshot } from '../scripts/doctor';
import { WORKBENCH_IMAGE } from '../src/lib/server/generator/workbenchContract';
import { readOnlyRequestBlocked } from '../src/middleware';

const tables = ['public.profiles','public.api_rate_limits',
  ...['campaigns','runs','events','calls','snapshots','asset_usage','workers'].map(name => 'dk_generator_v2.' + name),
  ...['documents','chunks','evaluations'].map(name => 'dk_rag.' + name)];
const ready: DatabaseSnapshot = { tables, compatibleWorker: true, approvedDocuments: 4, embeddedChunks: 12 };
function dependencies(snapshot: DatabaseSnapshot = ready): DoctorDependencies {
  return { environment: { NODE_ENV:'test', DATABASE_URL:'postgresql://user:private-password@localhost:54322/postgres',
    OPENAI_API_KEY:'test-provider-secret', NEXT_PUBLIC_SUPABASE_URL:'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY:'test-anonymous-key' }, nodeVersion:'v22.0.0',
    inspectDatabase:async () => snapshot,
    inspectDocker:async args => args[0] === 'info' ? '28.0.0' : 'sha256:' + 'a'.repeat(64) };
}

test('retired V1 entrypoints reject all work without reading a request or contacting a provider', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error('Provider access is forbidden for a retired endpoint.'); }) as typeof fetch;
  try {
    const request = new Request('http://localhost/api/jobs', { method:'POST', body:'{"engine":"v2"}' });
    Object.defineProperty(request, 'json', { get() { throw new Error('A retired route must not parse its payload.'); } });
    for (const handler of [GET, POST, DELETE, intake, runtime]) {
      const response = await (handler as (req:Request) => Response | Promise<Response>)(request);
      assert.equal(response.status, 410);
      assert.equal((await response.json()).code, 'GENERATOR_V1_DEPRECATED');
    }
  } finally { globalThis.fetch = original; }
});

test('doctor blocks missing exact runner and stale worker even with a healthy browser image', async () => {
  const deps = dependencies({ ...ready, compatibleWorker:false });
  const requests: string[][] = [];
  deps.inspectDocker = async args => {
    requests.push(args);
    if (args[0] === 'info') return '28.0.0';
    throw new Error('Only an older browser runner is installed.');
  };
  const checks = await runDoctor(deps);
  assert.equal(doctorExitCode(checks), 1);
  assert.equal(checks.find(item => item.name === 'Compatible heartbeat')?.status, 'FAILED');
  assert.equal(checks.find(item => item.name === 'Exact Workbench runtime')?.status, 'FAILED');
  assert.deepEqual(requests[1], ['image','inspect',WORKBENCH_IMAGE,'--format','{{.Id}}']);
});

test('doctor pre-start skips only heartbeat and never masks missing tables or Docker', async () => {
  const deps = dependencies({ ...ready, tables:tables.filter(name => name !== 'dk_generator_v2.calls'), compatibleWorker:false });
  deps.inspectDocker = async () => { throw new Error('Unavailable'); };
  const checks = await runDoctor(deps, { preStart:true });
  assert.equal(doctorExitCode(checks), 1);
  assert.equal(checks.some(item => item.name === 'Compatible heartbeat'), false);
  assert.match(checks.find(item => item.name === 'Required schemas and tables')!.details, /dk_generator_v2.calls/);
  assert.equal(checks.find(item => item.name === 'Engine')?.status, 'FAILED');
});

test('doctor does not print configured secrets or raw database errors', async () => {
  const deps = dependencies();
  deps.inspectDatabase = async () => { throw new Error(deps.environment.DATABASE_URL); };
  const output = JSON.stringify(await runDoctor(deps));
  assert.doesNotMatch(output, /private-password|test-provider-secret|test-anonymous-key/);
  assert.equal(doctorExitCode(await runDoctor(dependencies())), 0);
});

test('review deployment blocks writes before authentication and permits login/logout only', () => {
  for (const path of ['/api/generator/workbench','/api/jobs','/api/apps/image','/api/admin/members','/api/invites/accept']) {
    for (const method of ['POST','PATCH','DELETE','PUT']) assert.equal(readOnlyRequestBlocked('true',method,path),true);
    assert.equal(readOnlyRequestBlocked('true','GET',path),false);
  }
  assert.equal(readOnlyRequestBlocked('true','POST','/api/auth/login'),false);
  assert.equal(readOnlyRequestBlocked('true','POST','/api/auth/logout'),false);
  assert.equal(readOnlyRequestBlocked(undefined,'PATCH','/api/generator/workbench'),false);
});

test('Windows lifecycle validates project, executable entrypoint and process creation time without stopping anything', { skip:process.platform !== 'win32' }, () => {
  const root = resolve('.');
  const quote = (value:string) => "'" + value.replaceAll("'", "''") + "'";
  const command = [
    "$ErrorActionPreference = 'Stop'",
    '. ' + quote(resolve('scripts/local-processes.ps1')),
    '$root = ' + quote(root),
    "$entry = Get-LocalServiceEntry -ProjectRoot $root -Service worker",
    "$created = [datetime]'2026-09-05T10:00:00Z'",
    "$record = [pscustomobject]@{projectRoot=$root;service='worker';entryPoint=$entry;processId=4242;creationDate=$created.ToUniversalTime().ToString('o')}",
    '$process = [pscustomobject]@{ProcessId=4242;Name="node.exe";CreationDate=$created;CommandLine=(\'node "\' + $entry + \'"\')}',
    "if (-not (Test-LocalServiceIdentity $record $process $root worker)) { throw 'Valid identity rejected' }",
    "$record.creationDate = $created.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.FFFFFFFZ')",
    "$record = $record | ConvertTo-Json | ConvertFrom-Json",
    "if (-not (Test-LocalServiceIdentity $record $process $root worker)) { throw 'Equivalent serialized timestamp rejected' }",
    "$process.CreationDate = $created.AddSeconds(1)",
    "if (Test-LocalServiceIdentity $record $process $root worker) { throw 'Reused PID accepted' }",
    "$process.CreationDate = $created",
    '$process.CommandLine = \'node "\' + $entry + \'.backup"\'',
    "if (Test-LocalServiceIdentity $record $process $root worker) { throw 'Different entrypoint accepted' }",
    '$process.CommandLine = \'node "\' + $entry + \'"\'',
    "if (Test-LocalServiceIdentity $record $process ($root + '-other') worker) { throw 'Other workspace accepted' }",
    "foreach ($name in @('start-local.ps1','stop-local.ps1','local-processes.ps1')) {",
    '  $tokens=$null; $errors=$null',
    '  [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root ("scripts\\" + $name)),[ref]$tokens,[ref]$errors) | Out-Null',
    "  if ($errors.Count -gt 0) { throw ($errors | Out-String) }",
    '}',
    "'identity checks passed'",
  ].join('\n');
  const output = execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true});
  assert.match(output,/identity checks passed/);
});

test('versioned V2 installation includes every store table and worker isolation', () => {
  const migration = readFileSync(resolve('supabase/migrations/20260905200000_generator_v2_core.sql'),'utf8');
  for (const table of tables.filter(name => name.startsWith('dk_generator_v2.'))) {
    assert.ok(migration.includes('create table if not exists ' + table), table + ' absent from versioned installation');
  }
  assert.match(migration,/alter table dk_generator_v2\.workers enable row level security/);
  assert.doesNotMatch(migration,/\b(?:delete from|truncate|drop schema|drop table)\b/i);
});
