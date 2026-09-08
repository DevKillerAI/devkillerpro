import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { contractFingerprint, contractSchema } from '../src/lib/server/generator/contract';
import { createGeneratorSnapshot } from '../src/lib/server/generator/versionedEdits';
import { PILOT_CAMPAIGN_MAX_MICROS, reservePilotBudget, settlePilotBudget, validatePilotSnapshot, validatePrivateboardRuntimeRequalification, validatePrivateboardRuntimeRequalificationCall, validatePrivateboardRuntimeRequalificationSnapshot, type PilotBudget, type PilotCall, type PilotRun, type PilotSavedSnapshot } from '../src/lib/server/generator/pilotStore';
import { createPrivateboardContract } from '../src/lib/server/generator/supabasePilotContract';
import { requalifyPrivateboardSnapshot, type PrivateboardRuntimeRequalification } from '../src/lib/server/generator/supabasePilotRequalification';

const budget = (overrides: Partial<PilotBudget> = {}): PilotBudget => ({ spentMicros: 0, reservedMicros: 0, callCount: 0, maxCostMicros: 3_000_000, maxProviderCalls: 5, ...overrides });

test('pilot reserves costs and call count before a provider operation without mutating the input', () => {
  const initial = budget();
  assert.deepEqual(reservePilotBudget(initial, 600_000), { ...initial, reservedMicros: 600_000, callCount: 1 });
  assert.equal(initial.reservedMicros, 0);
  assert.equal(initial.callCount, 0);
});

test('confirmed spend and outstanding reservations share the same finite ceiling', () => {
  const previous = budget({ spentMicros: 1_800_000, reservedMicros: 900_000 });
  assert.equal(reservePilotBudget(previous, 300_000).reservedMicros, 1_200_000);
  assert.throws(() => reservePilotBudget(previous, 300_001), /PILOT_BUDGET_LIMIT/);
});

test('run call cap applies even when estimated cost is tiny', () => {
  assert.throws(() => reservePilotBudget(budget({ callCount: 5 }), 1), /PILOT_CALL_LIMIT/);
});

test('a new run budget cannot reset the shared three-dollar campaign ceiling', () => {
  const previousCampaign = budget({ spentMicros: 2_400_000, reservedMicros: 500_000, maxCostMicros: PILOT_CAMPAIGN_MAX_MICROS });
  assert.doesNotThrow(() => reservePilotBudget(budget(), 200_000));
  assert.throws(() => reservePilotBudget(previousCampaign, 200_000), /PILOT_BUDGET_LIMIT/);
});

test('unknown outcomes stay reserved and do not become zero-cost completions', () => {
  const uncertain = reservePilotBudget(budget(), 3_000_000);
  assert.equal(uncertain.spentMicros, 0);
  assert.equal(uncertain.reservedMicros, 3_000_000);
  assert.throws(() => reservePilotBudget(uncertain, 1), /PILOT_BUDGET_LIMIT/);
});

test('settlement replaces only its reservation with real cost and never refunds call count', () => {
  const reserved = budget({ spentMicros: 100_000, reservedMicros: 900_000, callCount: 2 });
  assert.deepEqual(settlePilotBudget(reserved, 600_000, 250_000), { ...reserved, spentMicros: 350_000, reservedMicros: 300_000 });
  assert.equal(reserved.reservedMicros, 900_000);
  assert.throws(() => settlePilotBudget(reserved, 900_001, 0), /PILOT_RESERVATION_MISMATCH/);
});

test('real overruns are recorded instead of discarded and block later calls', () => {
  const settled = settlePilotBudget(budget({ reservedMicros: 1_000_000, callCount: 1 }), 1_000_000, 3_100_000);
  assert.equal(settled.spentMicros, 3_100_000);
  assert.equal(settled.reservedMicros, 0);
  assert.throws(() => reservePilotBudget(settled, 1), /PILOT_BUDGET_LIMIT/);
});

