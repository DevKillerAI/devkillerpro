import 'server-only';
import { randomUUID } from 'node:crypto';
import { appendRetrievalMetric, knowledgeCandidates, saveChunkEmbedding } from './store';
import { eligibleKnowledge, type KnowledgeFilter } from './governance';
import { rankLexically } from './lexicalRanking';
import { embeddingInput, hashContent, validEmbedding } from './chunks';
import type { KnowledgeCandidate, RetrievalHit, RetrievalTrace } from './types';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export function cosine(a: number[], b: number[]) {
  if (a.length !== b.length) return 0;
  let dot=0, aa=0, bb=0;
  for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}
  return dot/(Math.sqrt(aa)*Math.sqrt(bb)||1);
}
export function candidateCorpusHash(candidates: KnowledgeCandidate[]) {
  return hashContent(JSON.stringify(candidates.map(({document:d,chunk:c}) => [d.id,d.version,d.contentHash,d.title,d.tenantId,d.trust,d.status,d.expiresAt,d.domains,d.tags,c.id,c.contentHash,c.embeddingModel,c.embeddingContentHash]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))||String(a[10]).localeCompare(String(b[10])))));
}
export type RetrievalOptions = KnowledgeFilter & {
  query: string; limit?: number; missionId?: string; useEmbeddings?: boolean;
  /** Caller supplies a separately budgeted embedding. Retrieval never calls an external provider. */
  queryEmbedding?: number[]; queryEmbeddingModel?: string; signal?: AbortSignal;
};
export function rankKnowledgeCandidates(args: RetrievalOptions, input: KnowledgeCandidate[]): {hits:RetrievalHit[];hybrid:boolean} {
  const candidates = input.filter(c => eligibleKnowledge(c.document,args));
  const hybrid = args.useEmbeddings !== false && validEmbedding(args.queryEmbedding)
    && args.queryEmbeddingModel === EMBEDDING_MODEL
    && candidates.some(c => c.chunk.embeddingModel===EMBEDDING_MODEL && validEmbedding(c.chunk.embedding));
  const lexicalScores = rankLexically(args.query,candidates.map(c=>({...c.document,content:c.chunk.content})));
  const semanticScores = candidates.map(c => hybrid && c.chunk.embeddingModel===EMBEDDING_MODEL && validEmbedding(c.chunk.embedding) ? Math.max(0,c.semanticScore??cosine(args.queryEmbedding!,c.chunk.embedding)) : 0);
  const ranks = (scores:number[], threshold:number) => new Map(scores.map((score,index)=>({score,index})).filter(r=>r.score>threshold).sort((a,b)=>b.score-a.score||candidates[a.index].chunk.id.localeCompare(candidates[b.index].chunk.id)).map((r,index)=>[r.index,index+1]));
  const lr=ranks(lexicalScores,0),sr=ranks(semanticScores,.24);
  const ranked=candidates.map(({document,chunk},index)=>{
    const score=hybrid ? (lr.has(index)?1/(60+lr.get(index)!):0)+(sr.has(index)?1/(60+sr.get(index)!):0) : lexicalScores[index];
    const {embedding:_vector,...safeChunk}=chunk;
    const {embedding:_documentVector,...safeDocument}=document;
    return {document:safeDocument,chunk:safeChunk,score,lexicalScore:lexicalScores[index],semanticScore:semanticScores[index],citation:`[${document.id}@${document.version}#${chunk.index}:${chunk.contentHash}] ${document.title} — ${document.sourceUri}`} satisfies RetrievalHit;
  }).filter(hit=>hit.score>0).sort((a,b)=>b.score-a.score||a.chunk.id.localeCompare(b.chunk.id));
  // One strongest chunk per source keeps repetitive documents from consuming the entire context.
  const seen=new Set<string>();
  return {hybrid,hits:ranked.filter(hit=>{if(seen.has(hit.document.id))return false;seen.add(hit.document.id);return true;}).slice(0,args.limit||6)};
}
export async function retrieveKnowledge(input: Omit<RetrievalOptions,'tenantId'> & {tenantId?:string}):Promise<RetrievalTrace> {
  if(!input.query.trim()||input.query.length>32000)throw new Error('Retrieval query must contain 1–32000 characters');
  if(input.limit!==undefined&&(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>30))throw new Error('Invalid retrieval limit');
  input.signal?.throwIfAborted();
  const args={...input,tenantId:input.tenantId||'devkiller'};
  const started=Date.now(),traceId=randomUUID();
  const candidates=await knowledgeCandidates(args,args.useEmbeddings!==false&&args.queryEmbeddingModel===EMBEDDING_MODEL?args.queryEmbedding:undefined);
  input.signal?.throwIfAborted();
  const {hits,hybrid}=rankKnowledgeCandidates(args,candidates);
  const trace:RetrievalTrace={query:args.query,tenantId:args.tenantId,domains:args.domains||[],retrievedAt:new Date().toISOString(),
    traceId,corpusHash:candidateCorpusHash(candidates),backend:'postgresql',algorithm:hybrid?'bm25-cosine-rrf-v1':'bm25-v2',
    mode:hybrid?'hybrid':'lexical-degraded',candidateCount:candidates.length,hits,durationMs:Date.now()-started,
    ...(!hybrid&&input.useEmbeddings===true?{degradedReason:'No compatible, separately budgeted query/document embeddings; lexical retrieval used.'}:{})};
  await appendRetrievalMetric({traceId,missionId:input.missionId,durationMs:trace.durationMs,mode:trace.mode,algorithm:trace.algorithm,backend:trace.backend,corpusHash:trace.corpusHash,candidateCount:candidates.length,hitIds:hits.map(h=>h.document.id),chunkIds:hits.map(h=>h.chunk!.id),chunkHashes:hits.map(h=>h.chunk!.contentHash),topScore:hits[0]?.score||0,at:trace.retrievedAt,degradedReason:trace.degradedReason});
  return trace;
}
export function formatGrounding(trace:RetrievalTrace) {
  if(!trace.hits.length)return 'No approved knowledge matched. State assumptions and do not invent citations.';
  return trace.hits.map((hit,index)=>`E${index+1} ${hit.citation}\n${hit.chunk?.content||hit.document.content}`).join('\n\n');
}

