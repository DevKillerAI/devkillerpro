import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {checkLocalRelease} from '../../src/lib/server/localRuntime';
test('release scripts execute in an offline disposable copy and expose failures',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'dk-release-test-'));
  try{
    await writeFile(path.join(root,'package.json'),JSON.stringify({scripts:{build:'node build.cjs'}}));
    await writeFile(path.join(root,'build.cjs'),"require('node:fs').mkdirSync('dist'); console.log('release-created');");
    const output=await checkLocalRelease(root);
    assert.match(output,/release-created/);
    await assert.rejects(access(path.join(root,'dist')));
    await writeFile(path.join(root,'build.cjs'),"throw new Error('release-blocker');");
    await assert.rejects(checkLocalRelease(root),/release-blocker/);
  }finally{await rm(root,{recursive:true,force:true});}
});
