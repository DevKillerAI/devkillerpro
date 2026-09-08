import {execFileSync} from 'node:child_process';
import {mkdir,readFile,copyFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {database,closeDatabase} from '../src/lib/server/database';
async function main(){
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 const root=path.resolve('.devkiller/checkpoints',`supabase-positive-${stamp}`);
 await mkdir(root,{recursive:true});
 const candidates=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
 const files=[...new Set(candidates)].filter(file=>{
  if(file.split('/').some(part=>part==='.git'||part==='.temp'||part==='node_modules'||part==='.devkiller'))return false;
  if(/(?:^|\/)(?:\.env(?!\.example$)|.*\.(?:key|pem|pfx|sqlite|db)$)/i.test(file))return false;
  return /^(src|scripts|tests|docs|public|supabase|DevKiller-Role-Emblems)\//.test(file)||!file.includes('/');
 });
 const hashes=[];
 for(const file of files){
  const bytes=await readFile(file),target=path.join(root,'source',file);
  await mkdir(path.dirname(target),{recursive:true});await copyFile(file,target);
  hashes.push({path:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
 const evidence=[
  '.devkiller/incident-reviews/supabase-migration/room-ledger-live-api.json',
  '.devkiller/missions/benchmark-supabase-booking-20260902/artifacts/build.execution-4.json',
  '.devkiller/missions/benchmark-supabase-booking-20260902/artifacts/build.validation.json',
  '.devkiller/missions/benchmark-firebase-orders-20260902/artifacts/build.execution-3.json',
 ];
 for(const file of evidence){const destination=path.join(root,'evidence',file.slice('.devkiller/'.length));await mkdir(path.dirname(destination),{recursive:true});await copyFile(file,destination);}
 const missions=await database()`select id,status,phase,progress,app_title,error_message from missions where id in ('benchmark-supabase-booking-20260902','benchmark-firebase-orders-20260902')`;
 const manifest={createdAt:new Date().toISOString(),gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:hashes,missions,excludes:['credentials','databases','dependencies','build caches'],note:'Source checkpoint plus selected evidence, not a full database backup or complete app certification.'};
 await writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
 for(const file of hashes){const copied=await readFile(path.join(root,'source',file.path));if(createHash('sha256').update(copied).digest('hex')!==file.sha256)throw new Error(`Snapshot verification failed: ${file.path}`);}
 console.log(JSON.stringify({checkpoint:root,files:hashes.length,verified:true,missions}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>closeDatabase());
