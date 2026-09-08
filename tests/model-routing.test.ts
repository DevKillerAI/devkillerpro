import test from "node:test";
import assert from "node:assert/strict";
import {modelTask,selectTaskModel} from "../src/lib/server/modelRouting";
test("routing defaults preserve the configured model",()=>{
  assert.equal(selectTaskModel("mission_build",{OPENAI_MODEL:"baseline",OPENAI_MODEL_BUILD:"other"}),"baseline");
  assert.throws(()=>selectTaskModel("mission_build",{}),/OPENAI_MODEL/);
});
test("opt-in role override does not affect other tasks",()=>{
  const config={OPENAI_MODEL:"baseline",DEVKILLER_MODEL_ROUTING:"enabled",OPENAI_MODEL_QA:"reviewer"};
  assert.equal(selectTaskModel("functional_qa_review",config),"reviewer");
  assert.equal(selectTaskModel("mission_build",config),"baseline");
  assert.equal(modelTask("mission_patch_repair"),"repair");
});
