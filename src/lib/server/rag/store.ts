import 'server-only';
import path from 'node:path';
import type { Sql } from 'postgres';
import { database } from '../database';
import { incidentContent, incidentCategory, redactKnowledge, type KnowledgeFilter } from './governance';
import { chunksForDocument, embeddingInput, hashContent, validEmbedding } from './chunks';
import type { KnowledgeCandidate, KnowledgeDocument } from './types';

export { hashContent } from './chunks';
export function ragSchema() {
  const override = process.env.DEVKILLER_RAG_TEST_SCHEMA;
  if (override && (process.env.NODE_ENV !== 'test' || !/^dk_rag_test_[a-z0-9_]+$/.test(override))) throw new Error('Invalid isolated RAG test schema');
  return override || 'dk_rag';
}
export const ragTable = (name: string) => `${ragSchema()}.${name}`;
// Legacy paths are retained for explicit import/export compatibility only; runtime never reads them.
export const knowledgePaths = { root: path.join(process.cwd(), '.devkiller', 'knowledge'), index: path.join(process.cwd(), '.devkiller', 'knowledge', 'index.json'), metrics: path.join(process.cwd(), '.devkiller', 'knowledge', 'retrieval-events.jsonl') };
const iso = (value: unknown) => value ? new Date(value as string).toISOString() : undefined;
function documentRow(row: Record<string, any>): KnowledgeDocument {
  return { id: row.id, tenantId: row.tenant_id, title: row.title, content: row.content, sourceUri: row.source_uri,
    sourceType: row.source_type, trust: row.trust, status: row.status, domains: row.domains, tags: row.tags,
    version: row.version, contentHash: row.content_hash, ingestedAt: iso(row.ingested_at)!, reviewedAt: iso(row.reviewed_at), expiresAt: iso(row.expires_at), metadata: row.metadata || {} };
}
export async function listKnowledge(): Promise<KnowledgeDocument[]> {
  const sql = database();
  return (await sql`SELECT * FROM ${sql(ragTable('documents'))} ORDER BY id`).map(documentRow);
}
/** Initialization is explicit via rag:ingest, never performed by a read. */
export const initializeKnowledgeStore = listKnowledge;

export function normalizeKnowledge(input: Omit<KnowledgeDocument, 'contentHash' | 'ingestedAt'> & Partial<Pick<KnowledgeDocument, 'ingestedAt'>>): KnowledgeDocument {
  for (const key of ['id', 'tenantId', 'title', 'content', 'sourceUri', 'version'] as const)
    if (typeof input[key] !== 'string' || !input[key].trim()) throw new Error(`Invalid knowledge ${key}`);
  if (!['official', 'internal', 'mission', 'upload'].includes(input.sourceType) || !['certified', 'verified', 'observed', 'untrusted'].includes(input.trust) || !['active', 'quarantined', 'retired'].includes(input.status)) throw new Error('Invalid knowledge governance');
  if (![input.domains, input.tags].every(values => Array.isArray(values) && values.every(value => typeof value === 'string'))) throw new Error('Invalid knowledge filters');
  for (const value of [input.reviewedAt, input.expiresAt, input.ingestedAt]) if (value && !Number.isFinite(Date.parse(value))) throw new Error('Invalid knowledge date');
  return { ...input, ...(input.sourceType === 'mission' ? { trust: 'observed' as const, status: 'quarantined' as const, reviewedAt: undefined } : {}),
    contentHash: hashContent(input.content), ingestedAt: input.ingestedAt || new Date().toISOString() };
}

