import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { GeneratorSnapshot } from './versionedEdits';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const image = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const runtimeDigest = (imageId: string, version: string) => createHash('sha256').update(`${imageId}:${version}`).digest('hex');

/** Explicit operator authority, not model output and never inferred from an image-tag change. */
export const privateboardRuntimeRequalificationSchema = z.object({
  sourceRevision: z.enum(['build-1', 'repair-1', 'repair-2']), sourceHash: digest,
  fromRuntimeDigest: digest, toRuntimeDigest: digest, fromImageId: image, toImageId: image,
  verifierVersion: z.string().regex(/^privateboard-v[1-9][0-9]*$/),
  requalificationRevision: z.literal('runtime-1'),
}).strict().refine(value => value.fromImageId !== value.toImageId &&
  value.fromRuntimeDigest === runtimeDigest(value.fromImageId, value.verifierVersion) &&
  value.toRuntimeDigest === runtimeDigest(value.toImageId, value.verifierVersion), 'Runtime images and their digests must be exact and different.');
export type PrivateboardRuntimeRequalification = z.infer<typeof privateboardRuntimeRequalificationSchema>;

export function requalifyPrivateboardSnapshot(base: GeneratorSnapshot, input: PrivateboardRuntimeRequalification, currentRuntimeDigest: string): GeneratorSnapshot {
  const authorization = privateboardRuntimeRequalificationSchema.parse(input);
  if (authorization.toRuntimeDigest !== currentRuntimeDigest || base.revision !== authorization.sourceRevision || base.hash !== authorization.sourceHash ||
    base.files.some(file => file.path === 'supabase/migrations/002_priority.sql')) throw new Error('Runtime requalification does not match the exact pre-upgrade recorded source.');
  // This is a new verification lineage, not a source edit. Every byte, file hash,
  // source hash and environment scope remains unchanged; old snapshots survive.
  return Object.freeze({ ...base, revision: authorization.requalificationRevision,
    parent: Object.freeze({ revision: base.revision, hash: base.hash }) });
}
