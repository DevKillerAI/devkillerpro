import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {candidateFingerprint} from './repairProgress';
import type {BrowserEvidence} from './browserExecutor';
type RecordData={candidateHash:string;passed:boolean;method:string;at:string;checks:string[];limitations:string[]};
export function validOperatorEvidence(value:unknown,hash:string,now=Date.now()):value is RecordData{
 const v=value as RecordData;
 return Boolean(v&&v.candidateHash===hash&&v.passed===true&&v.method==='operator-browser'&&Array.isArray(v.checks)&&v.checks.length>0&&v.checks.every(x=>typeof x==='string')&&Array.isArray(v.limitations)&&v.limitations.every(x=>typeof x==='string')&&Number.isFinite(Date.parse(v.at))&&now-Date.parse(v.at)>=0&&now-Date.parse(v.at)<86400000);
}
/** Server-owned directory outside generated workspaces. No app/client upload route exists. */
export async function operatorBrowserEvidence(missionId:string,files:{path:string;content:string}[]):Promise<BrowserEvidence|undefined>{
 if(!/^[a-zA-Z0-9_-]{8,180}$/.test(missionId))return;
 const hash=candidateFingerprint(files);
 try{
  const raw=await readFile(path.resolve('.devkiller/verification-evidence',missionId,`${hash}.json`),'utf8');
  if(raw.length>100000)return;
  const data:unknown=JSON.parse(raw);if(!validOperatorEvidence(data,hash))return;
  return {status:'passed',candidateHash:hash,failures:[],limitations:['Operator-executed browser evidence for this exact source, not an automatic browser run.',...data.limitations],report:data,durationMs:0};
 }catch{return;}
}