export async function upsertKnowledge(input: Omit<KnowledgeDocument, 'contentHash' | 'ingestedAt'>, transaction?: Sql): Promise<KnowledgeDocument> {
  const document = normalizeKnowledge(input);
  const write = async (sql: Sql) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`rag:${document.id}`}, 0))`;
    const [previous] = await sql`SELECT * FROM ${sql(ragTable('documents'))} WHERE id=${document.id} FOR UPDATE`;
    if (previous && previous.tenant_id !== document.tenantId) throw new Error('Knowledge tenant is immutable');
    if (previous) {
      const chunks = await sql`SELECT * FROM ${sql(ragTable('chunks'))} WHERE document_id=${document.id} ORDER BY chunk_index`;
      const snapshot = { document: previous, chunks: [...chunks] };
      await sql`INSERT INTO ${sql(ragTable('document_versions'))} (document_id,snapshot_hash,snapshot)
        VALUES (${document.id},${hashContent(JSON.stringify(snapshot))},${sql.json(snapshot)}) ON CONFLICT DO NOTHING`;
    }
    await sql`INSERT INTO ${sql(ragTable('documents'))} (id,tenant_id,title,content,source_uri,source_type,trust,status,domains,tags,version,content_hash,ingested_at,reviewed_at,expires_at,metadata)
      VALUES (${document.id},${document.tenantId},${document.title},${document.content},${document.sourceUri},${document.sourceType},${document.trust},${document.status},${sql.array(document.domains)},${sql.array(document.tags)},${document.version},${document.contentHash},${document.ingestedAt},${document.reviewedAt || null},${document.expiresAt || null},${sql.json((document.metadata || {}) as any)})
      ON CONFLICT (id) DO UPDATE SET title=excluded.title,content=excluded.content,source_uri=excluded.source_uri,source_type=excluded.source_type,trust=excluded.trust,status=excluded.status,domains=excluded.domains,tags=excluded.tags,version=excluded.version,content_hash=excluded.content_hash,reviewed_at=excluded.reviewed_at,expires_at=excluded.expires_at,metadata=excluded.metadata`;
    const chunks = chunksForDocument(document);
    for (const chunk of chunks) {
      await sql`INSERT INTO ${sql(ragTable('chunks'))} (id,document_id,chunk_index,content,content_hash,document_version,document_hash,embedding,embedding_model,embedding_content_hash)
        VALUES (${chunk.id},${document.id},${chunk.index},${chunk.content},${chunk.contentHash},${chunk.documentVersion},${chunk.documentHash},${chunk.embedding ? `[${chunk.embedding.join(',')}]` : null}::vector,${chunk.embeddingModel || null},${chunk.embeddingContentHash || null})
        ON CONFLICT (id) DO NOTHING`;
    }
    await sql`DELETE FROM ${sql(ragTable('chunks'))} WHERE document_id=${document.id} AND NOT (id = ANY(${sql.array(chunks.map(c => c.id))}))`;
    return document;
  };
  return transaction ? write(transaction) : database().begin(tx => write(tx as unknown as Sql)) as Promise<KnowledgeDocument>;
}

/** Eligibility is enforced in SQL before either ranking branch sees a candidate. */
export async function knowledgeCandidates(filter: KnowledgeFilter, queryEmbedding?:number[]): Promise<KnowledgeCandidate[]> {
  const sql = database();
  const domains = filter.domains || [], include = filter.includeTags || [], exclude = filter.excludeTags || [];
  const vectorLiteral=validEmbedding(queryEmbedding)?`[${queryEmbedding.join(',')}]`:null;
  const rows = await sql`WITH eligible AS MATERIALIZED (SELECT d.*, c.id AS chunk_id,c.chunk_index,c.content AS chunk_content,c.content_hash AS chunk_hash,c.document_hash,c.document_version,c.embedding,c.embedding_model,c.embedding_content_hash
    FROM ${sql(ragTable('documents'))} d JOIN ${sql(ragTable('chunks'))} c ON c.document_id=d.id
    WHERE d.status='active' AND d.trust IN ('certified','verified') AND d.tenant_id IN ('public',${filter.tenantId})
      AND (d.expires_at IS NULL OR d.expires_at>clock_timestamp())
      AND (${include.includes('platform-only')} OR NOT ('platform-only'=ANY(d.tags)))
      AND (${!domains.length} OR d.domains && ${domains}::text[])
      AND (${!include.length} OR d.tags && ${include}::text[])
      AND NOT (d.tags && ${exclude}::text[])
      AND c.document_hash=d.content_hash AND c.document_version=d.version)
    SELECT eligible.*,embedding::text AS vector,CASE WHEN ${vectorLiteral}::vector IS NULL THEN NULL ELSE 1-(embedding <=> ${vectorLiteral}::vector) END AS semantic_score
    FROM eligible ORDER BY id,chunk_index`;
  return rows.map(row => {
    const document = documentRow(row);
    let vector: unknown;
    try { vector = row.vector ? JSON.parse(row.vector) : undefined; } catch { /* legacy vector is ineligible */ }
    const compatible = validEmbedding(vector) && row.embedding_content_hash === hashContent(embeddingInput(document.title, row.chunk_content));
    return { document, ...(compatible&&row.semantic_score!==null?{semanticScore:Number(row.semantic_score)}:{}), chunk: { id: row.chunk_id, documentId: document.id, documentVersion: row.document_version,
      documentHash: row.document_hash, content: row.chunk_content, contentHash: row.chunk_hash, index: row.chunk_index,
      ...(compatible ? { embedding: vector as number[], embeddingModel: row.embedding_model, embeddingContentHash: row.embedding_content_hash } : {}) } };
  });
}

export async function saveChunkEmbedding(candidate: KnowledgeCandidate, vector: number[], model: string) {
  if (!validEmbedding(vector) || model !== 'text-embedding-3-small') throw new Error('Unsupported embedding model or dimensions');
  const sql = database(), chunk = candidate.chunk;
  const inputHash = hashContent(embeddingInput(candidate.document.title, chunk.content));
  const rows = await sql`UPDATE ${sql(ragTable('chunks'))} c SET embedding=${`[${vector.join(',')}]`}::vector,embedding_model=${model},embedding_content_hash=${inputHash}
    FROM ${sql(ragTable('documents'))} d WHERE c.id=${chunk.id} AND c.content_hash=${chunk.contentHash} AND c.document_id=d.id
      AND d.content_hash=${chunk.documentHash} AND d.version=${chunk.documentVersion} AND d.title=${candidate.document.title}
      AND d.status='active' AND d.trust IN ('certified','verified') AND (d.expires_at IS NULL OR d.expires_at>clock_timestamp()) RETURNING c.id`;
  if (rows.length !== 1) throw new Error('Knowledge changed while embedding; stale vector discarded');
}

/** Restores one recorded revision transactionally and retains the current revision in history. */
export async function restoreKnowledgeVersion(documentId: string, snapshotHash: string) {
  return database().begin(async transaction => {
    const sql=transaction as unknown as Sql;
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`rag:${documentId}`},0))`;
    const [saved]=await sql`SELECT snapshot FROM ${sql(ragTable('document_versions'))} WHERE document_id=${documentId} AND snapshot_hash=${snapshotHash}`;
    if(!saved)throw new Error('Knowledge revision not found');
    const snapshot=saved.snapshot as {document:Record<string,any>;chunks:Record<string,any>[]};
    const document=documentRow(snapshot.document);
    if(document.id!==documentId)throw new Error('Knowledge snapshot identity mismatch');
    await upsertKnowledge(document,sql);
    for(const chunk of snapshot.chunks){
      let vector:unknown;try{vector=typeof chunk.embedding==='string'?JSON.parse(chunk.embedding):chunk.embedding;}catch{continue;}
      if(!validEmbedding(vector)||chunk.embedding_model!=='text-embedding-3-small'||chunk.embedding_content_hash!==hashContent(embeddingInput(document.title,chunk.content)))continue;
      await sql`UPDATE ${sql(ragTable('chunks'))} SET embedding=${`[${vector.join(',')}]`}::vector,embedding_model=${chunk.embedding_model},embedding_content_hash=${chunk.embedding_content_hash}
        WHERE id=${chunk.id} AND document_id=${documentId} AND content_hash=${chunk.content_hash} AND document_hash=${document.contentHash} AND document_version=${document.version}`;
    }
    return document;
  });
}

