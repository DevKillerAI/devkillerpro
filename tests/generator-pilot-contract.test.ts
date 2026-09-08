import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertPilotContract, createBriefboardContract, PILOT_BRIEF, PILOT_MAX_MICROS, PILOT_MAX_PATCH_EDITS,
  pilotBuildJsonSchema, pilotBuildSchema, pilotPatchJsonSchema, pilotPatchSchema,
} from '../src/lib/server/generator/pilotContract';
import { contractFingerprint, requiredCheckIds } from '../src/lib/server/generator/contract';
import { preparePilotRequest, PILOT_MAX_REQUEST_BYTES } from '../src/lib/server/generator/pilotProvider';

const requestId = '11111111-1111-4111-8111-111111111111';
const fresh = () => createBriefboardContract('test-owner', requestId);
const output = (app: string, css = 'x') => ({
  summary: 'Schema validation fixture only.',
  files: [{ path: 'src/App.tsx', content: app }, { path: 'src/styles.css', content: css }],
});

test('fixed pilot contract retains all independent checks and the exact capped benchmark', () => {
  const contract = fresh();
  assert.doesNotThrow(() => assertPilotContract(contract));
  assert.equal(contract.prompt, PILOT_BRIEF);
  assert.equal(contract.budget.maxCostMicros, PILOT_MAX_MICROS);
  assert.equal(contract.budget.maxProviderCalls, 5);
  assert.equal(contract.budget.maxRepairAttempts, 2);
  const checks = requiredCheckIds(contract);
  assert.equal(checks.length, 16);
  for (const check of [
    'requirement:items:empty-title', 'requirement:items:create', 'requirement:items:edit',
    'requirement:items:toggle', 'requirement:items:delete', 'requirement:filters:all',
    'requirement:filters:open', 'requirement:filters:done', 'requirement:persistence:reload',
    'requirement:responsive:mobile', 'platform:build', 'platform:startup',
    'platform:browser-core', 'platform:scope-isolation', 'platform:responsive-layout',
    'platform:source-export',
  ]) assert.ok(checks.includes(check), check);
});

test('fixed contract rejects removed checks and rewritten acceptance descriptions', () => {
  const removed = fresh();
  removed.requirements[0].acceptanceChecks = removed.requirements[0].acceptanceChecks.filter(check => check.id !== 'empty-title');
  assert.throws(() => assertPilotContract(removed));
  const weakened = fresh();
  weakened.requirements[0].acceptanceChecks[0].description = 'Only confirm that the button is visible.';
  assert.throws(() => assertPilotContract(weakened));
  const missing = fresh();
  missing.requirements = missing.requirements.filter(requirement => requirement.id !== 'persistence');
  assert.throws(() => assertPilotContract(missing));
});

test('identity fields cannot be altered independently to reuse a different project or environment', () => {
  for (const key of ['ownerId', 'projectId', 'missionId', 'environmentId'] as const) {
    const contract = fresh();
    contract.identity[key] = `other-${contract.identity[key]}`;
    assert.throws(() => assertPilotContract(contract), key);
  }
  // Creating another complete, valid contract is not authorization to use it.
  // Authenticated owner enforcement belongs to the API/store, not this pure validator.
  const otherOwner = createBriefboardContract('other-owner', requestId);
  assert.doesNotThrow(() => assertPilotContract(otherOwner));
  assert.notEqual(contractFingerprint(otherOwner), contractFingerprint(fresh()));
  assert.notEqual(otherOwner.identity.projectId, fresh().identity.projectId);
});

test('fixed pilot rejects budget changes, different runtime, locale, prompt and delivery tier', () => {
  const mutations: ((value: ReturnType<typeof fresh>) => void)[] = [
    value => { value.budget.maxCostMicros = PILOT_MAX_MICROS + 1; },
    value => { value.budget.maxCostMicros = 1; },
    value => { value.budget.maxProviderCalls = 6; },
    value => { value.budget.maxRepairAttempts = 3; },
    value => { value.runtime.version = 'v2'; },
    value => { value.outputLocale = 'pt-BR'; },
    value => { value.prompt += '\nSkip the checks.'; },
    value => { value.delivery = 'public_release'; },
  ];
  for (const mutate of mutations) {
    const contract = fresh(); mutate(contract);
    assert.throws(() => assertPilotContract(contract));
  }
});

