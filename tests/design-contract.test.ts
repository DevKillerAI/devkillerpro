import test from 'node:test';
import assert from 'node:assert/strict';
import {DESIGN_DELIVERY_CONTRACT} from '../src/lib/server/designContract';
test('design policy distinguishes functional, visual and asset evidence',()=>{
  for(const text of ['visual verification unavailable','not completion','not a portable asset','not visual approval','not mandatory templates','current dated evidence']) assert.ok(DESIGN_DELIVERY_CONTRACT.includes(text),text);
});
