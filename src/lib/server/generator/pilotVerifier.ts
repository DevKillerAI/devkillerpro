import {isInfrastructureFailure} from './infrastructureFailure';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile, lstat } from 'node:fs/promises';
import {containerIdentityArgs} from './containerIdentity';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGeneratorSnapshot, type GeneratorSnapshot, type GeneratorSourceFile } from './versionedEdits';
import { BRIEFBOARD_RUNNER_IMAGE, BRIEFBOARD_VERIFIER_VERSION, BRIEFBOARD_SOURCE_PATHS, pilotArtifactDirectory, validateBriefboardSource, validateWorkbenchSource } from './pilotRuntime';
import { WORKBENCH_IMAGE, WORKBENCH_VERIFIER, workbenchJourneysSchema } from './workbenchContract';
import {assertSupabasePilotEnvironmentBinding,type SupabasePilotEnvironment} from './supabasePilotEnvironment';
import {workbenchEnvironmentIdentity,validateWorkbenchDatabaseSource} from './workbenchDatabase';

// Compatibility for existing worker/scripts; web routes import pilotRuntime directly.
export { BRIEFBOARD_RUNNER_IMAGE, BRIEFBOARD_VERIFIER_VERSION, BRIEFBOARD_SOURCE_PATHS,
  inspectBriefboardRuntime, pilotArtifactDirectory, validateBriefboardSource } from './pilotRuntime';

const exec = promisify(execFile);
const compiledPaths = ['index.html', 'assets/app.js', 'assets/app.css'];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export type PilotExecutedCheck = Readonly<{ id: string; passed: boolean; details: string }>;
export type PilotVerification = {
  status: 'passed' | 'failed' | 'unavailable';
  sourceHash: string;
  verifierVersion: string;
  runtimeImageId?: string;
  compiledHash?: string;
  compiledFiles: GeneratorSourceFile[];
  sourceExport?: { content: string; hash: string };
  checks: PilotExecutedCheck[];
  browser?: { checks: PilotExecutedCheck[]; failures: string[]; limitations: string[]; screenshots: string[]; executedAt: string; browserVersion?: string };
  failures: string[];
  limitations: string[];
  durationMs: number;
  databaseEnvironment?: {scopeHash:string;stackId:string;tableNames:string[]};
};

export function createPilotSourceExport(snapshot: GeneratorSnapshot) {
  const verified = snapshot.files.length > 2 || !snapshot.files.every(file => BRIEFBOARD_SOURCE_PATHS.includes(file.path as any))
    ? validateWorkbenchSource(snapshot)
    : validateBriefboardSource(snapshot);
  const content = JSON.stringify({ format: 'devkiller-source-v1', scope: verified.scope, revision: verified.revision,
    sourceHash: verified.hash, files: verified.files.map(({ path: sourcePath, content: source }) => ({ path: sourcePath, content: source })) }, null, 2);
  const restored = createGeneratorSnapshot(JSON.parse(content), { maxFiles: 24, maxFileBytes: 128 * 1024, maxSnapshotBytes: 512 * 1024 });
  if (restored.hash !== verified.hash) throw new Error('Source export changed candidate bytes.');
  return { content, hash: hash(content) };
}

function assertOutputDirectory(snapshot: GeneratorSnapshot, directory: string): string {
  const allowed = pilotArtifactDirectory(snapshot);
  const target = path.resolve(directory);
  if (target !== allowed && !target.startsWith(allowed + path.sep)) throw new Error('Evidence directory is outside this candidate scope.');
  return target;
}

