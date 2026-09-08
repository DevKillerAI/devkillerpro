import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { GeneratorIdentity } from './contract';
import { createGeneratorSnapshot, type GeneratorSnapshot } from './versionedEdits';
import { pilotArtifactDirectory } from './pilotRuntime';
import type { PilotVerification } from './pilotVerifier';
import { PRIVATEBOARD_RUNNER_IMAGE, PRIVATEBOARD_VERIFIER_VERSION, validatePrivateboardSource } from './supabasePilotRuntime';
import { assertSupabasePilotEnvironmentBinding, inspectSupabasePilotTableGuards, readSupabasePilotEnvironment,
  type SupabasePilotEnvironment, type SupabasePilotMigrationEvidence } from './supabasePilotEnvironment';

export { PRIVATEBOARD_RUNNER_IMAGE, PRIVATEBOARD_VERIFIER_VERSION, validatePrivateboardSource, inspectPrivateboardRuntime } from './supabasePilotRuntime';
const exec = promisify(execFile);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const compiledPaths = ['index.html', 'assets/app.js', 'assets/app.css'] as const;
const rowKeys = ['id', 'owner_id', 'title', 'done', 'request_id', 'created_at'] as const;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export type PrivateboardBaselineRow = { id: string; owner_id: string; title: string; done: boolean; request_id: string; created_at: string };
/** Private verifier state: NEVER include this object in public events, app configs or source exports. */
export type PrivateboardMigrationBaseline = {
  environmentScopeHash: string; sourceHash: string;
  email: string; password: string; ownerId: string; rows: PrivateboardBaselineRow[]; rowsHash: string;
};
export type PrivateboardVerification = PilotVerification & {
  environment: { scopeHash: string; stackId: string; migrationFingerprint?: string; comparisonScopeHash?: string;
    databaseRestart?: { databaseContainer: string; previousStartedAt: string; startedAt: string } };
  migrationBaseline?: PrivateboardMigrationBaseline;
};
type RunnerReport = NonNullable<PilotVerification['browser']> & { version: number; unavailable?: boolean };
type RunnerPrivateState = { migrationBaseline?: Omit<PrivateboardMigrationBaseline, 'environmentScopeHash' | 'sourceHash'>;
  foreignSession?: { accessToken: string; refreshToken: string } };
type BuildMetadata = { compiler: string; semanticTypecheck: boolean; dependencies: Record<string, string>;
  sourceFileHashes: Record<string, string>; artifacts: { path: string; hash: string; bytes: number }[] };

