import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { database, closeDatabase } from "../../src/lib/server/database";

test("authenticated enqueue, atomic credits, duplicate protection, ownership and unlimited owner", async () => {
  const origin = process.env.DEVKILLER_INTERNAL_URL || "http://127.0.0.1:3000";
  const sql = database();
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const users: string[] = [];
  const missionIds: string[] = [];
  const password = randomUUID() + "Aa!";
  const request = (path:string, token?:string, body?:unknown, method=body ? "POST" : "GET") => fetch(origin+path,{
    method,headers:{...(token ? {Authorization:`Bearer ${token}`} : {}),"Content-Type":"application/json"},...(body ? {body:JSON.stringify(body)} : {})
  });
  const createTester = async () => {
    const email=`pilot-regression-${randomUUID()}@example.test`;
    const result=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:"Regression fixture"}});
    assert.ifError(result.error); users.push(result.data.user!.id);
    const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}});
    const login=await client.auth.signInWithPassword({email,password});
    assert.ifError(login.error);
    return {id:result.data.user!.id,token:login.data.session!.access_token};
  };
  const body = () => { const missionId=`pilot-test-${randomUUID()}`;missionIds.push(missionId);return {missionId,prompt:"Controlled queue fixture; never execute a model call.",selectedAgentIds:["qa"]}; };
  try {
    const [active]=await sql`select count(*)::int as count from mission_jobs where status in ('queued','running','retrying')`;
    assert.equal(active.count,0,"Run only with worker paused and no active user jobs.");
    assert.equal((await request("/api/missions")).status,401);
    assert.equal((await request("/api/knowledge/health","invalid-token")).status,401);
    const owner=await createTester();const stranger=await createTester();
    await sql`update profiles set credit_limit=1 where id=${owner.id}`;
    const mission=body();
    const results=await Promise.all([request("/api/jobs",owner.token,mission),request("/api/jobs",owner.token,mission)]);
    assert.deepEqual(results.map(r=>r.status).sort(),[202,409]);
    const [profile]=await sql`select credits_used from profiles where id=${owner.id}`;
    assert.equal(profile.credits_used,1);
    const [ledger]=await sql`select count(*)::int as count from credit_ledger where mission_id=${mission.missionId}`;
    assert.equal(ledger.count,1);
    assert.equal((await request("/api/jobs",stranger.token,mission)).status,403);
    const foreign=await request("/api/missions",stranger.token);
    assert.equal((await foreign.json()).projects.length,0);
    assert.equal((await request("/api/runtime",stranger.token,{missionId:mission.missionId})).status,403);
    assert.equal((await request("/api/jobs?missionId="+mission.missionId,stranger.token,undefined,"DELETE")).status,409);
    const denied=body();
    assert.equal((await request("/api/jobs",owner.token,denied)).status,402);
    assert.equal((await sql`select id from missions where id=${denied.missionId}`).length,0);
    assert.equal((await request("/api/jobs?missionId="+mission.missionId,owner.token,undefined,"DELETE")).status,200);
    assert.equal((await request("/api/jobs",owner.token,mission)).status,202,"Retry must not double-charge");
    await sql`update profiles set credit_limit=null,credits_used=10000 where id=${stranger.id}`;
    assert.equal((await request("/api/jobs",stranger.token,body())).status,202);
    const account=await (await request("/api/account",stranger.token)).json();
    assert.equal(account.account.unlimited,true);assert.equal(account.account.creditsRemaining,null);
    assert.equal((await request("/api/admin/invites",stranger.token)).status,403);
  } finally {
    // Only remove exact fixtures created by this test.
    for(const id of missionIds) {
      await sql`delete from credit_ledger where mission_id=${id}`;
      await sql`delete from missions where id=${id}`;
    }
    for(const id of users) await admin.auth.admin.deleteUser(id);
    await closeDatabase();
  }
});
