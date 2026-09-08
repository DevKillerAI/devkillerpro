import { NextResponse } from 'next/server';
import {isSameOriginRequest} from '@/lib/server/requestOrigin';
import { z } from 'zod';
import { requireOwnerAdmin } from '@/lib/server/adminAccess';
import { accessError } from '@/lib/server/access';
import { database } from '@/lib/server/database';
import { selectTaskModel } from '@/lib/server/modelRouting';
import { currentPolicy } from '@/lib/server/modelPolicy';
import { ADMIN_CHECKS } from '@/lib/admin/metrics';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const response=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(req:Request){
  try{
    const access=await requireOwnerAdmin(req);
    const days=Number(new URL(req.url).searchParams.get('days') || 7);
    if(![1,7,30].includes(days)) return response({error:'Invalid period.'},400);
    const sql=database();
    const provider=await sql`select model,schema_name,count(*)::int as calls,
      count(*) filter(where status='completed')::int as completed,
      count(*) filter(where status in ('queued','in_progress'))::int as active,
      count(*) filter(where result->'usage'->>'input_tokens' is not null)::int as usage_calls,
      sum((result->'usage'->>'input_tokens')::bigint)::text as input_tokens,
      sum((result->'usage'->>'output_tokens')::bigint)::text as output_tokens,
      sum((result->'usage'->'input_tokens_details'->>'cached_tokens')::bigint)::text as cached_tokens,
      sum((result->'usage'->'input_tokens_details'->>'cache_write_tokens')::bigint)::text as write_tokens,
      count(*) filter(where result->'usage'->>'input_tokens' is not null and result->'usage'->'input_tokens_details'->>'cached_tokens' is not null and result->'usage'->'input_tokens_details'->>'cache_write_tokens' is not null)::int as cache_reporting_calls,
      round(avg(extract(epoch from updated_at-created_at)) filter(where status='completed'),1)::text as seconds
      from provider_requests where created_at>=now()-(${days}*interval '1 day') group by model,schema_name order by calls desc`;
    const missions=await sql`select status,count(*)::int as count from missions where created_at>=now()-(${days}*interval '1 day') group by status`;
    const notes=await sql`select check_id,state,note,updated_at from admin_review_notes where owner_id=${access.userId}`;
    const configured=await currentPolicy();
    return response({at:new Date().toISOString(),days,provider,missions,notes,models:{
      ...configured.policy},
      routing:new Set(Object.values(configured.policy)).size>1,cacheRouting:process.env.DEVKILLER_PROMPT_CACHE!=='disabled'});
  }catch(error){const known=accessError(error);return response({error:known?.error || 'Unable to load administration data.'},known?.status || 500);}
}
export async function PATCH(req:Request){
  if(!isSameOriginRequest(req)) return response({error:'Origin not allowed.'},403);
  try{
    const access=await requireOwnerAdmin(req);
    const parsed=z.object({id:z.string().refine(id=>ADMIN_CHECKS.some(item=>item.id===id)),state:z.enum(['pending','in_progress','verified']),note:z.string().max(2000)}).safeParse(await req.json());
    if(!parsed.success) return response({error:'Invalid checklist update.'},400);
    const {id,state,note}=parsed.data;
    if(state==='verified' && !note.trim()) return response({error:'Add test evidence before marking verified.'},400);
    await database()`insert into admin_review_notes(owner_id,check_id,state,note) values(${access.userId},${id},${state},${note}) on conflict(owner_id,check_id) do update set state=excluded.state,note=excluded.note,updated_at=now()`;
    return response({success:true});
  }catch(error){const known=accessError(error);return response({error:known?.error || 'Unable to save checklist.'},known?.status || 500);}
}
