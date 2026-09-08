import {createServerClient} from '@supabase/ssr';
import {cookies} from 'next/headers';
import {NextResponse} from 'next/server';
import {isSameOriginRequest} from '@/lib/server/requestOrigin';
export const runtime='nodejs';
export async function POST(req:Request){
  if(!isSameOriginRequest(req))return NextResponse.json({error:'Origin not allowed.'},{status:403});
  const store=await cookies();
  const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{cookies:{getAll:()=>store.getAll(),setAll:values=>values.forEach(({name,value,options})=>store.set(name,value,options))}});
  await client.auth.signOut({scope:'local'});
  return NextResponse.json({success:true},{headers:{'Cache-Control':'no-store'}});
}
