import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DESIGN_QUALITY_RULES} from '../src/lib/knowledge/designGuidance';
import {DESIGN_DELIVERY_CONTRACT} from '../src/lib/server/designContract';
import {CERTIFIED_SEED} from '../src/lib/server/rag/seed';
test('active design contract uses the canonical context-specific rules',()=>{
 assert.ok(DESIGN_DELIVERY_CONTRACT.includes(DESIGN_QUALITY_RULES));
 assert.doesNotMatch(DESIGN_QUALITY_RULES,/Never playful|A Delivery application MUST/);
});
test('RAG upgrades the existing baseline without duplicate policy and retains reviewed sources',()=>{
 const policies=CERTIFIED_SEED.filter(d=>d.id==='policy-visual-quality-v1');
 assert.equal(policies.length,1);assert.equal(policies[0].version,'2.0.0');assert.equal(policies[0].content,DESIGN_QUALITY_RULES);
 const sources=CERTIFIED_SEED.filter(d=>d.id.startsWith('design-')&&d.sourceUri.startsWith('https://'));
 assert.ok(sources.length>=3);assert.ok(sources.every(d=>d.sourceType==='official'&&d.reviewedAt&&d.status==='active'));
 assert.match(DESIGN_QUALITY_RULES,/pending verification, not defective source/);
 assert.match(DESIGN_QUALITY_RULES,/not a universal palette/);
});
