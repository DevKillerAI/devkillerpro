import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeneratorSnapshot, readSnapshotContext } from '../src/lib/server/generator/versionedEdits';
import { applyRecordedPilotRefinement } from '../src/lib/server/generator/pilotRecordedRefinement';
import { PILOT_BRIEF } from '../src/lib/server/generator/pilotContract';
import type { PilotCall } from '../src/lib/server/generator/pilotStore';

function fixture() {
  const base = createGeneratorSnapshot({ scope: { ownerId: 'fixture-owner', projectId: 'fixture-project', missionId: 'fixture-mission', environmentId: 'fixture-environment' }, revision: 'repair-1',
    files: [{ path: 'src/App.tsx', content: 'export default function App(){return <p>Decoder fixture</p>}' }, { path: 'src/styles.css', content: ':root { --accent: #00abcd; }' }] });
  const context = readSnapshotContext(base, { scope: base.scope, baseHash: base.hash, baseRevision: base.revision, selections: [{ path: 'src/styles.css', startLine: 1, endLine: 1 }], budget: { maxFiles: 1, maxBytes: 4096, maxLines: 20 } });
  const call: PilotCall = { operationId: 'refine-1', runId: base.scope.missionId, ownerId: base.scope.ownerId, requestHash: 'a'.repeat(64), model: 'gpt-5.6-terra', reservedMicros: 1000, actualMicros: 1, status: 'completed', responseId: 'resp_fixture', usage: {}, lastResponseStatus: 'completed',
    request: { model: 'gpt-5.6-terra', text: { format: { name: 'dk_v2_pilot_patch' } }, input: `${PILOT_BRIEF}\n\nEDIT REQUEST\nChange the primary cyan accent color to violet #8b5cf6 in src/styles.css only. Preserve layout, all interactions and other files. Update all matching accent shades as appropriate. No new features.\n\nSOURCE DATA (exact replacements only; no whole-project rewrite)\n${JSON.stringify(context)}` },
    result: { id: 'resp_fixture', model: 'gpt-5.6-terra', status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ summary: 'Change the accent.', edits: [{ path: 'src/styles.css', search: '#00abcd', replacement: '#8b5cf6' }] }) }] }] } };
  return { base, call };
}

test('offline recorded refinement preserves app code, source lineage and original inputs', () => {
  const { base, call } = fixture(); const original = JSON.stringify({ base, call });
  const result = applyRecordedPilotRefinement(base, call, Date.now());
  assert.equal(result.snapshot.revision, 'refine-1');
  assert.equal(result.snapshot.files.find(file => file.path === 'src/App.tsx')!.hash, base.files.find(file => file.path === 'src/App.tsx')!.hash);
  assert.match(result.snapshot.files.find(file => file.path === 'src/styles.css')!.content, /#8b5cf6/);
  assert.equal(JSON.stringify({ base, call }), original);
});

test('recorded replay rejects unsettled, cross-scope, foreign-response and wrong-base data', () => {
  for (const mutate of [
    (call: PilotCall) => { call.status = 'uncertain'; },
    (call: PilotCall) => { call.ownerId = 'other-owner'; },
    (call: PilotCall) => { call.actualMicros = null; },
    (call: PilotCall) => { call.responseId = 'resp_other'; },
    (call: PilotCall) => { (call.request as any).input = (call.request as any).input.replace('"baseRevision":"repair-1"', '"baseRevision":"other-revision"'); },
    (call: PilotCall) => { (call.result as any).output[0].content[0].text = JSON.stringify({ summary: 'Unauthorized', edits: [{ path: 'src/App.tsx', search: 'Decoder fixture', replacement: 'Changed #8b5cf6' }] }); },
  ]) { const { base, call } = fixture(); mutate(call); assert.throws(() => applyRecordedPilotRefinement(base, call, Date.now())); }
});
