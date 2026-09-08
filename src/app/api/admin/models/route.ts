import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOwnerAdmin } from '@/lib/server/adminAccess';
import { accessError,enforceRateLimit } from '@/lib/server/access';
import { database } from '@/lib/server/database';
import { currentPolicy } from '@/lib/server/modelPolicy';
import { MODEL_OPTIONS,policySchema } from '@/lib/admin/modelPolicy';
import { responseText } from '@/lib/server/openaiTransport';
import {isSameOriginRequest} from '@/lib/server/requestOrigin';
export const runtime='nodejs';
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(req:Request){try{
 const user=await requireOwnerAdmin(req);
 const [current,history,checks]=await Promise.all([currentPolicy(),database()`select id,policy,created_at from model_policy_history order by id desc limit 10`,database()`select model,checked_at from model_compatibility_checks where owner_id=${user.userId} and checked_at>now()-interval '24 hours'`]);
 return json({current,history,checks});
}catch(error){const known=accessError(error);return json({error:known?.error || 'Unable to load model settings.'},known?.status || 500);}}
export async function POST(req:Request){
 if(!isSameOriginRequest(req))return json({error:'Origin not allowed.'},403);
 try{
 const user=await requireOwnerAdmin(req);await enforceRateLimit(user,'admin:models',10,60);
 const body=await req.json();
 if(body.action==='test'){
   const model=z.enum(MODEL_OPTIONS).parse(body.model);
   const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model,store:false,reasoning:{effort:'none'},max_output_tokens:64,input:'Return ok true.',text:{format:{type:'json_schema',name:'compatibility_check',strict:true,schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false}}}}),signal:AbortSignal.timeout(30000)});
   const result=await response.json();
   if(!response.ok || JSON.parse(responseText(result)).ok!==true)return json({error:'Compatibility check failed. Configuration was not changed.'},422);
   await database()`insert into model_compatibility_checks(owner_id,model) values(${user.userId},${model}) on conflict(owner_id,model) do update set checked_at=now()`;
   return json({success:true,usage:result.usage});
 }
 if(body.action!=='save')return json({error:'Invalid action.'},400);
 const policy=policySchema.parse(body.policy);
 const result=await database().begin(async tx=>{
   await tx`select pg_advisory_xact_lock(82002026)`;
   const [latest]=await tx`select id from model_policy_history order by id desc limit 1`;
   if(String(latest?.id || 'environment')!==String(body.version))throw new Error('STALE_SETTINGS');
   const checks=await tx`select model from model_compatibility_checks where owner_id=${user.userId} and checked_at>now()-interval '24 hours'`;
   if(Object.values(policy).some(model=>!checks.some(check=>check.model===model)))throw new Error('UNTESTED_MODEL');
   const [saved]=await tx`insert into model_policy_history(owner_id,policy) values(${user.userId},${tx.json(policy)}) returning id`;
   return saved;
 });
 return json({success:true,id:String(result.id)});
 }catch(error){const known=accessError(error);const message=error instanceof Error?error.message:'';return json({error:known?.error || (message==='STALE_SETTINGS'?'Settings changed elsewhere. Refresh before saving.':message==='UNTESTED_MODEL'?'Test every selected model before saving.':'Unable to complete request. No automatic retry was made; a timed-out test may still be billed.')},known?.status || 400);}
}
