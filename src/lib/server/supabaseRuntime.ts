import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomBytes} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const exec=promisify(execFile);
const NODE='node@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e';
const targets:Record<string,{name:string;schema:string;port:number}>={
 'benchmark-supabase-booking-20260902':{name:'roomledger',schema:'room_ledger',port:55321},
 'benchmark-firebase-orders-20260902':{name:'queuepantry',schema:'queue_pantry',port:56321},
};
const pending=new Map<string,Promise<{url:string}>>();
const provisioning=new Map<string,Promise<void>>();
const docker=async(args:string[],timeout=20000)=>(await exec('docker',args,{windowsHide:true,timeout,maxBuffer:1_000_000})).stdout.trim();
function targetFor(id:string){const target=targets[id];if(!target)throw new Error('A dedicated Supabase runtime has not been provisioned for this mission.');return target;}
export function migrationFingerprint(files:{path:string;content:string}[]){
 return createHash('sha256').update(JSON.stringify(files.map(({path,content})=>({path,content})).sort((a,b)=>a.path.localeCompare(b.path)))).digest('hex');
}
export function isSupabaseNext(files:{path:string}[]){return files.some(f=>f.path==='src/app/page.tsx')&&files.some(f=>/^supabase\/migrations\/.*\.sql$/.test(f.path));}
export async function localSupabaseConfig(id:string){
 const target=targetFor(id);
 const raw=await exec(process.execPath,[path.resolve('node_modules/supabase/dist/supabase.js'),'status','--workdir',path.resolve('.devkiller/app-infrastructure',target.name),'-o','json'],{windowsHide:true,timeout:20000,maxBuffer:100000});
 const values=JSON.parse(raw.stdout);
 const claims=JSON.parse(Buffer.from(String(values.ANON_KEY).split('.')[1]||'','base64url').toString());
 if(claims.role!=='anon')throw new Error('Refusing privileged preview credentials');
 return {...target,url:`http://127.0.0.1:${target.port}`,anonKey:String(values.ANON_KEY)};
}
function sql(container:string,role:string,query:string,password?:string){return new Promise<string>((resolve,reject)=>{
 const child=spawn('docker',['exec','-i','--user','postgres',...(password?['-e',`PGPASSWORD=${password}`]:[]),container,'psql',...(password?['-h','127.0.0.1']:[]),'-U',role,'-d','postgres','-X','-v','ON_ERROR_STOP=1','-A','-t'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';const timer=setTimeout(()=>child.kill(),45000);
 child.stdout.on('data',c=>stdout=(stdout+c).slice(-16000));child.stderr.on('data',c=>stderr=(stderr+c).slice(-4000));
 child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);code===0?resolve(stdout):reject(new Error(`App migration failed: ${stderr}`));});child.stdin.on('error',()=>{});child.stdin.end(query);
});}
export async function provisionSupabaseSchema(id:string,files:{path:string;content:string}[]){
 const current=provisioning.get(id);if(current)return current;
 const work=provision(id,files).finally(()=>provisioning.delete(id));provisioning.set(id,work);return work;
}
async function provision(id:string,files:{path:string;content:string}[]){
 const target=targetFor(id),container=`supabase_db_dk_${target.name}`;
 const migrations=files.filter(f=>/^supabase\/migrations\/[^/]+\.sql$/.test(f.path)).sort((a,b)=>a.path.localeCompare(b.path));
 if(!migrations.length)throw new Error('No application migrations');
 const hash=migrationFingerprint(migrations);
 const folder=path.resolve('.devkiller/app-infrastructure',target.name),record=path.join(folder,'applied.json');
 try{const old=JSON.parse(await readFile(record,'utf8'));if(old.hash!==hash)throw new Error('App schema already provisioned with different migrations; explicit upgrade review required. No data was reset.');return;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 // Bootstrap privileges, not application tables. The app SQL executes as an unprivileged login.
 const password=randomBytes(32).toString('hex');
 await sql(container,'supabase_admin',`do $$ begin if not exists(select 1 from pg_roles where rolname='dk_app_migrator') then create role dk_app_migrator login nosuperuser nocreatedb nocreaterole noinherit; end if; end $$;
 alter role dk_app_migrator login password '${password}';
 create extension if not exists btree_gist with schema extensions;
 grant create on database postgres to dk_app_migrator;
 grant usage on schema auth,extensions to dk_app_migrator;
 grant references on auth.users to dk_app_migrator;`);
 try{await sql(container,'dk_app_migrator',"begin; set statement_timeout='20s'; set search_path=public,extensions;\n"+migrations.map(f=>f.content).join('\n')+'\ncommit;',password);}
 finally{await sql(container,'supabase_admin','alter role dk_app_migrator nologin password null;');}
 // Expose the schema only after successful creation, avoiding startup 503 loops.
 await sql(container,'supabase_admin',`alter role authenticator set pgrst.db_schemas='public,graphql_public,${target.schema}'; notify pgrst,'reload config'; notify pgrst,'reload schema';`);
 await mkdir(folder,{recursive:true});await writeFile(record,JSON.stringify({hash,at:new Date().toISOString(),missionId:id,files:migrations.map(f=>f.path)},null,2),{flag:'wx'});
}
const runtimeName=(id:string)=>`dk-supabase-app-${createHash('sha256').update(id).digest('hex').slice(0,16)}`;
export async function stopSupabaseRuntime(id:string){
 targetFor(id);const name=runtimeName(id);
 for(const container of [name,`${name}-gateway`]){
  try{if(await docker(['inspect','--format','{{index .Config.Labels "devkiller.supabase-preview"}}',container])==='true')await docker(['rm','-f',container]);}catch{/* Already absent. */}
 }
}
export async function startSupabaseRuntime(id:string,directory:string,revision:string){
 const existing=pending.get(id);if(existing)return existing;
 const work=start(id,directory,revision).finally(()=>pending.delete(id));pending.set(id,work);return work;
}
async function start(id:string,directory:string,revision:string){
 const config=await localSupabaseConfig(id),name=runtimeName(id),gateway=`${name}-gateway`,network=`${name}-private`;
 try{
  const info=JSON.parse(await docker(['inspect',name]))[0];
  if(info.State.Running&&info.Config.Labels['devkiller.revision']===revision){const port=await docker(['inspect','--format','{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}',gateway]);if(/^\d+$/.test(port))return {url:`http://127.0.0.1:${port}`};}
 }catch{/* First launch. */}
 await stopSupabaseRuntime(id);
 try{await docker(['network','inspect',network]);}catch{await docker(['network','create','--internal',network]);}
 const proxy=`const http=require('node:http');const forward=(host,port)=>http.createServer((req,res)=>{const out=http.request({host,port,path:req.url,method:req.method,headers:req.headers},r=>{const h={...r.headers};delete h['x-frame-options'];h['content-security-policy']="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${config.url}; frame-ancestors http://localhost:3000 http://127.0.0.1:3000; base-uri 'self'; form-action 'self'";res.writeHead(r.statusCode,h);r.pipe(res)});out.on('error',()=>{res.writeHead(502);res.end('Application starting')});req.pipe(out)});forward(${JSON.stringify(name)},3000).listen(3000,'0.0.0.0');forward(${JSON.stringify(`supabase_kong_dk_${config.name}`)},8000).listen(8000,'0.0.0.0');`;
 try{
  await docker(['create','--name',gateway,'--label','devkiller.supabase-preview=true','--network',`dk-${config.name}-local`,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=128m','--cpus=.5','--pids-limit=32','-p','127.0.0.1::3000',NODE,'node','-e',proxy]);
  await docker(['network','connect',network,gateway]);await docker(['start',gateway]);
  await docker(['run','-d','--pull=never','--name',name,'--label','devkiller.supabase-preview=true','--label',`devkiller.revision=${revision}`,'--network',network,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=2g','--cpus=2','--pids-limit=256','--tmpfs','/tmp:rw,nosuid,nodev,size=1g','--mount',`type=bind,source=${path.resolve(directory)},target=/candidate,readonly`,'-e','DEVKILLER_SERVE=1','-e',`DEVKILLER_SUPABASE_PORT=${config.port}`,'-e',`DEVKILLER_SUPABASE_BRIDGE=${gateway}`,'-e',`NEXT_PUBLIC_SUPABASE_URL=${config.url}`,'-e',`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${config.anonKey}`,'devkiller-supabase-next:1']);
  const port=await docker(['inspect','--format','{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}',gateway]);
  const url=`http://127.0.0.1:${port}`;
  for(let i=0;i<120;i++){try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).ok)return {url};}catch{}await new Promise(r=>setTimeout(r,500));}
  throw new Error('Supabase app preview did not become ready. Build logs were retained for diagnosis.');
 }catch(error){await stopSupabaseRuntime(id);throw error;}
}
