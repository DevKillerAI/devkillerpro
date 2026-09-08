import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {writeFileSnapshot} from '../src/lib/server/fileSnapshot';
test('A migrated candidate contains only current files and preserves its previous snapshot',async()=>{
 const temp=await mkdtemp(path.join(tmpdir(),'dk-snapshot-')),base=path.join(temp,'build-1');
 try{
  await writeFileSnapshot(base,[{path:'functions/firebase.ts',content:'old'}]);
  await writeFileSnapshot(base,[{path:'src/app/page.tsx',content:'new'}]);
  await assert.rejects(readFile(path.join(base,'functions/firebase.ts')));
  assert.equal(await readFile(path.join(base,'src/app/page.tsx'),'utf8'),'new');
  const archive=(await readdir(temp)).find(n=>n.startsWith('.build-1-previous-'))!;
  assert.equal(await readFile(path.join(temp,archive,'functions/firebase.ts'),'utf8'),'old');
  await assert.rejects(writeFileSnapshot(base,[{path:'../escape',content:'bad'}]));
  assert.equal(await readFile(path.join(base,'src/app/page.tsx'),'utf8'),'new');
 }finally{await rm(temp,{recursive:true,force:true});}
});
