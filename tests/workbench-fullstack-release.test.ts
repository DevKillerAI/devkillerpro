import test from 'node:test';
import assert from 'node:assert/strict';
import {assertFullstackRelease} from '../src/lib/server/generator/workbenchFullstackRelease';
import {assessWorkbenchCapabilities} from '../src/lib/server/generator/workbenchContract';

test('private database support reports owner isolation without claiming team roles',()=>{
  const plan=assessWorkbenchCapabilities('Private notes with email login and PostgreSQL database',{fullstackDatabase:true});
  assert.ok(plan.available.includes('database.postgres'));
  assert.ok(plan.available.includes('authorization.owner'));
  assert.ok(!plan.available.includes('auth.rbac'));
});

test('a compiled app cannot mask failed database, account or functional verification',()=>{
  for(const id of ['platform:persistence','platform:authorization-cross-owner','platform:auth-two-users','journey:create-record','requirement:feature.server-persistence']){
    const report={status:'failed',failures:[id],checks:[{id:'platform:build',passed:true},{id,passed:false}]};
    const original=JSON.stringify(report);
    assert.throws(()=>assertFullstackRelease(report),/cannot be promoted/);
    assert.equal(JSON.stringify(report),original);
  }
});
test('inconsistent success summaries and unavailable verification remain blocked',()=>{
  assert.throws(()=>assertFullstackRelease({status:'passed',failures:[],checks:[{id:'platform:persistence',passed:false}]}));
  assert.throws(()=>assertFullstackRelease({status:'passed',failures:['Account check failed'],checks:[]}));
  assert.throws(()=>assertFullstackRelease({status:'unavailable',failures:[],checks:[]}));
});
test('successful verification is preserved unchanged',()=>{
  const report={status:'passed',failures:[],checks:[{id:'platform:persistence',passed:true},{id:'platform:auth-two-users',passed:true}]};
  const original=JSON.stringify(report);
  assert.doesNotThrow(()=>assertFullstackRelease(report));
  assert.equal(JSON.stringify(report),original);
});
