import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, closeDatabase } from "../../src/lib/server/database";
import { cancellableMission } from "../../src/lib/server/jobs/cancellation";
import { backgroundJson } from "../../src/lib/server/openaiBackground";

test("persistent Responses checkpoints, pipeline lock, uncertainty and cancellation", async () => {
  const sql=database(), id=`provider-test-${randomUUID()}`;
  const originalFetch=globalThis.fetch;
  const oldKey=process.env.OPENAI_API_KEY, oldModel=process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY="sk-unit-test-only"; process.env.OPENAI_MODEL="test-model";
  const token=process.env.DEVKILLER_WORKER_TOKEN;
  assert.ok(token,"Use --env-file=.env.local; no actual OpenAI requests are made.");
  const request=(job:string)=>new Request("http://localhost/api/deliberate/codegen",{method:"POST",headers:{"content-type":"application/json","x-devkiller-worker-token":token!,"x-devkiller-job-id":job},body:JSON.stringify({missionId:id})});
  const args={schemaName:"probe",prompt:"Return ok",schema:{type:"object",properties:{ok:{type:"boolean"}},required:["ok"],additionalProperties:false}};
  let posts=0, gets=0, deletes=0;
  const complete={id:"resp_test",status:"completed",output:[{type:"message",content:[{type:"output_text",text:'{"ok":true}'}]}],usage:{total_tokens:3}};
  try {
    await sql`insert into missions(id,prompt,status) values(${id},'Provider test','running')`;
    globalThis.fetch=async (_input,init)=>{
      if(init?.method==="POST") {posts++;return Response.json({id:"resp_test",status:"queued"});}
      if(init?.method==="DELETE") {deletes++;return Response.json({deleted:true});}
      gets++;return Response.json(complete);
    };
    // Simulate handler interruption after provider result persistence, before
    // endpoint-result persistence. Replay must use the saved provider result.
    await assert.rejects(cancellableMission(request("resume"),async()=>{await backgroundJson(args);throw new Error("handler interrupted");}),/handler interrupted/);
    const handler=async()=>Response.json({success:true,...await backgroundJson(args)});
    const resumed=await cancellableMission(request("resume"),handler);
    assert.equal((await resumed.json()).data.ok,true);
    await cancellableMission(request("resume"),async()=>{throw new Error("cached endpoint must not run");});
    assert.equal(posts,1);assert.equal(gets,1);assert.equal(deletes,1);

    // Lost GET: an existing provider ID can be resumed without a new POST.
    await sql`update provider_requests set result=null,status='in_progress' where mission_id=${id}`;
    await sql`delete from pipeline_results where mission_id=${id}`;
    await cancellableMission(request("resume"),handler);
    assert.equal(posts,1);assert.equal(gets,2);

    // An aged response is cancelled, never recreated. A completion racing
    // cancellation must still be accepted and persisted.
    for (const terminal of ['cancelled','completed']) {
      await sql`update provider_requests set result=null,status='queued',created_at=now()-interval '21 minutes' where mission_id=${id}`;
      await sql`delete from pipeline_results where mission_id=${id}`;
      let cancellations=0;
      globalThis.fetch=async(input,init)=>{
        if (String(input).endsWith('/cancel')) { cancellations++; return Response.json(terminal==='completed'?complete:{id:'resp_test',status:'cancelled'}); }
        if (init?.method==='DELETE') return Response.json({deleted:true});
        assert.notEqual(init?.method,'POST','Timeout must not create a replacement response');
        return Response.json({id:'resp_test',status:'in_progress'});
      };
      if(terminal==='cancelled') await assert.rejects(cancellableMission(request('resume'),handler),/OPENAI_RESPONSE_CANCELLED/);
      else assert.equal((await (await cancellableMission(request('resume'),handler)).json()).data.ok,true);
      assert.equal(cancellations,1);
      const [saved]=await sql`select status from provider_requests where mission_id=${id}`;
      assert.equal(saved.status,terminal);
    }

    await sql`update provider_requests set result=null,status='queued' where mission_id=${id}`;
    await sql`delete from pipeline_results where mission_id=${id}`;
    globalThis.fetch=async(input,init)=>{
      if(String(input).endsWith('/cancel')) throw new Error('connection lost');
      assert.notEqual(init?.method,'POST');
      return Response.json({id:'resp_test',status:'in_progress'});
    };
    await assert.rejects(cancellableMission(request('resume'),handler),/PROVIDER_WAIT_LIMIT/);

    let replacements=0;
    globalThis.fetch=async(input,init)=>{
      if(String(input).endsWith('/cancel')) return Response.json({id:'resp_test',status:'cancelled'});
      if(init?.method==='POST') {replacements++;return Response.json({id:'resp_replacement',status:'queued'});}
      if(init?.method==='DELETE') return Response.json({deleted:true});
      return Response.json(String(input).endsWith('/resp_replacement')?{...complete,id:'resp_replacement'}:{id:'resp_test',status:'queued'});
    };
    assert.equal((await (await cancellableMission(request('resume'),handler)).json()).data.ok,true);
    assert.equal(replacements,1);
    await sql`delete from pipeline_results where mission_id=${id}`;
    await cancellableMission(request('resume'),handler);
    assert.equal(replacements,1,'Resume must reuse the replacement instead of paying twice');

    let release!:()=>void, entered!:()=>void;
    const ready=new Promise<void>(resolve=>entered=resolve);
    const gate=new Promise<void>(resolve=>release=resolve);
    const first=cancellableMission(request("lock"),async()=>{entered();await gate;return Response.json({success:true});});
    await ready;
    const duplicate=await cancellableMission(request("lock"),handler);
    assert.equal(duplicate.status,409);assert.equal((await duplicate.json()).code,"PIPELINE_BUSY");
    release();await first;

    globalThis.fetch=async()=>{posts++;throw new Error("fetch failed",{cause:{code:"ECONNRESET",message:"closed"}});};
    await assert.rejects(cancellableMission(request("uncertain"),handler),/SUBMISSION_UNCERTAIN/);
    const before=posts;
    await assert.rejects(cancellableMission(request("uncertain"),handler),/SUBMISSION_UNCERTAIN/);
    assert.equal(posts,before,"ambiguous POST must not be replayed");
    const [diagnostic]=await sql`select diagnostic from provider_requests where mission_id=${id} and response_id is null`;
    assert.equal(diagnostic.diagnostic.code,"ECONNRESET");
    await sql`update missions set status='cancelled' where id=${id}`;
    await assert.rejects(cancellableMission(request("resume"),handler),/cancelled/);
    assert.equal(posts,before);
  } finally {
    globalThis.fetch=originalFetch;
    process.env.OPENAI_API_KEY=oldKey;process.env.OPENAI_MODEL=oldModel;
    await sql`delete from missions where id=${id}`;
    await closeDatabase();
  }
});
