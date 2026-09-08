import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createGeneratorSnapshot, GeneratorEditError } from '../src/lib/server/generator/versionedEdits';
import {
  classifyPilotPatchFailure, describePilotPatchFailure, evaluatePilotPatch,
  pilotPatchCorrectionOperation, planPilotPatchCorrection, PilotPatchValidationError, PILOT_PATCH_RULES,
} from '../src/lib/server/generator/pilotPatchRecovery';

const scope = { ownerId: 'test-owner', projectId: 'test-project', missionId: 'test-mission', environmentId: 'test-preview' };
// Source fixtures exercise edit boundaries only; no generated application is implemented here.
const base = () => createGeneratorSnapshot({ scope, revision: 'repair-1', files: [
  { path: 'src/App.tsx', content: 'export default function App(){ return <main>Fixture only</main>; }' },
  { path: 'src/styles.css', content: ':root { --accent: cyan; }\n.a { color: #d9f6f5; }\n.b { color: #d9f6f5; }\n' },
] });
const options = { operationId: 'refine-1', allowedPaths: ['src/styles.css'], now: 1000 };
const proposal = (edits: unknown) => ({ summary: 'Localized edit fixture.', edits });
const edit = (search = '#d9f6f5', replacement = '#ede9fe') => ({ path: 'src/styles.css', search, replacement });
function captured(action: () => unknown): unknown {
  try { action(); } catch (error) { return error; }
  assert.fail('Expected a rejected patch.');
}
const ambiguous = () => captured(() => evaluatePilotPatch(base(), proposal([edit()]), options));
const budget = () => ({ repairsUsed: 1, maxRepairAttempts: 2, providerCallsUsed: 3, maxProviderCalls: 5, correctionAttempts: 0, correctionAlreadyRecorded: false });

test('exact-match rejection is atomic and reports observed count on the unchanged base', () => {
  const current = base(), saved = JSON.stringify(current);
  const proposed = proposal([edit('--accent: cyan;', '--accent: violet;'), edit()]);
  const error = captured(() => evaluatePilotPatch(current, proposed, options));
  assert.equal(classifyPilotPatchFailure(error), 'MATCH_NOT_UNIQUE');
  assert.equal(JSON.stringify(current), saved);
  const diagnosis = describePilotPatchFailure(error, current, proposed);
  assert.ok('firstFailingEdit' in diagnosis);
  assert.deepEqual(diagnosis.firstFailingEdit, { index: 2, path: 'src/styles.css', matchCount: 2 });
  assert.equal(diagnosis.baseHash, current.hash);
  assert.deepEqual(diagnosis.immutableBaseMatches.map(item => item.matchCount), [1, 2]);
});

test('a corrected disjoint patch applies against the original hash without changing other files', () => {
  const current = base();
  const result = evaluatePilotPatch(current, proposal([
    edit('--accent: cyan;', '--accent: violet;'),
    edit('.a { color: #d9f6f5; }', '.a { color: #ede9fe; }'),
    edit('.b { color: #d9f6f5; }', '.b { color: #ede9fe; }'),
  ]), { ...options, operationId: 'refine-repair-1' });
  assert.equal(result.snapshot.parent?.hash, current.hash);
  assert.equal(result.snapshot.parent?.revision, 'repair-1');
  assert.equal(result.snapshot.revision, 'refine-repair-1');
  assert.equal(result.snapshot.files.find(file => file.path === 'src/App.tsx')?.hash, current.files.find(file => file.path === 'src/App.tsx')?.hash);
  assert.notEqual(result.snapshot.hash, current.hash);
});

test('only output formatting and the two concrete matching conflict codes are editable', () => {
  for (const invalid of [proposal([]), proposal(Array.from({ length: 17 }, () => edit())), proposal([{ path: 'src/styles.css', replacement: 'x' }]), null]) {
    const error = captured(() => evaluatePilotPatch(base(), invalid, options));
    assert.equal(classifyPilotPatchFailure(error), 'output-format');
  }
  assert.equal(classifyPilotPatchFailure(new PilotPatchValidationError('apply', new GeneratorEditError('CONFLICTING_OPERATIONS', 'Observed conflict.'))), 'CONFLICTING_OPERATIONS');
  for (const error of [new Error('MATCH_NOT_UNIQUE'), new Error('Docker unavailable'), new Error('PILOT_BUDGET_LIMIT'), new z.ZodError([]),
    new PilotPatchValidationError('apply', new GeneratorEditError('STALE_BASE', 'Stale base.')),
    new PilotPatchValidationError('apply', new GeneratorEditError('STALE_FILE', 'Stale file.')),
    new PilotPatchValidationError('apply', new GeneratorEditError('UNSAFE_PATH', 'Unsafe path.')),
    new PilotPatchValidationError('apply', new GeneratorEditError('SCOPE_MISMATCH', 'Scope mismatch.')),
  ]) assert.equal(classifyPilotPatchFailure(error), null);
});

