import {readFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {database,closeDatabase} from '../src/lib/server/database';
import {enqueueMissionJob} from '../src/lib/server/jobs/queue';

async function main(){
  const [missionId,candidate]=process.argv.slice(2);
  if(!['benchmark-volt-drop-20260902','benchmark-firebase-orders-20260902','benchmark-image-studio-20260902'].includes(missionId)||!/^build\.candidate-\d+\.json$/.test(candidate))throw new Error('Expected an authorized benchmark and a preserved candidate artifact.');
  const sql=database();
  const [previous]=await sql`select j.payload,j.checkpoint,m.owner_id,m.status from mission_jobs j join missions m on m.id=j.mission_id where m.id=${missionId} order by j.created_at desc limit 1`;
  if(!previous||!['failed','cancelled'].includes(previous.status))throw new Error('Mission is not stopped; do not duplicate it.');
  const folder=path.resolve('.devkiller/missions',missionId,'artifacts');
  const content=JSON.parse(await readFile(path.join(folder,candidate),'utf8'));
  if(!Array.isArray(content.sourceFiles)||!content.sourceFiles.length)throw new Error('Candidate has no source files.');
  const preserved=`build.candidate-${Date.now()}.json`;
  await copyFile(path.join(folder,candidate),path.join(folder,preserved));
  const job=await enqueueMissionJob({missionId,ownerId:previous.owner_id,payload:{...previous.payload,resumeCandidateArtifact:preserved},resumeCheckpoint:previous.checkpoint});
  console.log(JSON.stringify({missionId,jobId:job.id,preserved,files:content.sourceFiles.length}));
  await closeDatabase();
}
void main().catch(async error=>{console.error(error.message);await closeDatabase();process.exitCode=1;});
