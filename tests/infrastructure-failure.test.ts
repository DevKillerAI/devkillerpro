import test from 'node:test';
import assert from 'node:assert/strict';
import {isInfrastructureFailure} from '../src/lib/server/generator/infrastructureFailure';
test('permission and daemon failures are infrastructure faults, not model repair requests',()=>{
  assert.equal(isInfrastructureFailure('Cannot read directory ../../candidate/src: permission denied'),true);
  assert.equal(isInfrastructureFailure('Cannot connect to the Docker daemon'),true);
  assert.equal(isInfrastructureFailure('Unexpected token at src/App.tsx:31'),false);
  assert.equal(isInfrastructureFailure('Could not resolve ./MissingComponent'),false);
});
