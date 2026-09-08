import {createServerClient} from '@supabase/ssr';
import {cookies} from 'next/headers';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {database} from '@/lib/server/database';
import {isSameOriginRequest} from '@/lib/server/requestOrigin';
export const runtime='nodejs';
const schema=z.object({email:z.string().email().max(254),password:z.string().min(12).max(128)}).strict();
export async function POST(req:Request){
  if(!isSameOriginRequest(req))return NextResponse.json({error:'Origin not allowed.'},{status:403});
  const raw=await req.text();if(raw.length>1000)return NextResponse.json({error:'Request too large.'},{status:413});
  let body:unknown;try{body=JSON.parse(raw);}catch{return NextResponse.json({error:'Invalid request.'},{status:400});}
  const parsed=schema.safeParse(body);if(!parsed.success)return NextResponse.json({error:'Check your email and password.'},{status:400});
  const store=await cookies();
  const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{cookies:{getAll:()=>store.getAll(),setAll:values=>values.forEach(({name,value,options})=>store.set(name,value,options))}});
  const {data,error}=await client.auth.signInWithPassword(parsed.data);
  if(error||!data.user)return NextResponse.json({error:'We couldn\u2019t sign you in. Check your email and password.'},{status:401});
  const [profile]=await database()`select access_enabled from profiles where id=${data.user.id}`;
  if(!profile?.access_enabled){await client.auth.signOut({scope:'local'});return NextResponse.json({error:'This account\u2019s access has been paused by the workspace owner.'},{status:403});}
  return NextResponse.json({success:true},{headers:{'Cache-Control':'no-store'}});
}
