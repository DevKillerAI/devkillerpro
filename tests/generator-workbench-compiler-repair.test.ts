import assert from 'node:assert/strict';
import test from 'node:test';
import { applyKnownWorkbenchCompilerRepair } from '../src/lib/server/generator/workbenchCompilerRepair';
import { createGeneratorSnapshot } from '../src/lib/server/generator/versionedEdits';
import type { PilotVerification } from '../src/lib/server/generator/pilotVerifier';

const scope={ownerId:'owner',projectId:'project',missionId:'mission',environmentId:'environment'};
function failed(details:string):PilotVerification{return {status:'failed',sourceHash:'a'.repeat(64),verifierVersion:'test',compiledFiles:[],checks:[{id:'platform:build',passed:false,details}],failures:[details],limitations:[],durationMs:1};}
function diagnostic(line:number,column:number){return `✘ [ERROR] Expected ")" but found "=>"\n\n    ../../candidate/src/App.tsx:${line}:${column}:\n      ${line} │ broken\n         ╵ )`;}

test('repairs only the compiler-located missing close on a typed destructured arrow',()=>{
  const content=`import React from 'react';\nexport default function App(){const título='ação à mesa';return <>{[['Pix',1]].map(([v,I]:any=><button>{v}</button>)}</>}`;
  const arrow=content.indexOf('=>',content.indexOf('.map'));
  const line=2,lineStart=content.indexOf('\n')+1,column=Buffer.byteLength(content.slice(lineStart,arrow),'utf8');
  const base=createGeneratorSnapshot({scope,revision:'build-1',files:[{path:'src/App.tsx',content},{path:'src/styles.css',content:'body{}'}]});
  const repaired=applyKnownWorkbenchCompilerRepair(base,failed(diagnostic(line,column)),'compiler-repair-1');
  assert.ok(repaired);
  assert.match(repaired.snapshot.files.find(file=>file.path==='src/App.tsx')!.content,/\.map\(\(\[v,I\]:any\)=>/);
  assert.equal(repaired.snapshot.parent?.revision,'build-1');
  assert.equal(repaired.snapshot.parent?.hash,base.hash);
});

test('does not alter valid source, strings, or a different compiler failure',()=>{
  const valid=`export const text='([v,I]:any=>';\nexport default function App(){return <>{[['Pix',1]].map(([v,I]:any)=><button>{v}</button>)}</>}`;
  const arrow=valid.indexOf('=>',valid.indexOf('.map'));
  const base=createGeneratorSnapshot({scope,revision:'build-1',files:[{path:'src/App.tsx',content:valid},{path:'src/styles.css',content:'body{}'}]});
  assert.equal(applyKnownWorkbenchCompilerRepair(base,failed(diagnostic(2,arrow-(valid.indexOf('\n')+1))),'compiler-repair-1'),null);
  assert.equal(applyKnownWorkbenchCompilerRepair(base,failed('src/App.tsx:2:1: ERROR: Expected identifier'),'compiler-repair-1'),null);
});
