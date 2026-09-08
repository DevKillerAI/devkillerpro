import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export function readOnlyRequestBlocked(mode: string | undefined, method: string, pathname: string) {
  if (mode !== 'true' || ['GET','HEAD','OPTIONS'].includes(method.toUpperCase())) return false;
  return !['/api/auth/login','/api/auth/logout'].includes(pathname);
}

export async function middleware(request: NextRequest) {
  const path=request.nextUrl.pathname;
  // Public tools execute locally. Generator and account APIs stay protected.
  if(['GET','HEAD'].includes(request.method) && (['/','/tools','/support','/plans','/robots.txt','/sitemap.xml','/manifest.webmanifest','/opengraph-image'].includes(path)||path.startsWith('/tools/')||path.startsWith('/tools-assets/'))) return NextResponse.next();
  if (readOnlyRequestBlocked(process.env.DEVKILLER_READ_ONLY, request.method, path)) {
    return NextResponse.json({success:false,code:'READ_ONLY_DEPLOYMENT',error:'This deployment is for reviewing existing deliveries. Open the host V2 workspace to make changes.'},{status:403,headers:{'Cache-Control':'no-store'}});
  }
  if(path.startsWith("/_next")||path.startsWith("/login")||path.startsWith("/invite")||path==="/api/invites/accept"||path==="/api/auth/login"||path==="/api/auth/session"||path==="/api/auth/logout"||path.match(/\.(?:png|jpg|jpeg|webp|svg|ico|woff2?)$/)) return NextResponse.next();
  if(request.headers.get("x-devkiller-worker-token") && request.headers.get("x-devkiller-worker-token")===process.env.DEVKILLER_WORKER_TOKEN) return NextResponse.next();
  let response=NextResponse.next({request});
  const supabase=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{cookies:{getAll:()=>request.cookies.getAll(),setAll:(cookies)=>{cookies.forEach(({name,value})=>request.cookies.set(name,value));response=NextResponse.next({request});cookies.forEach(({name,value,options})=>response.cookies.set(name,value,options));}}});
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const {data:{user}}=bearer ? await supabase.auth.getUser(bearer) : await supabase.auth.getUser();
  if(!user){if(path.startsWith("/api/")) return NextResponse.json({success:false,error:"Authentication required."},{status:401});const url=request.nextUrl.clone();url.pathname=path==='/projects'?'/tools':'/login';url.search="";url.searchParams.set(path==='/projects'?'signin':'next',path+request.nextUrl.search);return NextResponse.redirect(url);}
  const {data:profile}=await supabase.from('profiles').select('access_enabled,generator_enabled').eq('id',user.id).maybeSingle();
  if(profile?.access_enabled!==true){
    await supabase.auth.signOut({scope:'local'});
    if(path.startsWith('/api/'))return NextResponse.json({success:false,error:"This account's access has been paused by the workspace owner."},{status:403});
    const url=request.nextUrl.clone();url.pathname='/login';url.search='';url.searchParams.set('disabled','1');return NextResponse.redirect(url);
  }
  if(path==='/'&&profile?.generator_enabled===true){const url=request.nextUrl.clone();url.pathname='/create';url.search='';return NextResponse.redirect(url);}
  response.headers.set("Cache-Control","private, no-store, max-age=0");
  return response;
}

export const config={matcher:["/((?!_next/static|_next/image|favicon.ico).*)"]};
