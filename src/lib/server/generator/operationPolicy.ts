import { z } from 'zod';
import { contractFingerprint, contractSchema, digest, identitySchema, sameIdentity, scopedId, type GenerationContract } from './contract';
import { candidateBindingSchema, type CandidateBinding } from './releaseGate';
import { applyVersionedEdits, createGeneratorSnapshot, type GeneratorEditRequest, type GeneratorSnapshot } from './versionedEdits';

const authoritySchema = z.object({
  operationId: scopedId,
  identity: identitySchema,
  baseRevision: scopedId,
  baseHash: digest,
  allowedPaths: z.array(z.string().min(1).max(240)).min(1).max(256),
  allowCreate: z.boolean(),
  allowDelete: z.boolean(),
  expiresAt: z.number().int().positive().safe(),
}).strict();
export type EditAuthority = z.infer<typeof authoritySchema>;

/** Authority comes from trusted scope approval, not from the model proposing a patch.
 * Path authority limits which files may change; it does not prove semantic intent.
 * This pure boundary still needs durable operation IDs and compare-and-swap at commit.
 */
export function applyAuthorizedEdits(snapshot: GeneratorSnapshot, request: GeneratorEditRequest, authorityInput: EditAuthority, now: number): GeneratorSnapshot {
  const authority = authoritySchema.parse(authorityInput);
  if (!Number.isSafeInteger(now) || now < 0 || now >= authority.expiresAt) throw new Error('Edit authority expired.');
  if (!sameIdentity(authority.identity, identitySchema.parse(request.scope)) || authority.baseHash !== request.baseHash || authority.baseRevision !== request.baseRevision) throw new Error('Edit authority does not match the requested base.');
  if (!Array.isArray(request.operations) || !request.operations.length) throw new Error('No authorized edit operations.');
  for (const operation of request.operations) {
    if (!authority.allowedPaths.includes(operation.path)) throw new Error('Edit is outside the approved files.');
    if (operation.kind === 'create' && !authority.allowCreate) throw new Error('Creating files was not approved.');
    if (operation.kind === 'delete' && !authority.allowDelete) throw new Error('Deleting files was not approved.');
  }
  return applyVersionedEdits(snapshot, request);
}

/** Bind the validated snapshot produced by the source editor to the release gate. */
export function bindSourceCandidate(snapshot: GeneratorSnapshot, contractInput: GenerationContract, runtimeDigest: string): CandidateBinding {
  const contract = contractSchema.parse(contractInput);
  if (!sameIdentity(contract.identity, identitySchema.parse(snapshot.scope))) throw new Error('Source candidate scope mismatch.');
  const verified = createGeneratorSnapshot(snapshot);
  if (snapshot.schemaVersion !== 1 || verified.hash !== snapshot.hash || verified.totalBytes !== snapshot.totalBytes) throw new Error('Source snapshot integrity mismatch.');
  return candidateBindingSchema.parse({ identity: verified.scope, revision: verified.revision, sourceHash: verified.hash, contractHash: contractFingerprint(contract), runtimeDigest });
}
