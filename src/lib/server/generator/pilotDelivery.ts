import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { candidateBindingSchema, sameCandidate, type CandidateBinding } from './releaseGate';
import type { GeneratorSnapshot } from './versionedEdits';
import { pilotArtifactDirectory } from './pilotRuntime';
import type { PilotVerification } from './pilotVerifier';
import { exportedBuildScript, exportedServerScript } from './pilotExportRuntime';

export type PilotDelivery = {
  candidate: CandidateBinding; compiledFiles: { path: string; content: string }[];
  compiledHash: string; checks: PilotVerification['checks']; limitations: string[];
  initialRevision: string; finalRevision: string; refinementVerified: boolean; durationMs: number;
  runtime?: { id: 'react-static-pilot' | 'react-supabase-pilot' | 'react-workbench'; version: 'v1' };
  runtimeImageId?: string;
  database?: { scopeHash: string; stackId: string; migrationFingerprint: string; environmentId: string };
  projectMetadata?: {
    title: string; description: string; locale: string; briefingMode: 'simple' | 'detailed';
    runtime: string; deliveryMode: 'complete' | 'partial'; revision: string;
    availableCapabilities: string[]; deferredCapabilities: string[];
  };
};
export function pilotBundleHash(files: PilotDelivery['compiledFiles']) { return createHash('sha256').update(JSON.stringify(files)).digest('hex'); }

/** Export actual source and actual compiled output, without manufacturing a different framework. */
export async function exportPilotZip(snapshot: GeneratorSnapshot, delivery: Pick<PilotDelivery, 'candidate' | 'compiledFiles' | 'compiledHash'> & Pick<Partial<PilotDelivery>, 'runtime' | 'projectMetadata'>) {
  if (snapshot.hash !== delivery.candidate.sourceHash || pilotBundleHash(delivery.compiledFiles) !== delivery.compiledHash) throw new Error('Pilot export integrity mismatch.');
  const zip = new JSZip();
  for (const file of snapshot.files) zip.file(file.path, file.content);
  for (const file of delivery.compiledFiles) {
    if (!['index.html', 'assets/app.js', 'assets/app.css'].includes(file.path)) throw new Error('Unexpected build artifact.');
    zip.file(`dist/${file.path}`, file.content);
  }
  const databaseApp = snapshot.files.some(file => /^supabase\/migrations\/001_.*\.sql$/.test(file.path));
  const dependencies={react:'19.2.8','react-dom':'19.2.8',esbuild:'0.28.2','lucide-react':'0.468.0',...(databaseApp?{'@supabase/supabase-js':'2.112.4'}:{})};
  const tables=[...new Set(snapshot.files.filter(file=>file.path.endsWith('.sql')).flatMap(file=>[...file.content.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?app\.([a-z][a-z0-9_]*)/gi)].map(match=>match[1])))];
  zip.file('package.json',JSON.stringify({name:'devkiller-export',private:true,type:'module',engines:{node:'>=22'},scripts:{start:'node --env-file-if-exists=.env server.mjs',build:'node build.mjs'},dependencies},null,2));
  zip.file('build.mjs',exportedBuildScript(delivery.projectMetadata?.title||'Generated app'));
  zip.file('server.mjs',exportedServerScript(databaseApp,tables));
  if(databaseApp)zip.file('.env.example','SUPABASE_URL=https://your-project.supabase.co\nSUPABASE_ANON_KEY=your-public-publishable-key\nPORT=3000\n');
  const runtime = delivery.runtime ? `${delivery.runtime.id}/${delivery.runtime.version}` : (databaseApp ? 'react-supabase-pilot/v1' : 'react-static-pilot/v1');
  zip.file('devkiller-manifest.json', JSON.stringify({ format: 'devkiller-pilot-export-v1', candidate: delivery.candidate,
    compiledHash: delivery.compiledHash, runtime,
    project: delivery.projectMetadata,
    dependencies: { react: '19.2.8', 'react-dom': '19.2.8', esbuild: '0.28.2', ...(delivery.runtime?.id === 'react-workbench' ? { 'lucide-react': '0.468.0' } : {}), ...(databaseApp ? { '@supabase/supabase-js': '2.112.4' } : {}) },
    sourceFiles: snapshot.files.map(file => ({ path: file.path, hash: file.hash })),
  }, null, 2));
  zip.file('README.txt', databaseApp
    ? 'Privateboard — DevKiller v2 database/Auth pilot\n\nExact generated React sources, additive SQL migrations and compiled assets are included. This app requires its own Supabase project and the reviewed runtime configuration before its JavaScript executes. No users, session tokens, API secrets, database passwords or existing database records are exported. Apply migrations in order using a restricted application-schema role, and serve through the same-origin Supabase proxy supplied by the runtime. The archive is not a one-click production deployment or a database backup. The original runtime and candidate are identified in devkiller-manifest.json.\n'
    : delivery.runtime?.id === 'react-workbench'
      ? 'DevKiller local React app\n\nThe dist directory contains the verified, self-contained static application. Serve dist through a static HTTP server. No OpenAI key, backend, login or database server is included. Any local app data is scoped to the browser and origin.\n\nsrc contains the exact generated React sources. The original compiler/runtime is identified in devkiller-manifest.json. This export does not claim deployment, server storage, or production readiness.\n'
      : 'Briefboard — DevKiller v2 pilot\n\nThe dist directory contains the verified, self-contained static application. Serve dist through a static HTTP server. No OpenAI key, backend, login or database server is included. Task data is local to the browser and origin.\n\nsrc contains the exact generated React sources. The original compiler/runtime is identified in devkiller-manifest.json. This export does not claim deployment, server storage, or production readiness.\n');
  zip.file('README.txt',`DevKiller V2 export\n\nThe original verified sources and dist bundle are included unchanged. Node22+ is required. Run npm start to serve the included bundle on loopback; npm install --ignore-scripts and npm run build rebuild edited source using the pinned direct dependencies. A rebuild is a new artifact and does not inherit the original verification.\n\n${databaseApp?'Database setup: create a separate Supabase project with an app schema, grant schema usage to authenticated, expose app through the Data API and apply the included migrations in order using a restricted role. Copy .env.example to .env and set only the project API origin and public anonymous/publishable key. Never use a service-role or secret key. The supplied server provides the same-origin REST/Auth proxy. No database records, users or credentials were exported.':'This is a browser app. Small local data is scoped to its browser origin; no backend database is included.'}\n\nDevKiller image/product-import bridges require a separately configured backend outside the editor. No automatic production deployment, TLS, backup/restore or external bridge setup is claimed. See devkiller-manifest.json for the original source and bundle identity.\n`);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const restored = await JSZip.loadAsync(buffer);
  for (const file of [...snapshot.files, ...delivery.compiledFiles.map(file => ({ ...file, path: `dist/${file.path}` }))]) {
    if (await restored.file(file.path)?.async('string') !== file.content) throw new Error('Pilot ZIP round-trip changed file bytes.');
  }
  return buffer;
}

