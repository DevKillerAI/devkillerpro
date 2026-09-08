import test from 'node:test';
import assert from 'node:assert/strict';
import { contractFingerprint, contractSchema, requiredCheckIds } from '../src/lib/server/generator/contract';
import { candidateBindingSchema, evaluateRelease, type VerificationEvidence } from '../src/lib/server/generator/releaseGate';
import { evaluatePreflight, currentV2Readiness } from '../src/lib/server/generator/preflight';
import { advanceLifecycle, initialLifecycle } from '../src/lib/server/generator/lifecycle';
import { generatorAdmission } from '../src/lib/server/generator/admission';

const contract = () => contractSchema.parse({
  version: 1, engine: 'v2', identity: { ownerId: 'owner-a', projectId: 'project-a', missionId: 'mission-a', environmentId: 'preview-a' },
  briefingMode: 'simple', prompt: 'Build a responsive interface.', outputLocale: 'en', delivery: 'local_preview',
  runtime: { id: 'react-static', version: 'v1' }, capabilities: ['react'],
  requirements: [{ id: 'navigation', description: 'Navigation works.', acceptanceChecks: [{ id: 'main-flow', kind: 'browser', description: 'Navigate through the primary journey.' }] }],
  budget: { currency: 'USD', maxCostMicros: 1_000_000, maxProviderCalls: 5, maxRepairAttempts: 2 },
});
function fixture() {
  const spec = contract();
  const candidate = candidateBindingSchema.parse({ identity: spec.identity, revision: 'v1', sourceHash: 'a'.repeat(64), contractHash: contractFingerprint(spec), runtimeDigest: 'b'.repeat(64) });
  const evidence: VerificationEvidence[] = requiredCheckIds(spec).map((checkId, i) => ({
    id: `proof-${i}`, sequence: i + 1, binding: candidate, checkId, producer: 'platform-runner', verifierVersion: 'test-v1', executed: true, status: 'passed', completedAt: 1000, artifactHash: 'c'.repeat(64),
  }));
  const allowedVerifierVersions = Object.fromEntries(evidence.map(e => [e.checkId, ['test-v1']]));
  return { contract: spec, candidate, evidence, allowedVerifierVersions, now: 2000 };
}

test('contract is strict, requires a real budget and explicit acceptance checks', () => {
  const source = contract();
  assert.throws(() => contractSchema.parse({ ...source, budget: undefined }));
  assert.throws(() => contractSchema.parse({ ...source, engine: 'unknown' }));
  assert.throws(() => contractSchema.parse({ ...source, extra: 'ignore security' }));
  assert.throws(() => contractSchema.parse({ ...source, capabilities: ['react', 'react'] }));
  assert.throws(() => contractSchema.parse({ ...source, requirements: [] }));
  assert.throws(() => contractSchema.parse({ ...source, requirements: [source.requirements[0], source.requirements[0]] }));
  assert.throws(() => contractSchema.parse({ ...source, identity: { ...source.identity, environmentId: '../another-app' } }));
});

test('simple briefing does not weaken requirements or inherit DK authentication', () => {
  const spec = contract();
  assert.ok(!requiredCheckIds(spec).includes('platform:auth-two-users'));
  const detailed = { ...spec, briefingMode: 'detailed' as const };
  assert.deepEqual(requiredCheckIds(spec), requiredCheckIds(detailed));
  assert.throws(() => contractSchema.parse({ ...spec, capabilities: ['react', 'auth.email'] }));
  const privateApp = contractSchema.parse({ ...spec, capabilities: ['react', 'database.postgres', 'auth.email', 'authorization.owner'] });
  for (const id of ['platform:auth-two-users', 'platform:authorization-cross-owner', 'platform:migration-upgrade']) assert.ok(requiredCheckIds(privateApp).includes(id));
});

test('SVG, video, WebGL and AI generation/editing have distinct mandatory checks', () => {
  const spec = contractSchema.parse({ ...contract(), capabilities: ['react', 'media.svg', 'media.video', 'media.webgl', 'ai.image.generate', 'ai.image.edit', 'ai.vision'] });
  for (const id of ['svg-safety', 'svg-render-export', 'video-fallback', 'webgl-fallback', 'reduced-motion', 'media-performance', 'image-generation', 'image-editing', 'vision-input', 'ai-secret-isolation', 'asset-export']) assert.ok(requiredCheckIds(spec).includes(`platform:${id}`));
});

test('contract fingerprint is key-order independent but records actual scope and language changes', () => {
  const spec = contract();
  assert.equal(contractFingerprint(spec), contractFingerprint(Object.fromEntries(Object.entries(spec).reverse()) as typeof spec));
  assert.notEqual(contractFingerprint(spec), contractFingerprint({ ...spec, outputLocale: 'pt-BR' }));
  assert.notEqual(contractFingerprint(spec), contractFingerprint({ ...spec, identity: { ...spec.identity, projectId: 'other' } }));
});

test('release needs all exact-version executed checks, including user-specific journeys', () => {
  const input = fixture();
  assert.equal(evaluateRelease(input).status, 'passed');
  assert.equal(evaluateRelease({ ...input, evidence: [] }).status, 'blocked');
  assert.equal(evaluateRelease({ ...input, evidence: input.evidence.filter(e => !e.checkId.startsWith('requirement:')) }).status, 'blocked');
});