export async function recordMissionMemory(args: { missionId: string; tenantId?: string; title: string; content: string; success: boolean; domains?: string[]; tags?: string[] }) {
  const content = incidentContent(args.content, args.success);
  return upsertKnowledge({ id: `mission-${args.missionId}-${hashContent(content).slice(0,16)}`, tenantId: args.tenantId || `mission:${args.missionId}`, title: redactKnowledge(args.title), content, sourceUri: `mission://${args.missionId}`, sourceType: 'mission', trust: 'observed', status: 'quarantined', domains: args.domains || ['builder','qa','recovery'], tags: [...(args.tags || []),'requires-review',incidentCategory(args.content)], version: '2' });
}
export async function appendRetrievalMetric(event: Record<string, unknown>) {
  if (typeof event.traceId !== 'string') throw new Error('Retrieval trace identity required');
  const safe = Object.fromEntries(['traceId','missionId','durationMs','mode','algorithm','backend','corpusHash','candidateCount','hitIds','chunkIds','chunkHashes','topScore','at','degradedReason','type','inputTokens','model'].filter(k => event[k] !== undefined).map(k => [k,event[k]]));
  const sql = database();
  await sql`INSERT INTO ${sql(ragTable('retrieval_events'))} (trace_id,event) VALUES (${event.traceId},${sql.json(safe as any)}) ON CONFLICT (trace_id) DO NOTHING`;
}
