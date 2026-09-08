import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runtimeScriptFailures} from '../src/lib/server/runtimeScriptContract';
test('isolated runtime blocks incompatible inline handlers without loosening CSP',()=>{
 const runtime={path:'devkiller.runtime.json',content:'{}'};
 assert.equal(runtimeScriptFailures([runtime,{path:'public/index.html',content:'<button onclick="save()">Save</button>'}]).length,1);
 assert.equal(runtimeScriptFailures([runtime,{path:'public/index.html',content:'<!-- <button onclick="x()"> --><button data-action="save">Save</button><script src="/app.js"></script>'}]).length,0);
 assert.equal(runtimeScriptFailures([{path:'index.html',content:'<button onclick="save()">Save</button>'}]).length,0);
});
