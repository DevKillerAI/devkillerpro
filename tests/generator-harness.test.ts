import test from 'node:test';
import assert from 'node:assert/strict';
import { contractSchema, requiredCheckIds } from '../src/lib/server/generator/contract';
import { applyAuthorizedEdits, bindSourceCandidate, type EditAuthority } from '../src/lib/server/generator/operationPolicy';
import { createGeneratorSnapshot, type GeneratorEditRequest } from '../src/lib/server/generator/versionedEdits';
import { evaluateRelease, type VerificationEvidence } from '../src/lib/server/generator/releaseGate';
import { advanceLifecycle, initialLifecycle } from '../src/lib/server/generator/lifecycle';

test('harness: logo edit is scoped, does not touch the database or another app, and invalidates old delivery evidence', () => {
  const spec = contractSchema.parse({ version: 1, engine: 'v2', identity: { ownerId: 'alice', projectId: 'app-a', missionId: 'mission-a', environmentId: 'preview-a' },
    briefingMode: 'simple', prompt: 'Create a web app.', outputLocale: 'en', delivery: 'local_preview', runtime: { id: 'react-static', version: 'v1' }, capabilities: ['react', 'media.svg'],
    requirements: [{ id: 'logo', description: 'Display the brand logo.', acceptanceChecks: [{ id: 'logo-visible', description: 'The logo is visible and legible.', kind: 'visual' }] }],
    budget: { currency: 'USD', maxCostMicros: 1_000_000, maxProviderCalls: 5, maxRepairAttempts: 2 },
  });
  // Strings exercise source boundaries; these are not generated benchmark applications.
  const files = [{ path: 'public/logo.svg', content: '<svg fill="red"></svg>' }, { path: 'supabase/migrations/001.sql', content: '-- existing app migration' }];
  const base = createGeneratorSnapshot({ scope: spec.identity, revision: 'r1', files });
  const other = createGeneratorSnapshot({ scope: { ...spec.identity, ownerId: 'bob', projectId: 'app-b', missionId: 'mission-b', environmentId: 'preview-b' }, revision: 'r1', files });
  const candidate = bindSourceCandidate(base, spec, 'a'.repeat(64));
  const evidence: VerificationEvidence[] = requiredCheckIds(spec).map((checkId, index) => ({ id: `e-${index}`, sequence: index + 1, checkId, binding: candidate, status: 'passed', executed: true, producer: 'platform-runner', verifierVersion: 'harness-fixture-v1', completedAt: 1000, artifactHash: 'b'.repeat(64) }));
  const allowedVerifierVersions = Object.fromEntries(evidence.map(e => [e.checkId, ['harness-fixture-v1']]));
  assert.equal(evaluateRelease({ contract: spec, candidate, evidence, now: 1500, allowedVerifierVersions }).status, 'passed');
  const request: GeneratorEditRequest = { scope: spec.identity, baseRevision: base.revision, baseHash: base.hash, newRevision: 'r2', operations: [{ kind: 'replace', path: 'public/logo.svg', expectedHash: base.files[0].hash, search: 'red', replacement: 'blue' }] };
  const authority: EditAuthority = { operationId: 'edit-1', identity: spec.identity, baseRevision: base.revision, baseHash: base.hash, allowedPaths: ['public/logo.svg'], allowCreate: false, allowDelete: false, expiresAt: 2000 };
  const edited = applyAuthorizedEdits(base, request, authority, 1500);
  assert.equal(edited.files[0].content, '<svg fill="blue"></svg>');
  assert.equal(edited.files[1].content, base.files[1].content);
  assert.equal(other.files[0].content, '<svg fill="red"></svg>');
  assert.throws(() => applyAuthorizedEdits(other, request, authority, 1500), /scope/i);
  assert.throws(() => applyAuthorizedEdits(base, { ...request, operations: [{ kind: 'delete', path: 'supabase/migrations/001.sql', expectedHash: base.files[1].hash }] }, authority, 1500), /approved files/);
  assert.throws(() => applyAuthorizedEdits(base, { ...request, operations: [{ kind: 'delete', path: 'public/logo.svg', expectedHash: base.files[0].hash }] }, authority, 1500), /not approved/);
  assert.throws(() => applyAuthorizedEdits(base, request, authority, 2000), /expired/);
  assert.throws(() => applyAuthorizedEdits(edited, request, authority, 1500), /base/i);
  const changedCandidate = bindSourceCandidate(edited, spec, 'a'.repeat(64));
  assert.equal(evaluateRelease({ contract: spec, candidate: changedCandidate, evidence, now: 1500, allowedVerifierVersions }).status, 'blocked');
  assert.throws(() => bindSourceCandidate(other, spec, 'a'.repeat(64)), /scope/);
  assert.throws(() => bindSourceCandidate({ ...base, files: [{ ...base.files[0], content: 'tampered source' }, ...base.files.slice(1)] }, spec, 'a'.repeat(64)), /integrity/);
});

test('malformed persisted lifecycle state cannot bypass lease or sequence validation', () => {
  const spec = contractSchema.parse({ version: 1, engine: 'v2', identity: { ownerId: 'alice', projectId: 'app-a', missionId: 'mission-a', environmentId: 'preview-a' }, briefingMode: 'simple', prompt: 'Create a web app.', outputLocale: 'en', delivery: 'local_preview', runtime: { id: 'react-static', version: 'v1' }, capabilities: ['react'], requirements: [{ id: 'flow', description: 'Core journey works.', acceptanceChecks: [{ id: 'flow-test', description: 'Exercise core flow.', kind: 'browser' }] }], budget: { currency: 'USD', maxCostMicros: 1000, maxProviderCalls: 1, maxRepairAttempts: 0 } });
  const state = initialLifecycle(spec, 1, 3000);
  const context = { identity: spec.identity, contract: spec, expectedSequence: 0, fence: 1, now: 1000, allowedVerifierVersions: {} };
  assert.throws(() => advanceLifecycle({ ...state, leaseUntil: NaN }, { type: 'plan' }, context));
  assert.throws(() => advanceLifecycle({ ...state, sequence: Number.MAX_SAFE_INTEGER }, { type: 'plan' }, { ...context, expectedSequence: Number.MAX_SAFE_INTEGER }));
});
