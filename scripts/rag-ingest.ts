import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Sql } from 'postgres';
import { database, closeDatabase } from '../src/lib/server/database';
import { CERTIFIED_SEED } from '../src/lib/server/rag/seed';
import { hashContent, normalizeKnowledge, upsertKnowledge, ragTable, ragSchema } from '../src/lib/server/rag/store';
import type { KnowledgeDocument } from '../src/lib/server/rag/types';

async function main() {
  const url=new URL(process.env.DATABASE_URL||'invalid');
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('This migration command requires the configured local platform database');
  if(ragSchema()!=='dk_rag')throw new Error('Production import cannot target a test schema');
  const sql=database();
  let raw='[]';
  try{raw=await readFile(path.join(process.cwd(),'.devkiller','knowledge','index.json'),'utf8');}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const parsed:unknown=JSON.parse(raw);
  if(!Array.isArray(parsed))throw new Error('Legacy knowledge index is not an array');
  const legacy=parsed.map(row=>normalizeKnowledge(row as KnowledgeDocument));
  const documents=[...new Map([...CERTIFIED_SEED.map(d=>normalizeKnowledge(d)),...legacy].map(d=>[d.id,d])).values()];
  const sourceHash=hashContent(raw),seedHash=hashContent(JSON.stringify(CERTIFIED_SEED));
  const backup=path.join(process.cwd(),'.devkiller','backups',`rag-postgres-${Date.now()}`);
  await mkdir(backup,{recursive:true});
  await writeFile(path.join(backup,'legacy-index.json'),raw,{flag:'wx'});
  const existing:Record<string,unknown>={};
  for(const table of ['documents','chunks','evaluations','document_versions','imports','retrieval_events','evaluation_runs']){
    const [present]=await sql`SELECT to_regclass(${ragTable(table)}) AS relation`;
    if(present.relation)existing[table]=[...await sql`SELECT * FROM ${sql(ragTable(table))}`];
  }
  await writeFile(path.join(backup,'database-before.json'),JSON.stringify(existing,null,2),{flag:'wx'});
  const migrationFiles=['20260905200000_rag_core_pgvector.sql','20260905210000_rag_runtime.sql'];
  const migrations=await Promise.all(migrationFiles.map(file=>readFile(path.join('supabase','migrations',file),'utf8')));
  let imported=0,retainedServerRevisions=0;
  await sql.begin(async transaction=>{
    const tx=transaction as unknown as Sql;
    await tx`SELECT pg_advisory_xact_lock(hashtextextended('dk-rag-import',0))`;
    for(const migration of migrations)await tx.unsafe(migration);
    const [done]=await tx`SELECT source_hash FROM dk_rag.imports WHERE source_hash=${sourceHash}`;
    const [priorImport]=await tx`SELECT source_hash FROM dk_rag.imports WHERE source_name='legacy-index.json' LIMIT 1`;
    // An already imported local snapshot must never overwrite later server edits.
    if(!done){
      for(const document of documents){
        const [existing]=await tx`SELECT id FROM dk_rag.documents WHERE id=${document.id}`;
        if(priorImport&&existing){retainedServerRevisions++;continue;}
        await upsertKnowledge(document,tx);imported++;
      }
      await tx`INSERT INTO dk_rag.imports(source_hash,source_name,payload) VALUES (${sourceHash},'legacy-index.json',${tx.json(parsed as any)})`;
    }
    // Retain the exact seed snapshot without silently promoting/replacing an existing review.
    await tx`INSERT INTO dk_rag.imports(source_hash,source_name,payload) VALUES (${seedHash},'certified-seed',${tx.json(CERTIFIED_SEED as any)}) ON CONFLICT DO NOTHING`;
    const [counts]=await tx`SELECT count(*)::int AS count FROM dk_rag.documents`;
    if(counts.count<documents.length)throw new Error('Migration document count would lose source records');
  });
  const [counts]=await sql`SELECT (SELECT count(*)::int FROM dk_rag.documents) AS documents,(SELECT count(*)::int FROM dk_rag.chunks) AS chunks,(SELECT count(*)::int FROM dk_rag.chunks WHERE embedding IS NOT NULL AND embedding_content_hash IS NOT NULL) AS bound_embeddings`;
  console.log(JSON.stringify({backend:'postgresql',imported,retainedServerRevisions,...counts,backup,sourceHash,paidCalls:0,legacyVectors:'Preserved in import snapshots and backup; vectors without exact input hash are not promoted.'},null,2));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'RAG import failed');process.exitCode=1;}).finally(closeDatabase);
