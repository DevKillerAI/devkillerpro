export const SUPABASE_SESSION_CONTRACT = `LOCAL AUTH ISOLATION CONTRACT: Independent Supabase projects on 127.0.0.1 with different ports must not share the default SSR cookie name. The installed SDK default derives its storage key from hostname, not port. In BOTH src/lib/supabase/client.ts and src/lib/supabase/server.ts pass cookieOptions: { name: "dk-<unique-app-slug>-auth" } to createBrowserClient/createServerClient. Use the SAME literal app-specific name in both clients; never the shared default sb-127-auth-token. Preserve auth, RLS and migrations. This isolates normal app sessions; it does not replace distinct signing secrets and separate origins before external deployment. Treat missing live evidence as a verification task, not a request to rewrite healthy SQL.`;

/** Bounded contract for the two managed local benchmark apps, not arbitrary source inference. */
export function localSessionContractFailures(missionId:string,files:{path:string;content:string}[]){
 if(!['benchmark-firebase-orders-20260902','benchmark-supabase-booking-20260902'].includes(missionId))return [];
 const expected=missionId==='benchmark-firebase-orders-20260902'?'dk-queue-pantry-auth':'dk-room-ledger-auth';
 const failures:string[]=[];
 for(const file of ['src/lib/supabase/client.ts','src/lib/supabase/server.ts']){
  const source=files.find(f=>f.path===file)?.content||'';
  const match=source.match(/cookieOptions\s*:\s*\{\s*name\s*:\s*['"]([^'"]+)['"]/);
  if(match?.[1]!==expected)failures.push(`${file}: local benchmark session isolation requires cookieOptions: { name: "${expected}" } on the Supabase client. A different local app's signed-in identity was observed in Pantry. The SDK's hostname-only default collides across local ports. Change the two client options only; do not change database schema.`);
 }
 return failures;
}
