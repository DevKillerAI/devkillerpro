-- DevKiller V2 Industrial RAG: PostgreSQL + pgvector Consolidation
CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS dk_rag;

-- 1. Knowledge Documents Table
CREATE TABLE IF NOT EXISTS dk_rag.documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_uri TEXT NOT NULL,
  source_type TEXT NOT NULL,
  trust TEXT NOT NULL CHECK (trust IN ('certified', 'verified', 'observed', 'untrusted')),
  status TEXT NOT NULL CHECK (status IN ('active', 'quarantined', 'retired')),
  domains TEXT[] NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  version TEXT NOT NULL DEFAULT '1',
  content_hash TEXT NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  reviewed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  fts TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(content, '')), 'B')
  ) STORED
);

-- 2. Knowledge Chunks with Vector Embeddings
CREATE TABLE IF NOT EXISTS dk_rag.chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES dk_rag.documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),
  embedding_model TEXT,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 3. RAG Retrieval Metrics & Evaluation Runs
CREATE TABLE IF NOT EXISTS dk_rag.evaluations (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  expected_hit_ids TEXT[] NOT NULL,
  retrieved_hit_ids TEXT[] NOT NULL,
  recall_at_5 NUMERIC(6, 4),
  precision_at_5 NUMERIC(6, 4),
  mode TEXT NOT NULL,
  latency_ms NUMERIC(10, 2),
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Indexes for Speed, Filtering and Isolation
CREATE INDEX IF NOT EXISTS idx_dk_rag_docs_fts ON dk_rag.documents USING GIN (fts);
CREATE INDEX IF NOT EXISTS idx_dk_rag_docs_status_trust ON dk_rag.documents (status, trust);
CREATE INDEX IF NOT EXISTS idx_dk_rag_docs_tenant ON dk_rag.documents (tenant_id);
CREATE INDEX IF NOT EXISTS idx_dk_rag_docs_domains ON dk_rag.documents USING GIN (domains);
CREATE INDEX IF NOT EXISTS idx_dk_rag_chunks_doc ON dk_rag.chunks (document_id);
CREATE INDEX IF NOT EXISTS idx_dk_rag_chunks_embedding ON dk_rag.chunks USING hnsw (embedding vector_cosine_ops);