export async function writePilotDelivery(snapshot: GeneratorSnapshot, delivery: PilotDelivery) {
  const directory = pilotArtifactDirectory(snapshot);
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, 'delivery.json');
  const payload = JSON.stringify(delivery);
  try { await writeFile(file, payload, { flag: 'wx' }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const previous = await readPilotDelivery(snapshot, delivery.candidate);
    if (!previous || previous.compiledHash !== delivery.compiledHash) throw new Error('Pilot delivery already exists with different bytes.');
  }
}
export async function readPilotDelivery(snapshot: GeneratorSnapshot, accepted: CandidateBinding): Promise<PilotDelivery | null> {
  try {
    const text = await readFile(path.join(pilotArtifactDirectory(snapshot), 'delivery.json'), 'utf8');
    if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new Error('Pilot delivery too large.');
    const result = JSON.parse(text) as PilotDelivery;
    candidateBindingSchema.parse(result.candidate);
    if (!sameCandidate(accepted, result.candidate) || !Array.isArray(result.compiledFiles) || result.compiledFiles.length !== 3 ||
        result.compiledFiles.some(file => !['index.html', 'assets/app.js', 'assets/app.css'].includes(file.path) || typeof file.content !== 'string') ||
        new Set(result.compiledFiles.map(file => file.path)).size !== 3 || pilotBundleHash(result.compiledFiles) !== result.compiledHash)
      throw new Error('Pilot delivery integrity mismatch.');
    return result;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
