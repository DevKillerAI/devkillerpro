import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localSessionContractFailures} from '../src/lib/server/supabaseSessionContract';
test('managed local projects must use matching project-specific SSR cookie names',()=>{
 const id='benchmark-firebase-orders-20260902';
 const files=['client','server'].map(n=>({path:`src/lib/supabase/${n}.ts`,content:'cookieOptions: { name: "dk-queue-pantry-auth" }'}));
 assert.deepEqual(localSessionContractFailures(id,files),[]);
 assert.equal(localSessionContractFailures(id,[]).length,2);
 assert.equal(localSessionContractFailures(id,[files[0],{...files[1],content:'cookieOptions: {name: "dk-room-ledger-auth"}'}]).length,1);
 assert.deepEqual(localSessionContractFailures('unmanaged',[]),[]);
});
