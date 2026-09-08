import test from "node:test";
import assert from "node:assert/strict";
import { eligibleKnowledge, incidentContent, redactKnowledge, approvedLessonContent } from "../src/lib/server/rag/governance";
import type { KnowledgeDocument } from "../src/lib/server/rag/types";
const doc:KnowledgeDocument={id:"a",tenantId:"owner",status:"active",trust:"verified",title:"SQLite",content:"transactions",sourceUri:"internal://test",sourceType:"internal",domains:["database"],tags:["sqlite"],version:"1",contentHash:"x",ingestedAt:"2026-09-02"};
test("all knowledge eligibility gates apply",()=>{
  const filter={tenantId:"owner",domains:["database"],excludeTags:["firebase"]};
  assert.equal(eligibleKnowledge(doc,filter),true);
  assert.equal(eligibleKnowledge({...doc,tags:['platform-only']},filter),false);
  assert.equal(eligibleKnowledge({...doc,tags:['platform-only']},{...filter,includeTags:['platform-only']}),true);
  for(const change of [{tenantId:"other"},{status:"quarantined"},{trust:"observed"},{expiresAt:"2000-01-01"},{tags:["firebase"]},{domains:["design"]}])
    assert.equal(eligibleKnowledge({...doc,...change} as KnowledgeDocument,filter),false);
});
test("incident filter distinguishes observations from proven remedies",()=>{
  const failure=JSON.parse(incidentContent("fetch failed ECONNRESET",false));
  assert.equal(failure.category,"provider-transport");assert.equal(failure.causeStatus,"unconfirmed");
  assert.equal(JSON.parse(incidentContent("tests passed",true)).remedyStatus,"not-validated");
});
test("incident sanitization removes common credentials and email",()=>{
  const result=redactKnowledge("sk-secret123 password=hunter2 Bearer abc.def user@example.com postgresql://user:pass@host/db");
  for(const secret of ["sk-secret123","hunter2","abc.def","user@example.com","user:pass"]) assert.ok(!result.includes(secret));
});
test("unreviewed observations cannot qualify as approved lesson records",()=>{
  assert.throws(()=>approvedLessonContent({title:"It worked",success:true}));
  const lesson={title:"Runtime test extensions",applicability:"Local Node runtime tests only.",confirmedCause:"The runner rejects unsupported TypeScript paths.",prevention:"Validate concrete JavaScript test paths before starting the runner.",limitations:"Other runtimes differ.",sourceIncidentIds:["incident-1"],reviewedBy:"reviewer",reviewedAt:"2026-09-02T00:00:00.000Z",regressionEvidence:[{test:"runtime paths",reportSha256:"a".repeat(64),passed:true}]};
  assert.ok(approvedLessonContent(lesson).includes("Local Node"));
  assert.throws(()=>approvedLessonContent({...lesson,regressionEvidence:[]}));
});
