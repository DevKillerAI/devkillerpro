import {test} from 'node:test';
import assert from 'node:assert/strict';
import {migrationFingerprint,isSupabaseNext} from '../src/lib/server/supabaseRuntime';
test('Migration identity ignores UI metadata and file ordering, not SQL changes',()=>{
 const a=[{path:'b.sql',content:'select 2;',language:'sql',description:'Documentation'}, {path:'a.sql',content:'select 1;'}];
 const b=[{path:'a.sql',content:'select 1;'}, {path:'b.sql',content:'select 2;'}];
 assert.equal(migrationFingerprint(a),migrationFingerprint(b));
 assert.notEqual(migrationFingerprint(b),migrationFingerprint([{path:'a.sql',content:'select 3;'}]));
});
test('Next/Supabase preview needs both Next entry and migrations',()=>{
 assert.equal(isSupabaseNext([{path:'src/app/page.tsx'},{path:'supabase/migrations/1.sql'}]),true);
 assert.equal(isSupabaseNext([{path:'src/app/page.tsx'}]),false);
});
