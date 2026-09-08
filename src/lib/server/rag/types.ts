export type KnowledgeTrust = "certified" | "verified" | "observed" | "untrusted";
export type KnowledgeStatus = "active" | "quarantined" | "retired";

export interface KnowledgeDocument {
  id: string;
  tenantId: string;
  title: string;
  content: string;
  sourceUri: string;
  sourceType: "official" | "internal" | "mission" | "upload";
  trust: KnowledgeTrust;
  status: KnowledgeStatus;
  domains: string[];
  tags: string[];
  version: string;
  contentHash: string;
  ingestedAt: string;
  reviewedAt?: string;
  expiresAt?: string;
  embedding?: number[];
  embeddingModel?: string;
  embeddingContentHash?: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  documentVersion: string;
  documentHash: string;
  content: string;
  contentHash: string;
  index: number;
  embedding?: number[];
  embeddingModel?: string;
  embeddingContentHash?: string;
}
export interface KnowledgeCandidate { document: KnowledgeDocument; chunk: KnowledgeChunk; semanticScore?: number }

export interface RetrievalHit {
  document: Omit<KnowledgeDocument, "embedding">;
  score: number;
  lexicalScore: number;
  semanticScore: number;
  citation: string;
  chunk?: Omit<KnowledgeChunk, "embedding">;
}

export interface RetrievalTrace {
  query: string;
  tenantId: string;
  domains: string[];
  retrievedAt: string;
  mode: "hybrid" | "lexical-degraded";
  candidateCount: number;
  hits: RetrievalHit[];
  traceId?: string;
  corpusHash?: string;
  algorithm?: "bm25-v2" | "bm25-cosine-rrf-v1";
  backend?: "postgresql";
  durationMs?: number;
  degradedReason?: string;
}
