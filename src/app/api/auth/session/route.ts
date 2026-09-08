import {createServerClient} from '@supabase/ssr';
import {cookies} from 'next/headers';
import {NextResponse} from 'next/server';
import {database} from '@/lib/server/database';

export const dynamic='force-dynamic';
export async function GET() {
  const headers={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie'};
  if(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    return NextResponse.json({user:null,available:false},{headers,status:503});
  try {
    const store=await cookies();
    const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>store.getAll(),setAll:values=>values.forEach(({name,value,options})=>store.set(name,value,options))}});
    const {data:{user},error}=await client.auth.getUser();
    if(error||!user)return NextResponse.json({user:null},{headers});
    const [profile]=await database()`select display_name,access_enabled,generator_enabled from profiles where id=${user.id}`;
    if(profile?.access_enabled!==true) {
      await client.auth.signOut({scope:'local'});
      return NextResponse.json({user:null},{headers});
    }
    return NextResponse.json({user:{id:user.id,name:profile.display_name||'My account',createEnabled:profile.generator_enabled===true}},{headers});
  } catch {
    return NextResponse.json({user:null,available:false},{headers,status:503});
  }
}
