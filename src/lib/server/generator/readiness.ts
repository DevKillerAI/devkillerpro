import 'server-only';
import { database } from '../database';
import { currentV2Readiness } from './preflight';
import { inspectWorkbenchRuntime } from './workbenchRuntime';
import { workbenchWorkerAvailable } from './workbenchStore';

/** Read-only infrastructure checks. Never submits AI calls, claims jobs or provisions containers. */
export async function inspectCurrentV2Readiness() {
  const diagnostics: string[] = [];
  const result = await Promise.allSettled([
    inspectWorkbenchRuntime(), workbenchWorkerAvailable(),
    database().begin('read only', async sql => {
      const [row] = await sql`select to_regclass('dk_generator_v2.campaigns') is not null
        and to_regclass('dk_generator_v2.runs') is not null
        and to_regclass('dk_generator_v2.calls') is not null as reservations,
        to_regclass('dk_rag.documents') is not null and to_regclass('dk_rag.chunks') is not null
        and to_regclass('dk_rag.retrieval_events') is not null as rag`;
      return { reservations: Boolean(row.reservations), rag: Boolean(row.rag) };
    }),
  ]);
  const runtimeAvailable = result[0].status === 'fulfilled' && result[0].value.available;
  const workerAvailable = result[1].status === 'fulfilled' && result[1].value;
  const reservationsAvailable = result[2].status === 'fulfilled' && result[2].value.reservations;
  const ragAvailable = result[2].status === 'fulfilled' && result[2].value.rag;
  const providerConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());
  const readOnly = process.env.DEVKILLER_READ_ONLY === 'true';
  if (!runtimeAvailable) diagnostics.push('WORKBENCH_RUNTIME_UNAVAILABLE');
  if (!workerAvailable) diagnostics.push('COMPATIBLE_WORKER_UNAVAILABLE');
  if (!reservationsAvailable) diagnostics.push('BUDGET_STORE_UNAVAILABLE');
  if (!ragAvailable) diagnostics.push('POSTGRESQL_RAG_UNAVAILABLE');
  if (!providerConfigured) diagnostics.push('PROVIDER_NOT_CONFIGURED');
  if (readOnly) diagnostics.push('READ_ONLY_PREVIEW');
  return currentV2Readiness({ observedAt: new Date().toISOString(), runtimeAvailable, workerAvailable,
    reservationsAvailable, providerConfigured, readOnly, ragAvailable, diagnostics });
}
