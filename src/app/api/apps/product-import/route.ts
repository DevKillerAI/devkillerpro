import {NextResponse} from 'next/server';
import {z} from 'zod';
import {accessContext,accessError,enforceRateLimit} from '@/lib/server/access';
import {canUseAppCapability} from '@/lib/server/appVision';
import {importProductFromUrl} from '@/lib/server/productImporter';
import {assertSameOriginRequest} from '@/lib/server/requestOrigin';
export const runtime='nodejs';
const schema=z.object({missionId:z.string().regex(/^[a-zA-Z0-9_-]{8,180}$/),url:z.string().trim().url().max(2048)}).strict();
export async function POST(req:Request){try{
  assertSameOriginRequest(req);
  const access=await accessContext(req);if(access.internal)throw new Error('FORBIDDEN');
  const raw=await req.text();if(raw.length>5000)return NextResponse.json({success:false,error:'Request too large.'},{status:413});
  const parsed=schema.safeParse(JSON.parse(raw));if(!parsed.success)return NextResponse.json({success:false,error:'Enter a valid public product URL.'},{status:400});
  if(!await canUseAppCapability(access.userId,parsed.data.missionId))throw new Error('FORBIDDEN');
  await enforceRateLimit(access,'apps:product-import',20,3600);
  const product=await importProductFromUrl(parsed.data.url,AbortSignal.timeout(20_000));
  return NextResponse.json({success:true,product},{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}catch(error){const known=accessError(error);return NextResponse.json({success:false,error:known?.error||(error instanceof Error?error.message:'The product page could not be imported.')},{status:known?.status||422,headers:{'Cache-Control':'no-store'}});}}
