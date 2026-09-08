import { sameIdentity } from './contract';
import { PILOT_BRIEF, pilotBuildSchema, pilotPatchSchema } from './pilotContract';
import { applyAuthorizedEdits } from './operationPolicy';
import { parsePilotOutput, PILOT_MODEL } from './pilotProvider';
import type { PilotCall } from './pilotStore';
import type { GeneratorSnapshot } from './versionedEdits';

/** Offline replay of an already-paid, completed response. No provider/network/store writes. */
export function readRecordedPilotRefinement(base: GeneratorSnapshot, call: PilotCall) {
  const request = call.request as Record<string, any> | null;
  const raw = call.result as Record<string, any> | null;
  if (call.status !== 'completed' || call.operationId !== 'refine-1' || call.model !== PILOT_MODEL ||
      call.ownerId !== base.scope.ownerId || call.runId !== base.scope.missionId ||
      call.actualMicros === null || !call.responseId || raw?.id !== call.responseId || raw?.model !== PILOT_MODEL ||
      request?.model !== PILOT_MODEL || typeof request?.input !== 'string' ||
      request?.text?.format?.name !== 'dk_v2_pilot_patch') throw new Error('Recorded refinement is not a settled, scoped pilot response.');
  const marker = '\n\nSOURCE DATA (exact replacements only; no whole-project rewrite)\n';
  const split = request.input.indexOf(marker);
  const expectedRequest = `${PILOT_BRIEF}\n\nEDIT REQUEST\nChange the primary cyan accent color to violet #8b5cf6 in src/styles.css only. Preserve layout, all interactions and other files. Update all matching accent shades as appropriate. No new features.`;
  if (split < 0 || request.input.slice(0, split) !== expectedRequest) throw new Error('Recorded request is not the approved style-only edit.');
  const context = JSON.parse(request.input.slice(split + marker.length));
  const css = base.files.find(file => file.path === 'src/styles.css');
  if (!css || !sameIdentity(context.scope, base.scope) || context.baseHash !== base.hash || context.baseRevision !== base.revision ||
      !Array.isArray(context.selections) || context.selections.length !== 1 || context.selections[0]?.path !== css.path ||
      context.selections[0]?.fileHash !== css.hash || context.selections[0]?.content !== css.content)
    throw new Error('Recorded refinement was prepared for a different source snapshot.');
  return pilotPatchSchema.parse(parsePilotOutput(raw));
}

export function applyPilotStylePatch(base: GeneratorSnapshot, value: unknown, revision: 'refine-1' | 'refine-repair-1', now: number) {
  const patch = pilotPatchSchema.parse(value);
  const next = applyAuthorizedEdits(base, {
    scope: base.scope, baseHash: base.hash, baseRevision: base.revision, newRevision: revision,
    operations: patch.edits.map(edit => ({ kind: 'replace' as const, ...edit, expectedHash: base.files.find(file => file.path === edit.path)?.hash || '' })),
  }, { operationId: revision, identity: base.scope, baseHash: base.hash, baseRevision: base.revision,
    allowedPaths: ['src/styles.css'], allowCreate: false, allowDelete: false, expiresAt: now + 60_000 }, now);
  pilotBuildSchema.parse({ summary: patch.summary, files: next.files.map(file => ({ path: file.path, content: file.content })) });
  if (base.files.find(file => file.path === 'src/App.tsx')?.hash !== next.files.find(file => file.path === 'src/App.tsx')?.hash ||
      !next.files.find(file => file.path === 'src/styles.css')?.content.toLowerCase().includes('#8b5cf6'))
    throw new Error('Recorded edit did not preserve app code and include the requested accent.');
  return { snapshot: next, summary: patch.summary, editCount: patch.edits.length };
}

export function applyRecordedPilotRefinement(base: GeneratorSnapshot, call: PilotCall, now: number) {
  return applyPilotStylePatch(base, readRecordedPilotRefinement(base, call), 'refine-1', now);
}
