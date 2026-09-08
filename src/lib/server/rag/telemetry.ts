import {createHash} from 'node:crypto';
const hash=(value:unknown,length=32)=>createHash('sha256').update(String(value)).digest('hex').slice(0,length);
// Allowlisted metadata only: never copy queries, source text, credentials, user IDs or titles.
export function retrievalOtlp(event:Record<string,unknown>){
 const end=Date.parse(String(event.at));const duration=Number(event.durationMs);
 if(!Number.isFinite(end)||!Number.isFinite(duration)||duration<0||duration>3_600_000||typeof event.traceId!=='string')throw new Error('Invalid retrieval metric');
 const attributes=[
  {key:'openinference.span.kind',value:{stringValue:'RETRIEVER'}},
  {key:'dk.retrieval.mode',value:{stringValue:event.mode==='hybrid'?'hybrid':'lexical-degraded'}},
  {key:'dk.retrieval.documents',value:{arrayValue:{values:(Array.isArray(event.hitIds)?event.hitIds:[]).slice(0,100).map(id=>({stringValue:hash(id)}))}}},
  {key:'dk.mission.hash',value:{stringValue:event.missionId?hash(event.missionId):'unlinked'}},
 ];
 return {traceId:hash(event.traceId),spanId:hash(event.traceId,16),name:'knowledge.retrieve',kind:1,startTimeUnixNano:String(BigInt(Math.floor(end-duration))*1_000_000n),endTimeUnixNano:String(BigInt(end)*1_000_000n),attributes,status:{code:1}};
}
