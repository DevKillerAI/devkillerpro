import {createClient} from '@supabase/supabase-js';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requireOwnerAdmin} from '@/lib/server/adminAccess';
import {accessError,enforceRateLimit} from '@/lib/server/access';
import {database} from '@/lib/server/database';
import {cancelPilotRun} from '@/lib/server/generator/pilotStore';
import {PILOT_CAMPAIGN} from '@/lib/server/generator/pilotContract';
import {isSameOriginRequest} from '@/lib/server/requestOrigin';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
const response=(data:unknown,status=200)=>NextResponse.json(data,{status,headers});
export async function GET(req:Request){try{
  await requireOwnerAdmin(req);
  const rows=await database()`select p.id,u.email,p.display_name,p.role,p.access_enabled,p.generator_enabled,p.managed_ai_enabled,p.generation_budget_micros,p.access_revoked_at,
    coalesce(c.spent_micros,0) as spent_micros,coalesce(c.reserved_micros,0) as reserved_micros,
    count(r.id) filter(where r.status not in ('ready','failed','cancelled'))::int as active_runs
    from profiles p join auth.users u on u.id=p.id
    left join dk_generator_v2.campaigns c on c.owner_id=p.id::text and c.campaign_id=${PILOT_CAMPAIGN}
    left join dk_generator_v2.runs r on r.owner_id=p.id::text and r.campaign_id=${PILOT_CAMPAIGN}
    where p.role<>'admin'
    group by p.id,u.email,p.display_name,p.role,p.access_enabled,p.generator_enabled,p.managed_ai_enabled,p.generation_budget_micros,p.access_revoked_at,c.spent_micros,c.reserved_micros
    order by p.created_at`;
  return response({members:rows.map(row=>({id:row.id,email:row.email,name:row.display_name,role:row.role,accessEnabled:row.access_enabled,generatorEnabled:row.generator_enabled,managedAiEnabled:row.managed_ai_enabled,budgetMicros:row.generation_budget_micros===null?null:Number(row.generation_budget_micros),spentMicros:Number(row.spent_micros),reservedMicros:Number(row.reserved_micros),activeRuns:Number(row.active_runs),revokedAt:row.access_revoked_at}))});
}catch(error){const known=accessError(error);return response({error:known?.error||'Unable to load family access.'},known?.status||500);}}

export async function PATCH(req:Request){
  if(!isSameOriginRequest(req))return response({error:'Origin not allowed.'},403);
  try{
    const access=await requireOwnerAdmin(req);await enforceRateLimit(access,'admin:member-access',12,60);
    const parsed=z.object({userId:z.string().uuid(),accessEnabled:z.boolean()}).strict().safeParse(await req.json());
    if(!parsed.success)return response({error:'Invalid member access change.'},400);
    const {userId,accessEnabled}=parsed.data;
    const [target]=await database()`select p.id,p.role,u.email from profiles p join auth.users u on u.id=p.id where p.id=${userId}`;
    if(!target||target.role==='admin'||String(target.email).toLowerCase()===String(process.env.DEVKILLER_PILOT_EMAIL||'').toLowerCase())throw new Error('FORBIDDEN');
    const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
    if(accessEnabled){const result=await admin.auth.admin.updateUserById(userId,{ban_duration:'none'});if(result.error)throw new Error('AUTH_UPDATE_FAILED');}
    await database().begin(async tx=>{
      await tx`update profiles set access_enabled=${accessEnabled},access_revoked_at=${accessEnabled?null:new Date()} where id=${userId}`;
      await tx`insert into workspace_access_events(actor_id,target_id,action) values(${access.userId},${userId},${accessEnabled?'access_enabled':'access_disabled'})`;
    });
    if(!accessEnabled){
      const active=await database()`select id from dk_generator_v2.runs where owner_id=${userId} and status not in ('ready','failed','cancelled')`;
      for(const run of active)await cancelPilotRun(run.id,userId);
      await admin.auth.admin.updateUserById(userId,{ban_duration:'876000h'});
    }
    return response({success:true,accessEnabled});
  }catch(error){const known=accessError(error);return response({error:known?.error||(error instanceof Error&&error.message==='AUTH_UPDATE_FAILED'?'Unable to restore the account login.':'Unable to change this connection.')},known?.status||500);}
}
