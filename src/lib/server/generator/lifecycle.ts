import { candidateBindingSchema, evaluateRelease, sameCandidate, type CandidateBinding, type VerificationEvidence } from './releaseGate';
import { z } from 'zod';
import { contractFingerprint, contractSchema, digest, identitySchema, sameIdentity, type GenerationContract, type GeneratorIdentity } from './contract';

export type GeneratorStatus = 'queued' | 'planning' | 'building' | 'verifying' | 'awaiting_input' | 'ready' | 'cancelling' | 'cancelled' | 'failed';
export type LifecycleState = {
  identity: GeneratorIdentity;
  contractHash: string;
  sequence: number;
  fence: number;
  leaseUntil: number;
  status: GeneratorStatus;
  candidate: CandidateBinding | null;
  accepted: CandidateBinding | null;
};
const lifecycleStateSchema = z.object({
  identity: identitySchema, contractHash: digest,
  sequence: z.number().int().nonnegative().safe(),
  fence: z.number().int().positive().safe(),
  leaseUntil: z.number().int().positive().safe(),
  status: z.enum(['queued', 'planning', 'building', 'verifying', 'awaiting_input', 'ready', 'cancelling', 'cancelled', 'failed']),
  candidate: candidateBindingSchema.nullable(), accepted: candidateBindingSchema.nullable(),
}).strict();
export type LifecycleCommand =
  | { type: 'plan' }
  | { type: 'build' }
  | { type: 'candidate'; candidate: CandidateBinding }
  | { type: 'await-input' }
  | { type: 'resume' }
  | { type: 'cancel' }
  | { type: 'cancel-confirmed' }
  | { type: 'fail' }
  | { type: 'accept'; candidate: CandidateBinding; evidence: VerificationEvidence[] };

export function initialLifecycle(contract: GenerationContract, fence: number, leaseUntil: number): LifecycleState {
  const parsed = contractSchema.parse(contract);
  if (!Number.isSafeInteger(fence) || fence <= 0 || !Number.isSafeInteger(leaseUntil) || leaseUntil <= 0) throw new Error('Invalid worker lease.');
  return { identity: { ...parsed.identity }, contractHash: contractFingerprint(parsed), sequence: 0, fence, leaseUntil, status: 'queued', candidate: null, accepted: null };
}

/** Deterministic policy, not a durable store. Its caller MUST perform compare-and-swap
 * on sequence+fence in the same transaction as the event/accepted-version pointer.
 * Clock, lease and verifier policy must originate in trusted infrastructure.
 */
export function advanceLifecycle(storedState: LifecycleState, command: LifecycleCommand, context: {
  identity: GeneratorIdentity;
  expectedSequence: number;
  fence: number;
  now: number;
  contract: GenerationContract;
  allowedVerifierVersions: Readonly<Record<string, readonly string[]>>;
}): LifecycleState {
  const state = lifecycleStateSchema.parse(storedState);
  identitySchema.parse(context.identity);
  if (!Number.isSafeInteger(context.expectedSequence) || !Number.isSafeInteger(context.fence) || state.sequence === Number.MAX_SAFE_INTEGER) throw new Error('Invalid lifecycle sequence.');
  const contract = contractSchema.parse(context.contract);
  if (!sameIdentity(state.identity, context.identity) || !sameIdentity(state.identity, contract.identity)) throw new Error('Lifecycle scope mismatch.');
  if (state.contractHash !== contractFingerprint(contract)) throw new Error('Lifecycle contract changed.');
  if (state.sequence !== context.expectedSequence || state.fence !== context.fence) throw new Error('Stale worker or state.');
  if (!Number.isSafeInteger(context.now) || context.now < 0 || context.now >= state.leaseUntil) throw new Error('Worker lease expired.');
  if (['ready', 'failed', 'cancelled'].includes(state.status)) throw new Error('Mission is terminal. Create a separate revision operation.');
  const next: LifecycleState = { ...state, identity: { ...state.identity }, sequence: state.sequence + 1 };
  const allow = (...statuses: GeneratorStatus[]) => { if (!statuses.includes(state.status)) throw new Error(`Invalid transition: ${state.status} -> ${command.type}.`); };
  switch (command.type) {
    case 'plan': allow('queued'); next.status = 'planning'; break;
    case 'build': allow('planning', 'verifying'); next.status = 'building'; break;
    case 'candidate': {
      allow('building');
      const candidate = candidateBindingSchema.parse(command.candidate);
      if (!sameIdentity(candidate.identity, state.identity) || candidate.contractHash !== state.contractHash) throw new Error('Candidate scope mismatch.');
      next.candidate = candidate; next.status = 'verifying'; break;
    }
    case 'await-input': allow('planning', 'building', 'verifying'); next.status = 'awaiting_input'; break;
    case 'resume': allow('awaiting_input'); next.status = 'planning'; break;
    case 'cancel': allow('queued', 'planning', 'building', 'verifying', 'awaiting_input'); next.status = 'cancelling'; break;
    case 'cancel-confirmed': allow('cancelling'); next.status = 'cancelled'; break;
    case 'fail': allow('queued', 'planning', 'building', 'verifying', 'awaiting_input'); next.status = 'failed'; break;
    case 'accept': {
      allow('verifying');
      if (!state.candidate || !sameCandidate(state.candidate, candidateBindingSchema.parse(command.candidate))) throw new Error('Accepted candidate is stale.');
      const result = evaluateRelease({ contract, candidate: state.candidate, evidence: command.evidence, now: context.now, allowedVerifierVersions: context.allowedVerifierVersions });
      if (result.status !== 'passed') throw new Error('Delivery checks have not passed.');
      next.accepted = result.candidate; next.status = 'ready'; break;
    }
    default: throw new Error('Unknown lifecycle command.');
  }
  return next;
}