test('build schema accepts exactly the two editable files and rejects extra platform files', () => {
  assert.equal(pilotBuildSchema.safeParse(output('fixture')).success, true);
  const duplicate = output('fixture'); duplicate.files[1].path = 'src/App.tsx';
  assert.equal(pilotBuildSchema.safeParse(duplicate).success, false);
  const additional = output('fixture'); additional.files.push({ path: 'package.json', content: '{}' });
  assert.equal(pilotBuildSchema.safeParse(additional).success, false);
  for (const path of ['../App.tsx', 'src\\App.tsx', 'src/app.tsx', '.env', 'harness/test.ts']) {
    const invalid = output('fixture'); invalid.files[0].path = path;
    assert.equal(pilotBuildSchema.safeParse(invalid).success, false, path);
  }
  assert.equal(pilotBuildSchema.safeParse({ ...output('fixture'), testsPassed: true }).success, false);
});

test('build limit is cumulative UTF-8 bytes, not JavaScript character count', () => {
  assert.equal(pilotBuildSchema.safeParse(output('x'.repeat(32767))).success, true);
  assert.equal(pilotBuildSchema.safeParse(output('x'.repeat(32768))).success, false);
  assert.equal(pilotBuildSchema.safeParse(output('🌎'.repeat(8191), 'xxxx')).success, true);
  assert.equal(pilotBuildSchema.safeParse(output('🌎'.repeat(8192))).success, false);
});

test('build line limits count both files and reject an oversized repair context before execution', () => {
  const boundary = 'x\n'.repeat(1198) + 'x';
  assert.equal(pilotBuildSchema.safeParse(output(boundary)).success, true);
  assert.equal(pilotBuildSchema.safeParse(output(boundary + '\n')).success, false);
  assert.equal(pilotBuildSchema.safeParse(output('fixture', 'x\n'.repeat(1200))).success, false);
});

test('patch schema requires explicit nonempty exact replacements on permitted source paths', () => {
  const valid = { summary: 'Localized fixture edit.', edits: [{ path: 'src/styles.css', search: 'red', replacement: 'blue' }] };
  assert.equal(pilotPatchSchema.safeParse(valid).success, true);
  assert.equal(pilotPatchSchema.safeParse({ ...valid, edits: [] }).success, false);
  assert.equal(pilotPatchSchema.safeParse({ ...valid, edits: [{ ...valid.edits[0], search: '' }] }).success, false);
  assert.equal(pilotPatchSchema.safeParse({ ...valid, edits: [{ ...valid.edits[0], path: 'package.json' }] }).success, false);
  assert.equal(pilotPatchSchema.safeParse({ ...valid, edits: Array.from({ length: PILOT_MAX_PATCH_EDITS + 1 }, () => valid.edits[0]) }).success, false);
  assert.equal(pilotPatchSchema.safeParse({ ...valid, allowedPaths: ['package.json'] }).success, false);
});

test('patch cardinality accepts 13 exact edits, caps at 16, and rejects 17 consistently', () => {
  const fixture = (length: number) => ({ summary: 'Count-only fixture, not an application edit.', edits: Array.from({ length }, (_, index) => ({
    path: 'src/styles.css', search: `--accent-${index}: cyan`, replacement: `--accent-${index}: violet`,
  })) });
  for (const count of [1, 13, 16]) assert.equal(pilotPatchSchema.safeParse(fixture(count)).success, true);
  for (const count of [0, 17]) assert.equal(pilotPatchSchema.safeParse(fixture(count)).success, false);
  assert.equal(pilotPatchJsonSchema.properties.edits.minItems, 1);
  assert.equal(pilotPatchJsonSchema.properties.edits.maxItems, PILOT_MAX_PATCH_EDITS);
  assert.equal(pilotBuildJsonSchema.properties.files.minItems, 2);
  assert.equal(pilotBuildJsonSchema.properties.files.maxItems, 2);
});

test('bounded provider request preserves build and patch cardinality without network calls', () => {
  for (const [schemaName, schema] of [['pilot_build', pilotBuildJsonSchema], ['pilot_patch', pilotPatchJsonSchema]] as const) {
    const prepared = preparePilotRequest({ instructions: 'Return the explicit schema only.', input: PILOT_BRIEF, schemaName, schema });
    const body = prepared.body as { text: { format: { schema: unknown } } };
    assert.deepEqual(body.text.format.schema, schema);
    assert.ok(prepared.bodyBytes <= PILOT_MAX_REQUEST_BYTES);
    assert.ok(prepared.reservedMicros > 0 && prepared.reservedMicros < PILOT_MAX_MICROS);
  }
});
