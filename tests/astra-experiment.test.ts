import test from 'node:test';
import assert from 'node:assert/strict';
import {PILOT_MODEL,preparePilotRequest,estimatePilotCostMicros} from '../src/lib/server/generator/pilotProvider';

test('Astra experiment uses Astra and its own conservative price reservation',{skip:process.env.DEVKILLER_ASTRA_EXPERIMENT!=='1'},()=>{
  assert.equal(PILOT_MODEL,'gpt-6-astra');
  const request=preparePilotRequest({instructions:'Return JSON.',input:'Test',schemaName:'test',schema:{type:'object',additionalProperties:false,properties:{},required:[]},maxOutputTokens:16000});
  assert.equal(request.body.model,'gpt-6-astra');
  assert.equal(request.reservedMicros,request.inputTokenUpperBound*25+16000*75);
  assert.equal(estimatePilotCostMicros({inputTokens:1000,cachedInputTokens:200,cacheWriteTokens:100,cacheWriteTokensObserved:true,outputTokens:100,reasoningTokens:50}),13450);
});
