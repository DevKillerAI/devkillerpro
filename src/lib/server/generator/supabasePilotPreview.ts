import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { type GeneratorSnapshot } from './versionedEdits';
import { type PilotDelivery, pilotBundleHash } from './pilotDelivery';
import { privateboardEnvironmentIdentity } from './supabasePilotContract';
import { readSupabasePilotEnvironment } from './supabasePilotEnvironment';
import { validatePrivateboardSource, PRIVATEBOARD_VERIFIER_VERSION } from './supabasePilotRuntime';
import { bindSourceCandidate } from './operationPolicy';
import { sameCandidate } from './releaseGate';
import type { GenerationContract, GeneratorIdentity } from './contract';
import { workbenchEnvironmentIdentity, validateWorkbenchDatabaseSource } from './workbenchDatabase';
import { WORKBENCH_VERIFIER } from './workbenchContract';

const exec = promisify(execFile);
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
const pending=new Map<string,Promise<{url:string;sourceHash:string}>>();
const root=path.resolve('.devkiller/generator-v2/previews');
const docker=async(args:string[]) => (await exec('docker',args,{windowsHide:true,timeout:30000,maxBuffer:500_000})).stdout.trim();
async function writeExact(file:string,content:string) {
  try { await writeFile(file,content,{flag:'wx',mode:0o600}); }
  catch(error) { if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error; if(await readFile(file,'utf8')!==content)throw new Error('Preview artifact changed unexpectedly.'); }
}

