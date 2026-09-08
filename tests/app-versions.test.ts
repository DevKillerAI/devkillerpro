import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareVersions,currentVersion,versionSummary,saveAppVersion,appVersions} from '../src/lib/server/appVersions';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('comparison identifies added, removed and modified files without unchanged noise',()=>{
 const before=[{path:'same',content:'x'},{path:'edit',content:'old'},{path:'gone',content:''}];
 const after=[{path:'same',content:'x'},{path:'edit',content:'new'},{path:'added',content:''}];
 assert.deepEqual(compareVersions(before,after).map(c=>[c.path,c.status]),[['added','added'],['edit','modified'],['gone','removed']]);
 assert.deepEqual(compareVersions(after,after),[]);
});
test('sensitive file types are excluded and hashes ignore input order',()=>{
 const files=[{path:'.env.local',content:'secret'},{path:'cert.key',content:'secret'},{path:'.env.example',content:'EXAMPLE='},{path:'page.tsx',content:'hello'}];
 const current=currentVersion(files);
 assert.equal(current.files.length,2);
 assert.equal(versionSummary(current).hash,versionSummary(currentVersion([...files].reverse())).hash);
});
test('successive snapshots remain immutable and can be loaded',async()=>{
 const previous=process.cwd(),folder=await mkdtemp(path.join(tmpdir(),'dk-versions-'));
 try{
  process.chdir(folder);
  await saveAppVersion('test-mission',[{path:'a',content:'first'}],'First request');
  await saveAppVersion('test-mission',[{path:'a',content:'second'}],'Second request');
  const versions=await appVersions('test-mission');
  assert.equal(versions.length,2);
  assert.equal(new Set(versions.map(v=>v.id)).size,2);
  assert.deepEqual(versions.map(v=>v.files[0].content).sort(),['first','second']);
  await assert.rejects(appVersions('../outside'));
 }finally{process.chdir(previous);await rm(folder,{recursive:true,force:true});}
});
