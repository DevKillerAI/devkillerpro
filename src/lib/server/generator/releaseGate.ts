import { z } from 'zod';
import { contractFingerprint, contractSchema, digest, identitySchema, requiredCheckIds, sameIdentity, scopedId, type GenerationContract } from './contract';

export const candidateBindingSchema = z.object({
  identity: identitySchema,
  revision: scopedId,
  sourceHash: digest,
  contractHash: digest,
  runtimeDigest: digest,
}).strict();
export type CandidateBinding = z.infer<typeof candidateBindingSchema>;
const checkId = z.string().min(1).max(400);
export const evidenceSchema = z.object({
  id: scopedId,
  sequence: z.number().int().positive().safe(),
  binding: candidateBindingSchema,
  checkId,
  producer: z.enum(['platform-runner', 'model', 'operator-note']),
  verifierVersion: scopedId,
  executed: z.boolean(),
  status: z.enum(['passed', 'failed', 'unavailable', 'skipped']),
  completedAt: z.number().int().nonnegative().safe(),
  artifactHash: digest,
}).strict();
export type VerificationEvidence = z.infer<typeof evidenceSchema>;

export function sameCandidate(a: CandidateBinding, b: CandidateBinding): boolean {
  return sameIdentity(a.identity, b.identity) && a.revision === b.revision && a.sourceHash === b.sourceHash && a.contractHash === b.contractHash && a.runtimeDigest === b.runtimeDigest;
}

/** Pure guard. Evidence must be loaded by trusted server code, NEVER from a client/model body.
 * Hashes bind reports to content; they are not signatures or proof of an honest executor.
 */
export function evaluateRelease(input: {
  contract: GenerationContract;
  candidate: CandidateBinding;
  evidence: VerificationEvidence[];
  allowedVerifierVersions: Readonly<Record<string, readonly string[]>>;
  now: number;
  maxAgeMs?: number;
}) {
  const contract = contractSchema.parse(input.contract);
  const candidate = candidateBindingSchema.parse(input.candidate);
  if (!Number.isSafeInteger(input.now) || input.now < 0) throw new Error('Invalid verification clock.');
  const maxAgeMs = input.maxAgeMs ?? 24 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) throw new Error('Invalid evidence lifetime.');
  if (!sameIdentity(contract.identity, candidate.identity) || contractFingerprint(contract) !== candidate.contractHash) throw new Error('Candidate does not belong to this contract.');
  if (input.evidence.length > 5000) throw new Error('Too much verification evidence.');
  const evidence = input.evidence.map(item => evidenceSchema.parse(item));
  const required = requiredCheckIds(contract);
  const blockers: { checkId: string; reason: string }[] = [];
  if (new Set(evidence.map(e => e.id)).size !== evidence.length) blockers.push({ checkId: 'evidence', reason: 'duplicate-evidence-id' });
  const current = evidence.filter(e => sameCandidate(e.binding, candidate));
  if (new Set(current.map(e => e.sequence)).size !== current.length) blockers.push({ checkId: 'evidence', reason: 'ambiguous-evidence-sequence' });
  for (const id of required) {
    const report = current.filter(e => e.checkId === id).sort((a, b) => b.sequence - a.sequence)[0];
    const reason = !report ? 'missing' : report.producer !== 'platform-runner' ? 'untrusted-producer'
      : !input.allowedVerifierVersions[id]?.includes(report.verifierVersion) ? 'verifier-not-approved'
      : !report.executed ? 'not-executed' : report.completedAt > input.now ? 'future-evidence'
      : input.now - report.completedAt > maxAgeMs ? 'expired' : report.status !== 'passed' ? report.status : null;
    if (reason) blockers.push({ checkId: id, reason });
  }
  return { status: blockers.length ? 'blocked' as const : 'passed' as const, candidate, requiredChecks: required.length, blockers };
}
