import assert from 'node:assert/strict';
import test from 'node:test';
import { typecheckGeneratorSource } from '../src/lib/server/generator/typescriptTypecheck';
import { createGeneratorSnapshot } from '../src/lib/server/generator/versionedEdits';
import { applyKnownWorkbenchCompilerRepair } from '../src/lib/server/generator/workbenchCompilerRepair';

const source = (content: string) => [{ path: 'src/App.tsx', content }, { path: 'src/styles.css', content: 'body {}' }];
test('actual React and DOM declarations accept typed components and local imports', () => {
  const report = typecheckGeneratorSource([...source(`import { useState } from 'react';
import { title } from './title'; import './styles.css';
export default function App() { const [value,setValue]=useState(''); return <label>{title}<input value={value} onChange={event=>setValue(event.currentTarget.value)}/></label>; }`),
    { path: 'src/title.ts', content: "export const title: string = 'Name';" }]);
  assert.equal(report.status, 'passed', JSON.stringify(report.diagnostics));
});
test('actual declarations reject wrong hook types, missing icons and DOM properties', () => {
  for (const content of [
    "import {useState} from 'react'; export default function App(){ const [x]=useState<number>('wrong'); return <div>{x}</div>; }",
    "import {NotAnActualDevKillerIcon} from 'lucide-react'; export default function App(){return <NotAnActualDevKillerIcon/>;}",
    "export default function App(){return <input onChange={event=>event.currentTarget.thisPropertyDoesNotExist()}/>;}",
  ]) assert.equal(typecheckGeneratorSource(source(content)).status, 'failed');
});
test('semantic checks include JavaScript and reject missing local files', () => {
  assert.equal(typecheckGeneratorSource([{path:'src/App.jsx',content:'export default function App(){ return missingVariable; }'}]).status,'failed');
  assert.equal(typecheckGeneratorSource(source("import {unknown} from './missing'; export default function App(){return <div>{unknown}</div>;}")).status,'failed');
});
test('nullable refs fail verification and are not fixed by suppressing the error', () => {
  const files=source("import {useRef} from 'react'; export default function App(){ const ref=useRef<HTMLCanvasElement>(null); ref.current.getContext('2d'); return <canvas ref={ref}/>;}");
  const report=typecheckGeneratorSource(files);
  assert.equal(report.status,'failed');
  const base=createGeneratorSnapshot({scope:{ownerId:'owner',projectId:'project',missionId:'mission',environmentId:'environment'},revision:'base',files});
  const details=report.diagnostics.map(d=>`${d.file}:${d.line}:${d.column} TS${d.code}: ${d.message}`).join('\n');
  assert.equal(applyKnownWorkbenchCompilerRepair(base,{status:'failed',sourceHash:base.hash,verifierVersion:'test',compiledFiles:[],checks:[{id:'platform:typescript-typecheck',passed:false,details}],failures:[details],limitations:[],durationMs:1},'repair'),null);
});
