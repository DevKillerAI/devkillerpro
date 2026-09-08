import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoveryRouting} from '../src/lib/server/recoveryRouting';
test('Pantry missing live evidence and concurrency evidence never trigger source repair',()=>{
 const issues=[
  {severity:'major',file:'README.md',description:'Required live core-journey evidence is absent. The available evidence proves the isolated PostgreSQL migration/pgTAP suite and Next.js production compilation, but browser checks did not run.'},
  {severity:'major',file:'README.md',description:'The repository contains credible documented two-session procedures, but no executed concurrency evidence is supplied.'},
  {severity:'minor',file:'src/app/page.tsx',description:'The reservation dialog does not manage initial focus.'},
 ];
 const routed=recoveryRouting(issues);
 assert.equal(routed.route,'verification');assert.equal(routed.verification.length,2);assert.equal(routed.defects.length,0);
 assert.equal(recoveryRouting([...issues,{severity:'major',file:'rpc.sql',description:'Concurrent requests decrement inventory twice.'}]).route,'repair');
 assert.equal(recoveryRouting([{severity:'major',file:'app.ts',description:'Session missing because the sign-in handler deletes the token.'}]).route,'repair');
});
