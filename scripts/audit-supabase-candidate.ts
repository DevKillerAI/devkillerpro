import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {checkSupabaseBuild,checkSupabaseSql} from '../src/lib/server/supabaseExecutor';
async function main(){
 const root='.devkiller/missions/benchmark-supabase-booking-20260902';
 const candidate=JSON.parse(await readFile(`${root}/artifacts/build.candidate-5.json`,'utf8'));
 const report:Record<string,unknown>={at:new Date().toISOString(),candidate:'Room Ledger build-5'};
 for(const [name,run] of [['sql',()=>checkSupabaseSql(candidate.sourceFiles)],['build',()=>checkSupabaseBuild(`${root}/candidates/build-5`)]] as const){
  try{report[name]={passed:true,output:await run()};}catch(error){report[name]={passed:false,error:error instanceof Error?error.message:String(error)};}
 }
 await mkdir('.devkiller/incident-reviews/supabase-migration',{recursive:true});
 await writeFile('.devkiller/incident-reviews/supabase-migration/preflight.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
