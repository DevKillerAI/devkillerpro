import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import assert from 'node:assert/strict';
import {listKnowledge,upsertKnowledge} from '../src/lib/server/rag/store';
import {approvedLessonContent} from '../src/lib/server/rag/governance';
import {triageQuarantine} from '../src/lib/server/rag/quarantineTriage';
import {retrieveKnowledge} from '../src/lib/server/rag/retrieval';
async function main(){
 const documents=await listKnowledge(),entries=triageQuarantine(documents);
 const folder=path.resolve('.devkiller/knowledge-reviews',`quarantine-${Date.now()}`);await mkdir(folder,{recursive:true});
 const counts=entries.reduce((a,e)=>({...a,[e.disposition]:(a[e.disposition]||0)+1}),{} as Record<string,number>);
 await writeFile(path.join(folder,'triage.json'),JSON.stringify({at:new Date().toISOString(),method:'Conservative machine triage; no record discarded or automatically approved',counts,entries},null,2));
 const incident='mission-benchmark-firebase-orders-20260902-b89b820ea21d9f15';
 assert.ok(documents.some(d=>d.id===incident&&d.status==='quarantined'),'Reviewed source incident is missing');
 // Review evidence already inspected by the operator: before/after Pantry outcomes.
 const after=JSON.parse(await readFile('.devkiller/missions/benchmark-firebase-orders-20260902/artifacts/build.verification-needed.json','utf8'));
 assert.equal(after.status,'awaiting-verification');
 const tests=await promisify(execFile)(process.execPath,['node_modules/tsx/dist/cli.mjs','--test','tests/pantry-verification-routing.test.ts','tests/openai-transport.test.ts'],{windowsHide:true,timeout:30000});
 const evidence={at:new Date().toISOString(),exitCode:0,stdout:tests.stdout,stderr:tests.stderr,after};
 const bytes=JSON.stringify(evidence,null,2);await writeFile(path.join(folder,'routing-regression.json'),bytes);
 const hash=createHash('sha256').update(bytes).digest('hex');
 const lesson=approvedLessonContent({
  title:'Missing verification is not an application source defect',
  applicability:'DevKiller platform recovery routing when all blocking QA findings concern missing execution evidence; not a universal classifier of every natural-language finding.',
  confirmedCause:'The previous router recognized missing evidence but failed to recognize evidence is absent in the Pantry review, treating that evidence-only finding as a defect and invoking code repair.',
  prevention:'Separate verification findings from actual blocking source defects. Route evidence-only cases to the appropriate executor, or preserve the candidate and pause when unavailable. Mixed findings retain real defects for focused repair. Do not mark unexecuted checks as passed.',
  limitations:'Regression proves the covered routing language and mixed-finding behavior. It does not certify autonomous browser execution, complete Pantry delivery or all future wording. Unknown findings stay conservative.',
  sourceIncidentIds:[incident,'incident-meme-20260902-verification-routed-to-builder'],reviewedBy:'Codex scoped source and execution review',reviewedAt:new Date().toISOString(),
  regressionEvidence:[{test:'tests/pantry-verification-routing.test.ts and tests/openai-transport.test.ts',reportSha256:hash,passed:true}],
 });
 const id='lesson-platform-verification-routing-v1';
 await upsertKnowledge({id,tenantId:'public',title:'Platform lesson: absent verification routes to executor, not source repair',content:lesson,sourceUri:'internal://devkiller/reviews/verification-routing',sourceType:'internal',trust:'verified',status:'active',domains:['recovery','qa','operations'],tags:['platform-only','verification-routing','executed-regression'],version:'1.0.0',reviewedAt:new Date().toISOString()});
 delete process.env.OPENAI_API_KEY;
 const retrieval=await retrieveKnowledge({query:'absent verification evidence executor source repair',domains:['recovery'],includeTags:['platform-only'],limit:10});
 assert.ok(retrieval.hits.some(h=>h.document.id===id),'Approved lesson was not retrieved');
 const normal=await retrieveKnowledge({query:'absent verification evidence executor source repair',domains:['recovery'],limit:20});
 assert.ok(!normal.hits.some(h=>h.document.id===id),'Platform lesson leaked into normal app guidance');
 await writeFile(path.join(folder,'promotion.json'),JSON.stringify({id,evidenceSha256:hash,evidencePath:path.join(folder,'routing-regression.json'),sourceIncident:incident,retrievalPassed:true,normalGuidanceExcluded:true,at:new Date().toISOString()},null,2));
 console.log(JSON.stringify({folder,reviewedByTriage:entries.length,counts,promotedLessons:1,removed:0,retrievalPassed:true}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