/** Explicit offline indexing operation; no read path invokes this function. */
export async function embedApprovedKnowledge(args:{tenantId?:string;maxInputTokens:number;maxCostMicros:number;priceMicrosPerMillion:number;signal?:AbortSignal}) {
  for(const value of [args.maxInputTokens,args.maxCostMicros,args.priceMicrosPerMillion])if(!Number.isSafeInteger(value)||value<=0)throw new Error('Explicit positive embedding token/cost budget and price are required');
  const normal=await knowledgeCandidates({tenantId:args.tenantId||'devkiller'});
  const platform=await knowledgeCandidates({tenantId:args.tenantId||'devkiller',includeTags:['platform-only']});
  const all=[...new Map([...normal,...platform].map(c=>[c.chunk.id,c])).values()];
  const missing=all.filter(c=>!c.chunk.embedding||c.chunk.embeddingModel!==EMBEDDING_MODEL);
  const upperTokens=missing.reduce((sum,c)=>sum+Buffer.byteLength(embeddingInput(c.document.title,c.chunk.content),'utf8')+32,0);
  const reservedCostMicros=Math.ceil(upperTokens*args.priceMicrosPerMillion/1_000_000);
  if(upperTokens>args.maxInputTokens||reservedCostMicros>args.maxCostMicros)throw new Error(`Embedding budget insufficient: upper bound ${upperTokens} tokens / ${reservedCostMicros} micro-USD`);
  if(missing.length&&!process.env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is not configured');
  let inputTokens=0,embedded=0;
  const traceId=randomUUID();
  for(let offset=0;offset<missing.length;offset+=16){
    args.signal?.throwIfAborted();
    const batch=missing.slice(offset,offset+16);
    const response=await fetch('https://api.openai.com/v1/embeddings',{method:'POST',signal:args.signal?AbortSignal.any([args.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json','X-Client-Request-Id':`${traceId}-${offset}`},body:JSON.stringify({model:EMBEDDING_MODEL,input:batch.map(c=>embeddingInput(c.document.title,c.chunk.content)),encoding_format:'float'})});
    if(!response.ok)throw new Error(`Embedding provider HTTP ${response.status}; no automatic retry`);
    const payload=await response.json() as {data?:{index:number;embedding:number[]}[];usage?:{total_tokens:number}};
    const rows=payload.data?.sort((a,b)=>a.index-b.index);
    if(!rows||rows.length!==batch.length||rows.some((r,i)=>r.index!==i||!validEmbedding(r.embedding))||!Number.isSafeInteger(payload.usage?.total_tokens))throw new Error('Invalid embedding response; vectors not promoted');
    inputTokens+=payload.usage!.total_tokens;
    for(let i=0;i<batch.length;i++){await saveChunkEmbedding(batch[i],rows[i].embedding,EMBEDDING_MODEL);embedded++;}
  }
  await appendRetrievalMetric({type:'embedding.batch',traceId,model:EMBEDDING_MODEL,inputTokens,at:new Date().toISOString()});
  return {model:EMBEDDING_MODEL,candidateCount:all.length,alreadyEmbedded:all.length-missing.length,embedded,inputTokens,reservedCostMicros,estimatedCostMicros:Math.ceil(inputTokens*args.priceMicrosPerMillion/1_000_000)};
}
