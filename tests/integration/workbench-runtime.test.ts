import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createWorkbenchContract } from '../../src/lib/server/generator/workbenchContract';
import { createGeneratorSnapshot } from '../../src/lib/server/generator/versionedEdits';
import { prepareWorkbenchDatabase } from '../../src/lib/server/generator/workbenchDatabase';
import { verifyBriefboardPilot } from '../../src/lib/server/generator/pilotVerifier';
import { typecheckGeneratorSource } from '../../src/lib/server/generator/typescriptTypecheck';

// Opt-in local Docker/Supabase integration. No model/provider API is invoked.
test('generic Workbench runs real owner-scoped CRUD, concurrency and sessions in Docker', { skip: process.env.V2_RUNTIME_TESTS !== '1', timeout: 600000 }, async () => {
  const requestId=process.env.V2_RUNTIME_QA_ID||randomUUID();
  const contract=createWorkbenchContract('qa-wb-'+requestId,{requestId,title:'Runtime QA',prompt:'Private notes with real database and separate owner accounts.',briefingMode:'simple',localScopeAccepted:true,profile:'fullstack-private'});
  const snapshot=createGeneratorSnapshot({scope:contract.identity,revision:'fixture-1',files:[
    {path:'supabase/migrations/001_init.sql',content:`CREATE TABLE app.notes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL DEFAULT auth.uid(), request_id uuid NOT NULL, title text NOT NULL CHECK (length(title)>0), UNIQUE(owner_id,request_id));
ALTER TABLE app.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.notes FORCE ROW LEVEL SECURITY;
CREATE POLICY notes_owner ON app.notes FOR ALL TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
GRANT SELECT,INSERT,UPDATE,DELETE ON app.notes TO authenticated;`},
    {path:'src/styles.css',content:'*{box-sizing:border-box}body{margin:0;font:16px system-ui;background:#f2f4f6;color:#17212b}main{width:min(600px,100%);padding:20px;margin:auto}input,button{max-width:100%;padding:10px;margin:4px}li{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}ul{padding:0;list-style:none}'},
    {path:'src/App.tsx',content:`import React,{useEffect,useState} from 'react';
import {createClient} from '@supabase/supabase-js';
const config=window.__DK_SUPABASE__;
if(!config)throw new Error('Missing scoped configuration');
const client=createClient(config.url,config.anonKey,{db:{schema:config.schema},auth:{storageKey:config.storageKey,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
type Note={id:string;title:string};
export default function App(){
const [notes,setNotes]=useState<Note[]>([]),[draft,setDraft]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
async function load(){const result=await client.from('notes').select('id,title').order('title');if(result.error)setError(result.error.message);else setNotes(result.data??[]);}
useEffect(()=>{void load()},[]);
async function add(){if(!draft.trim()||busy)return;setBusy(true);const result=await client.from('notes').insert({title:draft.trim(),request_id:crypto.randomUUID()}).select();if(result.error)setError(result.error.message);else{setDraft('');await load()}setBusy(false)}
async function rename(id:string){const result=await client.from('notes').update({title:'Edited note'}).eq('id',id).select();if(result.error)setError(result.error.message);else await load()}
async function remove(id:string){const result=await client.from('notes').delete().eq('id',id).select();if(result.error)setError(result.error.message);else await load()}
return <main><h1>Private notes</h1><label>Title<input data-testid="title" value={draft} onChange={e=>setDraft(e.target.value)}/></label><button data-testid="add" disabled={busy||!draft.trim()} onClick={()=>void add()}>Add</button><p role="alert">{error}</p><ul>{notes.map(note=><li data-testid="note" key={note.id}><span data-testid="note-title">{note.title}</span><button data-testid="rename" onClick={()=>void rename(note.id)}>Rename</button><button data-testid="delete" onClick={()=>void remove(note.id)}>Delete</button></li>)}</ul></main>}`},
  ]});
  assert.equal(typecheckGeneratorSource(snapshot.files).status,'passed');
  const database=await prepareWorkbenchDatabase(snapshot);
  const replay=await prepareWorkbenchDatabase(snapshot,undefined,undefined,database.environment.identity);
  assert.ok(replay.migrationEvidence.files.every(file=>file.reused));
  const journeys=[{name:'Create edit and reopen a private note',requirementIds:[],steps:[
    {action:'fill',testId:'title',value:'My note'},{action:'click',testId:'add',value:''},
    {action:'text',testId:'note-title',value:'My note'},{action:'click',testId:'rename',value:''},
    {action:'text',testId:'note-title',value:'Edited note'},{action:'reload',testId:'',value:''},
    {action:'text',testId:'note-title',value:'Edited note'},
  ]},{name:'Delete an owned record',requirementIds:[],steps:[
    {action:'fill',testId:'title',value:'Remove me'},{action:'click',testId:'add',value:''},
    {action:'text',testId:'note-title',value:'Remove me'},{action:'click',testId:'delete',value:''},
    {action:'count',testId:'note',value:'0'},
  ]}];
  const report=await verifyBriefboardPilot({snapshot,database,workbenchJourneys:journeys});
  console.log(JSON.stringify({sourceHash:snapshot.hash,environment:database.environment.scopeHash,status:report.status,checks:report.checks,failures:report.failures,limitations:report.limitations}));
  assert.equal(report.status,'passed',JSON.stringify(report.failures));
  for(const id of ['platform:persistence','platform:database-concurrency','platform:authorization-cross-owner','platform:authorization-anonymous','requirement:feature.app-authentication'])assert.equal(report.checks.find(check=>check.id===id)?.passed,true,id);
});
