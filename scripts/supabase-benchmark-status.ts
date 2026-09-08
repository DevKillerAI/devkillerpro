import {database,closeDatabase} from '../src/lib/server/database';
async function main(){
 console.log(JSON.stringify(await database()`select m.id,m.status,m.phase,m.progress,m.app_title,m.error_message,j.id as job_id,j.status as job_status,j.updated_at from missions m left join lateral(select * from mission_jobs where mission_id=m.id order by created_at desc limit 1) j on true where m.id in ('benchmark-supabase-booking-20260902','benchmark-firebase-orders-20260902')`));
 console.log(JSON.stringify(await database()`select mission_id,schema_name,status,created_at,updated_at from provider_requests where mission_id in ('benchmark-supabase-booking-20260902','benchmark-firebase-orders-20260902') and status in ('queued','in_progress') order by created_at desc`));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>closeDatabase());
