import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateFingerprint,repairProgress } from '../src/lib/server/repairProgress';
const a=[{path:'index.html',content:'A'},{path:'assets/app.js',content:'run()'}];
const b=[{path:'index.html',content:'B'},{path:'assets/app.js',content:'run()'}];
test('file ordering and descriptive metadata do not create repair progress',()=>{
  assert.equal(repairProgress(a,[...a].reverse(),new Set()).reason,'unchanged-patch');
  assert.equal(candidateFingerprint(a),candidateFingerprint(a.map(f=>({...f,description:'new'}))));
});
test('a source change can be tested, but an A-B-A repair loop stops',()=>{
  const seen=new Set([candidateFingerprint(a)]);
  assert.equal(repairProgress(a,b,seen).reason,null);
  seen.add(candidateFingerprint(b));
  assert.equal(repairProgress(b,a,seen).reason,'repeated-candidate');
});
test('deleting or adding a real file changes the fingerprint',()=>{
  assert.notEqual(candidateFingerprint(a),candidateFingerprint(a.slice(0,1)));
});
