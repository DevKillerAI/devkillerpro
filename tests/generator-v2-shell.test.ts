import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('the main route exposes only V2 and the brand returns to that route',()=>{
  const home=readFileSync(new URL('../src/app/page.tsx',import.meta.url),'utf8');
  const shell=readFileSync(new URL('../src/components/generator/GeneratorWorkbench.tsx',import.meta.url),'utf8');
  assert.match(home,/redirect\('\/create'\)/);
  assert.doesNotMatch(home,/Council|deliberate\/codegen/);
  assert.match(shell,/href="\/" aria-label="DevKiller main dashboard"/);
  assert.match(shell,/From Intent to Production\. .*Autonomously\./);
  assert.doesNotMatch(shell,/Your idea\. A working app\. One focused builder\./);
});
