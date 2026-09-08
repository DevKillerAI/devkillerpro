import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { browserContractSchema } from './browserContract';

const exec = promisify(execFile);
const IMAGE = 'devkiller-browser:1.62.0';
export interface BrowserEvidence {
  status:'passed'|'failed'|'unavailable'|'not-applicable';
  candidateHash:string;
  failures:string[];
  limitations:string[];
  report?:unknown;
  imageId?:string;
  durationMs:number;
}
export async function executeBrowserChecks(args:{files:{path:string;content:string}[];signal?:AbortSignal;timeoutMs?:number;outputDirectory?:string}):Promise<BrowserEvidence>{
  const started=Date.now();
  const candidateHash=createHash('sha256').update(JSON.stringify([...args.files].sort((a,b)=>a.path.localeCompare(b.path)))).digest('hex');
  const result:BrowserEvidence={status:'not-applicable',candidateHash,failures:[],limitations:[],durationMs:0};
  if(!args.files.some(f=>f.path==='index.html')||args.files.some(f=>f.path==='devkiller.runtime.json')){
    result.limitations.push('Browser execution unavailable for this runtime; backend checks are separate.');return result;
  }
  const entry=args.files.find(f=>f.path==='index.html')!.content;
  if(/<script\b[^>]*\bsrc\s*=\s*["'][^"']*\.(?:tsx?|jsx)(?:\?[^"']*)?["']/i.test(entry)){
    return {...result,status:'unavailable',limitations:['This source entry requires a JavaScript/TypeScript bundling step before browser execution. The static runner cannot execute TSX/JSX directly. Preserve the candidate and provide an isolated build runtime; do not repair the UI for a false empty-page failure.']};
  }
  const declared=args.files.find(f=>f.path==='devkiller.browser.json');
  let contract;
  try { contract=browserContractSchema.parse(declared?JSON.parse(declared.content):{version:1,tests:[]}); }
  catch(error) {return {...result,status:'failed',failures:[`Invalid devkiller.browser.json: ${error instanceof Error ? error.message.slice(0,1600) : 'invalid JSON'}. Use the supported bounded declarative browser contract.`]};}
  if(!contract.tests.length)result.limitations.push('No declared functional journeys. Browser smoke checks do not verify the complete app.');
  const work=await mkdtemp(path.join(tmpdir(),'devkiller-browser-'));
  const name=`dk-browser-${randomUUID()}`;
  const docker=(command:string[],timeout=15000,signal?:AbortSignal)=>exec('docker',command,{timeout,signal,windowsHide:true,maxBuffer:1024*1024});
  try {
    args.signal?.throwIfAborted();
    const inspected=await docker(['image','inspect',IMAGE,'--format','{{.Id}}']);
    const imageId=inspected.stdout.trim();
    if(!/^sha256:[a-f0-9]{64}$/.test(imageId))throw new Error('Browser image unavailable');
    result.imageId=imageId;
    const source=path.join(work,'source'),output=path.join(work,'output');
    await mkdir(source);await mkdir(output);
    for(const file of args.files){
      const target=path.resolve(source,file.path);
      if(!target.startsWith(source+path.sep)||file.path.includes(':')||file.path.includes('\\')||file.content.length>2_000_000)throw new Error('Unsafe candidate file');
      await mkdir(path.dirname(target),{recursive:true});await writeFile(target,file.content,{flag:'wx'});
    }
    await writeFile(path.join(work,'contract.json'),JSON.stringify(contract));
    const command=['run','--pull=never','--name',name,'--label',`devkiller.browser=${name}`,'--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=768m','--cpus=1','--pids-limit=128','--shm-size=128m','--tmpfs','/tmp:rw,nosuid,nodev,size=128m','--mount',`type=bind,source=${source},target=/candidate,readonly`,'--mount',`type=bind,source=${path.join(work,'contract.json')},target=/runner/contract.json,readonly`,'--mount',`type=bind,source=${output},target=/output`,imageId];
    let runError:unknown;
    try {await docker(command,args.timeoutMs??90_000,args.signal);}catch(error){runError=error;}
    // A killed CLI does not stop the container. Stop before inspecting output.
    if(runError)await docker(['stop','--time','1',name]).catch(()=>undefined);
    args.signal?.throwIfAborted();
    const raw=await readFile(path.join(output,'report.json'),'utf8');
    const report=JSON.parse(raw) as {failures:string[];checks:{passed:boolean}[];limitations:string[]};
    if(!Array.isArray(report.failures)||!Array.isArray(report.checks)||!report.checks.length)throw new Error('Incomplete browser report');
    result.report=report;result.failures=report.failures;result.limitations.push(...report.limitations);
    result.status=result.failures.length?'failed':runError?'unavailable':'passed';
    if(args.outputDirectory){
      await mkdir(args.outputDirectory,{recursive:true});
      await writeFile(path.join(args.outputDirectory,'browser.json'),JSON.stringify({...result,executedAt:new Date().toISOString()},null,2));
      for(const width of [1440,390])await copyFile(path.join(output,`layout-${width}.png`),path.join(args.outputDirectory,`layout-${width}.png`)).catch(()=>undefined);
    }
  }catch(error){
    args.signal?.throwIfAborted();
    result.status='unavailable';result.limitations.push(`Browser verification did not complete: ${error instanceof Error?error.message.slice(0,300):'environment unavailable'}`);
  }finally{
    // Random owned name, not a user container or a broad Docker cleanup.
    await docker(['rm','-f',name]).catch(()=>undefined);
    await rm(work,{recursive:true,force:true});
    result.durationMs=Date.now()-started;
  }
  return result;
}
