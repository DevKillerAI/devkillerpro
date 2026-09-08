import test from 'node:test';
import assert from 'node:assert/strict';
import { contractFingerprint } from '../src/lib/server/generator/contract';
import { createPrivateboardContract } from '../src/lib/server/generator/supabasePilotContract';
import { createGeneratorSnapshot } from '../src/lib/server/generator/versionedEdits';
import {
  privateboardEnvironmentRecoverySchema, validatePrivateboardEnvironmentRecovery, validatePrivateboardEnvironmentRecoveryCall,
  validatePrivateboardEnvironmentRecoverySnapshot, reservePilotBudget, type PilotCall, type PilotEvent, type PilotRun, type PilotSavedSnapshot,
} from '../src/lib/server/generator/pilotStore';

const poolFailure = 'Command failed: docker network create qa-only\nError response from daemon: all predefined address pools have been fully subnetted';
function fixture() {
  const contract = createPrivateboardContract('qa-owner', '12345678-1234-4234-8234-123456789abc');
  const snapshot = createGeneratorSnapshot({ scope: contract.identity, revision: 'build-1', files: [
    { path: 'src/App.tsx', content: 'export const App = () => null;' }, { path: 'src/styles.css', content: 'body { color: red; }' },
    { path: 'supabase/migrations/001_init.sql', content: 'create table app.tasks(id uuid);' },
  ] });
  const authorization = { sourceHash: snapshot.hash, runtimeDigest: 'c'.repeat(64) };
  const original: PilotSavedSnapshot = { snapshot, candidate: { identity: contract.identity, revision: snapshot.revision, sourceHash: snapshot.hash,
    contractHash: contractFingerprint(contract), runtimeDigest: authorization.runtimeDigest }, createdAt: new Date(0).toISOString() };
  const call: PilotCall = { operationId: 'build-1', ownerId: contract.identity.ownerId, runId: contract.identity.missionId,
    requestHash: 'a'.repeat(64), reservedMicros: 100_000, actualMicros: 64_372, status: 'completed', model: 'qa-no-provider', responseId: 'qa-response',
    request: { fixture: true }, result: { fixture: true }, usage: { fixture: true }, lastResponseStatus: 'completed' };
  const budget = { spentMicros: 64_372, reservedMicros: 0, callCount: 1, maxCostMicros: 3_000_000, maxProviderCalls: 5 };
  const run: PilotRun = { id: contract.identity.missionId, runId: contract.identity.missionId, ownerId: contract.identity.ownerId, campaignId: 'qa-campaign',
    contract, identity: contract.identity, contractHash: contractFingerprint(contract), status: 'failed', sequence: 3, fence: 1, workerId: 'qa-worker', leaseUntil: 0,
    budget, campaignBudget: { ...budget, spentMicros: 200_000, callCount: 3 }, candidate: original.candidate, accepted: null,
    details: { error: poolFailure }, createdAt: original.createdAt, updatedAt: original.createdAt };
  const events: PilotEvent[] = [
    { sequence: 1, type: 'verification.environment', message: 'Preparing QA environment.', details: { revision: 'build-1' }, createdAt: original.createdAt },
    { sequence: 2, type: 'run.error', message: poolFailure, details: {}, createdAt: original.createdAt },
    { sequence: 3, type: 'run.failed', message: 'Pilot phase: failed.', details: { error: poolFailure }, createdAt: original.createdAt },
  ];
  return { contract, original, authorization, call, run, events };
}
const check = (f: ReturnType<typeof fixture>) => validatePrivateboardEnvironmentRecovery(f.run, [f.original], [f.call], f.events, f.authorization, 1000);

test('environment recovery binds only the original settled build and does not change runtime, source, history or budgets', () => {
  const f = fixture(), before = structuredClone(f);
  assert.deepEqual(check(f), f.authorization);
  assert.deepEqual(f, before);
  assert.doesNotThrow(() => validatePrivateboardEnvironmentRecoverySnapshot(f.contract, f.authorization, f.original.snapshot, f.original.candidate, undefined));
  assert.throws(() => privateboardEnvironmentRecoverySchema.parse({ ...f.authorization, sourceRevision: 'build-2' }));
  assert.throws(() => privateboardEnvironmentRecoverySchema.parse({ ...f.authorization, runtimeDigest: 'not-a-digest' }));
});