test('path, authority and unknown fields remain fatal even when the proposal also exceeds format limits', () => {
  for (const invalid of [proposal([{ ...edit(), path: 'src/App.tsx' }]), proposal([{ ...edit(), path: '../outside.css' }]),
    proposal([{ search: 'x', replacement: 'y' }]), { ...proposal([edit()]), allowedPaths: ['src/App.tsx'] },
    proposal(Array.from({ length: 17 }, () => ({ ...edit(), path: 'src/App.tsx' }))),
  ]) assert.equal(classifyPilotPatchFailure(captured(() => evaluatePilotPatch(base(), invalid, options))), null);
  const corrupted = { ...base(), hash: '0'.repeat(64) };
  assert.equal(classifyPilotPatchFailure(captured(() => evaluatePilotPatch(corrupted, proposal([edit()]), options))), null);
  assert.equal(classifyPilotPatchFailure(captured(() => evaluatePilotPatch(base(), proposal([edit()]), { ...options, now: Number.NaN }))), null);
});

test('a patch that exceeds accepted source bounds is not a new AI repair opportunity', () => {
  const error = captured(() => evaluatePilotPatch(base(), proposal([edit('--accent: cyan;', 'x'.repeat(39_000))]), options));
  assert.ok(error instanceof PilotPatchValidationError);
  assert.equal(error.phase, 'source-boundary');
  assert.equal(classifyPilotPatchFailure(error), null);
});

test('one correction shares the global repair limit and cannot recurse', () => {
  const plan = planPilotPatchCorrection(ambiguous(), 'refine-1', budget());
  assert.deepEqual(plan, { allowed: true, operationId: 'refine-repair-1', repairsUsed: 2, kind: 'MATCH_NOT_UNIQUE' });
  for (const value of [{ ...budget(), repairsUsed: 2 }, { ...budget(), correctionAttempts: 1 }])
    assert.equal(planPilotPatchCorrection(ambiguous(), 'refine-1', value).allowed, false);
  assert.equal(pilotPatchCorrectionOperation('repair-1'), 'repair-1-patch-repair-1');
  assert.equal(pilotPatchCorrectionOperation('repair-2'), 'repair-2-patch-repair-1');
  for (const id of ['refine-repair-1', 'repair-1-patch-repair-1', 'repair-3', 'build-1', '../refine-1']) {
    assert.equal(pilotPatchCorrectionOperation(id), null);
    assert.equal(planPilotPatchCorrection(ambiguous(), id, budget()).allowed, false);
  }
});

test('correction cannot exceed five provider calls; existing operation replay reserves nothing new', () => {
  assert.equal(planPilotPatchCorrection(ambiguous(), 'refine-1', { ...budget(), providerCallsUsed: 5 }).allowed, false);
  assert.equal(planPilotPatchCorrection(ambiguous(), 'refine-1', { ...budget(), providerCallsUsed: 5, correctionAlreadyRecorded: true }).allowed, true);
  for (const invalid of [{ ...budget(), repairsUsed: -1 }, { ...budget(), maxRepairAttempts: 3 }, { ...budget(), providerCallsUsed: Number.NaN },
    { ...budget(), maxProviderCalls: 6 }, { ...budget(), correctionAttempts: 0.5 }])
    assert.equal(planPilotPatchCorrection(ambiguous(), 'refine-1', invalid).allowed, false);
});

test('patch guidance is conditional, unique, disjoint and does not authorize whole-file replacement', () => {
  assert.match(PILOT_PATCH_RULES, /^When a patch is requested/);
  assert.match(PILOT_PATCH_RULES, /exactly once/);
  assert.match(PILOT_PATCH_RULES, /non-overlapping/);
  assert.match(PILOT_PATCH_RULES, /Never use.*whole-file/);
});
