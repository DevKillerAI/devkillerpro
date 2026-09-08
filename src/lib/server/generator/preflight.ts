import { contractSchema, identitySchema, requiredCheckIds, sameIdentity, type Capability, type GenerationContract, type GeneratorIdentity } from './contract';

export type RuntimePack = {
  id: string;
  version: string;
  status: 'experimental' | 'certified' | 'unavailable';
  capabilities: readonly Capability[];
  certifiedChecks: readonly string[];
};

// These are inventory entries, not a claim that accepting a framework certifies it.
export const RUNTIME_PACKS: readonly RuntimePack[] = [
  { id: 'react-workbench', version: 'v1', status: 'experimental', capabilities: ['react'], certifiedChecks: [] },
  { id: 'react-supabase-pilot', version: 'v1', status: 'experimental', capabilities: ['react', 'database.postgres', 'auth.email', 'authorization.owner'], certifiedChecks: [] },
];

/** Readiness check only: does not reserve money, provision resources, or start a model. */
export function evaluatePreflight(contractInput: GenerationContract, context: {
  identity: GeneratorIdentity;
  runtimePacks: readonly RuntimePack[];
  executorEnabled: boolean;
  availableCapabilities: readonly Capability[];
  monetaryReservationsAvailable: boolean;
}) {
  const contract = contractSchema.parse(contractInput);
  if (!sameIdentity(contract.identity, identitySchema.parse(context.identity))) throw new Error('Preflight environment does not belong to this contract.');
  const blockers: { code: string; detail: string }[] = [];
  const pack = context.runtimePacks.find(p => p.id === contract.runtime.id && p.version === contract.runtime.version);
  if (!context.executorEnabled) blockers.push({ code: 'EXECUTOR_NOT_ENABLED', detail: 'The v2 executor has not been enabled. No generation was started.' });
  if (!context.monetaryReservationsAvailable) blockers.push({ code: 'BUDGET_RESERVATION_UNAVAILABLE', detail: 'Atomic monetary reservations must be connected before paid generation.' });
  if (!pack) blockers.push({ code: 'RUNTIME_UNKNOWN', detail: 'The selected runtime version is not registered.' });
  else {
    if (pack.status !== 'certified') blockers.push({ code: 'RUNTIME_NOT_CERTIFIED', detail: 'The selected runtime has not passed its certification suite.' });
    for (const capability of contract.capabilities) {
      if (!pack.capabilities.includes(capability)) blockers.push({ code: 'CAPABILITY_UNSUPPORTED', detail: capability });
      else if (!context.availableCapabilities.includes(capability)) blockers.push({ code: 'CAPABILITY_NOT_CONFIGURED', detail: capability });
    }
    for (const check of requiredCheckIds(contract).filter(id => id.startsWith('platform:'))) {
      if (!pack.certifiedChecks.includes(check)) blockers.push({ code: 'VERIFIER_UNAVAILABLE', detail: check });
    }
  }
  return { engine: 'v2' as const, status: blockers.length ? 'blocked' as const : 'eligible' as const, executionStarted: false as const, blockers, requiredChecks: requiredCheckIds(contract) };
}

export type V2ReadinessObservation = {
  observedAt: string; workerAvailable: boolean; runtimeAvailable: boolean;
  reservationsAvailable: boolean; providerConfigured: boolean; readOnly: boolean;
  ragAvailable: boolean; diagnostics: string[];
};
export function currentV2Readiness(observed?: V2ReadinessObservation) {
  const executorEnabled = Boolean(observed?.workerAvailable && observed.runtimeAvailable && !observed.readOnly);
  return {
    engine: 'v2', phase: 'verified-candidate-workbench', executorEnabled,
    paidGenerationEnabled: Boolean(executorEnabled && observed?.reservationsAvailable && observed.providerConfigured && observed.ragAvailable),
    observedAt: observed?.observedAt ?? null, inspected: Boolean(observed),
    message: observed ? 'Live infrastructure inspection. Model access, account spending limits and each generated candidate require their own checks.'
      : 'Infrastructure has not been inspected in this call. No availability or quality certification is implied.',
    runtimePacks: RUNTIME_PACKS,
    diagnostics: observed?.diagnostics ?? ['READINESS_NOT_INSPECTED'],
    observation: observed ?? null,
  } as const;
}
