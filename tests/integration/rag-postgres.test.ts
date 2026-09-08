import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import { database, closeDatabase } from '../../src/lib/server/database';
import { knowledgeCandidates, listKnowledge, ragTable, saveChunkEmbedding, upsertKnowledge, restoreKnowledgeVersion, hashContent } from '../../src/lib/server/rag/store';
import { retrieveKnowledge } from '../../src/lib/server/rag/retrieval';
import type { KnowledgeDocument } from '../../src/lib/server/rag/types';

test('PostgreSQL RAG isolation, atomic import, concurrent writes, immutable history and no paid retrieval',{skip:!process.env.DATABASE_URL},async()=>{
  const url=new URL(process.env.DATABASE_URL!);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  const schema=`dk_rag_test_${randomUUID().replaceAll('-','')}`;
  Object.assign(process.env,{NODE_ENV:'test',DEVKILLER_RAG_TEST_SCHEMA:schema});
  const sql=database();
  const originalFetch=globalThis.fetch;
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('Network forbidden in this test');};
  const common={tenantId:'owner',title:'canvas export',content:'canvas export isolation test',sourceUri:'internal://integration',sourceType:'internal' as const,trust:'verified' as const,status:'active' as const,domains:['test'],tags:[],version:'1',reviewedAt:'2026-09-01T00:00:00Z',expiresAt:'2099-01-01T00:00:00Z',metadata:{license:'test-only'}};
  try{
    for(const file of ['20260905200000_rag_core_pgvector.sql','20260905210000_rag_runtime.sql']){
      const ddl=(await readFile(`supabase/migrations/${file}`,'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS vector;/,'').replace(/\bdk_rag\b/g,schema);
      await sql.unsafe(ddl);
    }
    await Promise.all([
      upsertKnowledge({...common,id:'allowed'}),upsertKnowledge({...common,id:'foreign',tenantId:'other'}),upsertKnowledge({...common,id:'public',tenantId:'public'}),
      upsertKnowledge({...common,id:'quarantine',status:'quarantined'}),upsertKnowledge({...common,id:'expired',expiresAt:'2000-01-01'}),
      upsertKnowledge({...common,id:'provider',tags:['firebase']}),upsertKnowledge({...common,id:'platform',tags:['platform-only']}),
    ]);
    const trace=await retrieveKnowledge({query:'canvas export',tenantId:'owner',domains:['test'],excludeTags:['firebase'],useEmbeddings:true});
    assert.equal(trace.backend,'postgresql');assert.equal(trace.mode,'lexical-degraded');assert.equal(calls,0);
    assert.deepEqual(trace.hits.map(h=>h.document.id).sort(),['allowed','public']);assert.equal(trace.candidateCount,2);
    const [event]=await sql`SELECT event FROM ${sql(ragTable('retrieval_events'))} WHERE trace_id=${trace.traceId!}`;
    assert.deepEqual(event.event.hitIds,trace.hits.map(h=>h.document.id));assert.equal(event.event.query,undefined);
    const allowed=(await listKnowledge()).find(d=>d.id==='allowed')!;
    assert.equal(allowed.reviewedAt,common.reviewedAt.replace('Z','.000Z'));assert.equal(allowed.metadata?.license,'test-only');
    await assert.rejects(sql.begin(async tx=>{await upsertKnowledge({...common,id:'rolled-back'},tx as unknown as Sql);throw new Error('rollback');}),/rollback/);
    assert.equal((await listKnowledge()).some(d=>d.id==='rolled-back'),false);
    const old=(await knowledgeCandidates({tenantId:'owner',excludeTags:['firebase']})).find(c=>c.document.id==='allowed')!;
    const vector=Array.from({length:1536},(_,i)=>i===0?1:0);
    await saveChunkEmbedding(old,vector,'text-embedding-3-small');
    const [scored]=await knowledgeCandidates({tenantId:'owner',domains:['test'],excludeTags:['firebase']},vector);
    assert.equal(scored.semanticScore,1,'pgvector computes cosine distance for a filtered candidate');
    const hybrid=await retrieveKnowledge({query:'canvas',tenantId:'owner',queryEmbedding:vector,queryEmbeddingModel:'text-embedding-3-small'});
    assert.equal(hybrid.mode,'hybrid');assert.equal(hybrid.algorithm,'bm25-cosine-rrf-v1');assert.equal(calls,0);
    await Promise.all([upsertKnowledge({...common,id:'allowed',content:'first updated canvas'}),upsertKnowledge({...common,id:'allowed',content:'second updated canvas'})]);
    const latest=(await listKnowledge()).find(d=>d.id==='allowed')!;
    const current=(await knowledgeCandidates({tenantId:'owner'})).find(c=>c.document.id==='allowed')!;
    assert.equal(current.chunk.documentHash,hashContent(latest.content));assert.equal(current.chunk.embedding,undefined);
    await assert.rejects(saveChunkEmbedding(old,vector,'text-embedding-3-small'),/changed/);
    const [versions]=await sql`SELECT count(*)::int AS count FROM ${sql(ragTable('document_versions'))} WHERE document_id='allowed'`;
    assert.ok(versions.count>=2);await assert.rejects(upsertKnowledge({...common,id:'allowed',tenantId:'other'}),/tenant is immutable/);
    const [saved]=await sql`SELECT snapshot_hash FROM ${sql(ragTable('document_versions'))} WHERE document_id='allowed' AND snapshot->'document'->>'content'=${common.content}`;
    await restoreKnowledgeVersion('allowed',saved.snapshot_hash);
    const restored=(await knowledgeCandidates({tenantId:'owner'})).find(c=>c.document.id==='allowed')!;
    assert.equal(restored.document.content,common.content);assert.equal(restored.document.metadata?.license,'test-only');assert.deepEqual(restored.chunk.embedding,vector);
    const before=(await listKnowledge()).length;await retrieveKnowledge({query:'nonexistentxyz',tenantId:'owner'});assert.equal((await listKnowledge()).length,before);
  }finally{
    globalThis.fetch=originalFetch;
    assert.match(schema,/^dk_rag_test_[a-f0-9]{32}$/);
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    delete process.env.DEVKILLER_RAG_TEST_SCHEMA;
    await closeDatabase();
  }
});
