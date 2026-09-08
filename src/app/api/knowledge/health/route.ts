import { NextResponse } from 'next/server';
import { knowledgeHealth } from '@/lib/server/rag/evaluation';
import { requireOwnerAdmin } from '@/lib/server/adminAccess';
import { accessError } from '@/lib/server/access';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req:Request){
  try{
    await requireOwnerAdmin(req);
    if(new URL(req.url).searchParams.has('eval'))return NextResponse.json({error:'Run evaluations with the authenticated administrative command rag:evaluate.'},{status:400,headers:{'Cache-Control':'no-store'}});
    const health=await knowledgeHealth();
    return NextResponse.json({status:health.active>0&&health.chunks>0?'operational':'empty',mode:'lexical',health},{headers:{'Cache-Control':'no-store'}});
  }catch(error){const known=accessError(error);return NextResponse.json({error:known?.error||'Unable to load knowledge health.'},{status:known?.status||503,headers:{'Cache-Control':'no-store'}});}
}
