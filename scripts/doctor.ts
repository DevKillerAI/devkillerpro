import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { database, closeDatabase } from '../src/lib/server/database';
import { WORKBENCH_IMAGE, WORKBENCH_PROTOCOL_VERSION } from '../src/lib/server/generator/workbenchContract';

export type CheckItem = { category: string; name: string; status: 'PASSED' | 'FAILED' | 'WARNING'; details: string };
export type DatabaseSnapshot = { tables: string[]; compatibleWorker: boolean; approvedDocuments: number; embeddedChunks: number };
export type DoctorDependencies = {
  environment: NodeJS.ProcessEnv;
  nodeVersion: string;
  inspectDatabase: () => Promise<DatabaseSnapshot>;
  inspectDocker: (args: string[]) => Promise<string>;
};

const REQUIRED_TABLES = [
  'public.profiles', 'public.api_rate_limits',
  ...['campaigns', 'runs', 'events', 'calls', 'snapshots', 'asset_usage', 'workers'].map(name => 'dk_generator_v2.' + name),
  ...['documents', 'chunks', 'evaluations'].map(name => 'dk_rag.' + name),
];
const configured = (value?: string) => Boolean(value?.trim() && !/replace[-_ ]with|placeholder|your[-_ ](?:key|token)|example\.com/i.test(value));
const check = (category: string, name: string, passed: boolean, details: string): CheckItem =>
  ({ category, name, status: passed ? 'PASSED' : 'FAILED', details });

