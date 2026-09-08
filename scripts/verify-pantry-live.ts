import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {verifyPantryLive} from '../src/lib/server/pantryVerification';
import {candidateFingerprint} from '../src/lib/server/repairProgress';
async function main(){
 const id='benchmark-firebase-orders-20260902';
 const candidate=JSON.parse(await readFile(`.devkiller/missions/${id}/artifacts/build.candidate-5.json`,'utf8'));
 const report=await verifyPantryLive(id);
 await mkdir('.devkiller/incident-reviews/supabase-migration',{recursive:true});
 await writeFile('.devkiller/incident-reviews/supabase-migration/pantry-live-api.json',JSON.stringify({...report,candidateHash:candidateFingerprint(candidate.sourceFiles)},null,2));
 console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
