import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const root='.devkiller/missions/benchmark-supabase-booking-20260902/artifacts';
const candidate=JSON.parse(await readFile(`${root}/build.candidate-5.json`,'utf8'));
const sqlFiles=candidate.sourceFiles.filter(f=>f.path.endsWith('.sql'));
// This one-off audit only executes the two SQL files reviewed in this task.
if(sqlFiles.length!==2||!sqlFiles.some(f=>f.path==='supabase/migrations/0001_room_ledger.sql')||!sqlFiles.some(f=>f.path==='supabase/tests/reservations_rls.test.sql'))throw new Error('Unexpected reviewed candidate');
const sql='begin; create extension if not exists pgtap with schema extensions; set search_path=public,extensions;\n'+sqlFiles.map(f=>f.content).join('\n')+'\nrollback;';
const result=await new Promise((resolve,reject)=>{
 const child=spawn('docker',['exec','-i','supabase_db_dk_roomledger','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1','-A','-t'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
 child.on('error',reject);child.on('close',code=>resolve({exitCode:code,stdout,stderr}));child.stdin.end(sql);
});
const report={...result,passed:result.exitCode===0&&!/^not ok|Looks like|planned .* but ran/im.test(result.stdout),candidateHash:createHash('sha256').update(JSON.stringify(candidate.sourceFiles)).digest('hex'),executedAt:new Date().toISOString(),scope:'Reviewed candidate SQL only, dedicated Room Ledger local stack; all application changes rolled back.'};
await mkdir('.devkiller/incident-reviews/supabase-migration',{recursive:true});
await writeFile('.devkiller/incident-reviews/supabase-migration/room-ledger-database.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
