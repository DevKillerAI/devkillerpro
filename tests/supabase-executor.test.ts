import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pgTapFailures} from '../src/lib/server/supabaseExecutor';
test('SQL checks require actual pgTAP evidence and exact plan counts',()=>{
 assert.deepEqual(pgTapFailures('1..2\nok 1 - first\nok 2 - second'),[]);
 assert.ok(pgTapFailures('1..1\nok 1\nok 2').length);
 assert.ok(pgTapFailures('1..1\nnot ok 1 - denied').length);
 assert.ok(pgTapFailures('CREATE TABLE').length);
 assert.deepEqual(pgTapFailures('1..1\nok 1\n1..1\nok 1'),[]);
});