test('environment recovery rejects live leases, nonfailed/accepted/held runs, wrong owner and changed fixed contracts', () => {
  for (const override of [{ status: 'ready' }, { status: 'verifying' }, { status: 'cancelled' }, { leaseUntil: 1001 }, { leaseUntil: NaN },
    { ownerId: 'other' }, { runId: 'other' }, { candidate: null }]) {
    const f = fixture(); assert.throws(() => check({ ...f, run: { ...f.run, ...override } as PilotRun }), /NOT_ALLOWED/);
  }
  const f = fixture();
  for (const override of [{ accepted: f.original.candidate }, { budget: { ...f.run.budget, reservedMicros: 1 } },
    { campaignBudget: { ...f.run.campaignBudget, reservedMicros: 1 } }, { budget: { ...f.run.budget, maxProviderCalls: 6 } },
    { contract: { ...f.contract, prompt: 'Different benchmark.' } }, { contract: { ...f.contract, runtime: { id: 'react-static-pilot', version: 'v1' } } }])
    assert.throws(() => check({ ...f, run: { ...f.run, ...override } }), /NOT_ALLOWED/);
});

test('environment recovery rejects missing/extra/unsettled calls and every changed source or saved binding', () => {
  const f = fixture();
  for (const override of [{ status: 'reserved' }, { status: 'submitted' }, { status: 'uncertain' }, { status: 'failed' }, { actualMicros: null },
    { actualMicros: 1 }, { actualMicros: -1 }, { operationId: 'repair-1' }, { ownerId: 'other' }, { runId: 'other' }])
    assert.throws(() => check({ ...f, call: { ...f.call, ...override } as PilotCall }), /CALL_HISTORY_MISMATCH/);
  for (const calls of [[], [f.call, { ...f.call, operationId: 'repair-1' }]])
    assert.throws(() => validatePrivateboardEnvironmentRecovery(f.run, [f.original], calls, f.events, f.authorization, 1000), /CALL_HISTORY_MISMATCH/);
  for (const saved of [[], [f.original, f.original]])
    assert.throws(() => validatePrivateboardEnvironmentRecovery(f.run, saved, [f.call], f.events, f.authorization, 1000), /SOURCE_MISMATCH/);
  assert.throws(() => check({ ...f, authorization: { ...f.authorization, sourceHash: 'f'.repeat(64) } }), /SOURCE_MISMATCH/);
  assert.throws(() => check({ ...f, authorization: { ...f.authorization, runtimeDigest: 'f'.repeat(64) } }), /SOURCE_MISMATCH/);
  assert.throws(() => check({ ...f, original: { ...f.original, candidate: { ...f.original.candidate, identity: { ...f.contract.identity, ownerId: 'other' } } } }), /SOURCE_MISMATCH/);
});

test('only exact pre-environment-ready subnet exhaustion with recorded ordering can receive one-shot authority', () => {
  const f = fixture();
  for (const events of [[], f.events.slice(1), f.events.slice(0, 2),
    f.events.map(event => event.type === 'run.error' ? { ...event, message: 'Generic network failure.' } : event),
    f.events.map(event => event.type === 'verification.environment' ? { ...event, details: { revision: 'repair-1' } } : event),
    [...f.events, { ...f.events[1], sequence: 4 }],
  ]) assert.throws(() => check({ ...f, events }), /FAILURE_EVIDENCE_MISMATCH/);
  for (const type of ['verification.environment-ready', 'verification.finished', 'verification.runtime', 'benchmark.initial-passed'])
    assert.throws(() => check({ ...f, events: [...f.events, { ...f.events[0], type }] }), /FAILURE_EVIDENCE_MISMATCH/);
  assert.throws(() => check({ ...f, run: { ...f.run, details: { error: 'Different failure.' } } }), /FAILURE_EVIDENCE_MISMATCH/);
  for (const details of [{ recoveryMode: 'environment-recovery' }, { recoveryMode: 'runtime-requalification' }, { environmentRecovery: f.authorization }, { runtimeRequalification: {} }])
    assert.throws(() => check({ ...f, run: { ...f.run, details } }), /ALREADY_CLAIMED/);
  assert.throws(() => check({ ...f, events: [...f.events, { ...f.events[0], type: 'recovery.claimed' }] }), /ALREADY_CLAIMED/);
});

