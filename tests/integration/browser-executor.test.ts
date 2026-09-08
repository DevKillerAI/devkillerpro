import test from 'node:test';
import assert from 'node:assert/strict';
import { executeBrowserChecks } from '../../src/lib/server/browserExecutor';
const html='<html><body><button id="add" onclick="document.getElementById(\'count\').textContent=\'1\'">Add</button><p id="count">0</p></body></html>';
const contract={version:1,tests:[{name:'Counter changes',steps:[{action:'click',selector:'#add'},{action:'expectText',selector:'#count',value:'1'}]}]};
const files=(content=html)=>[{path:'index.html',content},{path:'devkiller.browser.json',content:JSON.stringify(contract)}];

test('text assertions use DOM content despite CSS uppercase and allow bounded notes',async()=>{
  const result=await executeBrowserChecks({files:[
    {path:'index.html',content:'<p id="headline" style="text-transform:uppercase">Design for Tomorrow</p>'},
    {path:'devkiller.browser.json',content:JSON.stringify({version:1,notes:'Offline coverage only.',tests:[{name:'Headline',steps:[{action:'expectText',selector:'#headline',value:'Design for Tomorrow'}]}]})},
  ]});
  assert.equal(result.status,'passed',JSON.stringify(result));
});
test('real Chromium executes declared journeys and rejects a broken control',async()=>{
  const good=await executeBrowserChecks({files:files()});
  assert.equal(good.status,'passed',JSON.stringify(good));
  const broken=await executeBrowserChecks({files:files(html.replace('onclick=','data-disabled='))});
  assert.equal(broken.status,'failed',JSON.stringify(broken));
  assert.notEqual(good.candidateHash,broken.candidateHash);
});
test('browser reports page exceptions',async()=>{
  const result=await executeBrowserChecks({files:files(html+'<script>throw new Error("regression")</script>')});
  assert.equal(result.status,'failed');assert.ok(result.failures.some(f=>f.includes('regression')));
});
test('invalid contract cannot run arbitrary code',async()=>{
  const result=await executeBrowserChecks({files:[{path:'index.html',content:html},{path:'devkiller.browser.json',content:JSON.stringify({version:1,tests:[{name:'unsafe',steps:[{action:'evaluate',value:'process.exit()'}]}]})}]});
  assert.equal(result.status,'failed');
});
test('a TSX application is an unavailable build runtime, not a broken empty UI',async()=>{
  const result=await executeBrowserChecks({files:[{path:'index.html',content:'<div id="root"></div><script type="module" src="/src/main.tsx"></script>'}]});
  assert.equal(result.status,'unavailable');
  assert.deepEqual(result.failures,[]);
  assert.ok(result.limitations.some(message=>message.includes('bundling')));
});
test('smoke-only evidence explicitly excludes feature verification',async()=>{
  const result=await executeBrowserChecks({files:[{path:'index.html',content:html}]});
  assert.equal(result.status,'passed',JSON.stringify(result));
  assert.ok(result.limitations.some(f=>f.includes('No declared functional journeys')));
});
test('external requests are blocked by the runner',async()=>{
  const result=await executeBrowserChecks({files:[
    {path:'index.html',content:'<p id="status">Waiting</p><script>fetch("https://blocked.invalid/test").catch(()=>document.getElementById("status").textContent="Blocked")</script>'},
    {path:'devkiller.browser.json',content:JSON.stringify({version:1,tests:[{name:'Offline boundary',steps:[{action:'expectText',selector:'#status',value:'Blocked'}]}]})},
  ]});
  assert.equal(result.status,'passed',JSON.stringify(result));
});
test('timeout is verification unavailable, not a code repair instruction',async()=>{
  const result=await executeBrowserChecks({files:files(),timeoutMs:1});
  assert.equal(result.status,'unavailable');
  assert.equal(result.failures.length,0);
});
