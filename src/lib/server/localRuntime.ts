import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import {RuntimeStartupError,type RuntimeState} from './runtimeDiagnostics';

const exec = promisify(execFile);
const IMAGE = 'node@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e';
const safePath = z.string().regex(/^(?!.*(?:\.\.|\\))[a-zA-Z0-9_][a-zA-Z0-9_./-]*\.(?:mjs|cjs|js)$/, "Use a concrete relative .js, .mjs or .cjs file path. TypeScript files, globs and parent traversal are not supported by this runtime.");
export const runtimeSchema = z.object({ entry: safePath, tests: z.array(safePath).min(1).max(12), port: z.literal(3000), publicDir: z.literal('public') });
export type RuntimeContract = z.infer<typeof runtimeSchema>;
export async function docker(args: string[], timeout = 30_000) {
  return (await exec('docker', args, { timeout, maxBuffer: 1024 * 1024, windowsHide: true })).stdout.trim();
}
const limits = ['--memory=256m','--cpus=1','--pids-limit=64','--cap-drop=ALL','--security-opt=no-new-privileges','--read-only','--user=1000:1000','--tmpfs=/tmp:rw,noexec,nosuid,size=32m'];
export function runtimeName(id: string) { return `dk-app-${createHash('sha256').update(id).digest('hex').slice(0,20)}`; }
async function owned(name: string) {
  try { return await docker(['inspect','--format','{{index .Config.Labels "devkiller.runtime"}}',name]) === 'true'; } catch { return false; }
}
export async function stopRuntime(id: string) {
  const name = runtimeName(id);
  if (await owned(`${name}-gateway`)) await docker(['rm','-f',`${name}-gateway`]);
  if (await owned(name)) await docker(['rm','-f',name]);
}
export async function testRuntime(directory: string, contract: RuntimeContract) {
  const name = `${runtimeName(directory)}-test`;
  try {
    return await docker(['run','--rm','--name',name,'--label','devkiller.runtime=true','--network=none',...limits,
      '--tmpfs=/data:rw,nosuid,size=64m,uid=1000,gid=1000',
      '--mount',`type=bind,source=${path.resolve(directory)},target=/app,readonly`, '-w','/app',
      '-e','DATABASE_URL=file:/data/test.sqlite','-e','HOST=127.0.0.1','-e','PORT=3000',IMAGE,'node','--test',...contract.tests],60_000);
  } finally { if (await owned(name)) await docker(['rm','-f',name]); }
}
/** Execute dependency-free release scripts only inside an offline disposable copy. */
export async function checkLocalRelease(directory:string) {
  const name=`${runtimeName(directory)}-release`;
  const runner=`const fs=require('node:fs');const cp=require('node:child_process');fs.cpSync('/app','/tmp/release',{recursive:true});process.chdir('/tmp/release');const p=JSON.parse(fs.readFileSync('package.json','utf8'));function run(s){if(!p.scripts?.[s])return;const r=cp.spawnSync('npm',['run',s],{encoding:'utf8',timeout:20000,env:{...process.env,DATABASE_URL:'file:/data/release.sqlite'}});console.log('npm run '+s+' => '+r.status);console.log(r.stdout||'');console.error(r.stderr||'');if(r.status!==0)process.exit(1)}run('db:migrate');run('db:migrate');run('build');`;
  try {
    return await docker(['run','--rm','--name',name,'--label','devkiller.runtime=true','--network=none',...limits,
      '--tmpfs=/data:rw,nosuid,size=64m,uid=1000,gid=1000',
      '--mount',`type=bind,source=${path.resolve(directory)},target=/app,readonly`,
      '-e','HOST=127.0.0.1','-e','PORT=3000',IMAGE,'node','-e',runner],75_000);
  }finally{if(await owned(name))await docker(['rm','-f',name]);}
}
export async function checkRuntimeStartup(directory: string, contract: RuntimeContract) {
  const id=`startup-${directory}`, name=runtimeName(id);
  try { await startRuntime(id,directory,contract); return 'HTTP startup check passed with the real runtime environment.'; }
  finally {
    await stopRuntime(id);
    await docker(['volume','rm',`${name}-data`]).catch(()=>{});
    await docker(['network','rm',`${name}-net`]).catch(()=>{});
  }
}
export async function startRuntime(id: string, directory: string, contract: RuntimeContract, revision = '1') {
  const name = runtimeName(id), network = `${name}-net`, volume = `${name}-data`;
  if (await owned(name)) {
    const running = await docker(['inspect','--format','{{.State.Running}}',name]);
    const currentRevision=await docker(['inspect','--format','{{index .Config.Labels "devkiller.revision"}}',name]);
    if (running === 'true' && currentRevision === revision && await owned(`${name}-gateway`)) {
      const port=await docker(['inspect','--format','{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}',`${name}-gateway`]);
      if (/^\d+$/.test(port)) return {url:`http://127.0.0.1:${port}`};
    }
    await stopRuntime(id);
  }
  try { await docker(['network','inspect',network]); } catch { await docker(['network','create','--internal',network]); }
  await docker(['volume','create',volume]);
  // Trusted initializer changes only this runtime's named volume permissions.
  await docker(['run','--rm','--network=none','--cap-drop=ALL','--cap-add=CHOWN','--mount',`type=volume,source=${volume},target=/data`,IMAGE,'node','-e',"require('node:fs').chownSync('/data',1000,1000)"]);
  await docker(['run','-d','--name',name,'--label','devkiller.runtime=true','--label',`devkiller.revision=${revision}`,'--network',network,...limits,
    '--mount',`type=bind,source=${path.resolve(directory)},target=/app,readonly`,
    '--mount',`type=volume,source=${volume},target=/data`,'-w','/app',
    '-e','DATABASE_URL=file:/data/app.sqlite','-e','HOST=0.0.0.0','-e','PORT=3000',IMAGE,'node',contract.entry]);
  // A trusted gateway bridges browser traffic only to this fixed backend.
  // Generated code stays on the internal-only network with no outbound route.
  const gateway = `${name}-gateway`;
  const proxy = `const http=require('node:http');http.createServer((req,res)=>{const out=http.request({host:${JSON.stringify(name)},port:3000,path:req.url,method:req.method,headers:req.headers},r=>{const headers={...r.headers};delete headers['x-frame-options'];const csp=String(headers['content-security-policy']||\"default-src 'self'\");headers['content-security-policy']=csp.replace(/frame-ancestors[^;]*(;|$)/gi,'')+\"; frame-ancestors http://localhost:3000 http://127.0.0.1:3000\";res.writeHead(r.statusCode,headers);r.pipe(res)});out.on('error',()=>{res.writeHead(502);res.end('Backend unavailable')});req.pipe(out)}).listen(3000,'0.0.0.0')`;
  await docker(['create','--name',gateway,'--label','devkiller.runtime=true',...limits,'-p','127.0.0.1::3000',IMAGE,'node','-e',proxy]);
  await docker(['network','connect',network,gateway]);
  await docker(['start',gateway]);
  const port = await docker(['inspect','--format','{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}',gateway]);
  if (!/^\d+$/.test(port)) throw new Error('Runtime port was not allocated.');
  const url = `http://127.0.0.1:${port}`;
  let lastHttp:number|undefined;
  let state:RuntimeState={};
  for(let attempt=0;attempt<20;attempt++) {
    try{state=JSON.parse(await docker(['inspect','--format','{{json .State}}',name],3000));if(state.Running===false)break;}catch{}
    try { const response=await fetch(url,{signal:AbortSignal.timeout(1000)}); lastHttp=response.status; await response.body?.cancel(); if(response.ok) return {url}; } catch {}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  // Capture both Docker streams BEFORE removing the container. `docker()` alone drops stderr.
  let stdout='',stderr='';
  try{const logs=await exec('docker',['logs','--tail','80',name],{timeout:3000,maxBuffer:128*1024,windowsHide:true});stdout=logs.stdout;stderr=logs.stderr;}catch(error){const diagnostic=error as {stdout?:string;stderr?:string};stdout=diagnostic.stdout||'';stderr=diagnostic.stderr||'Container logs unavailable';}
  const failure=new RuntimeStartupError(state,stdout,stderr,lastHttp);
  await stopRuntime(id).catch(()=>{});
  throw failure;
}
