import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WORKBENCH_IMAGE, WORKBENCH_VERIFIER } from './workbenchContract';
export async function inspectWorkbenchRuntime(signal?:AbortSignal):Promise<{available:true;imageId:string;verifierVersion:string}|{available:false;reason:string}> {
  try {const {stdout}=await promisify(execFile)('docker',['image','inspect',WORKBENCH_IMAGE,'--format','{{.Id}}'],{windowsHide:true,timeout:10000,signal,maxBuffer:16000});
    const imageId=stdout.trim();if(!/^sha256:[a-f0-9]{64}$/.test(imageId))throw new Error();return {available:true,imageId,verifierVersion:WORKBENCH_VERIFIER};
  }catch{signal?.throwIfAborted();return {available:false,reason:'The isolated React build environment is unavailable. No generation has been started.'};}
}
