import {NextResponse} from 'next/server';
import {z} from 'zod';
import {accessContext,accessError,enforceRateLimit} from '@/lib/server/access';
import {canUseAppCapability} from '@/lib/server/appVision';
import {assertSameOriginRequest} from '@/lib/server/requestOrigin';
import {searchPublicImage} from '@/lib/server/publicImageSearch';
export const runtime='nodejs';
const schema=z.object({missionId:z.string().regex(/^[a-zA-Z0-9_-]{8,180}$/),query:z.string().trim().min(3).max(160)}).strict();
export async function POST(req:Request){try{
  assertSameOriginRequest(req);const access=await accessContext(req);if(access.internal)throw new Error('FORBIDDEN');
  const raw=await req.text();if(raw.length>1000)return NextResponse.json({success:false,error:'Request too large.'},{status:413});
  const parsed=schema.safeParse(JSON.parse(raw));if(!parsed.success)return NextResponse.json({success:false,error:'Enter a specific image description.'},{status:400});
  if(!await canUseAppCapability(access.userId,parsed.data.missionId))throw new Error('FORBIDDEN');
  await enforceRateLimit(access,'apps:public-image',30,3600);
  const asset=await searchPublicImage(parsed.data.query,AbortSignal.timeout(20_000));
  return NextResponse.json({success:true,asset},{headers:{'Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'}});
}catch(error){const known=accessError(error);return NextResponse.json({success:false,error:known?.error||(error instanceof Error?error.message:'Public image search failed.')},{status:known?.status||422,headers:{'Cache-Control':'no-store'}});}}
