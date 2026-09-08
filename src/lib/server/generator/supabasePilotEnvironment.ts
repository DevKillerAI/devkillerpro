import { execFile, spawn } from 'node:child_process';
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, verify, type JsonWebKey } from 'node:crypto';
import { mkdir, open, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import postgres from 'postgres';
import { z } from 'zod';
import { identitySchema, sameIdentity, type GeneratorIdentity } from './contract';
import { withSupabasePilotDockerProxy } from './supabasePilotDockerProxy';
import { ensureSupabasePilotNetwork, inspectSupabasePilotNetworkCapacity, SupabasePilotNetworkUnavailableError } from './supabasePilotNetworks';

const exec = promisify(execFile);
const ROOT = path.resolve('.devkiller/generator-v2/environments');
const CLI = path.resolve('node_modules/supabase/dist/supabase.js');
const MIGRATOR = 'dk_v2_app_migrator';
const CONTROL = 'dk_v2_control';
const LABEL = 'devkiller.generator-v2.scope';
const GATEWAY_IMAGE = 'node@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e';
const HEX = /^[a-f0-9]{64}$/;
const locks = new Map<string, Promise<unknown>>();

/** Only non-privileged, app-scoped values may leave this infrastructure module. */
export type SupabasePilotEnvironment = {
  identity: GeneratorIdentity;
  scopeHash: string;
  stackId: string;
  network: string;
  previewNetwork: string;
  dbContainer: string;
  apiUrl: string;
  internalApiUrl: string;
  anonKey: string;
  schema: 'app';
  storageKey: string;
};
export type SupabasePilotMigrationEvidence = {
  scopeHash: string;
  fingerprint: string;
  files: { path: string; hash: string; appliedAt: string; reused: boolean }[];
  appliedAt: string;
};
/** Only a database-executed source error is repairable; provisioning/authentication failures are not. */
export class SupabasePilotMigrationError extends Error {
  readonly name = 'SupabasePilotMigrationError';
  readonly sourceLocal = true;
  constructor(message: string, readonly migrationPath: string, readonly sqlState: string) { super(message); }
}

export async function inspectSupabasePilotPrerequisites(signal?: AbortSignal): Promise<{ available: true; cliVersion: string } | { available: false; reason: string }> {
  try {
    const result = await exec(process.execPath, [CLI, '--version'], { windowsHide: true, timeout: 15000, maxBuffer: 4096, signal });
    const cliVersion = result.stdout.trim();
    if (cliVersion !== '2.116.0') throw new Error('This local infrastructure adapter is pinned to Supabase CLI 2.116.0.');
    await docker(['version', '--format', '{{.Server.Version}}'], signal);
    await inspectSupabasePilotNetworkCapacity(signal);
    return { available: true, cliVersion };
  } catch (error) { signal?.throwIfAborted(); return { available: false, reason: error instanceof SupabasePilotNetworkUnavailableError || (error instanceof Error && error.message.includes('pinned')) ? error.message : 'The installed Supabase CLI or local Docker engine is unavailable.' }; }
}
const bindingSchema = z.object({
  version: z.literal(1), identity: identitySchema, scopeHash: z.string().regex(HEX),
  stackId: z.string().regex(/^dk_v2_[a-f0-9]{32}$/), network: z.string().regex(/^dk-v2-[a-f0-9]{32}$/),
  apiPort: z.number().int().min(1024).max(65535), dbPort: z.number().int().min(1024).max(65535),
  shadowPort: z.number().int().min(1024).max(65535), keyId: z.string().uuid(),
  signingKeysHash: z.string().regex(HEX), configHash: z.string().regex(HEX), secretsHash: z.string().regex(HEX),
  createdAt: z.string().datetime(),
}).strict();
type Binding = z.infer<typeof bindingSchema>;
const secretsSchema = z.object({
  jwtSecret: z.string().regex(/^[a-f0-9]{96}$/), dbPassword: z.string().regex(/^[a-f0-9]{64}$/),
  publishableKey: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]{43}$/),
  secretKey: z.string().regex(/^sb_secret_[A-Za-z0-9_-]{43}$/),
}).strict();
type Secrets = z.infer<typeof secretsSchema>;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

export function supabasePilotScopeHash(identity: GeneratorIdentity): string {
  const value = identitySchema.parse(identity);
  return sha(JSON.stringify([value.ownerId, value.projectId, value.missionId, value.environmentId]));
}

function names(identity: GeneratorIdentity) {
  const scopeHash = supabasePilotScopeHash(identity);
  return { scopeHash, stackId: `dk_v2_${scopeHash.slice(0, 32)}`, network: `dk-v2-${scopeHash.slice(0, 32)}`, directory: path.join(ROOT, scopeHash) };
}