/** Readiness diagnostics only. No provider calls, migrations, ingestion, or worker claims. */
export async function runDoctor(deps: DoctorDependencies, options: { preStart?: boolean } = {}): Promise<CheckItem[]> {
  const items: CheckItem[] = [];
  const major = Number(deps.nodeVersion.replace(/^v/, '').split('.')[0]);
  items.push(check('Environment', 'Node runtime', Number.isInteger(major) && major >= 22, 'Node ' + deps.nodeVersion + '; version 22 or newer is required.'));
  items.push(check('Environment', 'Provider credentials', configured(deps.environment.OPENAI_API_KEY),
    configured(deps.environment.OPENAI_API_KEY) ? 'Configured; validity and model access were not tested. No paid request was made.' : 'OPENAI_API_KEY is missing or a placeholder.'));
  const authReady = configured(deps.environment.NEXT_PUBLIC_SUPABASE_URL) && configured(deps.environment.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  items.push(check('Environment', 'Authentication configuration', authReady,
    authReady ? 'Public Supabase URL and anonymous key are configured.' : 'Supabase URL or anonymous key is missing or a placeholder.'));

  let validDatabaseUrl = false;
  try {
    const url = new URL(deps.environment.DATABASE_URL || '');
    validDatabaseUrl = ['postgres:', 'postgresql:'].includes(url.protocol) && Boolean(url.hostname);
  } catch { /* Values and raw connection errors must never expose credentials. */ }
  items.push(check('Database', 'Connection configuration', validDatabaseUrl,
    validDatabaseUrl ? 'PostgreSQL connection configured.' : 'DATABASE_URL must be a PostgreSQL URL.'));
  if (validDatabaseUrl) {
    try {
      const state = await deps.inspectDatabase();
      const missing = REQUIRED_TABLES.filter(name => !state.tables.includes(name));
      items.push(check('Database', 'Required schemas and tables', missing.length === 0,
        missing.length ? 'Missing: ' + missing.join(', ') + '. Apply the versioned migrations.' : 'Platform, V2 and RAG tables are present.'));
      if (!options.preStart) items.push(check('Worker', 'Compatible heartbeat', state.compatibleWorker,
        state.compatibleWorker ? 'A worker for protocol ' + WORKBENCH_PROTOCOL_VERSION + ' reported within 45 seconds.'
          : 'No fresh heartbeat for protocol ' + WORKBENCH_PROTOCOL_VERSION + '. Start or update the V2 worker.'));
      items.push({ category: 'RAG', name: 'Reviewed corpus', status: state.approvedDocuments > 0 ? 'PASSED' : 'WARNING',
        details: state.approvedDocuments > 0 ? state.approvedDocuments + ' reviewed active documents.'
          : 'No reviewed active documents. Run rag:ingest before qualifying generation quality.' });
      items.push({ category: 'RAG', name: 'Stored embeddings', status: state.embeddedChunks > 0 ? 'PASSED' : 'WARNING',
        details: state.embeddedChunks > 0 ? state.embeddedChunks + ' stored chunk embeddings; retrieval quality still requires rag:evaluate.'
          : 'No stored embeddings. Retrieval is degraded; hybrid retrieval has not been qualified.' });
    } catch {
      items.push(check('Database', 'Readiness query', false, 'Unable to read the configured database. Check connectivity, migrations and server permissions. Connection details were suppressed.'));
    }
  }
  try {
    const version = await deps.inspectDocker(['info', '--format', '{{.ServerVersion}}']);
    items.push(check('Docker', 'Engine', Boolean(version.trim()), 'Docker engine responded.'));
    try {
      const imageId = (await deps.inspectDocker(['image', 'inspect', WORKBENCH_IMAGE, '--format', '{{.Id}}'])).trim();
      items.push(check('Docker', 'Exact Workbench runtime', /^sha256:[a-f0-9]{64}$/.test(imageId),
        /^sha256:[a-f0-9]{64}$/.test(imageId) ? WORKBENCH_IMAGE + ' is available.'
          : WORKBENCH_IMAGE + ' did not return an immutable image ID.'));
    } catch {
      items.push(check('Docker', 'Exact Workbench runtime', false, WORKBENCH_IMAGE + ' is missing. Build the reviewed runner images before starting generation.'));
    }
  } catch {
    items.push(check('Docker', 'Engine', false, 'Docker is unavailable. Generation cannot execute or verify code in isolation.'));
  }
  return items;
}

export function doctorExitCode(items: CheckItem[]) {
  return items.some(item => item.status === 'FAILED') ? 1 : 0;
}

async function inspectDatabase(): Promise<DatabaseSnapshot> {
  const sql = database();
  const tables = await sql`select table_schema || '.' || table_name as name from information_schema.tables
    where table_schema in ('public','dk_generator_v2','dk_rag')`;
  const names = tables.map(row => String(row.name));
  let compatibleWorker = false, approvedDocuments = 0, embeddedChunks = 0;
  if (names.includes('dk_generator_v2.workers')) {
    const prefix = 'v2-worker-' + WORKBENCH_PROTOCOL_VERSION + '-%';
    const [row] = await sql`select exists(select 1 from dk_generator_v2.workers
      where id like ${prefix} and seen_at > clock_timestamp() - interval '45 seconds') as available`;
    compatibleWorker = Boolean(row.available);
  }
  if (names.includes('dk_rag.documents')) {
    const [row] = await sql`select count(*)::int as count from dk_rag.documents where status='active'
      and trust in ('certified','verified') and reviewed_at is not null
      and (expires_at is null or expires_at > clock_timestamp())`;
    approvedDocuments = Number(row.count);
  }
  if (names.includes('dk_rag.chunks')) {
    const [row] = await sql`select count(*)::int as count from dk_rag.chunks where embedding is not null`;
    embeddedChunks = Number(row.count);
  }
  return { tables: names, compatibleWorker, approvedDocuments, embeddedChunks };
}

async function main() {
  const execute = promisify(execFile);
  try {
    const checks = await runDoctor({ environment: process.env, nodeVersion: process.version, inspectDatabase,
      inspectDocker: async args => (await execute('docker', args, {
        encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 32_000,
      })).stdout }, { preStart: process.argv.includes('--pre-start') });
    for (const item of checks) console.log('[' + item.status + '] ' + item.category + ' / ' + item.name + ': ' + item.details);
    const failures = checks.filter(item => item.status === 'FAILED').length;
    const warnings = checks.filter(item => item.status === 'WARNING').length;
    console.log('Readiness: ' + failures + ' blocking failure(s), ' + warnings + ' warning(s). These checks do not certify generated app quality.');
    process.exitCode = doctorExitCode(checks);
  } finally { await closeDatabase(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { console.error('Doctor could not complete. No provider request was made.'); process.exitCode = 1; });
}
