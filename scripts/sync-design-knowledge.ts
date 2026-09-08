import {initializeKnowledgeStore} from '../src/lib/server/rag/store';
import {retrieveKnowledge} from '../src/lib/server/rag/retrieval';
import assert from 'node:assert/strict';
async function main(){
 const documents=await initializeKnowledgeStore();
 console.log(JSON.stringify(documents.filter(d=>d.id==='policy-visual-quality-v1'||d.id.startsWith('design-')).map(d=>({id:d.id,version:d.version,status:d.status,trust:d.trust,source:d.sourceUri}))));
 // This smoke test deliberately uses lexical retrieval; no paid model request is needed.
 delete process.env.OPENAI_API_KEY;
 const trace=await retrieveKnowledge({query:'design typography hierarchy spacing responsive visual-quality',domains:['design'],limit:6});
 assert.ok(trace.hits.some(h=>h.document.id==='policy-visual-quality-v1'&&h.document.version==='2.0.0'));
 console.log(JSON.stringify({retrievalTest:'passed',mode:trace.mode,ids:trace.hits.map(h=>h.document.id)}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
