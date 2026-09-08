import test from 'node:test';
import assert from 'node:assert/strict';
import {safeReturnPath} from '../src/lib/auth-navigation';
test('Login resumes the intended DK route with its query',()=>{
  assert.equal(safeReturnPath('/create?run=abc'),'/create?run=abc');
  assert.equal(safeReturnPath('/tools/audio/convert'),'/tools/audio/convert');
});
test('Login cannot return to another origin or an authentication loop',()=>{
  for(const path of ['https://evil.test','//evil.test','/\\evil.test','/login?next=/login','/api/auth/logout','/\n/evil.test',null])assert.equal(safeReturnPath(path),'/create');
});
