import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {database,closeDatabase} from '../src/lib/server/database';
import {enqueueMissionJob} from '../src/lib/server/jobs/queue';
import {candidateFingerprint} from '../src/lib/server/repairProgress';
const missionId='mission_build-an-application--pr_1788403683601';
async function main(){
 const sql=database();
 const requests=await sql`select request_key,response_id from provider_requests where mission_id=${missionId} and status in ('queued','in_progress')`;
 for(const row of requests){
  if(!row.response_id)throw new Error('Provider has no response ID; inspect before resuming.');
  const headers={Authorization:`Bearer ${process.env.OPENAI_API_KEY}`};
  let response=await fetch(`https://api.openai.com/v1/responses/${row.response_id}/cancel`,{method:'POST',headers,signal:AbortSignal.timeout(15000)});
  if(!response.ok)response=await fetch(`https://api.openai.com/v1/responses/${row.response_id}`,{headers,signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`Provider HTTP ${response.status}`);
  const result=await response.json();if(!['cancelled','completed','failed','incomplete'].includes(result.status))throw new Error('Provider still active');
  await sql`update provider_requests set status=${result.status},result=${sql.json(result)},updated_at=now() where request_key=${row.request_key}`;
  console.log(JSON.stringify({providerStatus:result.status}));
 }
 if(process.argv[2]!=='resume')return;
 const [previous]=await sql`select j.payload,j.checkpoint,m.owner_id,m.status from mission_jobs j join missions m on m.id=j.mission_id where m.id=${missionId} order by j.created_at desc limit 1`;
 if(!previous||!['failed','cancelled'].includes(previous.status))throw new Error('Mission not stopped');
 const folder=path.resolve('.devkiller/missions',missionId,'artifacts');const candidate=process.argv[3]||'build.candidate-3.json';
 if(!/^build\.candidate-\d+\.json$/.test(candidate))throw new Error('Invalid candidate');
 const data=JSON.parse(await readFile(path.join(folder,candidate),'utf8'));if(!data.sourceFiles?.length)throw new Error('Missing candidate');
 const review=candidate==='build.candidate-3.json'?JSON.parse(await readFile(path.join(folder,'build.review-3.json'),'utf8')).review:undefined;
 const recovery=candidate==='build.candidate-3.json'?JSON.parse(await readFile(path.join(folder,'build.recovery-3.json'),'utf8')).plan:undefined;
 const preserved=`build.candidate-${Date.now()}.json`;
 await writeFile(path.join(folder,preserved),JSON.stringify({...data,repairContext:review&&recovery?{candidateHash:candidateFingerprint(data.sourceFiles),review,recovery}:undefined},null,2));
 const job=await enqueueMissionJob({missionId,ownerId:previous.owner_id,payload:{...previous.payload,resumeCandidateArtifact:preserved},resumeCheckpoint:previous.checkpoint});
 console.log(JSON.stringify({missionId,jobId:job.id,preserved}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(closeDatabase);