test('negative, fractional, non-finite and unsafe monetary values fail closed', () => {
  for (const invalid of [-1, 0, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => reservePilotBudget(budget(), invalid));
  for (const invalid of [-1, 0.5, NaN, Infinity]) assert.throws(() => settlePilotBudget(budget({ reservedMicros: 10 }), 10, invalid));
  assert.throws(() => reservePilotBudget(budget({ spentMicros: Number.MAX_SAFE_INTEGER, maxCostMicros: Number.MAX_SAFE_INTEGER }), 1));
});

function snapshotFixture() {
  const contract = contractSchema.parse({
    version: 1, engine: 'v2', identity: { ownerId: 'owner-a', projectId: 'project-a', missionId: 'mission-a', environmentId: 'environment-a' },
    briefingMode: 'simple', prompt: 'Build a responsive interface.', outputLocale: 'en', delivery: 'local_preview',
    runtime: { id: 'react-static', version: 'v1' }, capabilities: ['react'],
    requirements: [{ id: 'navigation', description: 'Navigation works.', acceptanceChecks: [{ id: 'journey', kind: 'browser', description: 'Navigate the interface.' }] }],
    budget: { currency: 'USD', maxCostMicros: 1_000_000, maxProviderCalls: 5, maxRepairAttempts: 2 },
  });
  const snapshot = createGeneratorSnapshot({ scope: contract.identity, revision: 'v1', files: [{ path: 'src/App.tsx', content: 'export const App = () => null;' }] });
  const candidate = { identity: contract.identity, revision: snapshot.revision, sourceHash: snapshot.hash, contractHash: contractFingerprint(contract), runtimeDigest: 'a'.repeat(64) };
  return { contract, snapshot, candidate };
}

test('snapshot binding requires the exact source, contract, revision and owner', () => {
  const { contract, snapshot, candidate } = snapshotFixture();
  assert.deepEqual(validatePilotSnapshot(contract, snapshot, candidate), candidate);
  assert.throws(() => validatePilotSnapshot(contract, snapshot, { ...candidate, identity: { ...candidate.identity, ownerId: 'owner-b' } }));
  assert.throws(() => validatePilotSnapshot(contract, snapshot, { ...candidate, contractHash: 'b'.repeat(64) }));
  assert.throws(() => validatePilotSnapshot(contract, snapshot, { ...candidate, revision: 'v2' }));
  assert.throws(() => validatePilotSnapshot(contract, { ...snapshot, files: [{ ...snapshot.files[0], content: 'changed' }] }, candidate));
  assert.throws(() => validatePilotSnapshot(contract, { ...snapshot, files: [{ ...snapshot.files[0], hash: 'b'.repeat(64) }] }, candidate));
});

test('snapshot parent metadata must be valid and does not pretend to prove database lineage', () => {
  const { contract, snapshot, candidate } = snapshotFixture();
  assert.throws(() => validatePilotSnapshot(contract, { ...snapshot, parent: { revision: '../outside', hash: 'b'.repeat(64) } }, candidate));
});

function runtimeRequalificationFixture() {
  const contract = createPrivateboardContract('owner-a', 'e380119c-64d6-4d65-b3a6-4ad6ee68f42f');
  const verifierVersion = 'privateboard-v1';
  const fromImageId = `sha256:${'1'.repeat(64)}`, toImageId = `sha256:${'2'.repeat(64)}`;
  const runtimeHash = (imageId: string) => createHash('sha256').update(`${imageId}:${verifierVersion}`).digest('hex');
  const saved: PilotSavedSnapshot[] = ['build-1', 'repair-1', 'repair-2'].map((revision, index) => {
    const snapshot = createGeneratorSnapshot({ scope: contract.identity, revision, files: [
      { path: 'src/App.tsx', content: `export const App = () => ${index};` },
      { path: 'src/styles.css', content: 'body { color: red; }' },
      { path: 'supabase/migrations/001_init.sql', content: 'create table app.tasks(id uuid);' },
    ] });
    return { snapshot, candidate: { identity: contract.identity, revision, sourceHash: snapshot.hash, contractHash: contractFingerprint(contract), runtimeDigest: runtimeHash(fromImageId) }, createdAt: new Date(0).toISOString() };
  });
  const original = saved.at(-1)!;
  const authorization: PrivateboardRuntimeRequalification = {
    sourceRevision: 'repair-2', sourceHash: original.snapshot.hash, fromRuntimeDigest: runtimeHash(fromImageId), toRuntimeDigest: runtimeHash(toImageId),
    fromImageId, toImageId, verifierVersion, requalificationRevision: 'runtime-1',
  };
  const calls: PilotCall[] = saved.map(item => ({ operationId: item.snapshot.revision, runId: contract.identity.missionId, ownerId: contract.identity.ownerId,
    status: 'completed', actualMicros: 30_000, reservedMicros: 100_000, requestHash: 'a'.repeat(64), model: 'qa-no-provider', responseId: `qa-${item.snapshot.revision}`,
    request: { fixture: true }, result: { fixture: true }, usage: { fixture: true }, lastResponseStatus: 'completed' }));
  const run: PilotRun = {
    id: contract.identity.missionId, runId: contract.identity.missionId, ownerId: contract.identity.ownerId, campaignId: 'qa-campaign', contract,
    identity: contract.identity, contractHash: contractFingerprint(contract), status: 'failed', sequence: 20, fence: 1, workerId: 'qa-worker', leaseUntil: null,
    budget: budget({ spentMicros: 90_000, callCount: 3 }), campaignBudget: budget({ spentMicros: 120_000, callCount: 4 }),
    candidate: original.candidate, accepted: null, details: { error: 'Controlled runtime fixture failure.' }, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  };
  const runtimeSnapshot = requalifyPrivateboardSnapshot(original.snapshot, authorization, authorization.toRuntimeDigest);
  const runtime = { snapshot: runtimeSnapshot, candidate: { ...original.candidate, revision: runtimeSnapshot.revision, runtimeDigest: authorization.toRuntimeDigest }, createdAt: original.createdAt };
  return { contract, saved, original, calls, run, authorization, runtime };
}

test('runtime requalification is exact, additive and does not change source, history or either budget', () => {
  const f = runtimeRequalificationFixture();
  const before = structuredClone(f);
  assert.deepEqual(validatePrivateboardRuntimeRequalification(f.run, f.saved, f.calls, f.authorization), f.authorization);
  assert.doesNotThrow(() => validatePrivateboardRuntimeRequalificationSnapshot(f.contract, f.authorization, f.runtime.snapshot, f.runtime.candidate, f.original));
  assert.deepEqual(f, before);
  assert.equal(f.runtime.snapshot.hash, f.original.snapshot.hash);
  assert.deepEqual(f.runtime.snapshot.files, f.original.snapshot.files);
});

test('runtime requalification rejects changed images, digests, directive keys or revision authority', () => {
  const f = runtimeRequalificationFixture();
  for (const override of [
    { toImageId: f.authorization.fromImageId }, { toRuntimeDigest: 'c'.repeat(64) }, { fromRuntimeDigest: 'd'.repeat(64) },
    { verifierVersion: 'privateboard-v2' }, { requalificationRevision: 'runtime-2' }, { sourceRevision: 'upgrade-1' }, { extraAuthority: true },
  ]) assert.throws(() => validatePrivateboardRuntimeRequalification(f.run, f.saved, f.calls, { ...f.authorization, ...override } as PrivateboardRuntimeRequalification));
});

test('runtime requalification rejects non-failed, accepted, held, wrong-owner and non-Privateboard runs', () => {
  const f = runtimeRequalificationFixture();
  for (const override of [
    { status: 'ready' }, { status: 'verifying' }, { status: 'cancelled' }, { accepted: f.original.candidate }, { ownerId: 'owner-b' }, { runId: 'other-run' },
    { candidate: null }, { contractHash: 'f'.repeat(64) }, { budget: { ...f.run.budget, reservedMicros: 1 } },
    { campaignBudget: { ...f.run.campaignBudget, reservedMicros: 1 } }, { budget: { ...f.run.budget, maxProviderCalls: 6 } },
    { contract: { ...f.contract, runtime: { id: 'react-static-pilot', version: 'v1' } } },
  ]) assert.throws(() => validatePrivateboardRuntimeRequalification({ ...f.run, ...override } as PilotRun, f.saved, f.calls, f.authorization), /PILOT_RUNTIME_REQUALIFICATION_NOT_ALLOWED/);
});

test('runtime requalification requires every initial operation to be completed, settled, contiguous and fully counted', () => {
  const f = runtimeRequalificationFixture();
  for (const override of [{ status: 'failed' }, { status: 'reserved' }, { status: 'submitted' }, { status: 'uncertain' }, { actualMicros: null },
    { actualMicros: -1 }, { actualMicros: 0.5 }, { actualMicros: 0 }, { operationId: 'upgrade-1' }, { operationId: 'build-1' }, { ownerId: 'owner-b' }, { runId: 'other-run' }]) {
    const calls = [...f.calls.slice(0, 2), { ...f.calls[2], ...override } as PilotCall];
    assert.throws(() => validatePrivateboardRuntimeRequalification(f.run, f.saved, calls, f.authorization), /CALL_HISTORY_MISMATCH/);
  }
  for (const calls of [[], f.calls.slice(1), [...f.calls, { ...f.calls[0], operationId: 'refine-1' }]])
    assert.throws(() => validatePrivateboardRuntimeRequalification(f.run, f.saved, calls, f.authorization), /CALL_HISTORY_MISMATCH/);
  assert.throws(() => validatePrivateboardRuntimeRequalification({ ...f.run, budget: { ...f.run.budget, callCount: 2 } }, f.saved, f.calls, f.authorization), /CALL_HISTORY_MISMATCH/);
});

test('runtime requalification cannot point at another base, saved candidate or previous qualification', () => {
  const f = runtimeRequalificationFixture();
  for (const authorization of [{ ...f.authorization, sourceHash: 'a'.repeat(64) }, { ...f.authorization, sourceRevision: 'repair-1' as const }])
    assert.throws(() => validatePrivateboardRuntimeRequalification(f.run, f.saved, f.calls, authorization), /SOURCE_MISMATCH/);
  assert.throws(() => validatePrivateboardRuntimeRequalification(f.run, f.saved.slice(0, 2), f.calls, f.authorization), /SOURCE_MISMATCH/);
  assert.throws(() => validatePrivateboardRuntimeRequalification(f.run, f.saved.slice(1), f.calls, f.authorization), /SOURCE_MISMATCH/, 'Missing build-1 cannot consume one-shot authority while repair-2 is present.');
  assert.throws(() => validatePrivateboardRuntimeRequalification(f.run, [f.saved[0], f.saved[0], f.saved[2]], f.calls, f.authorization), /SOURCE_MISMATCH/);
  assert.throws(() => validatePrivateboardRuntimeRequalification(f.run, [...f.saved, f.saved[0]], f.calls, f.authorization), /SOURCE_MISMATCH/);
  assert.throws(() => validatePrivateboardRuntimeRequalification(f.run, [{ ...f.saved[0], candidate: { ...f.saved[0].candidate, runtimeDigest: 'a'.repeat(64) } }, ...f.saved.slice(1)], f.calls, f.authorization), /SOURCE_MISMATCH/);
  assert.throws(() => validatePrivateboardRuntimeRequalification(f.run, [{ ...f.saved[0], candidate: { ...f.saved[0].candidate, identity: { ...f.contract.identity, ownerId: 'owner-b' } } }, ...f.saved.slice(1)], f.calls, f.authorization), /SCOPE_OR_HASH_MISMATCH/);
  assert.throws(() => validatePrivateboardRuntimeRequalification({ ...f.run, candidate: f.saved[0].candidate }, f.saved, f.calls, f.authorization), /SOURCE_MISMATCH/);
  for (const details of [{ recoveryMode: 'recorded-output-only' }, { recoveryMode: 'runtime-requalification' }, { runtimeRequalification: f.authorization }])
    assert.throws(() => validatePrivateboardRuntimeRequalification({ ...f.run, details }, f.saved, f.calls, f.authorization), /ALREADY_CLAIMED/);
  assert.throws(() => validatePrivateboardRuntimeRequalification(f.run, [...f.saved, f.runtime], f.calls, f.authorization), /ALREADY_CLAIMED/);
  assert.throws(() => validatePrivateboardRuntimeRequalification(f.run, f.saved, f.calls, f.authorization, true), /ALREADY_CLAIMED/);
});

test('runtime mode permits only the remaining upgrade and CSS refine on the exact new-runtime base', () => {
  const f = runtimeRequalificationFixture();
  assert.doesNotThrow(() => validatePrivateboardRuntimeRequalificationCall(f.authorization, f.runtime.candidate, 'upgrade-1'));
  assert.doesNotThrow(() => validatePrivateboardRuntimeRequalificationCall(f.authorization, { ...f.runtime.candidate, revision: 'upgrade-1' }, 'refine-1'));
  for (const operation of ['build-1', 'repair-1', 'repair-2', 'build-2', 'refine-repair-1', 'refine-repair-2', 'upgrade-2', 'refine-2'])
    assert.throws(() => validatePrivateboardRuntimeRequalificationCall(f.authorization, f.runtime.candidate, operation), /CALL_SCOPE_MISMATCH/);
  for (const candidate of [null, f.original.candidate, { ...f.runtime.candidate, runtimeDigest: 'f'.repeat(64) }, { ...f.runtime.candidate, sourceHash: 'f'.repeat(64) }])
    assert.throws(() => validatePrivateboardRuntimeRequalificationCall(f.authorization, candidate, 'upgrade-1'), /CALL_SCOPE_MISMATCH/);
  assert.throws(() => validatePrivateboardRuntimeRequalificationCall(f.authorization, f.runtime.candidate, 'refine-1'), /CALL_SCOPE_MISMATCH/);
  const fifth = reservePilotBudget(reservePilotBudget(f.run.budget, 100_000), 100_000);
  assert.equal(fifth.callCount, 5);
  assert.equal(fifth.spentMicros, f.run.budget.spentMicros);
  assert.throws(() => reservePilotBudget(fifth, 1), /PILOT_CALL_LIMIT/);
  assert.throws(() => reservePilotBudget({ ...f.run.budget, spentMicros: 3_000_000 }, 1), /PILOT_BUDGET_LIMIT/);
});

test('runtime snapshot cannot change a byte or owner, relabel the old candidate, skip a parent or use the old runtime', () => {
  const f = runtimeRequalificationFixture();
  const changed = { ...createGeneratorSnapshot({ ...f.runtime.snapshot, files: [{ path: 'src/App.tsx', content: 'different bytes' }] }), parent: f.runtime.snapshot.parent };
  assert.throws(() => validatePrivateboardRuntimeRequalificationSnapshot(f.contract, f.authorization, changed, { ...f.runtime.candidate, sourceHash: changed.hash }, f.original), /SOURCE_MISMATCH/);
  assert.throws(() => validatePrivateboardRuntimeRequalificationSnapshot(f.contract, f.authorization, f.original.snapshot, f.original.candidate, f.original), /SNAPSHOT_SCOPE_MISMATCH/);
  assert.throws(() => validatePrivateboardRuntimeRequalificationSnapshot(f.contract, f.authorization, f.runtime.snapshot, { ...f.runtime.candidate, runtimeDigest: f.authorization.fromRuntimeDigest }, f.original), /SNAPSHOT_SCOPE_MISMATCH/);
  assert.throws(() => validatePrivateboardRuntimeRequalificationSnapshot(f.contract, f.authorization, f.runtime.snapshot, f.runtime.candidate, undefined), /SNAPSHOT_SCOPE_MISMATCH/);
  assert.throws(() => validatePrivateboardRuntimeRequalificationSnapshot(f.contract, f.authorization, { ...f.runtime.snapshot, parent: { revision: 'build-1', hash: f.runtime.snapshot.hash } }, f.runtime.candidate, f.original), /SNAPSHOT_SCOPE_MISMATCH/);
  assert.throws(() => validatePrivateboardRuntimeRequalificationSnapshot(f.contract, f.authorization, f.runtime.snapshot, { ...f.runtime.candidate, identity: { ...f.contract.identity, ownerId: 'owner-b' } }, f.original), /SCOPE_OR_HASH_MISMATCH/);
});

test('runtime upgrade preserves the original files and refinement preserves everything outside CSS', () => {
  const f = runtimeRequalificationFixture();
  const makeNext = (parent: PilotSavedSnapshot, revision: string, files: { path: string; content: string }[]): PilotSavedSnapshot => {
    const snapshot = { ...createGeneratorSnapshot({ scope: f.contract.identity, revision, files }), parent: { revision: parent.snapshot.revision, hash: parent.snapshot.hash } };
    return { snapshot, candidate: { ...f.runtime.candidate, revision, sourceHash: snapshot.hash }, createdAt: parent.createdAt };
  };
  const upgrade = makeNext(f.runtime, 'upgrade-1', [...f.runtime.snapshot.files, { path: 'supabase/migrations/002_priority.sql', content: 'alter table app.tasks add column priority integer;' }]);
  assert.doesNotThrow(() => validatePrivateboardRuntimeRequalificationSnapshot(f.contract, f.authorization, upgrade.snapshot, upgrade.candidate, f.runtime));
  const style = makeNext(upgrade, 'refine-1', upgrade.snapshot.files.map(file => file.path === 'src/styles.css' ? { ...file, content: 'body { color: blue; }' } : file));
  assert.doesNotThrow(() => validatePrivateboardRuntimeRequalificationSnapshot(f.contract, f.authorization, style.snapshot, style.candidate, upgrade));
  const wrongUpgrade = makeNext(f.runtime, 'upgrade-1', upgrade.snapshot.files.map(file => file.path === 'src/App.tsx' ? { ...file, content: 'unauthorized source change' } : file));
  assert.throws(() => validatePrivateboardRuntimeRequalificationSnapshot(f.contract, f.authorization, wrongUpgrade.snapshot, wrongUpgrade.candidate, f.runtime), /SOURCE_MISMATCH/);
  const wrongStyle = makeNext(upgrade, 'refine-1', upgrade.snapshot.files.map(file => file.path.endsWith('.sql') ? { ...file, content: 'unauthorized migration change' } : file));
  assert.throws(() => validatePrivateboardRuntimeRequalificationSnapshot(f.contract, f.authorization, wrongStyle.snapshot, wrongStyle.candidate, upgrade), /SOURCE_MISMATCH/);
});

test('pilot migration is isolated from v1/app tables and denies browser roles', () => {
  // Static guard only; PostgreSQL transactional behavior requires a separate real integration run.
  const sql = readFileSync(new URL('../scripts/sql/generator-v2-pilot.sql', import.meta.url), 'utf8');
  assert.match(sql, /create schema if not exists dk_generator_v2/);
  assert.match(sql, /max_cost_micros bigint not null default 3000000/);
  assert.match(sql, /max_cost_micros between 1 and 9007199254740991/);
  assert.match(sql, /one_live_run_per_campaign/);
  assert.match(sql, /primary key\(owner_id,run_id,operation_id\)/);
  assert.match(sql, /immutable_snapshot/);
  assert.equal((sql.match(/enable row level security/g) || []).length, 6);
  assert.match(sql, /create table if not exists dk_generator_v2\.asset_usage/);
  assert.match(sql, /foreign key\(owner_id,run_id\) references dk_generator_v2\.runs/);
  assert.match(sql, /revoke all on schema dk_generator_v2 from public/);
  assert.doesNotMatch(sql, /(?:alter|insert into|update|delete from|drop table)\s+(?:public\.|auth\.|storage\.)/i);
});
