import test from 'node:test';
import assert from 'node:assert/strict';
const {assessLayout}=require('../scripts/generator-v2-runner/workbench.cjs');
test('small cosmetic overflow is advisory, but clipped actions and severe overflow block',()=>{
  assert.deepEqual(assessLayout({overflow:2,clippedControls:0}),{blocking:false,advisory:false});
  for(const overflow of [3,8,16])assert.deepEqual(assessLayout({overflow,clippedControls:0}),{blocking:false,advisory:true});
  for(const overflow of [17,320])assert.equal(assessLayout({overflow,clippedControls:0}).blocking,true);
  assert.equal(assessLayout({overflow:0,clippedControls:1}).blocking,true);
  assert.throws(()=>assessLayout({overflow:NaN,clippedControls:0}));
});
