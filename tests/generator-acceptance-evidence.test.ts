import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {extractAcceptanceContract,evaluateAcceptanceEvidence,acceptanceCheckId,validateAcceptanceCompliance,type AcceptanceContract} from '../src/lib/server/generator/acceptanceContract';
import {workbenchJourneysSchema,evaluateWorkbenchPatch} from '../src/lib/server/generator/workbenchContract';
import {createGeneratorSnapshot} from '../src/lib/server/generator/versionedEdits';
import {createBuildEvidenceManifest,issueVerifiedBuildCertificate} from '../src/lib/server/generator/evidenceCertificate';

const runner=createRequire(path.join(process.cwd(),'package.json'))('./scripts/generator-v2-runner/workbench.cjs');
const identity={ownerId:'test-owner',projectId:'test-project',missionId:'test-mission',environmentId:'test-env'};
const contract=(brief:string)=>extractAcceptanceContract({identity,title:'Evidence app',brief});
const successfulJourneys=[{id:'journey:1440:1',passed:true,details:'Executed desktop'},{id:'journey:390:1',passed:true,details:'Executed mobile'}];
const calculator=workbenchJourneysSchema.parse([{name:'Calculate exact sum',requirementIds:['feature.calculation-logic'],steps:[
  {action:'fill',testId:'amount',value:'25'},{action:'click',testId:'calculate',value:''},{action:'text',testId:'total',value:'50'},
]}]);

test('an aggregate browser pass and a static label cannot prove a requested calculation',()=>{
  const input=contract('Crie uma calculadora para calcular totais.');
  const missing=evaluateAcceptanceEvidence(input,[],[{id:'requirement:application:journeys',passed:true,details:'Generic pass'}]);
  assert.equal(missing.find(c=>c.id===acceptanceCheckId('feature.calculation-logic'))?.passed,false);
  const echo=workbenchJourneysSchema.parse([{name:'Echo input',requirementIds:['feature.calculation-logic'],steps:[{action:'fill',testId:'amount',value:'25'},{action:'text',testId:'amount',value:'25'}]}]);
  assert.equal(evaluateAcceptanceEvidence(input,echo,successfulJourneys).find(c=>c.id===acceptanceCheckId('feature.calculation-logic'))?.passed,false);
});

test('a requirement needs its own bound journey executed at both viewports',()=>{
  const input=contract('Crie uma calculadora para calcular totais.');
  const id=acceptanceCheckId('feature.calculation-logic');
  assert.equal(evaluateAcceptanceEvidence(input,calculator,successfulJourneys).find(c=>c.id===id)?.passed,true);
  assert.equal(evaluateAcceptanceEvidence(input,calculator,successfulJourneys.slice(0,1)).find(c=>c.id===id)?.passed,false);
  assert.equal(evaluateAcceptanceEvidence(input,[{...calculator[0],requirementIds:[]}],successfulJourneys).find(c=>c.id===id)?.passed,false);
});

test('database persistence cannot be promoted from browser or generic database success',()=>{
  const input=contract('Crie uma aplicação com PostgreSQL obrigatório, sem localStorage.');
  const evidence=evaluateAcceptanceEvidence(input,[],[{id:'platform:database',passed:true,details:'Unrelated check'},...successfulJourneys]);
  assert.equal(evidence.find(c=>c.id===acceptanceCheckId('feature.server-persistence'))?.passed,false);
  assert.equal(validateAcceptanceCompliance(input,new Map(evidence.map(c=>[c.id,c]))).compliant,false);
});

test('local persistence requires a data change followed by reload and record assertion',()=>{
  const input=contract('Gerenciador deve salvar tarefas no localStorage após reload.');
  const noReload=workbenchJourneysSchema.parse([{name:'Save record',requirementIds:['feature.local-persistence'],steps:[{action:'fill',testId:'title',value:'Work'},{action:'click',testId:'save',value:''},{action:'text',testId:'record',value:'Work'}]}]);
  const id=acceptanceCheckId('feature.local-persistence');
  assert.equal(evaluateAcceptanceEvidence(input,noReload,successfulJourneys).find(c=>c.id===id)?.passed,false);
  const reloaded=[{...noReload[0],steps:[...noReload[0].steps.slice(0,2),{action:'reload',testId:'',value:''},noReload[0].steps[2]]}];
  assert.equal(evaluateAcceptanceEvidence(input,reloaded,successfulJourneys).find(c=>c.id===id)?.passed,true);
});

