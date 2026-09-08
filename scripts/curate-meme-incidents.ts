import { execFileSync } from 'node:child_process';
import { mkdir,writeFile,readFile,readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { upsertKnowledge,listKnowledge } from '../src/lib/server/rag/store';
import { approvedLessonContent,redactKnowledge,eligibleKnowledge } from '../src/lib/server/rag/governance';

const mission='mission_build-an-application--pr_1788375024535';
const root=path.join(process.cwd(),'.devkiller','incident-reviews','meme-studio-20260902');
async function main() {
  await mkdir(root,{recursive:true});
  // Real database-backed transport tests; provider responses are test doubles.
  // This neither enqueues a mission nor sends a paid OpenAI request.
  const output=execFileSync(process.execPath,['node_modules/tsx/dist/cli.mjs','--env-file=.env.local','--test','tests/integration/provider-resumption.test.ts'],{cwd:process.cwd(),encoding:'utf8'});
  const report={recordedAt:new Date().toISOString(),command:'tsx --env-file=.env.local --test tests/integration/provider-resumption.test.ts',exitCode:0,provider:'test double; no live quality or latency claim',output:redactKnowledge(output)};
  const reportText=JSON.stringify(report,null,2), reportHash=createHash('sha256').update(reportText).digest('hex');
  await writeFile(path.join(root,'provider-regression.json'),reportText);
  const records = [
    {key:'queue-sql-type',category:'database',cause:'confirmed',observation:'Mission creation returned HTTP 500 and PostgreSQL 42P18. A model-policy version parameter inside jsonb_build_object lacked an explicit SQL type.',remedy:'Explicit jsonb/text casts were applied and queue certification passed in the earlier session. A fresh queue test was not run during the active mission.',evidence:['src/lib/server/jobs/queue.ts','tests/integration/queue.test.ts']},
    {key:'cancel-status-enum',category:'database',cause:'confirmed',observation:'Queue integration exposed invalid enum value retrying in the missions table. The job table and mission table have different state vocabularies.',remedy:'Use waiting for the mission state; retain retrying for job state. Previous queue integration passed; not recertified during active work.',evidence:['src/lib/server/jobs/queue.ts','tests/integration/queue.test.ts']},
    {key:'stale-project-navigation',category:'orchestration',cause:'code-supported',observation:'Polling restoration and timed council playback could display an old delivery during a new request.',remedy:'Pin selection, protect intake state and require a real ready delivery. Browser flow subsequently followed Meme Studio; comprehensive UI race tests are still missing.',evidence:['src/app/page.tsx','src/components/war-room/LiveMeetingStage.tsx']},
    {key:'provider-queue-delay',category:'provider-transport',cause:'upstream-cause-unknown',observation:'Some Responses calls remained queued while sibling contributions completed. Remote retrieval confirmed queued status, not a local database outage.',remedy:'Bound queued waiting; confirm cancellation before at most one replacement. Persist response identities and completed results. Tests verify mechanics, not latency guarantees.',evidence:['src/lib/server/openaiBackground.ts','tests/integration/provider-resumption.test.ts']},
    {key:'resume-duplicate-qa',category:'orchestration',cause:'unconfirmed',observation:'After web-server restart a second QA record was created while an earlier QA response remained queued. The earlier remote response was subsequently cancelled.',remedy:'Investigate stable candidate/request identity across replay. Do not claim existing transport deduplication covers changed request inputs.',evidence:['src/lib/server/openaiBackground.ts','src/app/api/deliberate/codegen/route.ts']},
    {key:'verification-routed-to-builder',category:'verification-capability',cause:'confirmed-by-repeated-reports',observation:'Successive reviews reject missing browser execution evidence, while recovery repeatedly asks the code generator to execute browser checks it cannot perform.',remedy:'Route missing execution to an available test runner. Do not rewrite code merely to obtain test evidence, invent test results, or lower acceptance criteria. Runner integration remains unfinished.',evidence:['build.review-1.json','build.review-2.json','build.review-3.json','build.recovery-1.json']},
    {key:'quorum-coverage',category:'orchestration',cause:'design-gap',observation:'Numerical quorum can advance with unavailable specialist contributions; count alone does not prove required responsibilities are covered.',remedy:'Define required responsibilities and explicit reassignment or blocking before accepting missing specialists. This control is not implemented or validated yet.',evidence:['src/app/api/deliberate/meeting/route.ts']},
  ];
  const artifacts=path.join(process.cwd(),'.devkiller','missions',mission,'artifacts');
  const reviews=(await readdir(artifacts)).filter(name=>/^build\.review-\d+\.json$/.test(name));
  const unique=new Map<string,{description:string;files:string[]}>();
  for(const filename of reviews) {
    const review=JSON.parse(await readFile(path.join(artifacts,filename),'utf8'));
    for(const issue of review.review?.issues||[]) {
      const description=redactKnowledge(String(issue.description));
      const key=createHash('sha256').update(description.toLowerCase().replace(/\s+/g,' ').trim()).digest('hex').slice(0,16);
      const item=unique.get(key)||{description,files:[]}; item.files.push(filename);unique.set(key,item);
    }
  }
  for(const [key,item] of unique) records.push({key:`qa-${key}`,category:'generated-app-observation',cause:'source-review-only',observation:item.description,remedy:'Require browser reproduction and candidate-bound regression evidence before promoting a remedy.',evidence:item.files});
  for(const record of records) {
    await upsertKnowledge({id:`incident-meme-20260902-${record.key}`,tenantId:`mission:${mission}`,title:`Incident review: ${record.key}`,content:redactKnowledge(JSON.stringify({...record,mission,remedyValidated:false,promotion:'Quarantined. Not an instruction or an approved prevention rule.'},null,2)),sourceUri:`internal://incident-reviews/meme-studio-20260902/${record.key}`,sourceType:'internal',trust:'observed',status:'quarantined',domains:['recovery','qa'],tags:['incident',record.category,'requires-review'],version:'1'});
  }
  const lesson=approvedLessonContent({title:'Bound provider waiting without replaying ambiguous submissions',applicability:'DevKiller persisted Responses transport, stable request identity and local PostgreSQL checkpoints only.',confirmedCause:'A queued response can block a stage after peers complete. Local polling success does not imply generation progress; upstream queue causes are unknown.',prevention:'Persist response identity and original creation time. Resume saved results. Use bounded queue waiting; allow at most one same-model replacement only after confirmed queued cancellation. Retain completion racing cancellation. On uncertain submission or cancellation, stop automatic resubmission and reconcile.',limitations:'Tests use fake provider responses and a real database. They prove transport control paths, not live latency, zero billing, complete specialist coverage, application quality, or deduplication when replay changes the request input.',sourceIncidentIds:['incident-meme-20260902-provider-queue-delay'],reviewedBy:'Codex: source inspection and executed regression review',reviewedAt:new Date().toISOString(),regressionEvidence:[{test:'tests/integration/provider-resumption.test.ts',reportSha256:reportHash,passed:true}]});
  await upsertKnowledge({id:'lesson-provider-bounded-recovery-v1',tenantId:'devkiller',title:'Bounded Responses recovery and cancellation safety',content:lesson,sourceUri:'internal://incident-reviews/meme-studio-20260902/provider-regression.json',sourceType:'internal',trust:'verified',status:'active',domains:['recovery'],tags:['platform-only','provider-transport','validated-regression'],version:'1',reviewedAt:new Date().toISOString()});
  const all=await listKnowledge();
  const observations=all.filter(doc=>doc.id.startsWith('incident-meme-20260902-'));
  if(observations.some(doc=>eligibleKnowledge(doc,{tenantId:`mission:${mission}`}))) throw new Error('Quarantine leakage');
  await writeFile(path.join(root,'review.json'),JSON.stringify({mission,records,approvedLessons:['lesson-provider-bounded-recovery-v1'],reportHash,scope:'Observed incident review; no claim of exhaustive error discovery.'},null,2));
  console.log(JSON.stringify({quarantined:observations.length,promoted:1,quarantineLeakage:false,reportHash}));
}
void main().catch(error=>{console.error(redactKnowledge(error.message));process.exitCode=1;});
