import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RuntimeStartupError} from '../src/lib/server/runtimeDiagnostics';
test('startup diagnostics preserve SQL error and process exit, not secrets',()=>{
 const e=new RuntimeStartupError({Running:false,ExitCode:1},'','Error: table financial_entries has 9 columns but 8 values were supplied\npassword=hunter2',502);
 assert.equal(e.code,1);assert.match(e.message,/9 columns but 8 values/);assert.match(e.message,/last HTTP: 502/);
 assert.ok(!e.message.includes('hunter2'));assert.ok(!e.stderr.includes('hunter2'));
});
test('readiness failure does not invent an exit code or error output',()=>{
 const e=new RuntimeStartupError({},'','');assert.equal(e.code,undefined);assert.match(e.message,/no diagnostic output/);
});