export function privateboardCompilerExitIsSourceFailure(code: unknown, killed = false): boolean {
  return code === 1 && !killed;
}
export function privateboardBaselineRowsHash(rows: PrivateboardBaselineRow[]): string {
  return hash(JSON.stringify(rows.map(row => Object.fromEntries(rowKeys.map(key => [key, row[key]]))).sort((a, b) => String(a.id).localeCompare(String(b.id)))));
}
export function validatePrivateboardBaseline(value: PrivateboardMigrationBaseline, environmentScopeHash: string): PrivateboardMigrationBaseline {
  if (!value || value.environmentScopeHash !== environmentScopeHash || !/^[a-f0-9]{64}$/.test(value.sourceHash) ||
    !/^[a-f0-9]{64}$/.test(value.rowsHash) || typeof value.email !== 'string' || !/^dk-[a-zA-Z0-9-]+@example\.test$/.test(value.email) ||
    typeof value.password !== 'string' || value.password.length < 10 || value.password.length > 180 || !UUID.test(value.ownerId) ||
    !Array.isArray(value.rows) || value.rows.length < 2 || value.rows.length > 16 ||
    value.rows.some(row => !UUID.test(row.id) || !UUID.test(row.request_id) || row.owner_id !== value.ownerId ||
      typeof row.title !== 'string' || !row.title.trim() || row.title.length > 1000 || typeof row.done !== 'boolean' ||
      typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) ||
    new Set(value.rows.map(row => row.id)).size !== value.rows.length || privateboardBaselineRowsHash(value.rows) !== value.rowsHash) {
    throw new Error('Private migration baseline is invalid or belongs to another environment.');
  }
  return value;
}
export function createPrivateboardSourceExport(snapshot: GeneratorSnapshot) {
  const verified = validatePrivateboardSource(snapshot);
  const content = JSON.stringify({ format: 'devkiller-source-v1', scope: verified.scope, revision: verified.revision,
    sourceHash: verified.hash, files: verified.files.map(({ path: filePath, content: source }) => ({ path: filePath, content: source })) }, null, 2);
  if (createGeneratorSnapshot(JSON.parse(content)).hash !== verified.hash) throw new Error('Source export changed candidate bytes.');
  return { content, hash: hash(content) };
}
export function validatePrivateboardMigrationEvidence(snapshot: GeneratorSnapshot, environment: SupabasePilotEnvironment,
  evidence: SupabasePilotMigrationEvidence): void {
  const expected = snapshot.files.filter(file => file.path.startsWith('supabase/migrations/')).map(file => ({ path: file.path, hash: file.hash }));
  if (!evidence || evidence.scopeHash !== environment.scopeHash || evidence.fingerprint !== hash(JSON.stringify(expected)) ||
    !Array.isArray(evidence.files) || evidence.files.length !== expected.length ||
    evidence.files.some((file, index) => file.path !== expected[index].path || file.hash !== expected[index].hash ||
      !Number.isFinite(Date.parse(file.appliedAt)) || typeof file.reused !== 'boolean')) {
    throw new Error('Migration receipts do not match this exact source snapshot and database environment.');
  }
}
function destinationFor(snapshot: GeneratorSnapshot, directory?: string): string | undefined {
  if (!directory) return undefined;
  const allowed = pilotArtifactDirectory(snapshot), target = path.resolve(directory);
  if (target !== allowed && !target.startsWith(allowed + path.sep)) throw new Error('Evidence directory is outside this candidate scope.');
  return target;
}
async function smallJson<T>(filename: string, maxBytes: number): Promise<T> {
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error('Invalid bounded verifier artifact.');
  return JSON.parse(await readFile(filename, 'utf8')) as T;
}
function validateReport(report: RunnerReport): void {
  if (report.version !== 1 || !Array.isArray(report.checks) || !Array.isArray(report.failures) || !Array.isArray(report.limitations) ||
    !Array.isArray(report.screenshots) || !Number.isFinite(Date.parse(report.executedAt)) || report.checks.length > 100 ||
    report.checks.some(check => typeof check.id !== 'string' || typeof check.passed !== 'boolean' || typeof check.details !== 'string') ||
    report.failures.some(failure => typeof failure !== 'string') || report.limitations.some(limitation => typeof limitation !== 'string') ||
    new Set(report.checks.map(check => check.id)).size !== report.checks.length ||
    report.checks.some(check => !check.passed) !== (report.failures.length > 0)) throw new Error('Trusted runner report is incomplete or inconsistent.');
}

