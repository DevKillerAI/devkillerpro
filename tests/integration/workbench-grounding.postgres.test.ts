import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { retrieveWorkbenchGrounding } from '../../src/lib/server/generator/workbenchGrounding';
import { createWorkbenchQualityPlan } from '../../src/lib/server/generator/workbenchQuality';
import { CERTIFIED_SEED } from '../../src/lib/server/rag/seed';
import { upsertKnowledge, hashContent } from '../../src/lib/server/rag/store';
import { database, closeDatabase } from '../../src/lib/server/database';

test('workbench consumes reviewed PostgreSQL chunks with exact provenance and no provider calls',{skip:!process.env.DATABASE_URL},async()=>{
  const url=new URL(process.env.DATABASE_URL!);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  const schema=`dk_rag_test_${randomUUID().replaceAll('-','')}`;
  Object.assign(process.env,{NODE_ENV:'test',DEVKILLER_RAG_TEST_SCHEMA:schema});
  const sql=database(),originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error('External provider forbidden');};
  try{
    for(const file of ['20260905200000_rag_core_pgvector.sql','20260905210000_rag_runtime.sql']){
      const ddl=(await readFile(`supabase/migrations/${file}`,'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS vector;/,'').replace(/\bdk_rag\b/g,schema);
      await sql.unsafe(ddl);
    }
    for(const source of CERTIFIED_SEED)await upsertKnowledge(source);
    const briefs=[
      'Crie um cardápio editorial de restaurante com imagens reais e ótimo mobile.',
      'Crie um site corporativo para uma empresa de engenharia especializada em edifícios sustentáveis. Inclua portfólio, formulário de orçamento e menu responsivo.',
      'Dashboard moderno para gestão de pagamentos com estatísticas, transações e botões interativos.',
    ];
    for(const [index,brief] of briefs.entries()){
      const quality=createWorkbenchQualityPlan(brief,'detailed');
      if(index===1)assert.equal(quality.domain,'built-environment');
      const result=await retrieveWorkbenchGrounding(brief,quality,`integration-${index}`);
      assert.equal(result.backend,'postgresql');assert.equal(result.mode,'lexical-degraded');assert.equal(result.algorithm,'bm25-v2');
      assert.ok(result.text.length>100&&result.text.length<=9000);assert.ok(result.consumedChunks!.length>0);
      assert.equal(result.textHash,hashContent(result.text));assert.ok(result.traceId);assert.match(result.corpusHash!,/^[a-f0-9]{64}$/);
      assert.deepEqual(result.citations,result.consumedChunks!.map(c=>c.citation));assert.deepEqual(result.hitIds,result.consumedChunks!.map(c=>c.documentId));
      for(const consumed of result.consumedChunks!){
        const source=CERTIFIED_SEED.find(d=>d.id===consumed.documentId)!;
        assert.ok(source.domains.some(d=>['design','product','builder'].includes(d)));assert.ok(!source.tags.includes('platform-only'));
        assert.equal(consumed.documentHash,hashContent(source.content));assert.equal(consumed.consumedHash,hashContent(consumed.text));assert.ok(result.text.includes(consumed.text));
      }
    }
    assert.equal(calls,0);
  }finally{
    globalThis.fetch=originalFetch;assert.match(schema,/^dk_rag_test_[a-f0-9]{32}$/);
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);delete process.env.DEVKILLER_RAG_TEST_SCHEMA;await closeDatabase();
  }
});
