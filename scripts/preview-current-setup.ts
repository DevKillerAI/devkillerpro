import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {startRuntime,runtimeSchema} from '../src/lib/server/localRuntime';
async function main(){
 const directory=path.resolve('.devkiller/missions/mission_build-an-application--pr_1788403683601/candidates/build-4');
 const contract=runtimeSchema.parse(JSON.parse(await readFile(path.join(directory,'devkiller.runtime.json'),'utf8')));
 console.log(JSON.stringify(await startRuntime('operator-review-setup',directory,contract,'candidate-4')));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
