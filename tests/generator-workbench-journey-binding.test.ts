import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeneratorSnapshot} from '../src/lib/server/generator/versionedEdits';
import {bindWorkbenchJourneysToSource} from '../src/lib/server/generator/workbenchJourneyBinding';

const scope={ownerId:'owner-test',projectId:'project-test',missionId:'mission-test',environmentId:'environment-test'};
const snapshot=(app:string)=>createGeneratorSnapshot({scope,revision:'build-1',files:[{path:'src/App.tsx',content:app},{path:'src/styles.css',content:'body{}'}]});

test('binds literal and template test ids while retaining every declared assertion',()=>{
  const source='import {X} from "lucide-react";export default function App(){const c="Retrofit",p={id:2};return <><button data-testid={`filter-${c}`}>{c}</button><button data-testid={`project-${p.id}`}>Abrir</button><button data-testid="close-project" aria-label="Fechar detalhes"><X/></button></>}';
  const steps=[{action:'click',testId:'filter-Retrofit',value:''},{action:'click',testId:'project-2',value:''},{action:'text',testId:'close-project',value:'Fechar detalhes'}];
  const result=bindWorkbenchJourneysToSource([{name:'project flow',steps}],snapshot(source));
  assert.deepEqual(result.journeys[0].steps,steps);
  assert.deepEqual(result.findings.map(item=>item.reason),['accessible-name-is-not-visible-text']);
});

test('a missing selector remains a failed journey instead of disappearing behind a valid fallback',()=>{
  const source=`export default function App(){return <><button data-testid="other">Outro</button><p data-testid="other-result">OK</p></>}`;
  const input=[{name:'invalid form',steps:[{action:'fill',testId:'company',value:'ACME'},{action:'text',testId:'success',value:'Pronto'}]},{name:'valid fallback',steps:[{action:'click',testId:'other',value:''},{action:'text',testId:'other-result',value:'OK'}]}];
  const result=bindWorkbenchJourneysToSource(input,snapshot(source));
  assert.equal(result.journeys.length,2);
  assert.equal(result.findings[0].reason,'missing-target');
});

test('wrong control kinds are recorded without transforming the action',()=>{
  const source=`export default function App(){return <><p data-testid="label">Company</p><p data-testid="done">Done</p></>}`;
  const result=bindWorkbenchJourneysToSource([{name:'wrong control',steps:[{action:'fill',testId:'label',value:'ACME'},{action:'text',testId:'done',value:'Done'}]}],snapshot(source));
  assert.equal(result.findings[0].reason,'wrong-control-kind');
  assert.equal(result.journeys[0].steps[0].action,'fill');
});

test('does not guess a different source selector from a similar label',()=>{
  const source=`export default function App(){return <><button data-testid="filter-VIDEO">Placas</button><p data-testid="result-count">1 item</p></>}`;
  const result=bindWorkbenchJourneysToSource([{name:'filter flow',steps:[{action:'click',testId:'filter-video',value:''},{action:'text',testId:'result-count',value:'1 item'}]}],snapshot(source));
  assert.equal(result.journeys[0].steps[0].testId,'filter-video');
  assert.equal(result.findings[0].reason,'missing-target');
});
