import test from 'node:test';
import assert from 'node:assert/strict';
import {assessWorkbenchCapabilities,createWorkbenchContract} from '../src/lib/server/generator/workbenchContract';
import {workbenchInstructionsFor} from '../src/lib/server/generator/workbenchInstructions';
import {requiredCheckIds} from '../src/lib/server/generator/contract';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {exportedBuildScript,exportedServerScript} from '../src/lib/server/generator/pilotExportRuntime';
import {extractAcceptanceContract,preserveAcceptanceContract} from '../src/lib/server/generator/acceptanceContract';
import {createWorkbenchQualityPlan} from '../src/lib/server/generator/workbenchQuality';
test('real authentication does not turn explicitly excluded images into required photography',()=>{
  assert.equal(createWorkbenchQualityPlan('Notas privadas com login real. Interface sem imagens, anexos ou integrações externas.','detailed').media.requested,false);
  assert.equal(createWorkbenchQualityPlan('Menu sem imagens ou fotos.','detailed').media.photographic,false);
  assert.equal(createWorkbenchQualityPlan('Menu com fotos reais dos pratos.','detailed').media.photographic,true);
  assert.equal(createWorkbenchQualityPlan('Sem imagens na capa, com fotos reais dos produtos na galeria.','detailed').media.photographic,true);
});
test('resume preserves the billed request plan but rejects altered requirements or ownership',()=>{
  const contract=createWorkbenchContract('test-owner',{requestId:'5a0deefe-8d09-484f-ae4c-d39fb9e5bffd',title:'Notes app',prompt:'Create a personal notes app.',profile:'browser',briefingMode:'simple',localScopeAccepted:true});
  const plan=extractAcceptanceContract({identity:contract.identity,title:'Notes app',brief:'Create a personal notes app.',outputLocale:contract.outputLocale,capabilities:contract.capabilities});
  const prior={...plan,createdAt:'2026-09-01T00:00:00.000Z'};
  assert.deepEqual(preserveAcceptanceContract(plan,prior),prior);
  assert.throws(()=>preserveAcceptanceContract(plan,{...prior,identity:{...prior.identity,ownerId:'other-owner'}}));
  assert.throws(()=>preserveAcceptanceContract(plan,{...prior,requirements:prior.requirements.map((item,index)=>index===0?{...item,description:'Changed requirement'}:item)}));
});
const {validateConfig,createDatabaseHarness}=createRequire(import.meta.url)('../scripts/generator-v2-runner/workbench-database.cjs');
test('negated account list does not allocate a database profile',()=>{
  assert.ok(!assessWorkbenchCapabilities('Lista pessoal sem imagens, login ou serviços externos.').deferred.some(gap=>gap.id==='supabase.auth'));
  assert.ok(assessWorkbenchCapabilities('Lista sem imagens, com login real por email.').deferred.some(gap=>gap.id==='supabase.auth'));
});
test('private profile instructions and release checks agree with frozen SQL semantics',()=>{
  const contract=createWorkbenchContract('test-owner',{requestId:'5a0deefe-8d09-484f-ae4c-d39fb9e5bffd',title:'Private notes',prompt:'Private notes saved on a server with email accounts.',profile:'fullstack-private',briefingMode:'simple',localScopeAccepted:true});
  assert.equal(contract.budget.maxCostMicros,1_000_000);
  assert.ok(requiredCheckIds(contract).includes('platform:migration-idempotency'));
  assert.ok(!requiredCheckIds(contract).includes('platform:migration-upgrade'));
  const instructions=workbenchInstructionsFor(contract);
  assert.doesNotMatch(instructions,/The executable profile is a browser-only/);
  assert.match(instructions,/do not generate schema grants/);
});
test('database proxy configuration rejects arbitrary hosts and duplicate tables',()=>{
  const config={internalApiUrl:'http://dk-v2-api-'+ 'a'.repeat(32)+':8000',anonKey:'sb_publishable_'+ 'a'.repeat(43),schema:'app',storageKey:'qa-auth',tableNames:['notes']};
  assert.ok(createDatabaseHarness(config,{verificationMode:false}));
  assert.throws(()=>validateConfig({...config,internalApiUrl:'http://example.com:8000'}));
  assert.throws(()=>validateConfig({...config,tableNames:['notes','notes']}));
});
test('exported launch and rebuild scripts are valid Node modules in both profiles',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'dk-export-syntax-'));
  try{for(const [name,source] of [['server.mjs',exportedServerScript(true,['notes'])],['static.mjs',exportedServerScript(false,[])],['build.mjs',exportedBuildScript('Title " </script>')]]){
    const target=path.join(root,name);await writeFile(target,source);await promisify(execFile)(process.execPath,['--check',target],{windowsHide:true});
  }}finally{const resolved=path.resolve(root);if(path.dirname(resolved)!==path.resolve(tmpdir())||!path.basename(resolved).startsWith('dk-export-syntax-'))throw new Error('Unexpected test directory');await rm(resolved,{recursive:true,force:true});}
});
