import assert from 'node:assert/strict';
import test from 'node:test';
import {applyKnownWorkbenchResponsiveRepair} from '../src/lib/server/generator/workbenchResponsiveRepair';
import {createGeneratorSnapshot} from '../src/lib/server/generator/versionedEdits';
import type {PilotVerification} from '../src/lib/server/generator/pilotVerifier';

const scope={ownerId:'owner',projectId:'project',missionId:'mission',environmentId:'environment'};
const report=(details:string):PilotVerification=>({status:'failed',sourceHash:'a'.repeat(64),verifierVersion:'test',compiledFiles:[],checks:[{id:'journey:390:1',passed:false,details}],failures:[details],limitations:[],durationMs:1});

test('restores a journey-proven nav action hidden only on mobile',()=>{
  const base=createGeneratorSnapshot({scope,revision:'build-1',files:[
    {path:'src/App.tsx',content:`export default function App(){return <nav><a>Menu</a><button data-testid="admin-toggle">Admin</button></nav>}`},
    {path:'src/styles.css',content:'nav{display:flex}\n@media(max-width:700px){nav{display:none}.other{display:none}}'},
  ]});
  const fixed=applyKnownWorkbenchResponsiveRepair(base,report("locator.click: Timeout; waiting for getByTestId('admin-toggle'); element is not visible"),'responsive-repair-1');
  assert.ok(fixed);assert.match(fixed.snapshot.files.find(file=>file.path==='src/styles.css')!.content,/@media\(max-width:700px\)\{nav\{display:flex;margin-left:auto\}nav a\{display:none\}/);
  assert.equal(fixed.snapshot.parent?.revision,'build-1');
});

test('does not change a hidden element outside nav or an unrelated failure',()=>{
  const base=createGeneratorSnapshot({scope,revision:'build-1',files:[
    {path:'src/App.tsx',content:`export default function App(){return <><nav>Menu</nav><button data-testid="admin-toggle">Admin</button></>}`},
    {path:'src/styles.css',content:'@media(max-width:700px){nav{display:none}}'},
  ]});
  assert.equal(applyKnownWorkbenchResponsiveRepair(base,report("waiting for getByTestId('admin-toggle'); element is not visible"),'responsive-repair-1'),null);
  assert.equal(applyKnownWorkbenchResponsiveRepair(base,report('Expected text Admin'),'responsive-repair-1'),null);
});

test('repairs a single percentage grid whose columns and gap exceed its container',()=>{
  const base=createGeneratorSnapshot({scope,revision:'build-1',files:[
    {path:'src/App.tsx',content:'export default function App(){return <main/>}'},
    {path:'src/styles.css',content:'.safe{display:grid;grid-template-columns:1fr 1fr;gap:8%}.services{display:grid;grid-template-columns:40% 60%;gap:8%}'},
  ]});
  const overflow=report('Horizontal overflow after interaction.');overflow.failures=['journey:1440:1: Horizontal overflow after interaction.'];
  const fixed=applyKnownWorkbenchResponsiveRepair(base,overflow,'responsive-repair-1');
  assert.equal(fixed?.kind,'percentage-grid-gap-overflow');
  assert.match(fixed!.snapshot.files.find(file=>file.path==='src/styles.css')!.content,/\.services\{display:grid;grid-template-columns:40fr 60fr;gap:8%\}/);
});

test('does not guess when horizontal overflow has zero or multiple provable percentage-grid causes',()=>{
  const overflow=report('Horizontal overflow after interaction.');overflow.failures=['Horizontal overflow after interaction.'];
  const make=(css:string)=>createGeneratorSnapshot({scope,revision:'build-1',files:[{path:'src/App.tsx',content:'export default function App(){return <main/>}'},{path:'src/styles.css',content:css}]});
  assert.equal(applyKnownWorkbenchResponsiveRepair(make('.safe{display:grid;grid-template-columns:1fr 1fr;gap:8%}'),overflow,'repair-1'),null);
  assert.equal(applyKnownWorkbenchResponsiveRepair(make('.a{display:grid;grid-template-columns:50% 50%;gap:2%}.b{display:grid;grid-template-columns:40% 60%;gap:3%}'),overflow,'repair-1'),null);
});
