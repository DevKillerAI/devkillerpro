import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {listKnowledge} from '../src/lib/server/rag/store';
import {retrieveKnowledge} from '../src/lib/server/rag/retrieval';
import {closeDatabase} from '../src/lib/server/database';

const cases = [
 ['security','How should generated application security be verified?','owasp-asvs-5-local'],
 ['qa','What evidence is needed before delivering a mission?','policy-delivery-gates-v1'],
 ['security','How do we prevent poisoned RAG content from affecting production?','policy-rag-trust-v1'],
 ['recovery','How should a failed generated app be repaired?','policy-repair-v1'],
 ['intake','What requirements should mission intake collect?','policy-intake-v1'],
 ['database','How must Supabase tables be protected and tested?','supabase-rls-official-2026'],
 ['authentication','How should Next.js use Supabase authentication securely?','supabase-nextjs-auth-official-2026'],
 ['security','How must Firebase Firestore owner access and denied operations be verified?','firebase-firestore-rules-official-2026'],
 ['database','What is required for durable local SQLite persistence?','sqlite-local-foundation-v1'],
 ['database','Concurrent inventory stock transactions serialization retry','postgres-concurrency-retry-v1'],
 ['database','Two buyers request the last item; what happens after a serialization failure?','postgres-concurrency-retry-v1'],
 ['authentication','Supabase SSR cache session refresh Set-Cookie isolation','supabase-ssr-cache-isolation-v1'],
 ['security','A visitor gets another account after a CDN cached a refreshed session','supabase-ssr-cache-isolation-v1'],
 ['design','Canvas CORS image export SecurityError tainted bitmap','canvas-cors-export-v1'],
 ['recovery','A foreign image displays but downloading the canvas fails','canvas-cors-export-v1'],
];
async function main(){
 const label=process.argv[2]; if(!label||!/^[a-z0-9-]+$/.test(label))throw new Error('Supply a safe report label');
 // Controlled lexical benchmark: no paid embedding or judge calls; hybrid requires separate validation.
 delete process.env.OPENAI_API_KEY;
 const docs=await listKnowledge();const rows=[];
 for(const [domain,query,expected] of cases){const started=Date.now();const result=await retrieveKnowledge({query,domains:[domain],limit:3});rows.push({query,reference_context_ids:[expected],retrieved_context_ids:result.hits.map(h=>h.document.id),durationMs:Date.now()-started,mode:result.mode,referencePresent:docs.some(d=>d.id===expected)});}
 const report={label,at:new Date().toISOString(),benchmark:'development-set-v1-not-held-out',k:3,limitation:'One anchor per case; other relevant documents are not exhaustively labelled. Precision is anchor-only, not overall relevance.',corpusHash:createHash('sha256').update(JSON.stringify(docs.map(d=>[d.id,d.contentHash,d.status]).sort())).digest('hex'),rows};
 const directory=path.join(process.cwd(),'.devkiller','evaluations');await mkdir(directory,{recursive:true});const target=path.join(directory,`rag-${label}.json`);await writeFile(target,JSON.stringify(report,null,2));console.log(JSON.stringify({target,hits:rows.filter(r=>r.retrieved_context_ids.includes(r.reference_context_ids[0])).length,total:rows.length}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(closeDatabase);
