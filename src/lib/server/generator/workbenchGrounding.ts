import { createHash } from 'node:crypto';
import { retrieveKnowledge, EMBEDDING_MODEL } from '../rag/retrieval';
import type { RetrievalTrace } from '../rag/types';
import type { WorkbenchQualityPlan } from './workbenchQuality';


export type ConsumedKnowledgeChunk = Readonly<{
  documentId: string; documentVersion: string; documentHash: string;
  chunkId: string; chunkHash: string; citation: string;
  text: string; consumedHash: string; truncated: boolean;
}>;
export type WorkbenchGrounding = Readonly<{
  text: string; citations: readonly string[]; hitIds: readonly string[];
  mode: 'hybrid' | 'lexical-degraded';
  traceId?: string; corpusHash?: string; algorithm?: RetrievalTrace['algorithm'];
  backend?: 'postgresql'; phase?: 'build' | 'edit' | 'repair';
  consumedChunks?: readonly ConsumedKnowledgeChunk[]; textHash?: string;
}>;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** The audit contains only the exact excerpts actually sent to the model. */
export function assembleWorkbenchGrounding(trace: RetrievalTrace, options: {
  maxChars?: number; maxChunkChars?: number; phase?: WorkbenchGrounding['phase'];
} = {}): WorkbenchGrounding {
  const maxChars = options.maxChars ?? 9000, maxChunkChars = options.maxChunkChars ?? 1800;
  if (!Number.isSafeInteger(maxChars) || maxChars < 0 || maxChars > 16000 || !Number.isSafeInteger(maxChunkChars) || maxChunkChars < 1) {
    throw new Error('Invalid grounding context budget.');
  }
  let remaining = maxChars;
  const sections: string[] = [], consumedChunks: ConsumedKnowledgeChunk[] = [];
  for (const hit of trace.hits) {
    const chunk = hit.chunk;
    // Old document-only results cannot establish chunk provenance.
    if (!chunk || digest(chunk.content) !== chunk.contentHash || chunk.documentHash !== hit.document.contentHash
      || chunk.documentVersion !== hit.document.version) continue;
    const heading = 'Reference ' + (consumedChunks.length + 1) + ': ' + hit.citation + '\n';
    const separator = sections.length ? 2 : 0;
    const allowance = Math.min(maxChunkChars, remaining - heading.length - separator);
    if (allowance < 120) continue;
    const excerpt = chunk.content.slice(0, allowance).trimEnd();
    if (!excerpt) continue;
    const section = heading + excerpt;
    sections.push(section); remaining -= section.length + separator;
    consumedChunks.push({ documentId: hit.document.id, documentVersion: hit.document.version,
      documentHash: hit.document.contentHash, chunkId: chunk.id, chunkHash: chunk.contentHash,
      citation: hit.citation, text: excerpt, consumedHash: digest(excerpt), truncated: excerpt !== chunk.content });
  }
  const text = sections.join('\n\n');
  return { text, textHash: digest(text), consumedChunks,
    citations: consumedChunks.map(chunk => chunk.citation), hitIds: consumedChunks.map(chunk => chunk.documentId),
    mode: trace.mode, traceId: trace.traceId, corpusHash: trace.corpusHash, algorithm: trace.algorithm,
    backend: trace.backend, phase: options.phase ?? 'build' };
}

export async function retrieveWorkbenchGrounding(brief: string, quality: WorkbenchQualityPlan, missionId: string,
  options: { phase?: WorkbenchGrounding['phase']; focus?: string; signal?: AbortSignal } = {}): Promise<WorkbenchGrounding> {
  const phase = options.phase ?? 'build';
  const context = phase === 'build'
    ? [quality.domain, quality.experienceShape, quality.artDirection, quality.visualRecipe.composition,
      quality.domain === 'creative-studio'
        ? 'vector canvas interactive direct manipulation 8-point resize handles rotation zoom pan matrix layer hierarchy modular components types styles'
        : 'accessible responsive interface design tokens state validation error recovery']
    : [quality.domain, options.focus ?? '', 'React TypeScript atomic edits regression tests state validation'];

  const queryString = [brief, ...context].join('\n').slice(0, 32000);
  const readiness=await retrieveKnowledge({query:queryString,tenantId:'devkiller',domains:['design','product','builder'],excludeTags:['platform-only'],limit:6,missionId,useEmbeddings:false,signal:options.signal});
  if(readiness.candidateCount===0)throw new Error('The reviewed generation knowledge corpus is empty. Import and verify the RAG before starting a generation.');
  if(process.env.DEVKILLER_RAG_QUERY_EMBEDDINGS!=='true')return assembleWorkbenchGrounding(readiness,{phase});
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  let queryEmbedding: number[] | undefined;

  if (apiKey && process.env.DEVKILLER_RAG_QUERY_EMBEDDINGS === 'true') {
    try {
      const embRes = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: queryString.slice(0, 8000),
        }),
        signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      });
      if (embRes.ok) {
        const payload = await embRes.json() as { data?: Array<{ embedding?: number[] }> };
        if (Array.isArray(payload.data?.[0]?.embedding) && payload.data[0].embedding.length === 1536) {
          queryEmbedding = payload.data[0].embedding;
        }
      }
    } catch {
      // Graceful fallback to lexical ranking if provider is unreachable
    }
  }

  const trace = await retrieveKnowledge({
    query: queryString,
    // This is the shared reviewed platform corpus. Private tenant uploads are not queried.
    tenantId: 'devkiller',
    domains: ['design', 'product', 'builder'],
    excludeTags: ['platform-only'],
    limit: 6,
    missionId,
    useEmbeddings: Boolean(queryEmbedding),
    queryEmbedding,
    queryEmbeddingModel: queryEmbedding ? EMBEDDING_MODEL : undefined,
    signal: options.signal,
  });

  return assembleWorkbenchGrounding(trace, { phase });
}



