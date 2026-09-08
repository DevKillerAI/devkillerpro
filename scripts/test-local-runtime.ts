import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startRuntime,stopRuntime,testRuntime,docker,runtimeName} from '../src/lib/server/localRuntime';
const id=`runtime-test-${randomUUID()}`;
const directory='tests/fixtures/sqlite-runtime';
const contract={entry:'server.mjs',tests:['tests/database.test.mjs'],port:3000 as const,publicDir:'public' as const};
async function main(){
  try {
    console.log(await testRuntime(directory,contract));
    let {url}=await startRuntime(id,directory,contract);
    await fetch(url,{method:'POST',body:JSON.stringify({title:'persisted'})});
    await stopRuntime(id);
    ({url}=await startRuntime(id,directory,contract));
    const [note]=await (await fetch(url)).json();
    assert.equal(note.title,'persisted');
    await fetch(`${url}/${note.id}`,{method:'DELETE'});
    assert.equal((await (await fetch(url)).json()).length,0);
    assert.equal(await docker(['inspect','--format','{{.HostConfig.ReadonlyRootfs}}',runtimeName(id)]),'true');
    assert.equal(await docker(['network','inspect','--format','{{.Internal}}',`${runtimeName(id)}-net`]),'true');
    const isolation=await docker(['exec',runtimeName(id),'node','-e',"(async()=>{const fs=require('node:fs');if(process.env.OPENAI_API_KEY)process.exit(2);try{fs.writeFileSync('/app/forbidden','x');process.exit(3)}catch{};try{await fetch('https://example.com',{signal:AbortSignal.timeout(2000)});process.exit(4)}catch{};console.log('isolation-ok')})()"]);
    assert.equal(isolation,'isolation-ok');
    console.log('PASS: HTTP CRUD, persistent volume across container recreation, read-only root, internal network.');
  } finally {
    await stopRuntime(id);
    await docker(['volume','rm',`${runtimeName(id)}-data`]).catch(()=>{});
    await docker(['network','rm',`${runtimeName(id)}-net`]).catch(()=>{});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
