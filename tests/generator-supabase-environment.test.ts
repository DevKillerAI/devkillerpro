import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSupabasePilotEnvironmentBinding, supabasePilotMigrationStatements, supabasePilotScopeHash, validateSupabasePilotMigrations, type SupabasePilotEnvironment } from '../src/lib/server/generator/supabasePilotEnvironment';
import { rewriteSupabasePilotCreate } from '../src/lib/server/generator/supabasePilotDockerProxy';
import path from 'node:path';

const identity = { ownerId: 'qa-owner', projectId: 'qa-project', missionId: 'qa-mission', environmentId: 'qa-environment' };
test('dedicated environment hash binds all four identity dimensions and rejects path-bearing IDs', () => {
  const original = supabasePilotScopeHash(identity);
  for (const key of Object.keys(identity)) assert.notEqual(supabasePilotScopeHash({ ...identity, [key]: 'other' }), original);
  assert.throws(() => supabasePilotScopeHash({ ...identity, environmentId: '../existing' }));
});
test('environment assertion rejects identity, stack, network and API substitution', () => {
  const scopeHash = supabasePilotScopeHash(identity), suffix = scopeHash.slice(0, 32);
  const anonKey = `${Buffer.from(JSON.stringify({ alg: 'ES256' })).toString('base64url')}.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.c2ln`;
  const environment: SupabasePilotEnvironment = { identity, scopeHash, stackId: `dk_v2_${suffix}`, network: `dk-v2-${suffix}`, previewNetwork: `dk-v2-${suffix}-preview`, dbContainer: `supabase_db_dk_v2_${suffix}`, apiUrl: 'http://127.0.0.1:55333', internalApiUrl: `http://dk-v2-api-${suffix}:8000`, anonKey, schema: 'app', storageKey: `dk-v2-auth-${scopeHash}` };
  assert.doesNotThrow(() => assertSupabasePilotEnvironmentBinding(environment, identity));
  for (const override of [{ identity: { ...identity, ownerId: 'other' } }, { scopeHash: '0'.repeat(64) }, { stackId: 'dk_roomledger' }, { network: 'devkiller-local' }, { dbContainer: 'supabase_db_dk_war_room' }, { apiUrl: 'http://localhost:54321' }, { internalApiUrl: 'http://platform:8000' }, { storageKey: 'shared' }]) assert.throws(() => assertSupabasePilotEnvironmentBinding({ ...environment, ...override }, identity));
  const privileged = `${anonKey.split('.')[0]}.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.c2ln`;
  assert.throws(() => assertSupabasePilotEnvironmentBinding({ ...environment, anonKey: privileged }, identity), /anonymous/);
});
test('bounded SQL lexer preserves semicolons in strings and comments but refuses transaction escape and client commands', () => {
  const statements = supabasePilotMigrationStatements("-- COMMIT;\nCREATE TABLE app.probe (value text default 'a;b'); /* nested /* comment; */ safe */ ALTER TABLE app.probe ADD COLUMN state text default $$x;y$$;");
  assert.equal(statements.length, 2);
  for (const sql of ['COMMIT;', 'BEGIN; CREATE TABLE app.probe(x int);', 'CREATE TABLE app.probe(x int); ROLLBACK;', 'DO $$ BEGIN END $$;', 'COPY app.probe TO PROGRAM \'x\';', 'GRANT supabase_admin TO dk_v2_app_migrator;', 'SET ROLE supabase_admin;', 'RESET ROLE;', 'DROP TABLE app.probe;', 'TRUNCATE app.probe;', 'DELETE FROM app.probe;', '\\! arbitrary', 'CREATE TABLE app.probe(value text DEFAULT \'unterminated);', 'CREATE TABLE app.probe(x int); /* unterminated', "CREATE TABLE app.probe(x text default E'\\x');"]) assert.throws(() => supabasePilotMigrationStatements(sql), Error, sql);
});
test('migration set hashes exact bytes, rejects duplicate versions and unexpected infrastructure files', () => {
  const file = { path: 'supabase/migrations/001_probe.sql', content: 'CREATE TABLE app.probe(x int);' };
  const [first] = validateSupabasePilotMigrations([file]);
  assert.notEqual(first.hash, validateSupabasePilotMigrations([{ ...file, content: `${file.content}\n` }])[0].hash);
  assert.throws(() => validateSupabasePilotMigrations([file, file]), /Duplicate/);
  assert.throws(() => validateSupabasePilotMigrations([file, { ...file, path: 'supabase/migrations/001_other.sql' }]), /Duplicate/);
  assert.throws(() => validateSupabasePilotMigrations([{ ...file, path: 'supabase/config.toml' }]), /Unexpected/);
  assert.throws(() => validateSupabasePilotMigrations([{ ...file, path: 'supabase/migrations/../../001_probe.sql' }]), /Unexpected/);
});

test('Docker create rewriting is exact-scope and loopback-only with no host mount/capability escape', () => {
  const boundary = { stackId: `dk_v2_${'a'.repeat(32)}`, network: `dk-v2-${'a'.repeat(32)}-services`, directory: path.resolve('.devkiller/generator-v2/environments', 'a'.repeat(64)), apiPort: 60001, dbPort: 60002 };
  const name = `supabase_db_${boundary.stackId}`;
  const fresh = () => ({ Image: 'public.ecr.aws/supabase/postgres:17.6.1.165', Labels: { 'com.supabase.cli.project': boundary.stackId, 'com.supabase.cli.workdir': boundary.directory }, HostConfig: { NetworkMode: boundary.network, PortBindings: { '5432/tcp': [{ HostPort: '60002', HostIp: '' }] }, Binds: [`${name}:/var/lib/postgresql/data`] } });
  assert.equal(rewriteSupabasePilotCreate(boundary, name, fresh()).HostConfig.PortBindings['5432/tcp'][0].HostIp, '127.0.0.1');
  assert.throws(() => rewriteSupabasePilotCreate(boundary, 'supabase_db_dk_war_room', fresh()));
  for (const mutation of [{ NetworkMode: 'host' }, { Privileged: true }, { Binds: ['/:/host'] }, { VolumesFrom: ['supabase_db_dk_war_room'] }, { CapAdd: ['SYS_ADMIN'] }, { PidMode: 'container:platform' }, { Mounts: [{ Type: 'bind', Source: '/var/run/docker.sock', Target: '/sock' }] }, { PortBindings: { '5432/tcp': [{ HostIp: '', HostPort: '54322' }] } }]) {
    const create = fresh(); assert.throws(() => rewriteSupabasePilotCreate(boundary, name, { ...create, HostConfig: { ...create.HostConfig, ...mutation } }));
  }
});
