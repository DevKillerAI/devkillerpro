import { NextResponse } from 'next/server';
import { z } from 'zod';
import { retrieveKnowledge } from '@/lib/server/rag/retrieval';
import { requireGeneratorAccess, accessError, enforceRateLimit } from '@/lib/server/access';
import { requireOwnerAdmin } from '@/lib/server/adminAccess';
import { isSameOriginRequest } from '@/lib/server/requestOrigin';
import { knowledgeTenant } from '@/lib/server/rag/accessPolicy';
export const runtime='nodejs';
const requestSchema=z.object({prompt:z.string().min(8).max(12000),scope:z.enum(['personal','platform']).default('personal')}).strict();
const response=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(req:Request){
  if(!isSameOriginRequest(req))return response({success:false,error:'Origin not allowed.'},403);
  try{
    const access=await requireGeneratorAccess(req);
    await enforceRateLimit(access,'knowledge:intake',20,60);
    const parsed=requestSchema.safeParse(await req.json().catch(()=>null));
    if(!parsed.success)return response({success:false,error:'A valid prompt and knowledge scope are required.'},400);
    const platform=parsed.data.scope==='platform';
    if(platform)await requireOwnerAdmin(req);
    const tenantId=knowledgeTenant(access,parsed.data.scope,platform);
    const trace=await retrieveKnowledge({query:parsed.data.prompt,tenantId,domains:['intake','product','security','architecture','qa'],limit:6,useEmbeddings:false,signal:req.signal});
    return response({success:true,mode:trace.mode,backend:trace.backend,citations:trace.hits.map(hit=>hit.citation),guidance:trace.hits.map(hit=>({title:hit.document.title,statement:hit.chunk?.content||hit.document.content,trust:hit.document.trust,source:hit.document.sourceUri})),trace:{id:trace.traceId,corpusHash:trace.corpusHash,retrievedAt:trace.retrievedAt,candidateCount:trace.candidateCount,hitCount:trace.hits.length}});
  }catch(error){const known=accessError(error);return response({success:false,error:known?.error||'Knowledge is temporarily unavailable.'},known?.status||503);}
}
