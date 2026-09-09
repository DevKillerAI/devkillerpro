import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import {createGeneratorSnapshot} from '../src/lib/server/generator/versionedEdits';
import {typecheckGeneratorSource} from '../src/lib/server/generator/typescriptTypecheck';
import {applyKnownWorkbenchCompilerRepair} from '../src/lib/server/generator/workbenchCompilerRepair';
import {repairWorkbenchClientTypes} from '../src/lib/server/generator/workbenchClientRepair';
import {WORKBENCH_SUPABASE_CLIENT_EXAMPLE} from '../src/lib/server/generator/workbenchClientContract';
import type {PilotVerification} from '../src/lib/server/generator/pilotVerifier';

const scope={ownerId:'owner',projectId:'project',missionId:'mission',environmentId:'environment'};
const badClient=`import { createClient, type SupabaseClient } from '@supabase/supabase-js';
type RuntimeSettings = { url: string; anonKey: string; schema: string; storageKey: string };
declare global { interface Window { __DK_SUPABASE__?: RuntimeSettings } }
const settings = window.__DK_SUPABASE__;
export const supabase: SupabaseClient | null = settings ? createClient(settings.url, settings.anonKey, {
db: { schema: settings.schema }, auth: { storageKey: settings.storageKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
}) : null;`;
const source=(client:string)=>createGeneratorSnapshot({scope,revision:'repair-1',files:[{path:'src/App.tsx',content:'export default function App(){return <h1>Healing</h1>}'},{path:'src/lib/supabase.ts',content:client},{path:'src/styles.css',content:'body{margin:0}'}]});
const details=(r:ReturnType<typeof typecheckGeneratorSource>)=>r.diagnostics.map(d=>`${d.file}:${d.line}:${d.column} TS${d.code}: ${d.message}`).join('; ');
const emitted=(content:string)=>ts.transpileModule(content,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;

test('Healing real SDK diagnostics are repaired locally with identical runtime JavaScript',()=>{
  const base=source(badClient),before=typecheckGeneratorSource(base.files);
  assert.deepEqual(before.diagnostics.map(d=>d.code).sort(),[2322,2717]);
  const text=details(before);
  const report={status:'failed',sourceHash:base.hash,verifierVersion:'test',compiledFiles:[],checks:[{id:'platform:typescript-typecheck',passed:false,details:text}],failures:[text],limitations:[],durationMs:1} satisfies PilotVerification;
  const fixed=applyKnownWorkbenchCompilerRepair(base,report,'local-repair-1')!;
  assert.equal(fixed.kind,'platform-supabase-types');
  const after=typecheckGeneratorSource(fixed.snapshot.files);
  assert.deepEqual(after.diagnostics,[]);
  const client=fixed.snapshot.files.find(f=>f.path==='src/lib/supabase.ts')!.content;
  assert.equal(emitted(client),emitted(badClient));
  assert.equal(fixed.snapshot.parent?.hash,base.hash);
  assert.equal(repairWorkbenchClientTypes(fixed.snapshot,details(after),'again'),null);
  assert.deepEqual(fixed.snapshot.files.filter(f=>f.path!=='src/lib/supabase.ts'),base.files.filter(f=>f.path!=='src/lib/supabase.ts'));
});

test('canonical client example compiles against the pinned SDK',()=>{
  assert.deepEqual(typecheckGeneratorSource(source(WORKBENCH_SUPABASE_CLIENT_EXAMPLE).files).diagnostics,[]);
});

test('unrelated type errors remain visible and cannot be repaired by suppression',()=>{
  const base=source(badClient+'\nconst invalid: number = "wrong";');
  const fixed=repairWorkbenchClientTypes(base,details(typecheckGeneratorSource(base.files)),'local-repair-1')!;
  const remaining=typecheckGeneratorSource(fixed.snapshot.files).diagnostics;
  assert.equal(remaining.length,1);
  assert.equal(remaining[0].code,2322);
  assert.ok(remaining[0].message.includes('number'));
  assert.ok(fixed.snapshot.files.find(f=>f.path==='src/lib/supabase.ts')!.content.includes('const invalid: number = "wrong"'));
});

test('no evidence or a similarly named non-SDK type is not a client repair',()=>{
  assert.equal(repairWorkbenchClientTypes(source(badClient),'','no-evidence'),null);
  const unrelated=badClient.replace("'@supabase/supabase-js'","'./other-client'");
  const base=source(unrelated);
  const fake='src/lib/supabase.ts:5:14 TS2322: SupabaseClient "app" is not assignable to "public"';
  assert.equal(repairWorkbenchClientTypes(base,fake,'do-not-touch'),null);
});
