import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createBriefboardContract } from '../src/lib/server/generator/pilotContract';
import { createPrivateboardContract, assertPrivateboardContract, privateboardBuildSchema, privateboardEnvironmentIdentity, applyPrivateboardPatch, applyPrivateboardUpgrade } from '../src/lib/server/generator/supabasePilotContract';
import { createGeneratorSnapshot } from '../src/lib/server/generator/versionedEdits';
import { requiredCheckIds } from '../src/lib/server/generator/contract';
import { validatePrivateboardSource } from '../src/lib/server/generator/supabasePilotRuntime';

const make = () => {
  const contract = createPrivateboardContract('qa-owner', randomUUID());
  const snapshot = createGeneratorSnapshot({ scope: contract.identity, revision: 'build-1', files: [
    { path: 'src/App.tsx', content: 'export default function App(){return null}' },
    { path: 'src/styles.css', content: ':root{--accent:cyan}' },
    // Intentionally not executable app SQL; these are pure authority/hash tests.
    { path: 'supabase/migrations/001_init.sql', content: '-- initial fixture' },
  ] });
  return { contract, snapshot };
};
test('database pilot has mandatory backend gates and cannot alias another benchmark request', () => {
  const id = randomUUID();
  const contract = createPrivateboardContract('qa-owner', id);
  assert.deepEqual(contract.identity, createBriefboardContract('qa-owner', id).identity);
  assertPrivateboardContract(contract);
  for (const gate of ['migration-fresh','migration-upgrade','auth-two-users','authorization-cross-owner','database-concurrency']) assert.ok(requiredCheckIds(contract).includes(`platform:${gate}`));
  assert.ok(requiredCheckIds(contract).includes('requirement:persistence:server-restart'));
  assert.throws(() => assertPrivateboardContract({ ...contract, capabilities: ['react'] }));
  assert.throws(() => assertPrivateboardContract({ ...contract, budget: { ...contract.budget, maxProviderCalls: 6 } }));
});
test('initial source rejects missing migrations, extra paths and an early upgrade', () => {
  const { snapshot } = make();
  privateboardBuildSchema.parse({ summary: 'fixture', files: snapshot.files.map(({path,content})=>({path,content})) });
  assert.throws(() => privateboardBuildSchema.parse({ summary:'fixture', files: snapshot.files.slice(0,2) }));
  assert.throws(() => validatePrivateboardSource(createGeneratorSnapshot({ ...snapshot, files: [...snapshot.files, { path:'src/other.ts',content:'not allowed' }] })));
});
test('database environment tracks original migration, not CSS or additive upgrades', () => {
  const { snapshot } = make();
  const original = privateboardEnvironmentIdentity(snapshot);
  const styled = applyPrivateboardPatch(snapshot, {summary:'Color',edits:[{path:'src/styles.css',search:'cyan',replacement:'violet'}]},'refine-1',['src/styles.css']).snapshot;
  assert.deepEqual(privateboardEnvironmentIdentity(styled), original);
  const upgraded = applyPrivateboardUpgrade(styled, {summary:'Additive fixture',sql:'-- additive fixture'}).snapshot;
  assert.deepEqual(privateboardEnvironmentIdentity(upgraded), original);
  assert.equal(upgraded.files.find(f=>f.path.endsWith('001_init.sql'))!.hash, snapshot.files.find(f=>f.path.endsWith('001_init.sql'))!.hash);
  const changed = applyPrivateboardPatch(snapshot,{summary:'Migration',edits:[{path:'supabase/migrations/001_init.sql',search:'initial fixture',replacement:'changed initial fixture'}]},'repair-1',['supabase/migrations/001_init.sql']).snapshot;
  assert.notEqual(privateboardEnvironmentIdentity(changed).environmentId, original.environmentId);
});
test('style authority cannot modify SQL or source and rejects ambiguous edits atomically', () => {
  const { snapshot } = make();
  assert.throws(() => applyPrivateboardPatch(snapshot,{summary:'Unauthorized',edits:[{path:'supabase/migrations/001_init.sql',search:'initial',replacement:'changed'}]},'refine-1',['src/styles.css']));
  assert.throws(() => applyPrivateboardPatch(snapshot,{summary:'Missing',edits:[{path:'src/styles.css',search:'does-not-exist',replacement:'x'}]},'refine-1',['src/styles.css']));
  assert.equal(snapshot.revision,'build-1');
});
