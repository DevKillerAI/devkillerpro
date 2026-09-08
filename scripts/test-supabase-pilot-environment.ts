import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ensureSupabasePilotEnvironment, applySupabasePilotMigrations, readSupabasePilotEnvironment, SupabasePilotMigrationError } from '../src/lib/server/generator/supabasePilotEnvironment';

// Opt-in LOCAL infrastructure QA only. Every run uses new identities and keeps its data.
async function main() {
  if (!process.argv.includes('--local-isolated')) throw new Error('Pass --local-isolated to provision new dedicated QA environments.');
  const unique = randomUUID().replaceAll('-', '');
  const scopeArgument = process.argv.find(argument => argument.startsWith('--reuse-scope='))?.slice('--reuse-scope='.length);
  if (scopeArgument && !/^[a-f0-9]{64}$/.test(scopeArgument)) throw new Error('Invalid existing QA scope.');
  const identity = scopeArgument ? JSON.parse(await readFile(`.devkiller/generator-v2/environments/${scopeArgument}/binding.json`, 'utf8')).identity : { ownerId: 'v2-infrastructure-qa', projectId: 'local-security-proof', missionId: `probe-${unique}`, environmentId: 'first' };
  if (identity.ownerId !== 'v2-infrastructure-qa' || identity.projectId !== 'local-security-proof') throw new Error('QA may not adopt an application identity.');
  const first = await ensureSupabasePilotEnvironment(identity);
  console.log(JSON.stringify({ stage: 'provisioned', scopeHash: first.scopeHash, apiUrl: first.apiUrl }));
  assert.equal((await readSupabasePilotEnvironment(identity)).scopeHash, first.scopeHash);
  const files = [{ path: 'supabase/migrations/001_probe.sql', content: 'CREATE TABLE app.isolation_probe (id integer PRIMARY KEY, value text); ALTER TABLE app.isolation_probe ENABLE ROW LEVEL SECURITY;' }];
  const receipt = await applySupabasePilotMigrations(first, files);
  // A requested reuse can already contain the exact committed probe from an earlier interrupted QA run.
  if (!scopeArgument) assert.equal(receipt.files[0].reused, false);
  else assert.equal(typeof receipt.files[0].reused, 'boolean');
  assert.equal((await applySupabasePilotMigrations(first, files)).files[0].reused, true);
  await assert.rejects(applySupabasePilotMigrations(first, [{ ...files[0], content: `${files[0].content}\n` }]), /changed/);
  const second = await ensureSupabasePilotEnvironment({ ...identity, environmentId: 'second' });
  assert.notEqual(second.anonKey, first.anonKey);
  for (const [name, content] of (process.argv.includes('--all-negative') ? [
    ['auth-write', 'ALTER TABLE auth.users ADD COLUMN attacker text;'],
    ['admin-grant', 'GRANT ALL ON DATABASE postgres TO dk_v2_app_migrator;'],
    ['catalog-read', 'CREATE TABLE app.stolen AS SELECT rolpassword FROM pg_authid;'],
    ['file-read', "CREATE TABLE app.stolen AS SELECT pg_read_file('/etc/passwd');"],
    ['control-write', 'ALTER TABLE dk_v2_control.migrations ADD COLUMN attacker text;'],
    ['role-escalation', "CREATE TABLE app.stolen AS SELECT set_config('role','supabase_admin',true);"],
  ] : [['auth-write', 'ALTER TABLE auth.users ADD COLUMN attacker text;']])) {
    const candidate = process.argv.includes('--all-negative') ? await ensureSupabasePilotEnvironment({ ...identity, environmentId: `negative-${name}` }) : second;
    await assert.rejects(applySupabasePilotMigrations(candidate, [{ path: 'supabase/migrations/001_negative.sql', content }]), (error: unknown) => error instanceof SupabasePilotMigrationError);
    console.log(JSON.stringify({ stage: 'denied', probe: name, scopeHash: candidate.scopeHash }));
  }
  const credentials = { email: `probe-${unique}@example.test`, password: `Qa-${unique}!` };
  const signup = await fetch(`${first.apiUrl}/auth/v1/signup`, { method: 'POST', headers: { apikey: first.anonKey, 'content-type': 'application/json' }, body: JSON.stringify(credentials) });
  const session = await signup.json();
  assert.equal(signup.ok, true, 'local app Auth must issue an independent test session');
  assert.equal(typeof session.access_token, 'string');
  const cross = await fetch(`${second.apiUrl}/auth/v1/user`, { headers: { apikey: second.anonKey, Authorization: `Bearer ${session.access_token}` } });
  assert.equal(cross.ok, false, 'another environment must reject the first JWT');
  console.log(JSON.stringify({ stage: 'passed', firstScopeHash: first.scopeHash, secondScopeHash: second.scopeHash, crossAppStatus: cross.status, migrationHash: receipt.files[0].hash, preserved: true }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Infrastructure QA failed'); process.exitCode = 1; });
