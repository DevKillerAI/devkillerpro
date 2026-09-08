import { database, closeDatabase } from "../src/lib/server/database";
import { enqueueMissionJob } from "../src/lib/server/jobs/queue";
async function main() {
  const sql=database();
  try {
    const [active]=await sql`select id from mission_jobs where status in ('queued','running','retrying') limit 1`;
    if(active) throw new Error("An active mission exists; validation was not started.");
    const [source]=await sql`select m.owner_id,j.payload from missions m join mission_jobs j on j.mission_id=m.id where m.id='mission_build-an-application--pr_1788318847952' order by j.created_at desc limit 1`;
    if(!source?.owner_id) throw new Error("Roomly source mission not found.");
    const missionId=`validation-roomly-${Date.now()}`;
    await enqueueMissionJob({missionId,ownerId:source.owner_id,payload:source.payload});
    await sql`update missions set app_title='Roomly · Validation',metadata=metadata || '{"validation":true}'::jsonb where id=${missionId}`;
    console.log(JSON.stringify({missionId,queued:true}));
  } finally { await closeDatabase(); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
