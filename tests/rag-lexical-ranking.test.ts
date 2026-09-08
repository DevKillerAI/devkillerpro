import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankLexically} from '../src/lib/server/rag/lexicalRanking';
import type {KnowledgeDocument} from '../src/lib/server/rag/types';
const doc=(title:string,content:string)=>({title,content,tags:[]} as unknown as KnowledgeDocument);
test('fallback favours specific terms and does not match substrings',()=>{
 const scores=rankLexically('canvas export',[doc('canvas export','canvas export'),doc('unrelated','canvassing exportation')]);
 assert.ok(scores[0]>0);assert.equal(scores[1],0);
 assert.deepEqual(rankLexically('the and how',[doc('canvas','canvas')]),[0]);
 assert.deepEqual(rankLexically('canvas',[]),[]);
});
