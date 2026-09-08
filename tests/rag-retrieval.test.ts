import test from 'node:test';
import assert from 'node:assert/strict';
import { chunksForDocument, embeddingInput, hashContent, splitKnowledgeContent } from '../src/lib/server/rag/chunks';
import { rankKnowledgeCandidates } from '../src/lib/server/rag/retrieval';
import { normalizeKnowledge } from '../src/lib/server/rag/store';
import { retrievalMetrics } from '../src/lib/server/rag/evaluation';
import { knowledgeTenant } from '../src/lib/server/rag/accessPolicy';
import type { KnowledgeDocument, KnowledgeCandidate } from '../src/lib/server/rag/types';

const doc=(id:string,overrides:Partial<KnowledgeDocument>={}):KnowledgeDocument=>normalizeKnowledge({id,tenantId:'owner',title:'canvas export',content:'canvas export cross origin',sourceUri:'internal://test',sourceType:'internal',trust:'verified',status:'active',domains:['design'],tags:[],version:'1',...overrides});
const candidate=(document:KnowledgeDocument):KnowledgeCandidate=>({document,chunk:chunksForDocument(document)[0]});
test('retrieval filters every candidate before either lexical or hybrid ranking',()=>{
  const allowed=candidate(doc('allowed'));
  const forbidden=[doc('foreign',{tenantId:'other'}),doc('quarantine',{status:'quarantined'}),doc('expired',{expiresAt:'2000-01-01'}),doc('observed',{trust:'observed'}),doc('platform',{tags:['platform-only']}),doc('provider',{tags:['firebase']})].map(candidate);
  const args={query:'canvas export',tenantId:'owner',excludeTags:['firebase']};
  assert.deepEqual(rankKnowledgeCandidates(args,[allowed,...forbidden]).hits.map(h=>h.document.id),['allowed']);
  const vector=Array.from({length:1536},(_,i)=>i===0?1:0);
  for(const c of [allowed,...forbidden])Object.assign(c.chunk,{embedding:vector,embeddingModel:'text-embedding-3-small'});
  const result=rankKnowledgeCandidates({...args,queryEmbedding:vector,queryEmbeddingModel:'text-embedding-3-small'},[allowed,...forbidden]);
  assert.equal(result.hybrid,true);assert.deepEqual(result.hits.map(h=>h.document.id),['allowed']);
  assert.equal('embedding' in result.hits[0].chunk!,false);
});
test('token ranking abstains without relevant terms and uses explicit compatible vectors only',()=>{
  const c=candidate(doc('a',{title:'canvassing',content:'exportation'}));
  assert.equal(rankKnowledgeCandidates({query:'canvas export',tenantId:'owner'},[c]).hits.length,0);
  assert.equal(rankKnowledgeCandidates({query:'canvassing',tenantId:'owner',useEmbeddings:true},[c]).hybrid,false);
});
test('chunks retain complete source, deterministic hashes and exact input vector binding',()=>{
  const content=('paragraph with unicode 😀 words\n'.repeat(200));
  const chunks=splitKnowledgeContent(content);assert.equal(chunks.join(''),content);assert.ok(chunks.every(c=>c.length<=1600));
  const vector=Array.from({length:1536},(_,i)=>i===0?1:0);
  const d=doc('a',{embedding:vector,embeddingModel:'text-embedding-3-small'});
  assert.equal(chunksForDocument(d)[0].embedding,undefined,'legacy vector without its input hash is archived only');
  d.embeddingContentHash=hashContent(embeddingInput(d.title,d.content));assert.deepEqual(chunksForDocument(d)[0].embedding,vector);
  assert.equal(chunksForDocument({...d,title:'changed'})[0].embedding,undefined);
  assert.notEqual(chunksForDocument({...d,title:'changed'})[0].id,chunksForDocument(d)[0].id);
});
test('evaluation stores actual unique hits and separates precision from reciprocal rank',()=>{
  const metrics=retrievalMetrics(['anchor'],['other','anchor','third'],3);
  assert.equal(metrics.precision,1/3);assert.equal(metrics.reciprocalRank,1/2);assert.equal(metrics.recall,1);
  assert.deepEqual(metrics.retrievedIds,['other','anchor','third']);
  assert.equal(retrievalMetrics(['anchor'],[],3).precision,0);
  assert.equal(retrievalMetrics([],[],3).recall,null);
});
test('mission observations remain quarantined and malformed governance cannot be persisted',()=>{
  const d=doc('mission',{sourceType:'mission',trust:'certified',status:'active'});
  assert.equal(d.status,'quarantined');assert.equal(d.trust,'observed');
  assert.throws(()=>doc('a',{expiresAt:'not-a-date'}));
});
test('knowledge API scope derives tenant from authenticated identity and restricts platform access',()=>{
  const user={userId:'user-123',role:'tester' as const,internal:false};
  assert.equal(knowledgeTenant(user,'personal'),'user-123');
  assert.throws(()=>knowledgeTenant(user,'platform',true),/FORBIDDEN/);
  assert.throws(()=>knowledgeTenant({...user,role:'admin'},'platform'),/FORBIDDEN/);
  assert.throws(()=>knowledgeTenant({...user,internal:true},'personal'),/FORBIDDEN/);
  assert.equal(knowledgeTenant({...user,role:'admin'},'platform',true),'devkiller');
});