/** Trusted-tool execution only. Generated TSX is parsed/bundled in Docker, never executed on the host. */
export async function verifyBriefboardPilot(args: {
  snapshot: GeneratorSnapshot;
  signal?: AbortSignal;
  outputDirectory?: string;
  expectedRuntimeImageId?: string;
  workbenchJourneys?: unknown;
  documentMetadata?: { title: string; description: string };
  database?: {environment:SupabasePilotEnvironment;tableNames:string[]};
}): Promise<PilotVerification> {
  const started = Date.now();
  const snapshot = args.workbenchJourneys !== undefined ? validateWorkbenchSource(args.snapshot) : validateBriefboardSource(args.snapshot);
  const destination = args.outputDirectory ? assertOutputDirectory(snapshot, args.outputDirectory) : undefined;
  const journeys = args.workbenchJourneys === undefined ? null : workbenchJourneysSchema.parse(args.workbenchJourneys);
  if(args.database){
    if(!journeys)throw new Error('Database verification requires the generic workbench journey contract.');
    assertSupabasePilotEnvironmentBinding(args.database.environment,workbenchEnvironmentIdentity(snapshot));
    if(JSON.stringify([...args.database.tableNames].sort())!==JSON.stringify(validateWorkbenchDatabaseSource(snapshot).tableNames))throw new Error('Database verification table allowlist differs from source.');
    if(!args.database.tableNames.length||args.database.tableNames.length>24||new Set(args.database.tableNames).size!==args.database.tableNames.length
      ||args.database.tableNames.some(name=>!/^[a-z][a-z0-9_]{0,62}$/.test(name)))throw new Error('Invalid database table verification allowlist.');
  }
  const result: PilotVerification = { status: 'unavailable', sourceHash: snapshot.hash, verifierVersion: journeys ? WORKBENCH_VERIFIER : BRIEFBOARD_VERIFIER_VERSION,
    compiledFiles: [], checks: [], failures: [], limitations: [
      'esbuild checks syntax/transpilation/bundling, not full TypeScript semantic types.',
      args.database?'Real isolated database/auth profile; live external AI, deployment and exhaustive product/security certification are outside these checks.'
        :'Browser-only localStorage pilot. No database, app authentication, live AI, deployment or full aesthetic certification.',
    ], durationMs: 0 };
  if(args.database)result.databaseEnvironment={scopeHash:args.database.environment.scopeHash,stackId:args.database.environment.stackId,tableNames:[...args.database.tableNames]};
  args.signal?.throwIfAborted();
  const work = await mkdtemp(path.join(tmpdir(), 'dk-v2-verify-'));
  const names: string[] = [];
  const docker = (command: string[], timeout = 15000, signal?: AbortSignal) => exec('docker', command, {
    windowsHide: true, timeout, signal, maxBuffer: 2 * 1024 * 1024,
  });
  try {
    const inspected = await docker(['image', 'inspect', journeys ? WORKBENCH_IMAGE : BRIEFBOARD_RUNNER_IMAGE, '--format', '{{.Id}}'], 15000, args.signal);
    const imageId = inspected.stdout.trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('Prepared pilot compiler/browser image is unavailable.');
    if (args.expectedRuntimeImageId && args.expectedRuntimeImageId !== imageId) throw new Error('Pilot runtime changed after preflight; no app code was executed.');
    result.runtimeImageId = imageId;
    if(args.database){
      const network=JSON.parse((await docker(['network','inspect',args.database.environment.network],15000,args.signal)).stdout)[0];
      if(!network.Internal||network.Labels?.['devkiller.generator-v2.scope']!==args.database.environment.scopeHash)throw new Error('Database verifier network is not the exact isolated project environment.');
    }
    const source = path.join(work, 'source'), compiled = path.join(work, 'compiled'), evidence = path.join(work, 'evidence');
    await mkdir(path.join(source, 'src'), { recursive: true }); await mkdir(compiled); await mkdir(evidence);
    for (const file of snapshot.files) {
      await mkdir(path.dirname(path.join(source, file.path)), { recursive: true });
      await writeFile(path.join(source, file.path), file.content, { flag: 'wx' });
    }

    const runContainer = async (mode: 'compile' | 'browser', input: string, output: string) => {
      const name = `dk-v2-${mode}-${randomUUID()}`; names.push(name);
      const environment=mode==='browser'?args.database?.environment:undefined;
      const command = ['run', '--pull=never', '--name', name, '--label', 'devkiller.generator-v2=true', '--network='+(environment?.network??'none'),
        '--read-only', ...containerIdentityArgs(), '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=768m', '--cpus=1', '--pids-limit=128',
        '--shm-size=128m', '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m',
        '--mount', `type=bind,source=${input},target=/candidate,readonly`,
        '--mount', `type=bind,source=${output},target=/output`];
      if(environment){
        const configDirectory=path.join(work,name+'-config');await mkdir(configDirectory);
        await writeFile(path.join(configDirectory,'runtime.json'),JSON.stringify({internalApiUrl:environment.internalApiUrl,anonKey:environment.anonKey,schema:'app',storageKey:environment.storageKey,tableNames:args.database!.tableNames}),{flag:'wx',mode:0o600});
        command.push('--mount',`type=bind,source=${configDirectory},target=/config,readonly`);
      }
      command.push(imageId,mode);
      try { return { completed: true, ...(await docker(command, mode === 'compile' ? 45000 : environment ? 300000 : 120000, args.signal)) }; }
      catch (error) {
        await docker(['stop', '--time', '1', name]).catch(() => undefined);
        args.signal?.throwIfAborted();
        return { completed: false, error: error as Error & { stdout?: string; stderr?: string; killed?: boolean; code?: number | string } };
      }
    };
    const build = await runContainer('compile', source, compiled);
    if (!build.completed) {
      const error = 'error' in build ? build.error : undefined;
      const codeFailure = typeof error?.code === 'number' && error.code !== 125 && !error.killed && !isInfrastructureFailure(error.stderr || error.message || '');
      const details = `${error?.stderr || error?.message || 'Compiler unavailable'}`.slice(-6000);
      result.status = codeFailure ? 'failed' : 'unavailable';
      if (codeFailure) { result.failures.push(details); result.checks.push({ id: 'platform:build', passed: false, details }); }
      else result.limitations.push(`Compilation did not complete: ${details}`);
      return result;
    }
    if (args.documentMetadata) {
      const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,character=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[character]!));
      const indexPath=path.join(compiled,'index.html'),buildPath=path.join(compiled,'build.json');
      const title=escapeHtml(args.documentMetadata.title.trim().slice(0,80));
      const description=escapeHtml(args.documentMetadata.description.replace(/\s+/g,' ').trim().slice(0,300));
      let html=await readFile(indexPath,'utf8');
      html=html.replace(/<title>[^<]*<\/title>/i,`<title>${title}</title>`);
      html=html.replace('</head>',`<meta name="description" content="${description}"></head>`);
      await writeFile(indexPath,html);
      const buildMetadata=JSON.parse(await readFile(buildPath,'utf8')) as {artifacts:{path:string;hash:string;bytes:number}[]};
      const declared=buildMetadata.artifacts.find(file=>file.path==='index.html');
      if(!declared)throw new Error('Compiled document metadata is unavailable.');
      declared.hash=hash(html);declared.bytes=Buffer.byteLength(html);
      await writeFile(buildPath,JSON.stringify(buildMetadata));
    }
    if ((await lstat(path.join(compiled, 'build.json'))).size > 128 * 1024) throw new Error('Build metadata exceeds the safety limit.');
    const metadata = JSON.parse(await readFile(path.join(compiled, 'build.json'), 'utf8')) as {
      compiler: string; semanticTypecheck: boolean; dependencies: Record<string, string>;
      sourceFileHashes: Record<string, string>; artifacts: { path: string; hash: string; bytes: number }[];
    };
    if (metadata.compiler !== 'esbuild' || metadata.semanticTypecheck !== false ||
        metadata.dependencies.react !== '19.2.8' || metadata.dependencies['react-dom'] !== '19.2.8' || metadata.dependencies.esbuild !== '0.28.2' ||
        (journeys && metadata.dependencies['lucide-react'] !== '0.468.0') ||
        snapshot.files.some(file => metadata.sourceFileHashes[file.path] !== file.hash)) throw new Error('Build metadata does not match the trusted runtime and input source.');
    for (const relative of compiledPaths) {
      const target = path.join(compiled, relative);
      const stat = await lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error('Invalid compiled artifact.');
      const content = await readFile(target, 'utf8');
      const declared = metadata.artifacts.find(file => file.path === relative);
      if (!declared || declared.hash !== hash(content) || declared.bytes !== Buffer.byteLength(content)) throw new Error('Compiled artifact hash mismatch.');
      result.compiledFiles.push({ path: relative, content });
    }
    result.compiledHash = hash(JSON.stringify(result.compiledFiles));
    result.checks.push({ id: 'platform:build', passed: true, details: 'Pinned esbuild/React compiled TSX into a self-contained browser bundle inside an offline, read-only-root container. No generated Node code was executed.' });
    result.sourceExport = createPilotSourceExport(snapshot);
    result.checks.push({ id: 'source:json-roundtrip', passed: true, details: 'All immutable source files round-trip through the JSON source export without changing bytes; ZIP/deployment packaging needs separate proof.' });
    if (journeys) await writeFile(path.join(compiled, 'journeys.json'), JSON.stringify(journeys), { flag: 'wx' });
    const browser = await runContainer('browser', compiled, evidence);
    if (!browser.completed && 'error' in browser && (browser.error?.killed || typeof browser.error?.code !== 'number' || browser.error?.code === 125)) {
      result.limitations.push('Browser environment did not complete; do not repair source for missing verification.');
      return result;
    }
    if ((await lstat(path.join(evidence, 'report.json'))).size > 2 * 1024 * 1024) throw new Error('Browser report exceeds the safety limit.');
    const report = JSON.parse(await readFile(path.join(evidence, 'report.json'), 'utf8')) as NonNullable<PilotVerification['browser']>&{unavailable?:boolean};
    if (!Array.isArray(report.checks) || report.checks.length < 1 || !Array.isArray(report.failures) || !Array.isArray(report.limitations) ||
        report.checks.some(check => typeof check.id !== 'string' || typeof check.passed !== 'boolean' || typeof check.details !== 'string')
        ||new Set(report.checks.map(check=>check.id)).size!==report.checks.length||report.checks.some(check=>!check.passed)!==(report.failures.length>0)) {
      throw new Error('Browser verification report is incomplete.');
    }
    result.browser = report;
    result.checks.push(...report.checks);
    result.failures.push(...report.failures);
    result.limitations.push(...report.limitations);
    result.status = report.unavailable ? 'unavailable' : report.failures.length ? 'failed' : browser.completed ? 'passed' : 'unavailable';
    result.durationMs = Date.now() - started;
    if (destination) {
      await mkdir(destination, { recursive: true });
      await writeFile(path.join(destination, 'verification.json'), JSON.stringify({ ...result, compiledFiles: undefined, sourceExport: undefined }, null, 2), { flag: 'wx' });
      for (const file of report.screenshots) {
        if (!/^(?:layout-(?:1440|390)|journey-mobile)\.png$/.test(file)) throw new Error('Unexpected screenshot name.');
        await copyFile(path.join(evidence, file), path.join(destination, file));
      }
    }
  } catch (error) {
    args.signal?.throwIfAborted();
    result.status = 'unavailable';
    result.limitations.push(`Pilot verification unavailable: ${error instanceof Error ? error.message.slice(0, 1600) : 'unknown runtime failure'}`);
  } finally {
    for (const name of names) await docker(['rm', '-f', name]).catch(() => undefined);
    // mkdtemp owns this exact directory; never an application workspace or shared Docker resource.
    const ownedWork = path.resolve(work), temporaryRoot = path.resolve(tmpdir());
    if (!ownedWork.startsWith(temporaryRoot + path.sep) || !path.basename(ownedWork).startsWith('dk-v2-verify-')) {
      throw new Error('Refusing cleanup outside the owned temporary verification directory.');
    }
    await rm(ownedWork, { recursive: true, force: true });
    result.durationMs = Date.now() - started;
  }
  return result;
}

