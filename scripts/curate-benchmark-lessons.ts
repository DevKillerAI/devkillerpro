import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {upsertKnowledge} from '../src/lib/server/rag/store';
import {approvedLessonContent,redactKnowledge} from '../src/lib/server/rag/governance';
async function main(){
  const reviewedAt=new Date().toISOString();
  const suites=['tests/foundations.test.ts','tests/infrastructure.test.ts','tests/integration/browser-executor.test.ts','tests/integration/local-release.test.ts'];
  const output=execFileSync(process.execPath,['node_modules/tsx/dist/cli.mjs','--test',...suites],{encoding:'utf8',windowsHide:true});
  const report=JSON.stringify({reviewedAt,suites,exitCode:0,output:redactKnowledge(output)},null,2);
  const reportSha256=createHash('sha256').update(report).digest('hex');
  await mkdir('.devkiller/incident-reviews/benchmark-protocol',{recursive:true});
  await writeFile('.devkiller/incident-reviews/benchmark-protocol/regression.json',report);
  const lessons=[
    {id:'scope-negation',title:'Negative production wording is not production intent',applicability:'DevKiller intake classification and foundation selection for English local-MVP briefs.',confirmedCause:'The phrase not a production claim matched the production classifier; this escalated SQLite local scope to Supabase requirements.',prevention:'Parse negative production statements before inferred tiers; retain explicit structured choices. Regression-test both excluded production and genuinely requested production.',limitations:'Tested patterns are not a complete natural-language parser.'},
    {id:'browser-contract',title:'Separate browser environment failures from application defects',applicability:'DevKiller static Chromium runner, declarative browser contracts and TSX entry points.',confirmedCause:'CSS text-transform changed innerText assertions, and raw TSX entries were served without a bundler and reported as empty UI.',prevention:'Compare DOM text for text assertions, validate bounded contract notes, and classify unbundled TSX as unavailable runtime instead of repairing the app. Keep real broken controls failing.',limitations:'The static runner still does not compile React or validate Firebase emulators.'},
    {id:'terminal-reconnect',title:'Persist terminal pipeline outcomes across reconnections',applicability:'DevKiller job-scoped HTTP pipeline replay and offline Node release verification.',confirmedCause:'Only successful pipeline results were cached; a disconnected caller could replay a completed failed repair budget. Release scripts were inspected but not executed.',prevention:'Persist terminal failures with HTTP status under the operation key; only poll interruptions remain resumable. Run dependency-free release scripts inside an offline disposable container copy and retain exit output.',limitations:'Unit coverage verifies replay policy; it is not a fault-injected end-to-end network test. Release assembly execution alone does not prove the assembled app UI.'},
    {id:'image-envelope',title:'Use an explicit compatible image-result envelope',applicability:'Owner-only DevKiller preview image and vision bridge messages.',confirmedCause:'The host nested success and imageDataUrl under data while a generated consumer expected top-level fields.',prevention:'Provide the documented flat fields and backward-compatible nested data, with host-owned type and id that payloads cannot override. Preserve source and correlation checks.',limitations:'Protocol unit test plus observed live PNG rendering; downloaded-file verification remains separate.'},
  ];
  for(const lesson of lessons){
    const {id,...fields}=lesson;
    const content=approvedLessonContent({...fields,sourceIncidentIds:['benchmark-volt-drop-20260902','benchmark-image-studio-20260902'],reviewedBy:'Codex source review and executed regressions',reviewedAt,regressionEvidence:[{test:suites.join(', '),reportSha256,passed:true}]});
    await upsertKnowledge({id:`lesson-benchmark-${id}-v1`,tenantId:'devkiller',title:lesson.title,content,sourceUri:'internal://incident-reviews/benchmark-protocol/regression.json',sourceType:'internal',trust:'verified',status:'active',domains:['orchestration'],tags:['platform-only','validated-regression'],version:'1',reviewedAt});
  }
  console.log(JSON.stringify({lessons:lessons.length,reportSha256}));
}
void main().catch(error=>{console.error(redactKnowledge(error.message));process.exitCode=1;});