test('environment call authority remains sequential with two repairs, original final operations and unchanged ceilings', () => {
  const f = fixture();
  const candidate = (revision: string) => ({ ...f.original.candidate, revision });
  const calls = (...ids: string[]) => ids.map(operationId => ({ ...f.call, operationId }));
  const verify = (revision: string, operationId: string, history: PilotCall[]) => validatePrivateboardEnvironmentRecoveryCall(f.contract, f.authorization, candidate(revision), operationId, history);
  assert.doesNotThrow(() => verify('build-1', 'repair-1', calls('build-1')));
  assert.doesNotThrow(() => verify('repair-1', 'repair-2', calls('build-1', 'repair-1')));
  for (const initial of [['build-1'], ['build-1', 'repair-1'], ['build-1', 'repair-1', 'repair-2']]) {
    assert.doesNotThrow(() => verify(initial.at(-1)!, 'upgrade-1', calls(...initial)));
    assert.doesNotThrow(() => verify('upgrade-1', 'refine-1', calls(...initial, 'upgrade-1')));
  }
  for (const operation of ['build-1', 'build-2', 'repair-2', 'repair-3', 'refine-1', 'refine-repair-1', 'runtime-1'])
    assert.throws(() => verify('build-1', operation, calls('build-1')), /CALL_SCOPE_MISMATCH/);
  assert.throws(() => verify('build-1', 'upgrade-1', calls('build-1', 'repair-1')), /CALL_SCOPE_MISMATCH/);
  assert.throws(() => verify('upgrade-1', 'refine-1', calls('build-1', 'repair-2', 'upgrade-1')), /CALL_SCOPE_MISMATCH/);
  assert.throws(() => verify('repair-1', 'repair-2', [f.call, { ...f.call, operationId: 'repair-1', status: 'submitted' }]), /CALL_SCOPE_MISMATCH/);
  for (const changed of [{ ...f.original.candidate, runtimeDigest: 'f'.repeat(64) }, { ...f.original.candidate, sourceHash: 'f'.repeat(64) },
    { ...f.original.candidate, identity: { ...f.contract.identity, ownerId: 'other' } }])
    assert.throws(() => validatePrivateboardEnvironmentRecoveryCall(f.contract, f.authorization, changed, 'repair-1', [f.call]), /CALL_SCOPE_MISMATCH/);
  let budget = f.run.budget;
  for (let n = 0; n < 4; n++) budget = reservePilotBudget(budget, 100_000);
  assert.equal(budget.callCount, 5); assert.equal(budget.spentMicros, 64_372);
  assert.throws(() => reservePilotBudget(budget, 1), /PILOT_CALL_LIMIT/);
  assert.throws(() => reservePilotBudget({ ...f.run.budget, spentMicros: 3_000_000 }, 1), /PILOT_BUDGET_LIMIT/);
});

test('environment snapshot authority preserves exact build and runtime with correct repair, migration and CSS-only lineage', () => {
  const f = fixture();
  const makeNext = (parent: PilotSavedSnapshot, revision: string, files: readonly { path: string; content: string }[] = parent.snapshot.files): PilotSavedSnapshot => {
    const snapshot = { ...createGeneratorSnapshot({ scope: f.contract.identity, revision, files }), parent: { revision: parent.snapshot.revision, hash: parent.snapshot.hash } };
    return { snapshot, candidate: { ...f.original.candidate, revision, sourceHash: snapshot.hash }, createdAt: parent.createdAt };
  };
  const verify = (next: PilotSavedSnapshot, parent?: PilotSavedSnapshot) => validatePrivateboardEnvironmentRecoverySnapshot(f.contract, f.authorization, next.snapshot, next.candidate, parent);
  const repair = makeNext(f.original, 'repair-1', f.original.snapshot.files.map(file => file.path === 'src/App.tsx' ? { ...file, content: 'export const App = () => 1;' } : file));
  const repair2 = makeNext(repair, 'repair-2');
  const upgrade = makeNext(repair2, 'upgrade-1', [...repair2.snapshot.files, { path: 'supabase/migrations/002_priority.sql', content: 'alter table app.tasks add column priority integer;' }]);
  const refine = makeNext(upgrade, 'refine-1', upgrade.snapshot.files.map(file => file.path === 'src/styles.css' ? { ...file, content: 'body { color: blue; }' } : file));
  assert.doesNotThrow(() => verify(f.original)); assert.doesNotThrow(() => verify(repair, f.original)); assert.doesNotThrow(() => verify(repair2, repair));
  assert.doesNotThrow(() => verify(upgrade, repair2)); assert.doesNotThrow(() => verify(refine, upgrade));
  assert.throws(() => verify({ ...f.original, candidate: { ...f.original.candidate, runtimeDigest: 'f'.repeat(64) } }), /SNAPSHOT_SCOPE_MISMATCH/);
  assert.throws(() => verify({ ...repair, candidate: { ...repair.candidate, identity: { ...f.contract.identity, ownerId: 'other' } } }, f.original), /SCOPE_OR_HASH_MISMATCH/);
  for (const revision of ['build-2', 'runtime-1', 'repair-3', 'refine-repair-1']) assert.throws(() => verify(makeNext(f.original, revision), f.original), /SNAPSHOT_SCOPE_MISMATCH/);
  assert.throws(() => verify(repair2, f.original), /SNAPSHOT_SCOPE_MISMATCH/);
  assert.throws(() => verify(makeNext(f.original, 'build-1', repair.snapshot.files), f.original), /SOURCE_MISMATCH/);
  assert.throws(() => verify(makeNext(repair2, 'upgrade-1', refine.snapshot.files), repair2), /SOURCE_MISMATCH/);
  assert.throws(() => verify(makeNext(upgrade, 'refine-1', upgrade.snapshot.files.map(file => file.path.endsWith('.sql') ? { ...file, content: 'changed SQL' } : file)), upgrade), /SOURCE_MISMATCH/);
});
