import { database, closeDatabase } from '../src/lib/server/database';
import { cancelMissionJob } from '../src/lib/server/jobs/queue';
import { readManifest, updateManifest } from '../src/lib/server/missionRuntime';
import { archiveMissionDelivery } from '../src/lib/server/storage';
const id='mission_build-an-application--pr_1788329154717';
async function main(){
 const sql=database();
 await cancelMissionJob(id,undefined,true);
 const connection=await sql.reserve();
 try {
   let locked=false;
   for(let i=0;i<45;i++){
     const [row]=await connection`select pg_try_advisory_lock(hashtextextended(${`pipeline:${id}`},0)) as ok`;
     if(row.ok){locked=true;break;}
     await new Promise(resolve=>setTimeout(resolve,1000));
   }
   if(!locked) throw new Error('Prior pipeline has not stopped. No resume submitted.');
   await connection`select pg_advisory_unlock(hashtextextended(${`pipeline:${id}`},0))`;
 } finally {await connection.release();}
 const manifest=await readManifest(id);
 const prompt=manifest.prompt.replace(/Brazilian Portuguese/gi,'English')+'\nLATEST USER CORRECTION: All visible application text, buttons, errors and preset names must be English. Preserve the existing visual design and functionality.';
 await sql`update missions set status='running',phase='build',error_message=null,prompt=${prompt} where id=${id}`;
 await updateManifest(id,{prompt,status:'running'});
 console.log('Resuming preserved candidate 5; no council or initial generation.');
 const response=await fetch('http://127.0.0.1:3000/api/deliberate/codegen',{
   method:'POST',headers:{'Content-Type':'application/json','x-devkiller-worker-token':process.env.DEVKILLER_WORKER_TOKEN!,'x-devkiller-job-id':'meme-guardrail-resume-1'},
   body:JSON.stringify({missionId:id,resumeCandidateArtifact:'build.candidate-5.json'}),signal:AbortSignal.timeout(1200000)
 });
 const result=await response.json();
 if(!response.ok || !result.success) {
   await sql`update missions set status='failed',error_message=${String(result.error || 'Resume failed')} where id=${id} and status<>'cancelled'`;
   throw new Error(result.error || 'Resume failed');
 }
 await archiveMissionDelivery(id,result.sourceFiles);
 await sql`update missions set status='verified',phase='delivery',progress=100,error_message=null where id=${id}`;
 console.log('Mission verified and delivery archived.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(closeDatabase);
