import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {RECOVERY_PLAYBOOKS} from '../src/lib/server/rag/recoveryPlaybooks';
import {upsertKnowledge,listKnowledge} from '../src/lib/server/rag/store';
import {approvedLessonContent,eligibleKnowledge,redactKnowledge} from '../src/lib/server/rag/governance';
async function main(){
  const reviewedAt=new Date().toISOString();
  const output=execFileSync(process.execPath,['node_modules/tsx/dist/cli.mjs','--test','tests/editor-continuity.test.ts','tests/integration/browser-executor.test.ts'],{encoding:'utf8',windowsHide:true});
  const report=JSON.stringify({reviewedAt,exitCode:0,output:redactKnowledge(output),scope:'Local fixture tests. No live AI or completed revision claim.'},null,2);
  const reportSha256=createHash('sha256').update(report).digest('hex');
  const root=path.resolve('.devkiller/incident-reviews/recovery-audit-20260902');
  await mkdir(root,{recursive:true});await writeFile(path.join(root,'regression.json'),report);
  for(const item of RECOVERY_PLAYBOOKS)await upsertKnowledge({id:`playbook-${item.id}-v1`,tenantId:'devkiller',title:item.title,content:JSON.stringify({guidance:item.content,evidenceLevel:'source-reviewed guidance; not a reproduced remedy',reviewedAt,source:item.source}),sourceUri:item.source,sourceType:'official',trust:'verified',status:'active',domains:item.scope==='platform'?['orchestration']:['builder','qa','recovery'],tags:item.scope==='platform'?['platform-only','source-reviewed']:['recovery-playbook','source-reviewed'],version:'1',reviewedAt,expiresAt:new Date(Date.now()+90*86400000).toISOString()});
  const lesson=approvedLessonContent({title:'Preserve an approved preview while validating a revision',applicability:'DevKiller workspace polling and static offline browser executor only.',confirmedCause:'The registry operation state was used as the sole preview-availability condition, hiding existing verified source files during revisions.',prevention:'Determine delivery availability from approved evidence and saved files. Keep unchanged preview identity. Preserve the previous delivery when a revision fails. Bind browser outcomes to the candidate hash; record unavailable checks instead of treating them as code defects.',limitations:'Unit tests cover state predicates, not every multi-browser race. Browser tests use fixtures, not live AI or the pending Meme Studio revision.',sourceIncidentIds:['local-editor-preview-regression'],reviewedBy:'Codex source audit and executed tests',reviewedAt,regressionEvidence:[{test:'editor-continuity and browser-executor suites',reportSha256,passed:true}]});
  await upsertKnowledge({id:'lesson-editor-browser-evidence-v1',tenantId:'devkiller',title:'Editor continuity and honest browser evidence',content:lesson,sourceUri:'internal://incident-reviews/recovery-audit-20260902/regression.json',sourceType:'internal',trust:'verified',status:'active',domains:['orchestration'],tags:['platform-only','validated-regression'],version:'1',reviewedAt});
  const all=await listKnowledge();
  const normal=all.filter(d=>d.id.startsWith('playbook-')&&eligibleKnowledge(d,{tenantId:'devkiller',domains:['recovery']}));
  if(normal.length!==3||normal.some(d=>d.tags.includes('platform-only')))throw new Error('Recovery scope isolation failed');
  const summary={sourceReviewed:6,regressionValidated:1,applicationRecoveryEligible:normal.map(d=>d.id),reportSha256};
  await writeFile(path.join(root,'audit.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}
void main().catch(error=>{console.error(redactKnowledge(error.message));process.exitCode=1;});