/** Exact identity and derived endpoint checks; never trusts a caller-selected container or URL. */
export function assertSupabasePilotEnvironmentBinding(environment: SupabasePilotEnvironment, identity: GeneratorIdentity): void {
  const expected = names(identity);
  if (!sameIdentity(identitySchema.parse(environment.identity), identitySchema.parse(identity)) ||
    environment.scopeHash !== expected.scopeHash || environment.stackId !== expected.stackId || environment.network !== expected.network || environment.previewNetwork !== `${expected.network}-preview` ||
    environment.dbContainer !== `supabase_db_${expected.stackId}` || environment.internalApiUrl !== `http://dk-v2-api-${expected.scopeHash.slice(0, 32)}:8000` ||
    !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/.test(environment.apiUrl) || Number(new URL(environment.apiUrl).port) > 65535 ||
    environment.schema !== 'app' || environment.storageKey !== `dk-v2-auth-${expected.scopeHash}`) {
    throw new Error('Supabase pilot environment does not match its exact generator identity.');
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]{43}$/.test(environment.anonKey)) {
    const claims = jwtParts(environment.anonKey);
    if (claims.payload.role !== 'anon' || claims.header.alg !== 'ES256') throw new Error('Only an environment-specific anonymous API key may reach generated code.');
  }
}

function jwtParts(token: string): { header: Record<string, unknown>; payload: Record<string, unknown>; unsigned: string; signature: Buffer } {
  if (typeof token !== 'string' || token.length > 4096) throw new Error('Invalid anonymous API key.');
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error('Invalid anonymous API key.');
  return { header: JSON.parse(Buffer.from(parts[0], 'base64url').toString()), payload: JSON.parse(Buffer.from(parts[1], 'base64url').toString()), unsigned: parts.slice(0, 2).join('.'), signature: Buffer.from(parts[2], 'base64url') };
}

async function docker(args: string[], signal?: AbortSignal, timeout = 30000): Promise<string> {
  signal?.throwIfAborted();
  return (await exec('docker', args, { windowsHide: true, timeout, signal, maxBuffer: 1_000_000 })).stdout.trim();
}

async function optionalInspect(kind: 'container' | 'network', name: string, signal?: AbortSignal): Promise<Record<string, any> | null> {
  try { return JSON.parse(await docker([kind, 'inspect', name], signal))[0]; }
  catch (error) {
    signal?.throwIfAborted();
    if (/No such (object|container|network)|network .+ not found/i.test(String((error as { stderr?: string }).stderr))) return null;
    throw new Error(`Cannot inspect dedicated pilot ${kind}.`);
  }
}

async function safeDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const [root, actual] = await Promise.all([realpath(ROOT), realpath(directory)]);
  const relative = path.relative(root, actual);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep)) throw new Error('Pilot environment directory escaped its dedicated root.');
}

async function locked<T>(identity: GeneratorIdentity, operation: () => Promise<T>): Promise<T> {
  const { scopeHash, directory } = names(identity);
  const preceding = locks.get(scopeHash);
  const job = (async () => {
    await preceding?.catch(() => undefined);
    await safeDirectory(directory);
    const lockPath = path.join(directory, '.operation.lock');
    let handle;
    try { handle = await open(lockPath, 'wx', 0o600); }
    catch { throw new Error('This pilot environment is being provisioned, or an interrupted operation needs inspection. No data was changed.'); }
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); return await operation(); }
    finally { await handle.close(); await unlink(lockPath); }
  })();
  locks.set(scopeHash, job);
  try { return await job; } finally { if (locks.get(scopeHash) === job) locks.delete(scopeHash); }
}

async function freePorts(): Promise<number[]> {
  const servers: net.Server[] = [];
  try {
    const ports: number[] = [];
    for (let index = 0; index < 3; index++) {
      const server = net.createServer(); servers.push(server);
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
      ports.push((server.address() as net.AddressInfo).port);
    }
    return ports;
  } finally { await Promise.all(servers.filter(server => server.listening).map(server => new Promise<void>(resolve => server.close(() => resolve())))); }
}

function configuration(value: Pick<Binding, 'stackId' | 'apiPort' | 'dbPort' | 'shadowPort'>): string {
  return `# Dedicated local v2 pilot. Generated app SQL is NEVER placed in this CLI workdir.\nproject_id = "${value.stackId}"\n\n[api]\nenabled = true\nport = ${value.apiPort}\nschemas = ["app"]\nextra_search_path = ["app"]\nmax_rows = 1000\nauto_expose_new_tables = false\n\n[db]\nport = ${value.dbPort}\nshadow_port = ${value.shadowPort}\nmajor_version = 17\nhealth_timeout = "2m"\n\n[db.migrations]\nenabled = false\n[db.seed]\nenabled = false\n[db.pooler]\nenabled = false\n[studio]\nenabled = false\n[local_smtp]\nenabled = false\n[storage]\nenabled = false\n[storage.vector]\nenabled = false\n[realtime]\nenabled = false\n[analytics]\nenabled = false\n[edge_runtime]\nenabled = false\n\n[auth]\nenabled = true\nsite_url = "http://127.0.0.1:3000"\nadditional_redirect_urls = []\nexternal_url = "http://127.0.0.1:${value.apiPort}/auth/v1"\njwt_issuer = "http://127.0.0.1:${value.apiPort}/auth/v1"\njwt_expiry = 3600\nsigning_keys_path = "./signing_keys.json"\njwt_secret = "env(DK_PILOT_JWT_SECRET)"\npublishable_key = "env(DK_PILOT_PUBLISHABLE_KEY)"\nsecret_key = "env(DK_PILOT_SECRET_KEY)"\nenable_signup = true\nenable_anonymous_sign_ins = false\nminimum_password_length = 10\n[auth.email]\nenable_signup = true\nenable_confirmations = false\nmax_frequency = "1s"\n[auth.rate_limit]\nsign_in_sign_ups = 120\ntoken_refresh = 300\n`;
}