/** Only platform Node is executed. The candidate compiler is offline; browser JS has a same-origin, allowlisted API bridge. */
export async function verifyPrivateboardPilot(args: {
  snapshot: GeneratorSnapshot;
  environment: SupabasePilotEnvironment;
  comparisonEnvironment?: SupabasePilotEnvironment;
  expectedEnvironmentIdentity?: GeneratorIdentity;
  expectedComparisonEnvironmentIdentity?: GeneratorIdentity;
  migrations?: SupabasePilotMigrationEvidence;
  migrationBaseline?: PrivateboardMigrationBaseline;
  signal?: AbortSignal;
  outputDirectory?: string;
  expectedRuntimeImageId?: string;
}): Promise<PrivateboardVerification> {
  const started = Date.now(), snapshot = validatePrivateboardSource(args.snapshot), destination = destinationFor(snapshot, args.outputDirectory);
  const expectedIdentity = args.expectedEnvironmentIdentity ?? snapshot.scope;
  if (expectedIdentity.ownerId !== snapshot.scope.ownerId || expectedIdentity.projectId !== snapshot.scope.projectId ||
    expectedIdentity.missionId !== snapshot.scope.missionId) throw new Error('Primary database identity is outside this candidate scope.');
  assertSupabasePilotEnvironmentBinding(args.environment, expectedIdentity);
  if (args.comparisonEnvironment) {
    const comparisonIdentity = args.expectedComparisonEnvironmentIdentity;
    if (!comparisonIdentity || comparisonIdentity.ownerId !== snapshot.scope.ownerId || comparisonIdentity.missionId !== snapshot.scope.missionId)
      throw new Error('An explicit owner/mission-bound comparison identity is required.');
    assertSupabasePilotEnvironmentBinding(args.comparisonEnvironment, comparisonIdentity);
    if (args.comparisonEnvironment.scopeHash === args.environment.scopeHash || args.comparisonEnvironment.network === args.environment.network ||
      args.comparisonEnvironment.anonKey === args.environment.anonKey) throw new Error('App-isolation proof requires independent environments and keys.');
  }
  if (args.migrationBaseline) validatePrivateboardBaseline(args.migrationBaseline, args.environment.scopeHash);
  if (args.migrations) validatePrivateboardMigrationEvidence(snapshot, args.environment, args.migrations);
  const result: PrivateboardVerification = { status: 'unavailable', sourceHash: snapshot.hash, verifierVersion: PRIVATEBOARD_VERIFIER_VERSION,
    compiledFiles: [], checks: [], failures: [], limitations: [
      'esbuild proves syntax/transpilation/bundling, not full TypeScript semantic typing.',
      'Local, isolated Supabase Auth/Postgres proof. No cloud deployment, email delivery, password recovery, MFA or exhaustive security certification.',
      'Wall-clock access-token expiration is not exercised; logout/refresh semantics are observed explicitly without claiming instant JWT revocation.',
    ], durationMs: 0, environment: { scopeHash: args.environment.scopeHash, stackId: args.environment.stackId,
      migrationFingerprint: args.migrations?.fingerprint, comparisonScopeHash: args.comparisonEnvironment?.scopeHash } };
  args.signal?.throwIfAborted();
  const work = await mkdtemp(path.join(tmpdir(), 'dk-v2-supabase-verify-')), names: string[] = [];
  const docker = (command: string[], timeout = 15000, signal?: AbortSignal) => exec('docker', command, {
    windowsHide: true, timeout, signal, maxBuffer: 2 * 1024 * 1024,
  });
  let evidenceDirectory: string | undefined;
  try {
    const imageId = (await docker(['image', 'inspect', PRIVATEBOARD_RUNNER_IMAGE, '--format', '{{.Id}}'], 15000, args.signal)).stdout.trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('Prepared Supabase compiler/browser image is unavailable.');
    if (args.expectedRuntimeImageId && args.expectedRuntimeImageId !== imageId) throw new Error('Supabase pilot runtime changed after preflight; no app code was executed.');
    result.runtimeImageId = imageId;
    // No caller-selected network may broaden the runner beyond the exact owned internal stack.
    for (const environment of [args.environment, ...(args.comparisonEnvironment ? [args.comparisonEnvironment] : [])]) {
      const network = JSON.parse((await docker(['network', 'inspect', environment.network], 15000, args.signal)).stdout)[0];
      if (!network.Internal || network.Labels?.['devkiller.generator-v2.scope'] !== environment.scopeHash)
        throw new Error('The verifier network is not the expected isolated environment.');
    }
    const source = path.join(work, 'source'), compiled = path.join(work, 'compiled');
    await mkdir(source); await mkdir(compiled);
    for (const file of snapshot.files) {
      await mkdir(path.dirname(path.join(source, file.path)), { recursive: true });
      await writeFile(path.join(source, file.path), file.content, { flag: 'wx' });
    }
    const runContainer = async (mode: 'compile' | 'api' | 'browser' | 'cross-app' | 'restart-proof', input: string, output: string,
      environment?: SupabasePilotEnvironment, extras?: Record<string, unknown>) => {
      const name = 'dk-v2-supabase-' + mode + '-' + randomUUID(); names.push(name);
      const configDirectory = path.join(work, name + '-config');
      const command = ['run', '--pull=never', '--name', name, '--label', 'devkiller.generator-v2=true',
        '--network=' + (environment?.network ?? 'none'), '--read-only', '--user=1000:1000', '--cap-drop=ALL',
        '--security-opt=no-new-privileges', '--memory=768m', '--cpus=1', '--pids-limit=128', '--shm-size=128m',
        '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m', '--mount', 'type=bind,source=' + input + ',target=/candidate,readonly',
        '--mount', 'type=bind,source=' + output + ',target=/output'];
      if (environment) {
        await mkdir(configDirectory);
        await writeFile(path.join(configDirectory, 'runtime.json'), JSON.stringify({
          internalApiUrl: environment.internalApiUrl, anonKey: environment.anonKey, schema: 'app', storageKey: environment.storageKey, ...extras,
        }), { flag: 'wx', mode: 0o600 });
        command.push('--mount', 'type=bind,source=' + configDirectory + ',target=/config,readonly');
      }
      command.push(imageId, mode);
      try { return { completed: true as const, ...(await docker(command, mode === 'browser' ? 210000 : mode === 'api' ? 120000 : 45000, args.signal)) }; }
      catch (error) {
        await docker(['stop', '--time', '1', name]).catch(() => undefined);
        args.signal?.throwIfAborted();
        return { completed: false as const, error: error as Error & { stdout?: string; stderr?: string; killed?: boolean; code?: string | number } };
      }
    };
    const build = await runContainer('compile', source, compiled);
    if (!build.completed) {
      // The trusted compiler uses exit 1 for a rejected source. Exec/OOM/signals are missing runtime proof.
      const sourceFailure = privateboardCompilerExitIsSourceFailure(build.error.code, build.error.killed);
      const details = String(build.error.stderr || build.error.message || 'Compiler unavailable').slice(-6000);
      result.status = sourceFailure ? 'failed' : 'unavailable';
      if (sourceFailure) { result.failures.push(details); result.checks.push({ id: 'platform:build', passed: false, details }); }
      else result.limitations.push('Compilation did not complete: ' + details);
      return result;
    }
    const metadata = await smallJson<BuildMetadata>(path.join(compiled, 'build.json'), 128 * 1024);
    if (metadata.compiler !== 'esbuild' || metadata.semanticTypecheck !== false || metadata.dependencies.react !== '19.2.8' ||
      metadata.dependencies['react-dom'] !== '19.2.8' || metadata.dependencies.esbuild !== '0.28.2' || metadata.dependencies['@supabase/supabase-js'] !== '2.112.4' ||
      Object.keys(metadata.sourceFileHashes).length !== snapshot.files.length || snapshot.files.some(file => metadata.sourceFileHashes[file.path] !== file.hash))
      throw new Error('Compiler dependency/source hashes do not match the trusted runtime and exact candidate.');
    for (const relative of compiledPaths) {
      const filename = path.join(compiled, relative), stat = await lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error('Invalid compiled artifact.');
      const content = await readFile(filename, 'utf8'), declared = metadata.artifacts.find(file => file.path === relative);
      if (!declared || declared.hash !== hash(content) || declared.bytes !== Buffer.byteLength(content)) throw new Error('Compiled artifact hash mismatch.');
      result.compiledFiles.push({ path: relative, content });
    }
    result.compiledHash = hash(JSON.stringify(result.compiledFiles));
    result.checks.push({ id: 'platform:build', passed: true, details: 'Pinned React/Supabase SDK/esbuild compiled exact TSX in an offline, unprivileged container. Generated code was never executed by Node.' });
    result.sourceExport = createPrivateboardSourceExport(snapshot);
    result.checks.push({ id: 'source:json-roundtrip', passed: true, details: 'Every immutable source/migration file round-trips exactly through the source export. ZIP packaging is independently verified at delivery.' });
    if (args.migrations) result.checks.push({ id: 'platform:migration-fresh', passed: true,
      details: 'All generated migrations have exact-hash committed receipts in this isolated environment; initial migration is present. Reused receipts do not claim a second fresh application.' });
    else result.limitations.push('No exact committed migration receipts supplied; migration-fresh remains unverified.');
    const guards = await inspectSupabasePilotTableGuards(args.environment, ['tasks'], args.signal);
    const rls = guards.length === 1 && guards[0].table === 'app.tasks' && guards[0].enabled && guards[0].forced && guards[0].ownerMigrator;
    const guardDetails = rls ? 'Postgres catalog confirms app.tasks has enabled and forced RLS and is owned by the restricted migration role.' :
      'Postgres catalog did not confirm enabled/forced RLS and the restricted owner for app.tasks.';
    result.checks.push({ id: 'platform:database-rls-schema', passed: rls, details: guardDetails });
    if (!rls) result.failures.push(guardDetails);
    const addReport = (report: RunnerReport) => {
      validateReport(report); result.checks.push(...report.checks); result.failures.push(...report.failures); result.limitations.push(...report.limitations);
    };
    const runEvidence = async (mode: 'api' | 'browser' | 'cross-app' | 'restart-proof', environment: SupabasePilotEnvironment, extras?: Record<string, unknown>) => {
      const output = path.join(work, mode + '-evidence'); await mkdir(output);
      const execution = await runContainer(mode, compiled, output, environment, extras);
      if (!execution.completed && (execution.error.killed || execution.error.code !== 1))
        throw new Error(mode + ' verification environment did not complete; missing evidence is not a generated-source failure.');
      const report = await smallJson<RunnerReport>(path.join(output, 'report.json'), 2 * 1024 * 1024);
      addReport(report);
      if (report.unavailable) throw new Error(mode + ' verification could not reach the real isolated service.');
      if (!execution.completed && !report.failures.length) throw new Error('Runner exited unsuccessfully without complete failure evidence.');
      return { output, report };
    };
    const api = await runEvidence('api', args.environment, { verifyUpgrade: snapshot.files.some(file => file.path.endsWith('/002_priority.sql')),
      ...(args.migrationBaseline ? { migrationBaseline: args.migrationBaseline } : {}) });
    const privateState = await smallJson<RunnerPrivateState>(path.join(api.output, 'private-state.json'), 128 * 1024).catch(error => {
      if (api.report.failures.length && (error as NodeJS.ErrnoException).code === 'ENOENT') return {} as RunnerPrivateState;
      throw error;
    });
    if (privateState.migrationBaseline) {
      result.migrationBaseline = validatePrivateboardBaseline({ ...privateState.migrationBaseline, environmentScopeHash: args.environment.scopeHash,
        sourceHash: args.migrationBaseline?.sourceHash ?? snapshot.hash }, args.environment.scopeHash);
    }
    if (result.migrationBaseline && !api.report.failures.length) {
      // The user-authorized restart targets only this freshly attested v2 database, never a v1 or other app container.
      const attested = await readSupabasePilotEnvironment(expectedIdentity, args.signal);
      if (attested.scopeHash !== args.environment.scopeHash || attested.dbContainer !== args.environment.dbContainer || attested.anonKey !== args.environment.anonKey)
        throw new Error('Database restart binding changed; no container was restarted.');
      const previousStartedAt = (await docker(['container', 'inspect', attested.dbContainer, '--format', '{{.State.StartedAt}}'], 15000, args.signal)).stdout.trim();
      if (!Number.isFinite(Date.parse(previousStartedAt))) throw new Error('Cannot attest the current database start time.');
      await docker(['restart', '--time', '10', attested.dbContainer], 45000, args.signal);
      const deadline = Date.now() + 45000;
      let ready = false;
      while (!ready && Date.now() < deadline) {
        args.signal?.throwIfAborted();
        try {
          await docker(['exec', '--user', 'postgres', attested.dbContainer, 'pg_isready', '-U', 'supabase_admin', '-d', 'postgres'], 5000, args.signal);
          ready = true;
        } catch {
          args.signal?.throwIfAborted();
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      if (!ready) throw new Error('The scoped database did not become ready after its authorized restart; this is unavailable infrastructure proof.');
      const startedAt = (await docker(['container', 'inspect', attested.dbContainer, '--format', '{{.State.StartedAt}}'], 15000, args.signal)).stdout.trim();
      if (!Number.isFinite(Date.parse(startedAt)) || Date.parse(startedAt) <= Date.parse(previousStartedAt))
        throw new Error('The exact database container did not attest a new start time.');
      result.environment.databaseRestart = { databaseContainer: attested.dbContainer, previousStartedAt, startedAt };
      await runEvidence('restart-proof', args.environment, { migrationBaseline: result.migrationBaseline,
        restartReceipt: result.environment.databaseRestart, verifyUpgrade: snapshot.files.some(file => file.path.endsWith('/002_priority.sql')) });
    } else result.limitations.push('Database restart persistence was not executed because a verified immutable baseline is unavailable.');
    if (snapshot.files.some(file => file.path.endsWith('/002_priority.sql')) && !args.migrationBaseline) {
      const details = 'The upgrade source exists but its pre-upgrade persisted fixture is missing; preservation cannot be claimed.';
      result.checks.push({ id: 'platform:migration-upgrade', passed: false, details }); result.failures.push(details);
    }
    if (args.comparisonEnvironment && privateState.foreignSession) {
      await runEvidence('cross-app', args.comparisonEnvironment, { foreignSession: privateState.foreignSession });
    } else result.limitations.push('Two-app token isolation was not executed; an independent comparison environment and live primary session are required.');
    const browser = await runEvidence('browser', args.environment,
      result.migrationBaseline ? { migrationBaseline: result.migrationBaseline } : undefined);
    evidenceDirectory = browser.output; result.browser = browser.report;
    result.status = result.failures.length ? 'failed' : 'passed';
  } catch (error) {
    args.signal?.throwIfAborted();
    result.status = 'unavailable';
    result.limitations.push('Privateboard verification unavailable: ' + (error instanceof Error ? error.message.slice(0, 1600) : 'unknown runtime failure'));
  } finally {
    result.durationMs = Date.now() - started;
    try {
      if (destination) {
        await mkdir(destination, { recursive: true });
        // Intentionally excludes test-account credentials, JWTs, source bytes and build bytes.
        await writeFile(path.join(destination, 'verification.json'), JSON.stringify({ ...result, compiledFiles: undefined,
          sourceExport: undefined, migrationBaseline: undefined }, null, 2), { flag: 'wx' });
        if (evidenceDirectory) for (const file of result.browser?.screenshots ?? []) {
          if (!/^(?:layout-(?:1440|390)|journey-mobile)\.png$/.test(file)) throw new Error('Unexpected screenshot evidence name.');
          const source = path.join(evidenceDirectory, file), stat = await lstat(source);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw new Error('Invalid screenshot evidence.');
          await copyFile(source, path.join(destination, file));
        }
      }
    } finally {
      for (const name of names) await docker(['rm', '-f', name]).catch(() => undefined);
      const owned = path.resolve(work), temporaryRoot = path.resolve(tmpdir());
      if (!owned.startsWith(temporaryRoot + path.sep) || !path.basename(owned).startsWith('dk-v2-supabase-verify-'))
        throw new Error('Refusing cleanup outside the exact owned temporary verifier directory.');
      await rm(owned, { recursive: true, force: true });
    }
    result.durationMs = Date.now() - started;
  }
  return result;
}
