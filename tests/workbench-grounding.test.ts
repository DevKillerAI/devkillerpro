import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assembleWorkbenchGrounding, groundingExclusions } from '../src/lib/server/generator/workbenchGrounding';
import type { RetrievalTrace } from '../src/lib/server/rag/types';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const trace = (): RetrievalTrace => ({ query: 'fixture', tenantId: 'devkiller', domains: [], retrievedAt: new Date().toISOString(),
  mode: 'lexical-degraded', candidateCount: 3, backend: 'postgresql', algorithm: 'bm25-v2', traceId: 'fixture-trace', corpusHash: hash('fixture'),
  hits: ['first', 'second', 'third'].map((id, index) => ({
    document: { id, tenantId: 'devkiller', title: id, content: 'entire document', sourceUri: 'internal:' + id, sourceType: 'internal',
      trust: 'verified', status: 'active', domains: ['builder'], tags: [], version: 'v2', contentHash: hash('entire document'), ingestedAt: new Date().toISOString() },
    chunk: { id: id + '-chunk', documentId: id, documentVersion: 'v2', documentHash: hash('entire document'), content: id.repeat(100), contentHash: hash(id.repeat(100)), index },
    score: 1, lexicalScore: 1, semanticScore: 0, citation: '[' + id + ']' })) });
test('grounding audits exact consumed chunks and never cites omitted hits', () => {
  const input = trace(), result = assembleWorkbenchGrounding(input, { maxChars: 350, maxChunkChars: 180 });
  assert.ok(result.text.length <= 350);
  assert.deepEqual(result.hitIds, ['first', 'second']);
  assert.deepEqual(result.citations, ['[first]', '[second]']);
  assert.equal(result.consumedChunks!.length, 2);
  assert.ok(result.consumedChunks!.every(chunk => chunk.truncated && hash(chunk.text) === chunk.consumedHash && result.text.includes(chunk.text)));
  assert.equal(result.textHash, hash(result.text));
  assert.equal(result.traceId, input.traceId);
  assert.equal(result.backend, 'postgresql');
});
test('grounding excludes corrupt, stale and unbound retrieval results', () => {
  const input = trace();
  input.hits[0].chunk!.content = 'tampered';
  input.hits[1].chunk!.documentVersion = 'v1';
  delete input.hits[2].chunk;
  const result = assembleWorkbenchGrounding(input);
  assert.equal(result.text, '');
  assert.deepEqual(result.citations, []);
  assert.deepEqual(result.consumedChunks, []);
});

test('operational app grounding excludes specialized canvas references',()=>{assert.ok(groundingExclusions('client-operations').includes('creative-studio'));assert.ok(groundingExclusions('general-product').includes('canvas'));assert.deepEqual(groundingExclusions('creative-studio'),['platform-only']);});
