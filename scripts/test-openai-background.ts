// Explicit live smoke test: one small paid request; no user mission is queued.
import { randomUUID } from "node:crypto";
import { database, closeDatabase } from "../src/lib/server/database";
import { cancellableMission } from "../src/lib/server/jobs/cancellation";
import { backgroundJson } from "../src/lib/server/openaiBackground";
async function main() {
  const sql=database(), id=`provider-smoke-${randomUUID()}`, started=Date.now();
  try {
    await sql`insert into missions(id,prompt,status,metadata) values(${id},'OpenAI background smoke test','running','{"discarded":true}')`;
    const request=()=>new Request("http://localhost/api/deliberate/codegen",{method:"POST",headers:{"content-type":"application/json","x-devkiller-worker-token":process.env.DEVKILLER_WORKER_TOKEN!,"x-devkiller-job-id":id},body:JSON.stringify({missionId:id})});
    const response=await cancellableMission(request(),async()=>Response.json({success:true,...await backgroundJson({schemaName:"connection_probe",prompt:"Return status OK.",schema:{type:"object",properties:{status:{type:"string",enum:["OK"]}},required:["status"],additionalProperties:false}})}));
    const result=await response.json();
    if(!response.ok || result.data?.status!=="OK") throw new Error("Background smoke check failed.");
    const replay=await cancellableMission(request(),async()=>{throw new Error("Replay must use saved output, not call OpenAI again.");});
    if(!replay.ok) throw new Error("Replay failed.");
    console.log(JSON.stringify({success:true,model:result.model,result:result.data,elapsedMs:Date.now()-started,replayFromDatabase:true,usage:result.usage}));
  } finally {
    await sql`delete from missions where id=${id}`;
    await closeDatabase();
  }
}
main().catch(error=>{console.error(String(error.message).replace(/sk-[\w-]+/g,"[REDACTED]"));process.exitCode=1;});
