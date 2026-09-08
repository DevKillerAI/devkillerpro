-- Additive upgrade. Existing rows and historical (mislabelled) metrics are retained.
ALTER TABLE dk_rag.documents ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
ALTER TABLE dk_rag.chunks ADD COLUMN IF NOT EXISTS document_version TEXT;
ALTER TABLE dk_rag.chunks ADD COLUMN IF NOT EXISTS document_hash TEXT;
ALTER TABLE dk_rag.chunks ADD COLUMN IF NOT EXISTS embedding_content_hash TEXT;
CREATE TABLE IF NOT EXISTS dk_rag.document_versions (
  document_id TEXT NOT NULL, snapshot_hash TEXT NOT NULL, snapshot JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY (document_id, snapshot_hash)
);
CREATE TABLE IF NOT EXISTS dk_rag.imports (
  source_hash TEXT PRIMARY KEY, source_name TEXT NOT NULL, payload JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS dk_rag.retrieval_events (
  trace_id TEXT PRIMARY KEY, event JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS dk_rag.evaluation_runs (
  id TEXT PRIMARY KEY, dataset TEXT NOT NULL, corpus_hash TEXT NOT NULL, report JSONB NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_dk_rag_events_recorded ON dk_rag.retrieval_events(recorded_at);
CREATE INDEX IF NOT EXISTS idx_dk_rag_versions_document ON dk_rag.document_versions(document_id);
REVOKE ALL ON SCHEMA dk_rag FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA dk_rag FROM PUBLIC;
ALTER TABLE dk_rag.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE dk_rag.chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE dk_rag.document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dk_rag.imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE dk_rag.retrieval_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE dk_rag.evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dk_rag.evaluation_runs ENABLE ROW LEVEL SECURITY;
