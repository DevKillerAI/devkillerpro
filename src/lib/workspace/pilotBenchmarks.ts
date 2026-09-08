export const PILOT_BENCHMARKS = ['briefboard', 'privateboard'] as const;
export type PilotBenchmark = typeof PILOT_BENCHMARKS[number];
export type PilotRuntimeIdentity = { id: string; version: string };
export const PILOT_BENCHMARK_LABELS: Record<PilotBenchmark, string> = { briefboard: 'Briefboard', privateboard: 'Privateboard' };
export type PilotBenchmarkReadiness = {
  id: PilotBenchmark; label: string; brief: string; runtime: PilotRuntimeIdentity;
  available: boolean; runtimeAvailable: boolean; providerConfigured: boolean;
  reason: string | null; prerequisites: string[];
};
export type PilotPreviewState = { kind: 'browser-local' | 'database' | 'unsupported'; url: string | null; reason: string | null };
export const PRIVATEBOARD_PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-same-origin';

/** The database app has its own loopback hostname, never the DevKiller origin. */
export function privateboardPreviewUrl(value: unknown, parentOrigin: string): string | null {
  if (typeof value !== 'string' || value.length > 200 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    const port = Number(url.port);
    if (url.protocol !== 'http:' || !/^dk-v2-[a-f0-9]{24}\.localhost$/.test(url.hostname) ||
      !Number.isInteger(port) || port < 1024 || port > 65535 || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || url.origin === new URL(parentOrigin).origin) return null;
    return url.href;
  } catch { return null; }
}

/** Display authorization is candidate-bound too; the protected API repeats it. */
export function isAcceptedPrivateboardDelivery(
  run: Pick<PilotRun, 'contract' | 'identity' | 'contractHash' | 'accepted'>,
  delivery: Pick<PilotDelivery, 'candidate' | 'runtime'> | null,
): boolean {
  if (pilotBenchmarkForRuntime(run.contract.runtime) !== 'privateboard' || !delivery?.runtime ||
    pilotBenchmarkForRuntime(delivery.runtime) !== 'privateboard' || !run.accepted) return false;
  const accepted = run.accepted, candidate = delivery.candidate;
  const identityKeys = ['ownerId', 'projectId', 'missionId', 'environmentId'] as const;
  return identityKeys.every(key => candidate.identity[key] === accepted.identity[key] && candidate.identity[key] === run.identity[key] && candidate.identity[key] === run.contract.identity[key]) &&
    accepted.sourceHash === candidate.sourceHash && accepted.revision === candidate.revision &&
    accepted.runtimeDigest === candidate.runtimeDigest && accepted.contractHash === candidate.contractHash && candidate.contractHash === run.contractHash;
}

/** Unknown runtimes must never fall back to the browser-storage preview. */
export function pilotBenchmarkForRuntime(runtime: PilotRuntimeIdentity): PilotBenchmark | null {
  if (runtime.version !== 'v1') return null;
  if (runtime.id === 'react-static-pilot') return 'briefboard';
  if (runtime.id === 'react-supabase-pilot') return 'privateboard';
  return null;
}

export function pilotPreviewState(runtime: PilotRuntimeIdentity): PilotPreviewState {
  const benchmark = pilotBenchmarkForRuntime(runtime);
  if (benchmark === 'briefboard') return { kind: 'browser-local', url: null, reason: null };
  if (benchmark === 'privateboard') return { kind: 'database', url: null, reason: 'Database preview requires runtime startup. No browser-storage substitute is used.' };
  return { kind: 'unsupported', url: null, reason: 'No preview is available for this runtime.' };
}

export function pilotBenchmarkLabel(runtime: PilotRuntimeIdentity): string {
  const benchmark = pilotBenchmarkForRuntime(runtime);
  return benchmark ? PILOT_BENCHMARK_LABELS[benchmark] : 'Unknown benchmark';
}

export type PilotCheckReport = {
  revision: string | null; checks: { id: string; passed: boolean; details: string }[];
  failures: string[]; limitations: string[];
};
/** Only typed, recorded check rows are presented as test results. */
export function readPilotCheckReport(value: unknown): PilotCheckReport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const report = value as Record<string, unknown>;
  if (!Array.isArray(report.checks) || report.checks.some(check => !check || typeof check !== 'object' ||
    typeof check.id !== 'string' || typeof check.passed !== 'boolean' || typeof check.details !== 'string')) return null;
  const strings = (items: unknown) => Array.isArray(items) ? items.filter((item): item is string => typeof item === 'string') : [];
  return { revision: typeof report.revision === 'string' ? report.revision : null, checks: report.checks,
    failures: strings(report.failures), limitations: strings(report.limitations) };
}
import type { PilotRun } from '../server/generator/pilotStore';
import type { PilotDelivery } from '../server/generator/pilotDelivery';
