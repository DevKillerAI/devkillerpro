import {test} from 'node:test';
import assert from 'node:assert/strict';
import {triageQuarantine} from '../src/lib/server/rag/quarantineTriage';
import type {KnowledgeDocument} from '../src/lib/server/rag/types';
test('triage never promotes symptoms, success labels or duplicate observations',()=>{
 const base={tenantId:'one',status:'quarantined',tags:[],content:'Recovery attempts exhausted: the artifact still failed static or functional validation'} as unknown as KnowledgeDocument;
 const r=triageQuarantine([{...base,id:'a'},{...base,id:'b'},{...base,id:'c',tenantId:'two'},{...base,id:'d',tags:['verified-delivery'],content:'Success'}]);
 assert.deepEqual(r.map(x=>x.disposition),['insufficient-diagnostic','duplicate-text','insufficient-diagnostic','delivery-history']);
 assert.ok(r.every(x=>x.action==='retain-quarantined'&&!x.manuallyVerified));
 assert.equal(r[1].duplicateOf,'a');
});