async function createBinding(identity: GeneratorIdentity): Promise<Binding> {
  const derived = names(identity);
  // Refuse adoption of any pre-existing unbound containers/network, including legacy stacks.
  for (const service of ['db', 'auth', 'rest', 'kong']) if (await optionalInspect('container', `supabase_${service}_${derived.stackId}`)) throw new Error('Unbound pilot container already exists; refusing to adopt it.');
  if (await optionalInspect('network', derived.network)) throw new Error('Unbound pilot network already exists; refusing to adopt it.');
  if (await optionalInspect('network', `${derived.network}-services`)) throw new Error('Unbound pilot service network already exists; refusing to adopt it.');
  const [apiPort, dbPort, shadowPort] = await freePorts();
  const keyId = randomUUID();
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const signingKeys = JSON.stringify([{ ...privateKey.export({ format: 'jwk' }), kid: keyId, use: 'sig', alg: 'ES256', key_ops: ['sign', 'verify'] }]);
  const secrets: Secrets = { jwtSecret: randomBytes(48).toString('hex'), dbPassword: randomBytes(32).toString('hex'), publishableKey: `sb_publishable_${randomBytes(32).toString('base64url')}`, secretKey: `sb_secret_${randomBytes(32).toString('base64url')}` };
  const secretsText = JSON.stringify(secrets);
  const config = configuration({ ...derived, apiPort, dbPort, shadowPort });
  const binding: Binding = { version: 1, identity: identitySchema.parse(identity), scopeHash: derived.scopeHash, stackId: derived.stackId, network: derived.network, apiPort, dbPort, shadowPort, keyId, signingKeysHash: sha(signingKeys), configHash: sha(config), secretsHash: sha(secretsText), createdAt: new Date().toISOString() };
  await mkdir(path.join(derived.directory, 'supabase'), { recursive: true });
  // Private material stays outside every generated source/build/export directory.
  await writeFile(path.join(derived.directory, 'supabase/signing_keys.json'), signingKeys, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(derived.directory, 'secrets.json'), secretsText, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(derived.directory, 'supabase/config.toml'), config, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(derived.directory, 'binding.json'), JSON.stringify(binding, null, 2), { flag: 'wx', mode: 0o600 });
  return binding;
}

async function loadBinding(identity: GeneratorIdentity): Promise<{ binding: Binding; secrets: Secrets; signingKey: JsonWebKey }> {
  const expected = names(identity);
  const binding = bindingSchema.parse(JSON.parse(await readFile(path.join(expected.directory, 'binding.json'), 'utf8')));
  if (!sameIdentity(binding.identity, identity) || binding.scopeHash !== expected.scopeHash || binding.stackId !== expected.stackId || binding.network !== expected.network) throw new Error('Stored pilot environment identity mismatch.');
  const [config, secretsText, keysText] = await Promise.all([
    readFile(path.join(expected.directory, 'supabase/config.toml'), 'utf8'), readFile(path.join(expected.directory, 'secrets.json'), 'utf8'), readFile(path.join(expected.directory, 'supabase/signing_keys.json'), 'utf8'),
  ]);
  if (sha(config) !== binding.configHash || sha(secretsText) !== binding.secretsHash || sha(keysText) !== binding.signingKeysHash) throw new Error('Bound pilot infrastructure files changed; refusing to start or migrate.');
  const signingKey = JSON.parse(keysText)[0];
  if (signingKey.kid !== binding.keyId || signingKey.alg !== 'ES256' || signingKey.kty !== 'EC') throw new Error('Invalid dedicated signing key.');
  return { binding, secrets: secretsSchema.parse(JSON.parse(secretsText)), signingKey };
}

function cliEnvironment(secrets: Secrets): NodeJS.ProcessEnv {
  // Never inherit platform/provider credentials into local provisioning subprocesses.
  const allowed = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG'];
  const environment: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  for (const name of allowed) if (process.env[name]) environment[name] = process.env[name];
  return { ...environment, CI: 'true', SUPABASE_DB_PASSWORD: secrets.dbPassword, DK_PILOT_JWT_SECRET: secrets.jwtSecret, DK_PILOT_PUBLISHABLE_KEY: secrets.publishableKey, DK_PILOT_SECRET_KEY: secrets.secretKey };
}

