import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {checkRuntimeStartup} from '../../src/lib/server/localRuntime';
test('real isolated SQLite seed failure reports the actual error before cleanup',{skip:process.env.DEVKILLER_RUNTIME_INTEGRATION!=='1'},async()=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'dk-startup-regression-'));
 try{
  await writeFile(path.join(folder,'server.mjs'),`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync('/data/test.sqlite');db.exec('CREATE TABLE financial_entries(a,b,c,d,e,f,g,h,i)');db.prepare('INSERT INTO financial_entries VALUES (?,?,?,?,?,?,?,?)').run(1,2,3,4,5,6,7,8,9);`);
  await assert.rejects(checkRuntimeStartup(folder,{entry:'server.mjs',tests:['test.mjs'],port:3000,publicDir:'public'}),error=>{
   assert.match(String(error),/9 columns but 8 values/);assert.equal((error as {code:number}).code,1);return true;
  });
 }finally{await rm(folder,{recursive:true,force:true});}
});
