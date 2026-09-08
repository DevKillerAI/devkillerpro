import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyWorkspace } from '../src/lib/workspace/projectWorkspace';
import { hasDeliveredPreview, preservePreviewIdentity } from '../src/lib/workspace/editorContinuity';

const delivered={...createEmptyWorkspace(),sourceFiles:[{path:'index.html',name:'index.html',language:'html',description:'',content:'Working app'}],evidence:[{stage:'build',status:'verified' as const,at:'2026-09-02',summary:'Passed'}]};
test('polling a running revision keeps the approved app visible',()=>{
  assert.equal(hasDeliveredPreview({...delivered,status:'MEETING_DONE'}),true);
});
test('failed revision keeps approved delivery, but an initial failed build does not',()=>{
  assert.equal(hasDeliveredPreview({...delivered,status:'FAILED'}),true);
  assert.equal(hasDeliveredPreview({...delivered,status:'FAILED',evidence:[]}),false);
  assert.equal(hasDeliveredPreview({...delivered,status:'READY',sourceFiles:[]}),false);
});
test('unchanged polling does not recreate preview props; changed files do',()=>{
  const before={appTitle:'Meme Studio',sourceFiles:delivered.sourceFiles};
  assert.equal(preservePreviewIdentity(before,structuredClone(before)),before);
  assert.notEqual(preservePreviewIdentity(before,{...before,sourceFiles:[]}),before);
});