async function cli(binding: Binding, secrets: Secrets, args: string[], signal?: AbortSignal): Promise<string> {
  try {
    const run = async (dockerHost?: string) => (await exec(process.execPath, [CLI, ...args, '--workdir', names(binding.identity).directory], { windowsHide: true, timeout: 180000, maxBuffer: 1_000_000, signal, env: { ...cliEnvironment(secrets), ...(dockerHost ? { DOCKER_HOST: dockerHost, DOCKER_CONTEXT: undefined } : {}) } })).stdout;
    if (args[0] === 'status') return await run();
    return await withSupabasePilotDockerProxy({ stackId: binding.stackId, directory: names(binding.identity).directory, network: `${binding.network}-services`, apiPort: binding.apiPort, dbPort: binding.dbPort }, host => run(host));
  }
  catch (error) {
    signal?.throwIfAborted();
    let reason = String((error as { stderr?: string }).stderr ?? (error instanceof Error && error.message.startsWith('Pinned Supabase CLI') ? error.message : '')).slice(-4000);
    for (const secret of Object.values(secrets)) reason = reason.replaceAll(secret, '[redacted]');
    reason = reason.replace(/[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted token]').replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, '[redacted key]');
    throw new Error(`Dedicated Supabase CLI operation failed; existing volumes and bindings were preserved. ${reason}`);
  }
}

async function checkContainers(binding: Binding, requireRunning: boolean, signal?: AbortSignal): Promise<void> {
  const expectedDirectory = names(binding.identity).directory;
  for (const service of ['db', 'auth', 'rest', 'kong']) {
    const info = await optionalInspect('container', `supabase_${service}_${binding.stackId}`, signal);
    if (!info) { if (requireRunning) throw new Error('Dedicated Supabase stack is incomplete.'); else continue; }
    const labels = info.Config?.Labels ?? {};
    if (labels['com.supabase.cli.project'] !== binding.stackId || path.resolve(labels['com.supabase.cli.workdir'] ?? '') !== expectedDirectory ||
      !info.NetworkSettings?.Networks?.[`${binding.network}-services`] || Object.keys(info.NetworkSettings.Networks).some(name => name !== `${binding.network}-services`)) throw new Error('Dedicated Supabase container binding mismatch.');
    for (const ports of Object.values(info.NetworkSettings?.Ports ?? {}) as any[]) for (const port of ports ?? []) if (port.HostIp !== '127.0.0.1') throw new Error('A dedicated Supabase port is not loopback-only.');
    if (requireRunning && (service === 'db' || service === 'kong') && !Object.values(info.NetworkSettings?.Ports ?? {}).some(ports => Array.isArray(ports) && ports.length > 0)) throw new Error('Dedicated Supabase loopback port is unavailable.');
    if (requireRunning && !info.State?.Running) throw new Error('Dedicated Supabase service is not running.');
  }
}

async function adminSql(binding: Binding, query: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn('docker', ['exec', '-i', '--user', 'postgres', `supabase_db_${binding.stackId}`, 'psql', '-X', '-q', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-A', '-t'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], signal });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill(), 45000);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 1_000_000) child.kill(); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout.trim()) : reject(new Error(`Dedicated database infrastructure operation failed: ${stderr.replace(/'[a-f0-9]{64,}'/g, "'[redacted]'")}`)); });
    child.stdin.on('error', () => undefined); child.stdin.end(query);
  });
}

async function bootstrap(binding: Binding, signal?: AbortSignal): Promise<void> {
  // Infrastructure permissions only: no generated business tables, policies, or business SQL.
  await adminSql(binding, `BEGIN;
DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${MIGRATOR}') THEN CREATE ROLE ${MIGRATOR} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; END $$;
ALTER ROLE ${MIGRATOR} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD NULL;
REVOKE CREATE ON DATABASE postgres FROM PUBLIC, ${MIGRATOR}, anon, authenticated;
REVOKE TEMPORARY ON DATABASE postgres FROM PUBLIC, ${MIGRATOR};
CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION ${MIGRATOR};
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO authenticated, anon;
CREATE SCHEMA IF NOT EXISTS ${CONTROL} AUTHORIZATION supabase_admin;
REVOKE ALL ON SCHEMA ${CONTROL} FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS ${CONTROL}.binding (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), scope_hash text NOT NULL);
INSERT INTO ${CONTROL}.binding(singleton,scope_hash) VALUES(true,'${binding.scopeHash}') ON CONFLICT(singleton) DO NOTHING;
DO $$ BEGIN IF (SELECT scope_hash FROM ${CONTROL}.binding WHERE singleton) <> '${binding.scopeHash}' THEN RAISE EXCEPTION 'Pilot database identity mismatch'; END IF; END $$;
CREATE TABLE IF NOT EXISTS ${CONTROL}.migrations (path text PRIMARY KEY, hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'), applied_at timestamptz);
REVOKE ALL ON ALL TABLES IN SCHEMA ${CONTROL} FROM PUBLIC, ${MIGRATOR}, anon, authenticated;
CREATE OR REPLACE FUNCTION ${CONTROL}.record_applied(migration_path text, migration_hash text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF session_user <> '${MIGRATOR}' THEN RAISE EXCEPTION 'Invalid migration principal'; END IF;
 UPDATE ${CONTROL}.migrations SET applied_at=clock_timestamp() WHERE path=migration_path AND hash=migration_hash AND applied_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Migration was not authorized'; END IF;
END $$;
REVOKE ALL ON FUNCTION ${CONTROL}.record_applied(text,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA ${CONTROL} TO ${MIGRATOR};
GRANT EXECUTE ON FUNCTION ${CONTROL}.record_applied(text,text) TO ${MIGRATOR};
REVOKE ALL ON SCHEMA public FROM PUBLIC, ${MIGRATOR}, anon, authenticated;
REVOKE ALL ON SCHEMA auth FROM PUBLIC, ${MIGRATOR};
REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM PUBLIC, ${MIGRATOR};
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auth FROM PUBLIC, ${MIGRATOR};
GRANT USAGE ON SCHEMA auth TO ${MIGRATOR}, authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt(), auth.role() TO ${MIGRATOR}, authenticated, anon;
GRANT REFERENCES(id) ON auth.users TO ${MIGRATOR};
DO $$ DECLARE s record; BEGIN FOR s IN SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('app','auth','${CONTROL}','pg_catalog','information_schema') AND nspname NOT LIKE 'pg_%' LOOP
 EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC, ${MIGRATOR}',s.nspname);
END LOOP; END $$;
ALTER DATABASE postgres RESET "app.settings.jwt_secret";
ALTER ROLE ${MIGRATOR} SET statement_timeout='20s';
ALTER ROLE ${MIGRATOR} SET lock_timeout='5s';
ALTER ROLE ${MIGRATOR} SET idle_in_transaction_session_timeout='25s';
ALTER ROLE authenticator SET pgrst.db_schemas='app';
NOTIFY pgrst,'reload config'; NOTIFY pgrst,'reload schema';
COMMIT;`, signal);
}

async function startStack(binding: Binding, secrets: Secrets, signal?: AbortSignal): Promise<void> {
  let finished = false;
  let launchError: unknown;
  const launched = cli(binding, secrets, ['start', '--network-id', `${binding.network}-services`, '-x', 'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'], signal).catch(error => { launchError = error; }).finally(() => { finished = true; });
  // PostgREST starts after the DB. Prepare only the empty namespace during startup, before its health check.
  for (let attempt = 0; attempt < 90 && !finished; attempt++) {
    signal?.throwIfAborted();
    const info = await optionalInspect('container', `supabase_db_${binding.stackId}`, signal);
    if (info?.State?.Running) {
      await checkContainers(binding, false, signal);
      try {
        await adminSql(binding, `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${MIGRATOR}') THEN CREATE ROLE ${MIGRATOR} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; END $$; CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION ${MIGRATOR};`, signal);
        break;
      } catch { signal?.throwIfAborted(); /* The database can still be initializing its socket. */ }
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  await launched;
  if (launchError) throw launchError;
}

async function environmentFrom(binding: Binding, secrets: Secrets, signingKey: JsonWebKey, signal?: AbortSignal): Promise<SupabasePilotEnvironment> {
  const values = JSON.parse(await cli(binding, secrets, ['status', '-o', 'json'], signal));
  const token = jwtParts(String(values.ANON_KEY ?? ''));
  const key = createPublicKey({ key: signingKey, format: 'jwk' });
  if (token.header.kid !== binding.keyId || !verify('sha256', Buffer.from(token.unsigned), { key, dsaEncoding: 'ieee-p1363' }, token.signature)) throw new Error('Supabase did not use its bound environment-specific signing key.');
  // The CLI re-signs legacy ES256 API tokens on every status call. Use the explicitly bound
  // opaque publishable key for stable client identity; Kong maps it to the anon principal.
  const anonKey = secrets.publishableKey;
  if (String(values.PUBLISHABLE_KEY ?? '') !== anonKey || token.payload.role !== 'anon') throw new Error('Supabase did not use its bound public application API key.');
  const result: SupabasePilotEnvironment = { identity: binding.identity, scopeHash: binding.scopeHash, stackId: binding.stackId, network: binding.network, previewNetwork: `${binding.network}-preview`, dbContainer: `supabase_db_${binding.stackId}`, apiUrl: `http://127.0.0.1:${binding.apiPort}`, internalApiUrl: `http://dk-v2-api-${binding.scopeHash.slice(0, 32)}:8000`, anonKey, schema: 'app', storageKey: `dk-v2-auth-${binding.scopeHash}` };
  assertSupabasePilotEnvironmentBinding(result, binding.identity);
  return result;
}

// Only this trusted, no-secret HTTP bridge joins both networks. Runners cannot resolve/reach the database.
const GATEWAY_SOURCE = `const http=require('node:http');const host=process.env.UPSTREAM;const anon=process.env.ANON_KEY;
http.createServer((req,res)=>{if(!req.url||!req.url.startsWith('/')||req.url.length>8192){res.writeHead(400);return res.end();}
const p=req.url.split('?')[0];const methods=['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'];
if(!methods.includes(req.method)||!(/^\\/auth\\/v1\\/(signup|token|user|logout|health|settings)$/.test(p)||/^\\/rest\\/v1\\/[a-z][a-z0-9_]*$/.test(p))){res.writeHead(403);return res.end('Outside app API boundary');}
if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,accept-profile,content-profile,prefer,x-client-info','access-control-allow-methods':methods.join(',')});return res.end();}
const headers={'apikey':anon,'accept-profile':'app','content-profile':'app'};for(const k of ['authorization','content-type','accept','prefer','x-client-info'])if(typeof req.headers[k]==='string')headers[k]=req.headers[k];
const out=http.request({host,port:8000,path:req.url,method:req.method,headers,timeout:20000},r=>{res.writeHead(r.statusCode||502,{...r.headers,'access-control-allow-origin':'*'});r.pipe(res)});
let bytes=0;req.on('data',chunk=>{bytes+=chunk.length;if(bytes>262144){out.destroy();req.destroy();}});out.on('timeout',()=>out.destroy());out.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('App API unavailable')});req.pipe(out);
}).listen(8000,'0.0.0.0');`;

async function ensureGateway(binding: Binding, environment: SupabasePilotEnvironment, signal?: AbortSignal, readOnly = false): Promise<void> {
  const name = `dk-v2-api-${binding.scopeHash.slice(0, 32)}`;
  const existing = await optionalInspect('container', name, signal);
  if (existing) {
    if (existing.Config?.Labels?.[LABEL] !== binding.scopeHash || existing.Config?.Labels?.['devkiller.gateway-source'] !== sha(GATEWAY_SOURCE) ||
      existing.Config?.Image !== GATEWAY_IMAGE || !existing.NetworkSettings?.Networks?.[`${binding.network}-services`] ||
      Object.keys(existing.NetworkSettings.Networks).some(network => ![binding.network, `${binding.network}-services`].includes(network))) throw new Error('Pilot API bridge binding mismatch.');
    if (!existing.NetworkSettings.Networks[binding.network]) {
      if (readOnly || existing.State?.Running) throw new Error('Pilot API bridge network setup is incomplete.');
      await docker(['network', 'connect', binding.network, name], signal);
    }
    if (!existing.State?.Running) { if (readOnly) throw new Error('Pilot API bridge is not running.'); await docker(['start', name], signal); }
    return;
  }
  if (readOnly) throw new Error('Pilot API bridge is unavailable.');
  await docker(['create', '--pull=never', '--name', name, '--label', `${LABEL}=${binding.scopeHash}`, '--label', `devkiller.gateway-source=${sha(GATEWAY_SOURCE)}`, '--network', `${binding.network}-services`, '--read-only', '--user=1000:1000', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=96m', '--cpus=.5', '--pids-limit=32', '-e', `UPSTREAM=supabase_kong_${binding.stackId}`, '-e', `ANON_KEY=${environment.anonKey}`, GATEWAY_IMAGE, 'node', '-e', GATEWAY_SOURCE], signal);
  await docker(['network', 'connect', binding.network, name], signal);
  await docker(['start', name], signal);
}

/** Starts only a dynamically identity-bound new v2 stack. Never resets, removes, or stops a stack. */
export async function ensureSupabasePilotEnvironment(identity: GeneratorIdentity, signal?: AbortSignal): Promise<SupabasePilotEnvironment> {
  identity = identitySchema.parse(identity);
  return locked(identity, async () => {
    signal?.throwIfAborted();
    const prerequisites = await inspectSupabasePilotPrerequisites(signal);
    if (!prerequisites.available) throw new Error(prerequisites.reason);
    try { await readFile(path.join(names(identity).directory, 'binding.json'), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await createBinding(identity); }
    const { binding, secrets, signingKey } = await loadBinding(identity);
    // The per-identity operation lock also serializes names. Docker IPAM performs
    // the cross-identity atomic subnet reservation; existing networks are attested only.
    for (const kind of ['runner', 'preview', 'services'] as const) await ensureSupabasePilotNetwork(binding.scopeHash, kind, signal);
    await checkContainers(binding, false, signal);
    await startStack(binding, secrets, signal);
    await checkContainers(binding, true, signal);
    await bootstrap(binding, signal);
    const environment = await environmentFrom(binding, secrets, signingKey, signal);
    await ensureGateway(binding, environment, signal);
    return environment;
  });
}

/** Read and attest existing infrastructure; never provisions or changes a stack. */
export async function readSupabasePilotEnvironment(identity: GeneratorIdentity, signal?: AbortSignal): Promise<SupabasePilotEnvironment> {
  const { binding, secrets, signingKey } = await loadBinding(identitySchema.parse(identity));
  await checkContainers(binding, true, signal);
  const network = await optionalInspect('network', binding.network, signal);
  if (!network?.Internal || network.Labels?.[LABEL] !== binding.scopeHash) throw new Error('Dedicated pilot network binding mismatch.');
  const environment = await environmentFrom(binding, secrets, signingKey, signal);
  await ensureGateway(binding, environment, signal, true);
  return environment;
}

export async function inspectSupabasePilotTableGuards(environment: SupabasePilotEnvironment, tableNames: readonly string[], signal?: AbortSignal): Promise<{ table: string; enabled: boolean; forced: boolean; ownerMigrator: boolean }[]> {
  assertSupabasePilotEnvironmentBinding(environment, environment.identity);
  if (!tableNames.length || tableNames.length > 16 || tableNames.some(name => !/^[a-z][a-z0-9_]{0,62}$/.test(name))) throw new Error('Invalid application table inspection request.');
  const attested = await readSupabasePilotEnvironment(environment.identity, signal);
  if (attested.apiUrl !== environment.apiUrl || attested.anonKey !== environment.anonKey) throw new Error('Pilot table inspection binding mismatch.');
  const { binding } = await loadBinding(environment.identity);
  return JSON.parse(await adminSql(binding, `SELECT coalesce(json_agg(t),'[]'::json) FROM (SELECT 'app.'||c.relname AS table, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced, pg_get_userbyid(c.relowner)='${MIGRATOR}' AS "ownerMigrator" FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind IN ('r','p') AND c.relname IN (${tableNames.map(name => `'${name}'`).join(',')})) t;`, signal));
}

/** A lexical splitter, not a SQL sanitizer: the database role remains the security boundary. */
export function supabasePilotMigrationStatements(content: string): string[] {
  if (!content.trim() || Buffer.byteLength(content) > 128 * 1024 || content.includes('\0')) throw new Error('Pilot migration is empty or exceeds its size limit.');
  const statements: string[] = [];
  let start = 0, index = 0, quote: string | null = null, dollar: string | null = null, block = 0, line = false;
  let lexical = '';
  const push = (end: number) => {
    if (lexical.trim()) {
      const prefix = lexical.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!/^(?:create (?:table|(?:unique )?index|policy) |alter (?:table|policy) |grant |revoke )/.test(prefix)) throw new Error('Pilot migrations allow bounded table/index/policy DDL and grants only; transaction control, procedural code, data deletion, and privileged operations are forbidden.');
      if (/^(?:grant|revoke) /.test(prefix) && !/^.{0,20}(?:select|insert|update|delete|usage|all|references|trigger|execute)/.test(prefix)) throw new Error('Role grants are forbidden in generated migrations.');
      statements.push(content.slice(start, end).trim());
    }
    start = end + 1; lexical = '';
  };
  while (index < content.length) {
    const ch = content[index], next = content[index + 1];
    if (line) { if (ch === '\n') { line = false; lexical += ' '; } index++; continue; }
    if (block) { if (ch === '/' && next === '*') { block++; index += 2; } else if (ch === '*' && next === '/') { block--; index += 2; } else index++; continue; }
    if (dollar) { if (content.startsWith(dollar, index)) { index += dollar.length; dollar = null; lexical += ' '; } else index++; continue; }
    if (quote) { if (ch === quote && next === quote) index += 2; else if (ch === quote) { quote = null; index++; lexical += ' '; } else if (ch === '\\') throw new Error('Backslash escape syntax is not supported in bounded pilot migrations.'); else index++; continue; }
    if (ch === '-' && next === '-') { line = true; index += 2; continue; }
    if (ch === '/' && next === '*') { block = 1; index += 2; lexical += ' '; continue; }
    if (ch === "'" || ch === '"') { quote = ch; index++; lexical += ' quoted '; continue; }
    if (ch === '$') { const match = content.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/); if (match) { dollar = match[0]; index += dollar.length; lexical += ' quoted '; continue; } }
    if (ch === '\\') throw new Error('Client commands are forbidden in generated migrations.');
    if (ch === ';') { push(index); index++; continue; }
    lexical += ch; index++;
  }
  if (quote || dollar || block) throw new Error('Unterminated SQL quote or comment.');
  push(content.length);
  if (!statements.length || statements.length > 100) throw new Error('Pilot migration statement limit exceeded.');
  return statements;
}

export function validateSupabasePilotMigrations(files: readonly { path: string; content: string }[]): { path: string; hash: string; statements: string[] }[] {
  const migrations = files.filter(file => file.path.startsWith('supabase/'));
  if (!migrations.length || migrations.length > 16) throw new Error('A pilot requires 1–16 generated migrations.');
  if (migrations.reduce((size, file) => size + Buffer.byteLength(file.content), 0) > 256 * 1024) throw new Error('Pilot migration set is too large.');
  const result = migrations.map(file => {
    if (!/^supabase\/migrations\/[0-9]{3,14}_[a-z][a-z0-9_]*\.sql$/.test(file.path)) throw new Error('Unexpected file in the pilot migration surface.');
    return { path: file.path, hash: sha(file.content), statements: supabasePilotMigrationStatements(file.content) };
  }).sort((a, b) => a.path.localeCompare(b.path));
  if (new Set(result.map(file => file.path)).size !== result.length || new Set(result.map(file => file.path.split('/').at(-1)!.split('_')[0])).size !== result.length) throw new Error('Duplicate pilot migration version.');
  return result;
}

async function ledger(binding: Binding, signal?: AbortSignal): Promise<{ path: string; hash: string; applied_at: string | null }[]> {
  return JSON.parse(await adminSql(binding, `SELECT coalesce(json_agg(t ORDER BY path),'[]'::json) FROM (SELECT path,hash,applied_at FROM ${CONTROL}.migrations) t;`, signal));
}

/** Append-only, exact-hash migrations under a real unprivileged login; all new SQL+receipts commit atomically. */
export async function applySupabasePilotMigrations(environment: SupabasePilotEnvironment, files: readonly { path: string; content: string }[], signal?: AbortSignal): Promise<SupabasePilotMigrationEvidence> {
  assertSupabasePilotEnvironmentBinding(environment, environment.identity);
  const migrations = validateSupabasePilotMigrations(files);
  return locked(environment.identity, async () => {
    const { binding, secrets, signingKey } = await loadBinding(environment.identity);
    await checkContainers(binding, true, signal);
    const attested = await environmentFrom(binding, secrets, signingKey, signal);
    if (attested.apiUrl !== environment.apiUrl || attested.anonKey !== environment.anonKey) throw new Error('Pilot migration endpoint or key does not match the stored binding.');
    const previous = await ledger(binding, signal);
    for (const record of previous) {
      const matching = migrations.find(migration => migration.path === record.path);
      if (!matching || matching.hash !== record.hash) throw new Error('Previously authorized or applied migration changed or disappeared. Use a pristine candidate environment; existing data was preserved.');
    }
    const alreadyApplied = previous.filter(record => record.applied_at).map(record => record.path);
    const pending = migrations.filter(migration => !alreadyApplied.includes(migration.path));
    if (pending.some(migration => alreadyApplied.some(old => migration.path < old))) throw new Error('Pilot migration versions must be append-only.');
    if (pending.length) {
      const password = randomBytes(32).toString('hex');
      await adminSql(binding, `BEGIN; ALTER ROLE ${MIGRATOR} LOGIN PASSWORD '${password}'; ${pending.map(migration => `INSERT INTO ${CONTROL}.migrations(path,hash) VALUES('${migration.path}','${migration.hash}') ON CONFLICT(path) DO NOTHING;`).join('\n')} COMMIT;`, signal);
      const client = postgres({ host: '127.0.0.1', port: binding.dbPort, database: 'postgres', username: MIGRATOR, password, max: 1, connect_timeout: 10, idle_timeout: 5, prepare: false, onnotice: () => undefined, connection: { statement_timeout: 20000, lock_timeout: 5000, idle_in_transaction_session_timeout: 25000, transaction_timeout: 60000 } });
      // Independent supervisor bound: generated SQL cannot extend it with set_config().
      let expired = false;
      const watchdog = setTimeout(() => {
        expired = true;
        void adminSql(binding, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename='${MIGRATOR}' AND pid<>pg_backend_pid();`).catch(() => client.end({ timeout: 0 }));
      }, 65000);
      const abort = () => { void client.end({ timeout: 0 }); };
      signal?.addEventListener('abort', abort, { once: true });
      try {
        signal?.throwIfAborted();
        await client.begin(async transaction => {
          await transaction.unsafe('SET LOCAL search_path=app,pg_catalog;');
          for (const migration of pending) {
            for (const statement of migration.statements) {
              signal?.throwIfAborted();
              try { await transaction.unsafe(statement); }
              catch (error) {
                signal?.throwIfAborted();
                if (expired) throw new Error('The bounded migration execution window expired; its transaction was interrupted and no repair was charged.');
                const state = (error as { code?: string }).code;
                if (state && /^(?:22|23|42|0A)/.test(state)) throw new SupabasePilotMigrationError(`Generated migration ${migration.path} was rejected by its restricted database role: ${(error as Error).message.slice(0, 1200)}`, migration.path, state);
                throw error;
              }
            }
            await transaction.unsafe(`SELECT ${CONTROL}.record_applied($1,$2)`, [migration.path, migration.hash]);
          }
        });
      } finally {
        clearTimeout(watchdog);
        signal?.removeEventListener('abort', abort);
        await client.end({ timeout: 2 });
        // Revoke login even on cancellation. Statement/connection timeouts bound abandoned sessions.
        await adminSql(binding, `ALTER ROLE ${MIGRATOR} NOLOGIN PASSWORD NULL; SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename='${MIGRATOR}' AND pid<>pg_backend_pid();`);
      }
      await adminSql(binding, "NOTIFY pgrst,'reload schema';", signal);
    }
    const committed = await ledger(binding, signal);
    const evidence: SupabasePilotMigrationEvidence = { scopeHash: binding.scopeHash, fingerprint: sha(JSON.stringify(migrations.map(({ path: filePath, hash }) => ({ path: filePath, hash })))), files: migrations.map(migration => {
      const applied = committed.find(record => record.path === migration.path && record.hash === migration.hash);
      if (!applied?.applied_at) throw new Error('Migration commit evidence is incomplete.');
      return { path: migration.path, hash: migration.hash, appliedAt: applied.applied_at, reused: alreadyApplied.includes(migration.path) };
    }), appliedAt: new Date().toISOString() };
    return evidence;
  });
}
