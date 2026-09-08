import {readFile,cp,mkdir,copyFile,writeFile} from 'node:fs/promises';
import {database,closeDatabase} from '../src/lib/server/database';
import {enqueueMissionJob} from '../src/lib/server/jobs/queue';
import {briefFromPrompt} from '../src/lib/intake/missionBrief';
import {SUPABASE_NEXT_CONTRACT} from '../src/lib/server/supabaseExecutor';
const common='\nDelivery depth explicitly selected by the user: local_mvp. Data provider explicitly selected: supabase. Authentication requirement: required. All UI and reports in English. Provide a responsive, polished working app, not setup-only output. A dedicated local Supabase stack has been provisioned for this app; do not access DevKiller control-plane tables or credentials. Provide executable migrations and pgTAP tests. Live Auth/browser validation is separate from SQL/build checks; report honestly. '+SUPABASE_NEXT_CONTRACT;
const targets=[
 {id:'benchmark-supabase-booking-20260902',title:'Room Ledger',resume:true,prompt:'Complete Room Ledger: a private room-reservation app with Supabase email/password login, create/list/update/cancel reservations and durable PostgreSQL data in schema room_ledger. Two users must see and edit only their own reservations. Enforce overlapping active room reservations atomically at the database, allow exact adjacency and release cancelled slots. Reject invalid dates and ownership spoofing. Preserve working behavior and sophisticated off-white/navy design. Dedicated local API is http://127.0.0.1:55321. Fix actual migration error: PostgreSQL rejects DEFAULT (select auth.uid()); use a valid direct function default with RLS. Execute rather than merely count pgTAP assertions; resolve plan/actual assertion discrepancies without deleting coverage.'},
 {id:'benchmark-firebase-orders-20260902',title:'Queue Pantry',resume:false,prompt:'Complete Queue Pantry using Supabase Auth and PostgreSQL ONLY. The owner explicitly replaces the prior Firebase architecture. Build email/password login, a stock catalog, quantity selection, owner-scoped order list and cancellation. Ordering reserves stock atomically in a database transaction/RPC; two simultaneous last-unit requests must produce exactly one successful order. Duplicate submit/retry uses an idempotency key and must not charge stock twice. Cancel an owned order once, restoring stock once; repeated cancel is idempotent. RLS must deny anonymous mutations and cross-user reads/changes, and identity comes from auth.uid(). Use schema queue_pantry. Provide an explicit action or documented seed to load clearly labelled sample catalog data; no real purchases. Dedicated local API is http://127.0.0.1:56321. Mobile-first, contemporary charcoal/white/terracotta storefront with compact catalog cards and an elegant order panel, restrained typography, clear loading/empty/error states. Test anonymous denial, ownership, invalid quantity, duplicate submission, stock exhaustion and repeated cancellation in pgTAP; include a real two-session concurrency test plan.'},
];
async function main(){
 const sql=database();
 if((await sql`select id from mission_jobs where status in ('queued','running','retrying') limit 1`).length)throw new Error('Another mission is active; no benchmark changed.');
 const stamp=Date.now();const queued=[];
 for(const target of targets){
  const [previous]=await sql`select m.owner_id,m.status,j.payload,j.checkpoint from missions m join mission_jobs j on j.mission_id=m.id where m.id=${target.id} order by j.created_at desc limit 1`;
  if(!previous||!['failed','cancelled'].includes(previous.status))throw new Error(`${target.title} is not stopped.`);
  const archive=`.devkiller/incident-reviews/supabase-migration/archive-${target.id}-${stamp}`;
  await cp(`.devkiller/missions/${target.id}`,archive,{recursive:true,errorOnExist:true,force:false});
  await writeFile(`${archive}/previous-job.json`,JSON.stringify(previous,null,2),{flag:'wx'});
  const prompt=target.prompt+common;
  const brief={...briefFromPrompt(prompt),appName:target.title,dataProvider:'supabase',authentication:'required'};
  let resumeCandidateArtifact: string|undefined;
  if(target.resume){resumeCandidateArtifact=`build.candidate-${stamp}.json`;await copyFile(`.devkiller/missions/${target.id}/artifacts/build.candidate-5.json`,`.devkiller/missions/${target.id}/artifacts/${resumeCandidateArtifact}`);}
  // Fresh council/checkpoint: no old Firebase or production-tier decision is reused.
  const job=await enqueueMissionJob({missionId:target.id,ownerId:previous.owner_id,payload:{prompt,brief,selectedAgentIds:['cto','architect','designer','backend','security','qa'],...(resumeCandidateArtifact?{resumeCandidateArtifact}:{})}});
  await sql`update missions set app_title=${target.title},metadata=coalesce(metadata,'{}'::jsonb)||${sql.json({dataProvider:'supabase',migrationArchive:archive})} where id=${target.id}`;
  queued.push({missionId:target.id,jobId:job.id,archive});
 }
 console.log(JSON.stringify(queued));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>closeDatabase());