test('runner validates the same contract and compares exact normalized values',()=>{
  assert.doesNotThrow(()=>runner.validateJourneys(calculator));
  assert.throws(()=>runner.validateJourneys([{name:'Legacy',steps:calculator[0].steps}]),/requalification/);
  assert.equal(runner.matchesText('R$\u00a050,00','R$ 50,00'),true);
  assert.equal(runner.matchesText('150','50'),false);
  assert.equal(runner.matchesText('3 records, total 150','50'),false);
  assert.equal(runner.matchesCount(3,2),false);
  assert.equal(runner.matchesCount(2,2),true);
});

test('workbench patches edit real modules atomically and cannot relax repair journeys',()=>{
  const base=createGeneratorSnapshot({scope:identity,revision:'build-1',files:[{path:'src/App.tsx',content:'export default function App(){return null}'},{path:'src/styles.css',content:'body{}'},{path:'src/lib/math.ts',content:'export const multiplier = 1;'}]});
  const proposal={summary:'Correct math',edits:[{path:'src/lib/math.ts',search:'multiplier = 1',replacement:'multiplier = 2'}],journeys:calculator};
  const options={operationId:'repair-1',allowedPaths:base.files.map(f=>f.path),now:Date.now(),journeys:calculator,allowJourneyChange:false};
  assert.match(evaluateWorkbenchPatch(base,proposal,options).snapshot.files.find(f=>f.path==='src/lib/math.ts')!.content,/multiplier = 2/);
  assert.throws(()=>evaluateWorkbenchPatch(base,{...proposal,journeys:[{...calculator[0],requirementIds:[]}]},options),/cannot change/);
  assert.throws(()=>evaluateWorkbenchPatch(base,proposal,{...options,allowedPaths:['src/styles.css']}));
  assert.match(base.files.find(f=>f.path==='src/lib/math.ts')!.content,/multiplier = 1/);
});

test('unsigned evidence binds exact mandatory checks, artifact bytes and complete manifest contents',()=>{
  const input:AcceptanceContract=contract('Uma página simples com conteúdo estático.');
  const files=[{path:'index.html',content:'<html><body>Verified</body></html>'}];
  const checks=input.requirements.map(req=>({id:acceptanceCheckId(req.id),passed:true,details:'Executed requirement-specific fixture'}));
  const verification={status:'passed' as const,sourceHash:'a'.repeat(64),verifierVersion:'runtime-test',runtimeImageId:'sha256:'+ 'b'.repeat(64),compiledFiles:files,checks,failures:[],limitations:[],durationMs:1};
  const args={identity:{missionId:identity.missionId,runId:'run-1',workspaceId:identity.projectId,artifactId:'artifact-1',artifactVersion:'build-1',buildId:'build-1',sandboxId:'sandbox-1',qaRunId:'qa-1'},sourceHash:verification.sourceHash,bundleHash:createHash('sha256').update(JSON.stringify(files)).digest('hex'),generatorVersion:'test',environmentVersion:'runtime-test',acceptanceContract:input,verification};
  const manifest=createBuildEvidenceManifest(args);
  const evidence=issueVerifiedBuildCertificate(manifest);
  assert.equal(evidence.attestation,'unsigned-integrity-manifest');
  assert.equal(evidence.verificationPassed,true);
  assert.equal('verifierSignature' in evidence,false);
  assert.notEqual(issueVerifiedBuildCertificate({...manifest,tests:manifest.tests.map((item,index)=>index?item:{...item,details:'Different evidence'})}).manifestDigest,evidence.manifestDigest);
  assert.throws(()=>issueVerifiedBuildCertificate({...manifest,tests:manifest.tests.slice(1)}),/mandatory/);
  assert.throws(()=>createBuildEvidenceManifest({...args,bundleHash:'c'.repeat(64)}),/bundle hash/);
  assert.throws(()=>createBuildEvidenceManifest({...args,sourceHash:'d'.repeat(64)}),/identity/);
  const fuzzy=createBuildEvidenceManifest({...args,verification:{...verification,checks:checks.map(c=>({...c,id:c.id+'-unrelated'}))}});
  assert.equal(fuzzy.mandatoryRequirementsPassed,false);
});
