import test from 'node:test';
import assert from 'node:assert/strict';
import {containerIdentityArgs} from '../src/lib/server/generator/containerIdentity';
test('Linux containers use the artifact-owning unprivileged service account',()=>{
  assert.deepEqual(containerIdentityArgs('linux',997,995),['--user=997:995','--env','HOME=/tmp']);
  for(const [uid,gid] of [[0,995],[997,0],[-1,995],[1.5,995],[NaN,995]])assert.throws(()=>containerIdentityArgs('linux',uid,gid));
});
test('Windows retains the reviewed image identity',()=>assert.deepEqual(containerIdentityArgs('win32'),['--user=1000:1000']));
