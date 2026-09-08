import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
const exec=promisify(execFile);
export const SUPABASE_NEXT_CONTRACT=`SUPABASE EXECUTION CONTRACT: Use Next.js 15 App Router with TypeScript and Supabase Auth/PostgREST. The isolated offline compiler supplies only next@15.5.24, react/react-dom@19.2.8, @supabase/ssr@0.12.5, @supabase/supabase-js@2.112.4, typescript@5.9.3, @types/react@19.2.18, @types/react-dom@19.2.5, @types/node@22.20.1 and server-only@0.0.1. Pin these exact versions when used. No extra packages, next/font remote downloads, dependency installation or generated shell/lifecycle scripts are available. Use system fonts and authored CSS. Include root package.json, src/app/page.tsx, src/app/layout.tsx, src/lib/supabase/client.ts, src/lib/supabase/server.ts, .env.example, supabase/config.toml, versioned supabase/migrations/*.sql and actual pgTAP supabase/tests/*.sql. SQL migrations and pgTAP run in a fresh network-disabled Supabase PostgreSQL 17 container, NOT the user's database. Use auth.uid() directly in column DEFAULT expressions; SELECT subqueries are not permitted there. pgTAP plan must match actual executed assertions. Tests use real PostgreSQL roles and synthetic auth.users fixtures, transactions and rollback. These checks prove SQL behavior and build success, NOT live Auth/browser success; separate live checks remain necessary. Never substitute SQLite or localStorage for Supabase persistence.`;

export function pgTapFailures(output:string){
 const lines=output.split(/\r?\n/).map(s=>s.trim());
 const assertions=lines.filter(s=>/^(?:not )?ok \d+\b/.test(s));
 const plans=lines.filter(s=>/^1\.\.\d+(?:\s|$)/.test(s));
 const failures=lines.filter(s=>/^not ok\b|^#.*(?:Looks like|failed|planned|died)/i.test(s));
 if(!plans.length||!assertions.length)failures.push('No executed pgTAP assertions/plan were returned.');
 const expected=plans.reduce((n,s)=>n+Number(s.match(/^1\.\.(\d+)/)![1]),0);
 if(expected!==assertions.length)failures.push(`pgTAP plan declared ${expected} assertions but executed ${assertions.length}.`);
 return failures;
}

export async function checkSupabaseSql(files:{path:string;content:string}[],signal?:AbortSignal){
 const migrations=files.filter(f=>/^supabase\/migrations\/[^/]+\.sql$/.test(f.path)).sort((a,b)=>a.path.localeCompare(b.path));
 const tests=files.filter(f=>/^supabase\/tests\/[^/]+\.sql$/.test(f.path)).sort((a,b)=>a.path.localeCompare(b.path));
 if(!migrations.length||!tests.length)throw new Error('Supabase delivery requires executable migrations and pgTAP tests.');
 const name=`dk-sql-check-${randomUUID()}`;
 const docker=(args:string[],timeout=15000)=>exec('docker',args,{windowsHide:true,timeout,signal,maxBuffer:1_000_000});
 try{
   await docker(['run','-d','--pull=never','--name',name,'--label','devkiller.sql-check=true','--network=none','--memory=512m','--cpus=1','--pids-limit=128','--tmpfs','/var/lib/postgresql/data:rw,nosuid,nodev,size=256m','--tmpfs','/tmp:rw,nosuid,nodev,size=64m','-e',`POSTGRES_PASSWORD=${randomUUID()}`,'public.ecr.aws/supabase/postgres:17.6.1.165']);
   let ready=false;
   for(let i=0;i<80;i++){
     try{
       // initdb's temporary server accepts connections before extension setup finishes.
       const process=await docker(['exec',name,'cat','/proc/1/comm']);
       if(!['postgres','.postgres-wrapp'].includes(process.stdout.trim()))throw new Error('Database initialization still running');
       await docker(['exec',name,'pg_isready','-U','postgres']);ready=true;break;
     }catch{signal?.throwIfAborted();await new Promise(r=>setTimeout(r,250));}
   }
   if(!ready)throw new Error('Supabase SQL validation environment did not become ready.');
   const baseline=await readFile(path.resolve('scripts/supabase-runner/auth-baseline.sql'),'utf8');
   const query=baseline+"\ncreate extension if not exists pgtap with schema extensions; set search_path=public,extensions; set statement_timeout='20s';\n"+migrations.map(f=>f.content).join('\n')+'\n'+tests.map(f=>f.content).join('\n');
   const output=await new Promise<string>((resolve,reject)=>{
     const child=spawn('docker',['exec','-i','--user','postgres',name,'psql','-U','supabase_admin','-d','postgres','-X','-v','ON_ERROR_STOP=1','-A','-t'],{windowsHide:true,signal,stdio:['pipe','pipe','pipe']});
     let stdout='',stderr='';
     const timer=setTimeout(()=>child.kill(),60_000);
     child.stdout.on('data',c=>{stdout=(stdout+c).slice(-60_000);});child.stderr.on('data',c=>{stderr=(stderr+c).slice(-6000);});
     child.on('error',e=>{clearTimeout(timer);reject(e);});
     child.on('close',code=>{clearTimeout(timer);code===0?resolve(stdout):reject(new Error(`Supabase migration/tests failed (exit ${code}): ${stderr}\n${stdout}`));});
     child.stdin.on('error',()=>{});child.stdin.end(query);
   });
   const failures=pgTapFailures(output);if(failures.length)throw new Error(failures.join('\n'));
   return output;
 }finally{
   // Only this randomly named validation container, never app or control-plane data.
   await exec('docker',['rm','-f',name],{windowsHide:true,timeout:15000}).catch(()=>{});
 }
}

export async function checkSupabaseBuild(directory:string,signal?:AbortSignal){
 const name=`dk-next-check-${randomUUID()}`;
 try{
   const result=await exec('docker',['run','--pull=never','--name',name,'--label','devkiller.next-check=true','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=2g','--cpus=2','--pids-limit=256','--tmpfs','/tmp:rw,nosuid,nodev,size=1g','--mount',`type=bind,source=${path.resolve(directory)},target=/candidate,readonly`,'-e','NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321','-e','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=build-only-no-credentials','devkiller-supabase-next:1'],{windowsHide:true,signal,timeout:180000,maxBuffer:1_000_000});
   return result.stdout;
 }catch(error){const e=error as {stdout?:string;stderr?:string};throw new Error(`Isolated Next build failed:\n${e.stdout||''}\n${e.stderr||''}`);}
 finally{await exec('docker',['rm','-f',name],{windowsHide:true,timeout:15000}).catch(()=>{});}
}