/** Only the exact, already approved candidate can start a loopback-only preview. */
export async function startPrivateboardPreview(snapshot:GeneratorSnapshot,contract:GenerationContract,delivery:PilotDelivery) {
  validatePrivateboardSource(snapshot);
  if(contract.runtime.id!=='react-supabase-pilot'||!delivery.database||!delivery.runtimeImageId||!/^sha256:[a-f0-9]{64}$/.test(delivery.runtimeImageId))throw new Error('This delivery has no verified database runtime.');
  const expected=bindSourceCandidate(snapshot,contract,sha(delivery.runtimeImageId+':'+PRIVATEBOARD_VERIFIER_VERSION));
  if(!sameCandidate(expected,delivery.candidate)||pilotBundleHash(delivery.compiledFiles)!==delivery.compiledHash)throw new Error('Preview candidate does not match approved source.');
  const key=sha(JSON.stringify(expected));
  const existing=pending.get(key);if(existing)return existing;
  const work=start(snapshot,delivery,key).finally(()=>pending.delete(key));pending.set(key,work);return work;
}
export async function startWorkbenchDatabasePreview(snapshot:GeneratorSnapshot,contract:GenerationContract,delivery:PilotDelivery) {
  const {migrations,tableNames}=validateWorkbenchDatabaseSource(snapshot);
  const identity=workbenchEnvironmentIdentity(snapshot);
  if(contract.runtime.id!=='react-workbench'||!contract.capabilities.includes('database.postgres')||!delivery.database||!delivery.runtimeImageId||!/^sha256:[a-f0-9]{64}$/.test(delivery.runtimeImageId))throw new Error('No verified Workbench database runtime.');
  const fingerprint=sha(JSON.stringify(migrations.map(({path,hash})=>({path,hash}))));
  const expected=bindSourceCandidate(snapshot,contract,sha(delivery.runtimeImageId+':'+WORKBENCH_VERIFIER));
  if(fingerprint!==delivery.database.migrationFingerprint||!sameCandidate(expected,delivery.candidate)||pilotBundleHash(delivery.compiledFiles)!==delivery.compiledHash)throw new Error('Database preview binding mismatch.');
  const key=sha(JSON.stringify(expected)),existing=pending.get(key);if(existing)return existing;
  const work=start(snapshot,delivery,key,identity,tableNames).finally(()=>pending.delete(key));pending.set(key,work);return work;
}
async function start(snapshot:GeneratorSnapshot,delivery:PilotDelivery,key:string,identity:GeneratorIdentity=privateboardEnvironmentIdentity(snapshot),tableNames?:string[]) {
  const environment=await readSupabasePilotEnvironment(identity);
  if(environment.scopeHash!==delivery.database!.scopeHash||environment.identity.environmentId!==delivery.database!.environmentId||environment.stackId!==delivery.database!.stackId)throw new Error('Preview environment mismatch.');
  const name=`dk-v2-preview-${key.slice(0,24)}`;
  const directory=path.join(root,key), compiled=path.join(directory,'compiled'),config=path.join(directory,'config');
  await mkdir(path.join(compiled,'assets'),{recursive:true});await mkdir(config,{recursive:true});
  const actual=await realpath(directory),actualRoot=await realpath(root);
  if(path.relative(actualRoot,actual)!==key)throw new Error('Preview directory escaped its bound scope.');
  for(const file of delivery.compiledFiles) {
    if(!['index.html','assets/app.js','assets/app.css'].includes(file.path))throw new Error('Unexpected preview artifact.');
    await writeExact(path.join(compiled,file.path),file.content);
  }
  await writeExact(path.join(config,'runtime.json'),JSON.stringify({internalApiUrl:environment.internalApiUrl,anonKey:environment.anonKey,schema:'app',storageKey:environment.storageKey,...(tableNames?{tableNames}:{})}));
  let info:Record<string,any>|null=null;
  const expectedNetworks=[environment.network,environment.previewNetwork].sort();
  try{info=JSON.parse(await docker(['container','inspect',name]))[0];}
  catch(error){if(!/No such (object|container)/i.test(String((error as {stderr?:string}).stderr)))throw error;}
  if(info) {
    const attached=Object.keys(info.NetworkSettings?.Networks??{}).sort();
    if(info.Config?.Labels?.['devkiller.v2.preview']!==key||info.Image!==delivery.runtimeImageId||
      attached.some(network=>!expectedNetworks.includes(network)))throw new Error('A conflicting preview container was preserved.');
    // Resume only our own not-yet-started container if the process stopped between create and connect.
    if(!info.State?.Running&&attached.length===1&&attached[0]===environment.previewNetwork) {
      await docker(['network','connect',environment.network,name]);
    } else if(attached.join(',')!==expectedNetworks.join(','))throw new Error('The preview network binding is incomplete.');
    if(!info.State?.Running)await docker(['start',name]);
  } else {
    // Docker Desktop does not publish ports on internal-only bridges. A separate loopback
    // preview bridge serves trusted static/proxy code; the generated app never runs in Node.
    await docker(['create','--pull=never','--name',name,'--label',`devkiller.v2.preview=${key}`,'--network',environment.previewNetwork,
      '--read-only','--user=1000:1000','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=192m','--cpus=.5','--pids-limit=64',
      '--tmpfs','/tmp:rw,nosuid,nodev,size=64m','--mount',`type=bind,source=${compiled},target=/candidate,readonly`,
      '--mount',`type=bind,source=${config},target=/config,readonly`,'-p','127.0.0.1::3000',delivery.runtimeImageId!,'serve']);
    await docker(['network','connect',environment.network,name]);
    await docker(['start',name]);
  }
  info=JSON.parse(await docker(['container','inspect',name]))[0];
  const binding=info?.NetworkSettings?.Ports?.['3000/tcp'];
  if(!Array.isArray(binding)||binding.length!==1||binding[0].HostIp!=='127.0.0.1'||!/^\d{4,5}$/.test(binding[0].HostPort))throw new Error('Preview port is not isolated on loopback.');
  const port=Number(binding[0].HostPort);
  const hostname=`dk-v2-${key.slice(0,24)}.localhost`;
  const url=`http://${hostname}:${port}/`;
  for(let attempt=0;attempt<20;attempt++) {
    try{const response=await fetch(`http://127.0.0.1:${port}/`,{headers:{Host:`${hostname}:${port}`},signal:AbortSignal.timeout(1500),redirect:'error'});if(response.ok)return {url,sourceHash:snapshot.hash};}catch{/* A just-started trusted HTTP server may still be binding. */}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error('The approved database preview did not become ready. Its bound container and data were preserved.');
}
