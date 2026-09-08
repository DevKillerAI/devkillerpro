import test from "node:test";
import assert from "node:assert/strict";
import { promptCacheFields } from "../src/lib/server/promptCache";
import { providerWaitExpired } from '../src/lib/server/providerWaitPolicy';
import { recoveryRouting } from '../src/lib/server/recoveryRouting';
test('missing execution evidence routes to verification, not code regeneration',()=>{
  const missing={file:'README.md',severity:'major',description:'Required executable browser evidence is missing.'};
  const defect={file:'app.js',severity:'major',description:'Undo loses caption state.'};
  assert.equal(recoveryRouting([missing]).route,'verification');
  assert.deepEqual(recoveryRouting([missing,defect]).defects,[defect]);
  assert.equal(recoveryRouting([defect]).route,'repair');
  assert.equal(recoveryRouting([]).route,'repair');
});
test('provider wait budgets use original age and preserve completed responses',()=>{
  const start=new Date(0);
  assert.equal(providerWaitExpired('consultant_contribution','queued',start,89999),false);
  assert.equal(providerWaitExpired('consultant_contribution','queued',start,90000),true);
  assert.equal(providerWaitExpired('functional_qa_review','queued',start,90000),true);
  assert.equal(providerWaitExpired('consultant_product','in_progress',start,359999),false);
  assert.equal(providerWaitExpired('consultant_product','in_progress',start,360000),true);
  assert.equal(providerWaitExpired('mission_build','in_progress',start,1200000),true);
  assert.equal(providerWaitExpired('mission_build','completed',start,9999999),false);
});
test("cache routing is stable, versioned and can be disabled",()=>{
  const fields=promptCacheFields('gpt-5.6-terra','mission_build',{type:'object'},'Stable rules');
  assert.deepEqual(fields,promptCacheFields('gpt-5.6-terra','mission_build',{type:'object'},'Stable rules'));
  assert.match(fields.prompt_cache_key!,/^[a-f0-9]{64}$/);
  assert.notDeepEqual(fields,promptCacheFields('gpt-5.6-terra','functional_qa_review',{type:'object'},'Stable rules'));
  assert.notDeepEqual(fields,promptCacheFields('gpt-5.6-terra','mission_build',{type:'object'},'Updated rules'));
  assert.deepEqual(promptCacheFields('gpt-5.6-terra','mission_build',{},'',false),{});
  assert.deepEqual(promptCacheFields('unknown','mission_build',{},''),{});
});
import { connectionDiagnostic, responseText, retryDelay } from "../src/lib/server/openaiTransport";
test("diagnostic retains transport cause and redacts keys",()=>{
  const error=new Error("fetch failed sk-secret",{cause:{code:"ECONNRESET",message:"socket closed"}});
  assert.equal(connectionDiagnostic(error).code,"ECONNRESET");
  assert.ok(!connectionDiagnostic(error).message.includes("sk-secret"));
});
test("only completed message output is accepted",()=>{
  assert.equal(responseText({status:"completed",output:[{type:"reasoning",content:[]},{type:"message",content:[{type:"output_text",text:'{"ok":true}'}]}]}),'{"ok":true}');
  assert.throws(()=>responseText({status:"incomplete",incomplete_details:{reason:"max_output_tokens"}}),/max_output_tokens/);
  assert.throws(()=>responseText({status:"completed",output:[{type:"message",content:[{type:"refusal"}]}]}),/REFUSAL/);
});
test("retry delay honors provider hints and stays bounded",()=>{
  assert.equal(retryDelay(1,"5",0),5000);
  assert.equal(retryDelay(20,null,0),60000);
});
