import {createHash} from 'node:crypto';
import type {KnowledgeDocument} from './types';
export function triageQuarantine(documents:KnowledgeDocument[]){
 const seen=new Map<string,string>();
 return documents.filter(d=>d.status==='quarantined').map(d=>{
  let parsed:{observation?:string;outcome?:string;cause?:string}={};try{parsed=JSON.parse(d.content);}catch{/* legacy plain text */}
  const observation=typeof parsed.observation==='string'?parsed.observation:d.content;
  const hash=createHash('sha256').update(observation.trim()).digest('hex');
  const duplicateOf=seen.get(`${d.tenantId}:${hash}`);seen.set(`${d.tenantId}:${hash}`,duplicateOf||d.id);
  const disposition=duplicateOf?'duplicate-text':/^Recovery attempts exhausted: the artifact still failed static or functional validation\s*$/.test(observation)?'insufficient-diagnostic':parsed.outcome==='delivery-reported-success'||d.tags.includes('verified-delivery')?'delivery-history':/^\s*(?:cto: )?fetch failed(?: after \d+ attempts\.)?\s*$/.test(observation)?'transport-symptom':'needs-evidence-review';
  const reasons={
   'duplicate-text':'Identical observation text in this tenant; keep incident identity. Equal text does not prove equal cause.',
   'insufficient-diagnostic':'No cause, failing check or remedy is recorded. Exclude from guidance; retain as historical evidence.',
   'delivery-history':'Mission-specific success report is not a reusable verified remedy; examine underlying tests before distillation.',
   'transport-symptom':'Connection symptom without a confirmed cause. Never teach application rewrites from this record.',
   'needs-evidence-review':'Potentially useful observation, but do not promote without a confirmed scoped cause and executed regression.',
  };
  return {id:d.id,contentHash:d.contentHash,observationHash:hash,disposition,duplicateOf,reason:reasons[disposition],action:'retain-quarantined',manuallyVerified:false};
 });
}
