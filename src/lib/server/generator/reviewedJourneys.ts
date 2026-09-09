import type {AcceptanceContract} from './acceptanceContract';
import {workbenchJourneysSchema} from './workbenchContract';
import {bindWorkbenchJourneysToSource} from './workbenchJourneyBinding';
import type {GeneratorSnapshot} from './versionedEdits';

/** Operator-authored recovery is tied to exact source and retains every original requirement. */
export function reviewedJourneys(value: unknown, snapshot: GeneratorSnapshot, original: unknown, acceptance?: AcceptanceContract) {
  const input=value as {sourceHash?: string; journeys?: unknown};
  if(!input||input.sourceHash!==snapshot.hash)throw new Error('Reviewed journeys do not match the preserved source.');
  const old=workbenchJourneysSchema.parse(original),next=workbenchJourneysSchema.parse(input.journeys);
  const retained=new Set(next.flatMap(j=>j.requirementIds));
  if(old.some(j=>j.requirementIds.some(id=>!retained.has(id)&&(!acceptance||acceptance.requirements.find(r=>r.id===id)?.verificationType==='browser'||!acceptance.requirements.some(r=>r.id===id)))))throw new Error('Reviewed journeys cannot remove requirements.');
  const binding=bindWorkbenchJourneysToSource(next,snapshot,{acceptanceContract:acceptance});
  if(binding.findings.length)throw new Error('Reviewed journeys contain invalid source targets.');
  return next;
}

