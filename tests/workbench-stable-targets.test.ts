import test from 'node:test';
import assert from 'node:assert/strict';
import {stabilizeWorkbenchJourneyTargets} from '../src/lib/server/generator/workbenchStableTargets';
import {createGeneratorSnapshot} from '../src/lib/server/generator/versionedEdits';
import {bindWorkbenchJourneysToSource} from '../src/lib/server/generator/workbenchJourneyBinding';
const scope={ownerId:'owner-test',projectId:'project-test',missionId:'mission-test',environmentId:'environment-test'};
const snapshot=(source:string)=>createGeneratorSnapshot({scope,revision:'build-1',files:[{path:'src/App.tsx',content:source},{path:'src/styles.css',content:'body{}'}]});
const journeys=[{name:'Reload and verify saved session',requirementIds:[],steps:[{action:'count',testId:'session-row-placeholder',value:'1'},{action:'text',testId:'session-title-placeholder',value:'Reiki'}]}];
const source='export default function App(){return sessions.map(session=><button key={session.id} data-testid={`session-row-${session.id}`} onClick={()=>select(session.id)}><strong data-testid={`session-title-${session.id}`}>{session.title}</strong></button>)}';

test('repairs the actual placeholder/UUID failure without changing behavior or expected results',()=>{
  const base=snapshot(source),fixed=stabilizeWorkbenchJourneyTargets(base,journeys)!;
  assert.ok(fixed);
  assert.deepEqual(fixed.journeys[0].steps,journeys[0].steps.map(s=>({...s,testId:s.testId.replace('-placeholder','')})));
  assert.equal(fixed.snapshot.files[0].content,source.replace('{`session-row-${session.id}`}','"session-row"').replace('{`session-title-${session.id}`}','"session-title"'));
  assert.deepEqual(fixed.snapshot.files[1],base.files[1]);
  assert.equal(bindWorkbenchJourneysToSource(fixed.journeys,fixed.snapshot).findings.length,0);
  assert.equal(stabilizeWorkbenchJourneyTargets(fixed.snapshot,fixed.journeys),null);
  assert.notEqual(fixed.snapshot.hash,base.hash);
});

test('does not rewrite genuine missing controls, guessed IDs, labels or conflicting collection hooks',()=>{
  assert.equal(stabilizeWorkbenchJourneyTargets(snapshot('<div/>'),journeys),null);
  assert.equal(stabilizeWorkbenchJourneyTargets(snapshot(source),[{...journeys[0],steps:journeys[0].steps.map(s=>({...s,testId:s.testId.replace('placeholder','123')}))}]),null);
  assert.equal(stabilizeWorkbenchJourneyTargets(snapshot(source.replaceAll('session.id','session.label')),journeys),null);
  assert.equal(stabilizeWorkbenchJourneyTargets(snapshot(source.replace('return sessions.map','return <><p data-testid="session-row"/><p data-testid="session-title"/>{sessions.map').replace('></button>)}','></button>)}</>}')),journeys),null);
});

test('retains mixed explicit ID selectors instead of changing their meaning',()=>{
  const mixed=[{...journeys[0],steps:[...journeys[0].steps,{action:'click',testId:'session-row-known-uuid',value:''}]}];
  const fixed=stabilizeWorkbenchJourneyTargets(snapshot(source),mixed)!;
  assert.deepEqual(fixed.changes.map(c=>c.to),['session-title']);
  assert.ok(fixed.snapshot.files[0].content.includes('`session-row-${session.id}`'));
});

test('declines two declarations for the same family',()=>{
  assert.equal(stabilizeWorkbenchJourneyTargets(snapshot(source+source),journeys),null);
});

test('an unresolved placeholder is a test defect, not a proved application defect',()=>{
  const bound=bindWorkbenchJourneysToSource(journeys,snapshot(source));
  assert.deepEqual(bound.findings.map(f=>[f.reason,f.classification]),[
    ['unresolved-id-placeholder','TEST_DEFECT'],['unresolved-id-placeholder','TEST_DEFECT'],
  ]);
});