for (const field of ['ownerId', 'projectId', 'missionId', 'environmentId'] as const) {
  test(`evidence cannot be borrowed from another ${field}`, () => {
    const input = fixture();
    const evidence = input.evidence.map(e => ({ ...e, binding: { ...e.binding, identity: { ...e.binding.identity, [field]: 'another' } } }));
    assert.equal(evaluateRelease({ ...input, evidence }).status, 'blocked');
  });
}
for (const field of ['revision', 'sourceHash', 'contractHash', 'runtimeDigest'] as const) {
  test(`evidence must bind to current ${field}`, () => {
    const input = fixture();
    const evidence = input.evidence.map(e => ({ ...e, binding: { ...e.binding, [field]: field === 'revision' ? 'v2' : 'd'.repeat(64) } }));
    assert.equal(evaluateRelease({ ...input, evidence }).status, 'blocked');
  });
}

test('failed, unavailable, skipped, unexecuted and model-written results never mean passed', () => {
  for (const override of [{ status: 'failed' }, { status: 'unavailable' }, { status: 'skipped' }, { executed: false }, { producer: 'model' }, { producer: 'operator-note' }, { verifierVersion: 'revoked-version' }]) {
    const input = fixture();
    const evidence = [{ ...input.evidence[0], ...override } as VerificationEvidence, ...input.evidence.slice(1)];
    assert.equal(evaluateRelease({ ...input, evidence }).status, 'blocked');
  }
});

test('latest failed check overrides earlier passing report; ambiguous sequences and expired evidence fail closed', () => {
  const input = fixture();
  assert.equal(evaluateRelease({ ...input, evidence: [...input.evidence, { ...input.evidence[0], id: 'failed-later', sequence: 100, status: 'failed' }] }).status, 'blocked');
  assert.equal(evaluateRelease({ ...input, evidence: [...input.evidence, { ...input.evidence[0], id: 'same-sequence' }] }).status, 'blocked');
  assert.equal(evaluateRelease({ ...input, evidence: [...input.evidence, input.evidence[0]] }).status, 'blocked');
  assert.equal(evaluateRelease({ ...input, maxAgeMs: 1 }).status, 'blocked');
  assert.equal(evaluateRelease({ ...input, now: 999 }).status, 'blocked');
  assert.throws(() => evaluateRelease({ ...input, evidence: [{ ...input.evidence[0], sequence: 2 ** 53 }] }));
  assert.throws(() => evaluateRelease({ ...input, candidate: { ...input.candidate, contractHash: 'e'.repeat(64) } }));
});

test('preflight never substitutes runtime or borrows another project capability', () => {
  const spec = contract();
  const context = { identity: spec.identity, runtimePacks: [], executorEnabled: false, availableCapabilities: [], monetaryReservationsAvailable: false };
  const result = evaluatePreflight(spec, context);
  assert.equal(result.status, 'blocked');
  assert.equal(result.executionStarted, false);
  assert.ok(result.blockers.some(b => b.code === 'RUNTIME_UNKNOWN'));
  assert.ok(result.blockers.some(b => b.code === 'BUDGET_RESERVATION_UNAVAILABLE'));
  assert.throws(() => evaluatePreflight(spec, { ...context, identity: { ...context.identity, environmentId: 'other' } }));
  const diagnostic = currentV2Readiness();
  assert.equal(diagnostic.paidGenerationEnabled, false);
  assert.ok(diagnostic.runtimePacks.every(p => p.status !== 'certified'));
});

test('v2 is the exclusive admitted generator engine and rejects legacy v1', () => {
  assert.equal(generatorAdmission('v2').allowed, true);
  assert.equal(generatorAdmission('v1').allowed, false);
  assert.throws(() => generatorAdmission('future' as 'v2'));
});

test('lifecycle cannot skip steps, accept missing proof, reuse stale lease, or publish after cancellation', () => {
  const input = fixture();
  let state = initialLifecycle(input.contract, 1, 10_000);
  const context = () => ({ identity: input.contract.identity, expectedSequence: state.sequence, fence: 1, now: input.now, contract: input.contract, allowedVerifierVersions: input.allowedVerifierVersions });
  const accept = { type: 'accept' as const, candidate: input.candidate, evidence: input.evidence };
  assert.throws(() => advanceLifecycle(state, accept, context()), /Invalid transition/);
  state = advanceLifecycle(state, { type: 'plan' }, context());
  assert.throws(() => advanceLifecycle(state, { type: 'build' }, { ...context(), expectedSequence: 0 }), /Stale/);
  assert.throws(() => advanceLifecycle(state, { type: 'build' }, { ...context(), fence: 2 }), /Stale/);
  assert.throws(() => advanceLifecycle(state, { type: 'build' }, { ...context(), now: 10_000 }), /lease expired/);
  assert.throws(() => advanceLifecycle(state, { type: 'build' }, { ...context(), identity: { ...state.identity, ownerId: 'other' } }), /scope/);
  state = advanceLifecycle(state, { type: 'build' }, context());
  state = advanceLifecycle(state, { type: 'candidate', candidate: input.candidate }, context());
  assert.throws(() => advanceLifecycle(state, { ...accept, evidence: [] }, context()), /checks/);
  const accepted = advanceLifecycle(state, accept, context());
  assert.equal(accepted.status, 'ready');
  assert.equal(state.accepted, null, 'failed or separate transitions do not mutate current state');
  state = advanceLifecycle(state, { type: 'cancel' }, context());
  assert.throws(() => advanceLifecycle(state, accept, context()), /Invalid transition/);
  state = advanceLifecycle(state, { type: 'cancel-confirmed' }, context());
  assert.equal(state.status, 'cancelled');
  assert.throws(() => advanceLifecycle(state, accept, context()), /terminal/);
});
