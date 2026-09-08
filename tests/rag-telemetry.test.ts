import {test} from 'node:test';
import assert from 'node:assert/strict';
import {retrievalOtlp} from '../src/lib/server/rag/telemetry';
test('OTLP snapshot allowlists metadata and hashes identifiers',()=>{
 const event={at:'2026-09-03T00:00:00Z',durationMs:23,traceId:'trace',mode:'hybrid',hitIds:['private-document'],missionId:'private-mission',query:'sk-secret',authorization:'Bearer token'};
 const span=retrievalOtlp(event);const json=JSON.stringify(span);
 for(const secret of ['private-document','private-mission','sk-secret','Bearer token'])assert.ok(!json.includes(secret));
 assert.match(span.traceId,/^[a-f0-9]{32}$/);assert.match(span.spanId,/^[a-f0-9]{16}$/);
 assert.equal(BigInt(span.endTimeUnixNano)-BigInt(span.startTimeUnixNano),23_000_000n);
 assert.throws(()=>retrievalOtlp({...event,durationMs:-1}));
});
