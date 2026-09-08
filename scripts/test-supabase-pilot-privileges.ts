import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';
import { readSupabasePilotEnvironment, applySupabasePilotMigrations, SupabasePilotMigrationError } from '../src/lib/server/generator/supabasePilotEnvironment';

async function main() {
  const scope = process.argv[2];
  if (!/^[a-f0-9]{64}$/.test(scope ?? '')) throw new Error('Provide an existing infrastructure-only QA scope hash.');
  const binding = JSON.parse(await readFile(`.devkiller/generator-v2/environments/${scope}/binding.json`, 'utf8'));
  if (binding.identity.ownerId !== 'v2-infrastructure-qa' || binding.identity.projectId !== 'local-security-proof') throw new Error('Privilege probes may not adopt application identities.');
  const environment = await readSupabasePilotEnvironment(binding.identity);
  const admin = (query: string) => {
    const result = spawnSync('docker', ['exec', '-i', '--user', 'postgres', environment.dbContainer, 'psql', '-X', '-q', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-A', '-t'], { input: query, encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 100000 });
    if (result.status !== 0) throw new Error('Infrastructure-only QA administrative fixture failed.');
    return result.stdout.trim();
  };
  const password = randomBytes(32).toString('hex');
  admin(`ALTER ROLE dk_v2_app_migrator LOGIN PASSWORD '${password}';`);
  const client = postgres({ host: '127.0.0.1', port: binding.dbPort, database: 'postgres', username: 'dk_v2_app_migrator', password, max: 1, prepare: false });
  const passed: string[] = [];
  try {
    const [privileges] = await client.unsafe("SELECT has_database_privilege(current_user,'postgres','CREATE') AS dbcreate,has_database_privilege(current_user,'postgres','TEMP') AS temporary,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls,current_setting('app.settings.jwt_secret',true) AS secret FROM pg_roles WHERE rolname=current_user");
    assert.equal(privileges.dbcreate, false); assert.equal(privileges.temporary, false); assert.equal(privileges.rolsuper, false); assert.equal(privileges.rolcreaterole, false); assert.equal(privileges.rolcreatedb, false); assert.equal(privileges.rolbypassrls, false); assert.ok(!privileges.secret);
    passed.push('no-admin-create-temp-bypass-or-jwt-secret');
    for (const [name, query] of [
      ['auth-read', 'SELECT count(*) FROM auth.users'], ['auth-write', 'ALTER TABLE auth.users ADD COLUMN denied_probe text'],
      ['catalog-password-read', 'SELECT rolpassword FROM pg_authid'], ['server-file-read', "SELECT pg_read_file('/etc/passwd')"],
      ['admin-role', 'SET ROLE supabase_admin'], ['set-config-admin-role', "SELECT set_config('role','supabase_admin',true)"],
      ['create-outside-schema', 'CREATE SCHEMA denied_probe'], ['create-temporary', 'CREATE TEMP TABLE denied_probe(id int)'],
      ['control-ledger-write', 'ALTER TABLE dk_v2_control.migrations ADD COLUMN denied_probe text'],
      ['auth-schema-object', 'CREATE TABLE auth.denied_probe(id int)'],
    ]) { await assert.rejects(client.unsafe(query), (error: { code?: string }) => error.code === '42501'); passed.push(name); }
  } finally { await client.end(); admin('ALTER ROLE dk_v2_app_migrator NOLOGIN PASSWORD NULL;'); }
  const baseline = { path: 'supabase/migrations/001_probe.sql', content: 'CREATE TABLE app.isolation_probe (id integer PRIMARY KEY, value text); ALTER TABLE app.isolation_probe ENABLE ROW LEVEL SECURITY;' };
  const negative = { path: 'supabase/migrations/002_atomic.sql', content: 'CREATE TABLE app.rollback_probe(id int); ALTER TABLE auth.users ADD COLUMN denied_probe text;' };
  await assert.rejects(applySupabasePilotMigrations(environment, [baseline, negative]), (error: unknown) => error instanceof SupabasePilotMigrationError && error.sqlState === '42501');
  assert.equal(admin("SELECT to_regclass('app.rollback_probe') IS NULL"), 't');
  assert.equal(admin("SELECT applied_at IS NULL FROM dk_v2_control.migrations WHERE path='supabase/migrations/002_atomic.sql'"), 't');
  assert.equal(admin("SELECT applied_at IS NOT NULL FROM dk_v2_control.migrations WHERE path='supabase/migrations/001_probe.sql'"), 't');
  passed.push('migration-and-receipt-atomic-rollback', 'applied-baseline-preserved');
  console.log(JSON.stringify({ scopeHash: scope, passed, count: passed.length, appDataPreserved: true }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Privilege QA failed'); process.exitCode = 1; });
