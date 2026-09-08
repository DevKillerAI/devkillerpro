import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {checkSupabaseSql,checkSupabaseBuild} from '../src/lib/server/supabaseExecutor';
import {provisionSupabaseSchema,startSupabaseRuntime} from '../src/lib/server/supabaseRuntime';
async function main(){
 const [id,candidate]=process.argv.slice(2);
 if(!['benchmark-supabase-booking-20260902','benchmark-firebase-orders-20260902'].includes(id)||!/^\d+$/.test(candidate))throw new Error('Expected authorized benchmark and candidate number');
 const root=`.devkiller/missions/${id}`;
 const data=JSON.parse(await readFile(`${root}/artifacts/build.candidate-${candidate}.json`,'utf8'));
 const hash=createHash('sha256').update(JSON.stringify(data.sourceFiles)).digest('hex');
 const directory=`${root}/candidates/build-${candidate}`;
 const sql=await checkSupabaseSql(data.sourceFiles);
 const build=await checkSupabaseBuild(directory);
 await provisionSupabaseSchema(id,data.sourceFiles);
 const preview=await startSupabaseRuntime(id,directory,hash);
 const report={missionId:id,candidate,hash,sql,build,preview,at:new Date().toISOString(),liveBrowser:'not yet tested'};
 await mkdir('.devkiller/incident-reviews/supabase-migration',{recursive:true});
 await writeFile(`.devkiller/incident-reviews/supabase-migration/${id}-live.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify({missionId:id,candidate,hash,preview}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
