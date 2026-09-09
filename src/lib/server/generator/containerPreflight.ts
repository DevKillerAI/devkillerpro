import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {containerIdentityArgs} from './containerIdentity';

/** Exercise the actual bind-mount identity before reserving any model credits. */
export async function assertContainerWorkspaceAccess(imageId:string,signal?:AbortSignal) {
  if(!/^sha256:[a-f0-9]{64}$/.test(imageId))throw new Error('Invalid preflight image.');
  const exec=promisify(execFile),root=await mkdtemp(path.join(tmpdir(),'dk-access-'));
  const input=path.join(root,'source'),output=path.join(root,'output'),name='dk-access-'+randomUUID();
  try{
    await mkdir(input,{mode:0o700});await mkdir(output,{mode:0o700});
    await writeFile(path.join(input,'probe'),'dk-access-ok',{mode:0o600});
    await exec('docker',['run','--rm','--pull=never','--name',name,'--network=none','--read-only',...containerIdentityArgs(),
      '--cap-drop=ALL','--security-opt=no-new-privileges','--memory=128m','--pids-limit=32',
      '--mount',`type=bind,source=${input},target=/candidate,readonly`,'--mount',`type=bind,source=${output},target=/output`,
      '--entrypoint','node',imageId,'-e',"const f=require('fs');f.writeFileSync('/output/probe',f.readFileSync('/candidate/probe'))"],
      {windowsHide:true,timeout:20000,signal,maxBuffer:2000});
    if(await readFile(path.join(output,'probe'),'utf8')!=='dk-access-ok')throw new Error('Artifact readback mismatch.');
  }catch{signal?.throwIfAborted();throw new Error('Generation host cannot read and write isolated build artifacts. No AI request was started.');}
  finally{await exec('docker',['rm','-f',name],{windowsHide:true,timeout:5000}).catch(()=>undefined);await rm(root,{recursive:true,force:true});}
}
