import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { createGeneratorSnapshot, type GeneratorSnapshot } from './versionedEdits';
import { validatePrivateboardSource } from './supabasePilotRuntime';

const exec = promisify(execFile);
export const BRIEFBOARD_RUNNER_IMAGE = 'devkiller-generator-v2:1';
export const BRIEFBOARD_VERIFIER_VERSION = 'briefboard-v1';
export const BRIEFBOARD_SOURCE_PATHS = Object.freeze(['src/App.tsx', 'src/styles.css'] as const);

/**
 * Web-facing, read-only runtime helpers. Keep worker execution, temporary
 * directories and report readers out of this module so Next's dependency
 * tracing never follows the verifier's temporary workspace into the host OS.
 */
export async function inspectBriefboardRuntime(signal?: AbortSignal): Promise<
  { available: true; imageId: string; verifierVersion: string } | { available: false; reason: string }
> {
  try {
    signal?.throwIfAborted();
    const inspected = await exec('docker', ['image', 'inspect', BRIEFBOARD_RUNNER_IMAGE, '--format', '{{.Id}}'], {
      windowsHide: true, timeout: 15000, signal, maxBuffer: 16000,
    });
    const imageId = inspected.stdout.trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('Invalid runtime image digest.');
    return { available: true, imageId, verifierVersion: BRIEFBOARD_VERIFIER_VERSION };
  } catch {
    signal?.throwIfAborted();
    return { available: false, reason: 'The prepared Briefboard Docker compiler/browser runtime is unavailable.' };
  }
}

/** Validates the exact, minimal source surface; never silently drops additional files. */
export function validateBriefboardSource(snapshot: GeneratorSnapshot): GeneratorSnapshot {
  const verified = createGeneratorSnapshot(snapshot, { maxFiles: 2, maxFileBytes: 128 * 1024, maxSnapshotBytes: 160 * 1024 });
  if (snapshot.hash !== verified.hash || snapshot.files.some(file => verified.files.find(item => item.path === file.path)?.hash !== file.hash)) {
    throw new Error('Pilot source does not match its immutable snapshot.');
  }
  if (verified.files.length !== 2 || BRIEFBOARD_SOURCE_PATHS.some(expected => !verified.files.some(file => file.path === expected))) {
    throw new Error('Pilot source must contain exactly src/App.tsx and src/styles.css.');
  }
  return verified;
}

/** Validates modular workbench sources (up to 24 files, with src/App.tsx and src/styles.css as root). */
export function validateWorkbenchSource(snapshot: GeneratorSnapshot): GeneratorSnapshot {
  const verified = createGeneratorSnapshot(snapshot, { maxFiles: 24, maxFileBytes: 128 * 1024, maxSnapshotBytes: 512 * 1024 });
  if (snapshot.hash !== verified.hash || snapshot.files.some(file => verified.files.find(item => item.path === file.path)?.hash !== file.hash)) {
    throw new Error('Workbench source does not match its immutable snapshot.');
  }
  if (!verified.files.some(file => file.path === 'src/App.tsx') || !verified.files.some(file => file.path === 'src/styles.css')) {
    throw new Error('Workbench source must contain src/App.tsx and src/styles.css as root entrypoints.');
  }
  return verified;
}

/** Returns a source-bound path, without creating or reading files. */
export function pilotArtifactDirectory(snapshot: GeneratorSnapshot): string {
  const isFixedPrivateboard = snapshot.files.length <= 4 && snapshot.files.every(f => ['src/App.tsx', 'src/styles.css', 'supabase/migrations/001_init.sql', 'supabase/migrations/002_priority.sql'].includes(f.path)) && !snapshot.files.some(f => f.path.startsWith('src/components/') || f.path.startsWith('src/views/') || f.path.startsWith('src/lib/'));
  const verified = isFixedPrivateboard && snapshot.files.some(file => file.path === 'supabase/migrations/001_init.sql')
    ? validatePrivateboardSource(snapshot)
    : snapshot.files.length > 2 || !snapshot.files.every(file => BRIEFBOARD_SOURCE_PATHS.includes(file.path as any))
      ? validateWorkbenchSource(snapshot)
      : validateBriefboardSource(snapshot);
  return path.resolve('.devkiller/generator-v2/artifacts', verified.scope.ownerId, verified.scope.projectId, verified.scope.missionId, verified.hash);
}

