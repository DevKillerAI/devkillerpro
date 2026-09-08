import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createGeneratorSnapshot, type GeneratorSnapshot } from './versionedEdits';
import { SUPABASE_PILOT_INITIAL_PATHS, SUPABASE_PILOT_PATHS } from './supabasePilotContract';

export const PRIVATEBOARD_RUNNER_IMAGE = 'devkiller-generator-v2-supabase:1';
export const PRIVATEBOARD_VERIFIER_VERSION = 'privateboard-v1';
const exec = promisify(execFile);
/** Web-safe inspection; never import worker temporary-file execution into Next routes. */
export async function inspectPrivateboardRuntime(signal?: AbortSignal): Promise<
  { available: true; imageId: string; verifierVersion: string } | { available: false; reason: string }
> {
  try {
    signal?.throwIfAborted();
    const result = await exec('docker', ['image', 'inspect', PRIVATEBOARD_RUNNER_IMAGE, '--format', '{{.Id}}'], { windowsHide: true, timeout: 15_000, maxBuffer: 16000, signal });
    const imageId = result.stdout.trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('Invalid image ID.');
    return { available: true, imageId, verifierVersion: PRIVATEBOARD_VERIFIER_VERSION };
  } catch { signal?.throwIfAborted(); return { available: false, reason: 'The dedicated database/Auth compiler and browser runtime is not prepared. No generation is started.' }; }
}
export function validatePrivateboardSource(snapshot: GeneratorSnapshot): GeneratorSnapshot {
  const verified = createGeneratorSnapshot(snapshot, { maxFiles: 4, maxFileBytes: 128 * 1024, maxSnapshotBytes: 160 * 1024 });
  if (verified.hash !== snapshot.hash || snapshot.files.some(f => verified.files.find(item => item.path === f.path)?.hash !== f.hash)) throw new Error('Privateboard source integrity mismatch.');
  if (![3, 4].includes(verified.files.length) || SUPABASE_PILOT_INITIAL_PATHS.some(p => !verified.files.some(f => f.path === p)) ||
    verified.files.some(f => !(SUPABASE_PILOT_PATHS as readonly string[]).includes(f.path))) throw new Error('Privateboard must use the exact reviewed source and migration paths.');
  return verified;
}
