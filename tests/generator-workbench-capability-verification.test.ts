import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkbenchContract} from '../src/lib/server/generator/workbenchContract';
import {addWorkbenchCapabilityEvidence} from '../src/lib/server/generator/workbenchCapabilityVerification';
import {createGeneratorSnapshot} from '../src/lib/server/generator/versionedEdits';
import {evaluatePilotPatch} from '../src/lib/server/generator/pilotPatchRecovery';
import {WORKBENCH_MAX_SOURCE_BYTES,WORKBENCH_MAX_SOURCE_LINES} from '../src/lib/server/generator/workbenchContract';

const owner='owner-capability-test';
const contract=createWorkbenchContract(owner,{requestId:crypto.randomUUID(),title:'Image Studio',prompt:'Generate images from a prompt and analyze uploaded photos.',briefingMode:'simple',localScopeAccepted:true},{managedImageAi:true});
const report=()=>({status:'passed' as const,sourceHash:'a'.repeat(64),verifierVersion:'test',compiledFiles:[],checks:[],failures:[],limitations:[],durationMs:1});

test('missing managed image integration fails before the release gate',()=>{
  const snapshot=createGeneratorSnapshot({scope:contract.identity,revision:'build-1',files:[{path:'src/App.tsx',content:'export default function App(){return <main>Image</main>}'},{path:'src/styles.css',content:'main{color:black}'}]});
  const checked=addWorkbenchCapabilityEvidence(report(),snapshot,contract);
  assert.equal(checked.status,'failed');
  assert.ok(checked.checks.some(check=>check.id==='platform:image-generation'&&!check.passed));
});

test('photographic products require public media and attribution before approval',()=>{
  const snapshot=createGeneratorSnapshot({scope:contract.identity,revision:'build-1',files:[{path:'src/App.tsx',content:'export default function App(){return <div className="fake-photo" />}'},{path:'src/styles.css',content:'.fake-photo{background:orange}'}]});
  const checked=addWorkbenchCapabilityEvidence(report(),snapshot,{...contract,capabilities:['react']},{publicPhotographs:true});
  assert.equal(checked.status,'failed');
  assert.ok(checked.checks.some(check=>check.id==='platform:public-image-search'&&!check.passed));
  assert.ok(checked.checks.some(check=>check.id==='platform:image-attribution'&&!check.passed));
});

test('photographic products reject persisted image bytes and missing in-flight deduplication',()=>{
  const unsafe=`type Asset={imageDataUrl:string};const assets:Record<string,Asset>={};localStorage.setItem('photos',JSON.stringify(assets));window.parent.postMessage({type:'DEVKILLER_PUBLIC_IMAGE_REQUEST'},'*');addEventListener('message',event=>{if(event.data.type==='DEVKILLER_PUBLIC_IMAGE_RESULT')console.log(event.data.imageDataUrl,event.data.attribution,event.data.sourceUrl,event.data.license)});export default function App(){return <main/>}`;
  const snapshot=createGeneratorSnapshot({scope:contract.identity,revision:'build-1',files:[{path:'src/App.tsx',content:unsafe},{path:'src/styles.css',content:'main{color:black}'}]});
  const checked=addWorkbenchCapabilityEvidence(report(),snapshot,{...contract,capabilities:['react']},{publicPhotographs:true});
  assert.equal(checked.status,'failed');
  assert.ok(checked.checks.some(check=>check.id==='platform:media-storage-safety'&&!check.passed));
});

test('photographic products accept request deduplication and metadata-only storage',()=>{
  const safe=`import {useRef} from 'react';type Asset={imageDataUrl:string};const requested=useRef(new Set<string>());localStorage.setItem('photo-metadata',JSON.stringify({sourceUrl:'source',license:'cc0'}));window.parent.postMessage({type:'DEVKILLER_PUBLIC_IMAGE_REQUEST'},'*');addEventListener('message',event=>{if(event.data.type==='DEVKILLER_PUBLIC_IMAGE_RESULT')console.log(event.data.imageDataUrl,event.data.attribution,event.data.sourceUrl,event.data.license)});export default function App(){return <main/>}`;
  const snapshot=createGeneratorSnapshot({scope:contract.identity,revision:'build-1',files:[{path:'src/App.tsx',content:safe},{path:'src/styles.css',content:'main{color:black}'}]});
  const checked=addWorkbenchCapabilityEvidence(report(),snapshot,{...contract,capabilities:['react']},{publicPhotographs:true});
  assert.equal(checked.status,'passed');
  assert.ok(checked.checks.some(check=>check.id==='platform:media-storage-safety'&&check.passed));
});

test('correlated host bridges and export satisfy capability integration evidence',()=>{
  const source=`export default function App(){let busy=false;function generate(prompt:string){if(busy)return;busy=true;const id=crypto.randomUUID();window.parent.postMessage({type:'DEVKILLER_IMAGE_REQUEST',id,prompt},'*');window.parent.postMessage({type:'DEVKILLER_VISION_REQUEST',id,imageDataUrl:new FileReader().result,prompt},'*');addEventListener('message',(event)=>{if(event.data.type==='DEVKILLER_IMAGE_RESULT'||event.data.type==='DEVKILLER_VISION_RESULT'){busy=false;if(!event.data.success)console.error(event.data.error||'timeout')}})}function save(){const canvas=document.createElement('canvas');canvas.toDataURL();const a=document.createElement('a');a.download='image.png'}return <><input type="file"/><button disabled={busy} onClick={()=>generate('prompt')}>Generate</button><button onClick={save}>Download</button></>}`;
  const snapshot=createGeneratorSnapshot({scope:contract.identity,revision:'build-1',files:[{path:'src/App.tsx',content:source},{path:'src/styles.css',content:'button{color:black}'}]});
  const checked=addWorkbenchCapabilityEvidence(report(),snapshot,contract);
  assert.equal(checked.status,'passed');
  assert.ok(checked.checks.every(check=>check.passed));
});

test('workbench edits use the workbench source envelope rather than the smaller V1 pilot limit',()=>{
  const large='a'.repeat(34*1024);
  const snapshot=createGeneratorSnapshot({scope:contract.identity,revision:'build-1',files:[{path:'src/App.tsx',content:`export default function App(){return <main>${large}</main>}`},{path:'src/styles.css',content:'main{color:black}'}]});
  assert.doesNotThrow(()=>evaluatePilotPatch(snapshot,{summary:'Small safe change.',edits:[{path:'src/styles.css',search:'color:black',replacement:'color:navy'}]},
    {operationId:'edit-1',allowedPaths:['src/styles.css'],now:Date.now(),sourceLimits:{maxBytes:WORKBENCH_MAX_SOURCE_BYTES,maxLines:WORKBENCH_MAX_SOURCE_LINES}}));
  assert.throws(()=>evaluatePilotPatch(snapshot,{summary:'Small safe change.',edits:[{path:'src/styles.css',search:'color:black',replacement:'color:navy'}]},
    {operationId:'edit-1',allowedPaths:['src/styles.css'],now:Date.now()}),/source-boundary/);
});
