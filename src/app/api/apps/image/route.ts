import { NextResponse } from 'next/server';
import { z } from 'zod';
import { accessContext, accessError, enforceRateLimit } from '@/lib/server/access';
import { canUseAppVision } from '@/lib/server/appVision';
import { database } from '@/lib/server/database';
import {assertSameOriginRequest} from '@/lib/server/requestOrigin';
export const runtime='nodejs';
const schema=z.object({missionId:z.string().regex(/^[a-zA-Z0-9_-]{8,180}$/),prompt:z.string().trim().min(5).max(3000)}).strict();
export async function POST(req:Request){
  try {
    assertSameOriginRequest(req);
    const access=await accessContext(req);
    if(access.internal)throw new Error('FORBIDDEN');
    const raw=await req.text();if(raw.length>5000)return NextResponse.json({success:false,error:'Request too large.'},{status:413});
    const parsed=schema.safeParse(JSON.parse(raw));if(!parsed.success)return NextResponse.json({success:false,error:'Invalid image request.'},{status:400});
    if(!await canUseAppVision(access.userId,parsed.data.missionId))throw new Error('FORBIDDEN');
    await enforceRateLimit(access,'apps:image',3,3600);
    if(!process.env.OPENAI_API_KEY)return NextResponse.json({success:false,error:'Image provider is not configured.'},{status:503});
    // Never automatically retry a billable image request after an ambiguous timeout.
    const response=await fetch('https://api.openai.com/v1/images/generations',{method:'POST',signal:AbortSignal.timeout(120000),headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-image-2',prompt:parsed.data.prompt,n:1,size:'1024x1024',quality:'low',output_format:'png'})});
    if(!response.ok)return NextResponse.json({success:false,error:'Image generation unavailable or declined. No automatic retry was made.'},{status:502});
    const payload=await response.json();const b64=payload.data?.[0]?.b64_json;
    if(typeof b64!=='string'||b64.length>16000000||Buffer.from(b64,'base64').subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Invalid image');
    let usageRecorded=true;
    try {
      const sql=database();
      const [pilot]=await sql`select 1 from dk_generator_v2.runs where owner_id=${access.userId} and id=${parsed.data.missionId}`;
      if(pilot)await sql`insert into dk_generator_v2.asset_usage(owner_id,run_id,stage,provider,model,input_tokens,output_tokens) values(${access.userId},${parsed.data.missionId},'app.image','OpenAI','gpt-image-2',${payload.usage?.input_tokens||0},${payload.usage?.output_tokens||0})`;
      else await sql`insert into mission_usage(mission_id,stage,provider,model,input_tokens,output_tokens) values(${parsed.data.missionId},'app.image','OpenAI','gpt-image-2',${payload.usage?.input_tokens||0},${payload.usage?.output_tokens||0})`;
    } catch(error) {
      // The provider has already completed a billable generation. Preserve the
      // image for the user even if local telemetry needs operator repair.
      usageRecorded=false;
      console.error('image usage telemetry failed',error instanceof Error?error.message:'unknown');
    }
    return NextResponse.json({success:true,imageDataUrl:`data:image/png;base64,${b64}`,model:'gpt-image-2',usageRecorded},{headers:{'Cache-Control':'no-store'}});
  }catch(error){const known=accessError(error);return NextResponse.json({success:false,error:known?.error||'Image generation could not be confirmed. Do not automatically resubmit.'},{status:known?.status||502});}
}
