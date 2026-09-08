import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exactSourceEdits} from '../src/lib/server/exactSourceEdits';
test('localized edit preserves unrelated bytes and literal replacement tokens',()=>{
 const files=[{path:'server.mjs',content:'before\nold\nafter'}];
 assert.equal(exactSourceEdits(files,[{path:'server.mjs',search:'old',replacement:'new $&'}])[0].content,'before\nnew $&\nafter');
 assert.equal(files[0].content,'before\nold\nafter');
});
test('ambiguous, missing and conflicting edits fail closed',()=>{
 const files=[{path:'a.js',content:'x x'}];
 for(const search of ['x','missing',''])assert.throws(()=>exactSourceEdits(files,[{path:'a.js',search,replacement:'y'}]));
 assert.throws(()=>exactSourceEdits(files,[{path:'a.js',search:'x x',replacement:'y'}],['a.js']));
});
