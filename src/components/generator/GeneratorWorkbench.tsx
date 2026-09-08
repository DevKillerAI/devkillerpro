'use client';
import PlatformHeader from '@/components/tools/PlatformHeader';
import PlatformFooter from '@/components/tools/PlatformFooter';
import ProjectCard from '@/components/tools/ProjectCard';
import './workspace-theme.css';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Zap,Folder,Code2,Eye,History,ShieldCheck,ArrowLeft,Send,Square,UserRound,Trash2} from 'lucide-react';
import {ProfileModal,type ProfileAccount,profileInitials} from '@/components/account/ProfileModal';
import {pilotPreviewDocument,PILOT_PREVIEW_SANDBOX,validPilotStorage,acceptsPilotStorageMessage} from '@/lib/workspace/pilotPreview';
import type {PilotRun,PilotSavedSnapshot,PilotEvent} from '@/lib/server/generator/pilotStore';
import type {PilotDelivery} from '@/lib/server/generator/pilotDelivery';
import {useVisionBridge} from '@/lib/workspace/useVisionBridge';

type Detail={run:PilotRun;events:PilotEvent[];snapshots:PilotSavedSnapshot[];delivery:PilotDelivery|null};
type CapabilityGap={id:string;label:string;reason:string;fallback:string};
const terminal=(s:string)=>['ready','failed','cancelled'].includes(s);
const title=(r:PilotRun)=>{try{return JSON.parse(r.contract.prompt).title||'Untitled app';}catch{return 'Untitled app';}};
const projectDescription=(r:PilotRun)=>{const details=r.details&&typeof r.details==='object'?r.details as Record<string,unknown>:{};const metadata=details.projectMetadata&&typeof details.projectMetadata==='object'?details.projectMetadata as Record<string,unknown>:{};return typeof metadata.description==='string'?metadata.description:'';};
const superseded=(r:PilotRun)=>Boolean(r.details&&typeof r.details==='object'&&(r.details as Record<string,unknown>).supersededBy);
const money=(v:number)=>'$'+(v/1e6).toFixed(3);
const inputClass='w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100';

export function WorkbenchPreview({detail,standalone=false}:{detail:Detail;standalone?:boolean}) {
  const frame=useRef<HTMLIFrameElement>(null),[prepared,setPrepared]=useState<{key:string;document?:string;url?:string}|null>(null),[error,setError]=useState('');
  const runId=detail.run.runId,owner=detail.run.ownerId,compiledHash=detail.delivery?.compiledHash;
  const key=owner+':'+runId+':'+compiledHash, database=Boolean(detail.delivery?.database);
  useVisionBridge(frame,runId);
  useEffect(()=>{
    if(!detail.delivery)return;
    setError('');const controller=new AbortController();
    if(database){
      void fetch('/api/generator/workbench/preview',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
        body:JSON.stringify({runId,sourceHash:detail.delivery.candidate.sourceHash})}).then(async response=>{
        const data=await response.json();if(!response.ok)throw new Error(data.error);
        if(typeof data.url!=='string'||!/^http:\/\/dk-v2-[a-f0-9]{24}\.localhost:[0-9]{4,5}\/$/.test(data.url))throw new Error('Invalid isolated preview address.');
        if(!controller.signal.aborted)setPrepared({key,url:data.url});
      }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Preview unavailable.');});
      return()=>controller.abort();
    }
    const nonce=crypto.randomUUID(),storageKey=`dk-v2-preview:${owner}:${runId}`;let values:Record<string,string>={};
    try{const saved=JSON.parse(localStorage.getItem(storageKey)||'{}');if(validPilotStorage(saved))values=saved;}catch{setError('Browser data could not be restored.');}
    setPrepared({key,document:pilotPreviewDocument(detail.delivery.compiledFiles,runId,nonce,values)});
    const receive=(event:MessageEvent)=>{if(event.source!==frame.current?.contentWindow||!acceptsPilotStorageMessage(event.data,runId,nonce))return;try{localStorage.setItem(storageKey,JSON.stringify(event.data.values));setError('');}catch{setError('Browser storage is full or unavailable. Your latest changes may not survive reload.');}};
    window.addEventListener('message',receive);return()=>{controller.abort();window.removeEventListener('message',receive);};
    // Polling status must not reload the approved app.
  },[runId,owner,compiledHash,database,key]);
  const current=prepared?.key===key?prepared:null;
  return <>{error&&<p role="alert" className="bg-amber-50 p-3 text-xs text-amber-800">{error}</p>}{current?<iframe key={key} ref={frame} title="Your app preview"
    sandbox={current.url?'allow-scripts allow-same-origin allow-forms allow-downloads':PILOT_PREVIEW_SANDBOX} src={current.url} srcDoc={current.document}
    className={standalone?'h-screen w-full border-0 bg-white':'h-[min(75vh,800px)] min-h-[480px] w-full border-0 bg-white'}/>:<p className="p-12 text-center text-sm text-slate-500">Preparing the approved app…</p>}</>;
}
export function GeneratorWorkbench({ownerId,initialRun='',standalone=false,administration=false}:{ownerId:string;initialRun?:string;standalone?:boolean;administration?:boolean}) {
  const [account,setAccount]=useState<ProfileAccount|null>(null),[profile,setProfile]=useState(false);
  const [runs,setRuns]=useState<PilotRun[]>([]),[selected,setSelected]=useState(initialRun),[detail,setDetail]=useState<Detail|null>(null);
  const [creating,setCreating]=useState(!initialRun),[ready,setReady]=useState(false),[reason,setReason]=useState('Checking the local worker…');
  const [name,setName]=useState(''),[prompt,setPrompt]=useState(''),[mode,setMode]=useState<'simple'|'detailed'>('simple'),[requirements,setRequirements]=useState(''),[design,setDesign]=useState(''),[scopeAccepted,setScopeAccepted]=useState(false);
  const [appProfile,setAppProfile]=useState<'browser'|'fullstack-private'>('browser');
  const [editing,setEditing]=useState(''),[editScope,setEditScope]=useState<'style'|'app'>('style'),[tab,setTab]=useState<'preview'|'source'|'changes'|'checks'>('preview');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[readError,setReadError]=useState(''),[budget,setBudget]=useState({spentMicros:0,reservedMicros:0,maxCostMicros:1000000000});
  const [help,setHelp]=useState(false),helpDialog=useRef<HTMLDialogElement>(null);
  const [deleteTarget,setDeleteTarget]=useState<PilotRun|null>(null),[deleteFiles,setDeleteFiles]=useState(false);
  const createRequest=useRef<{id:string;body:string}|null>(null),editRequest=useRef<{id:string;body:string}|null>(null);
  useEffect(()=>{fetch('/api/account',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(d=>setAccount(d?.account||null)).catch(()=>{});},[]);
  useEffect(()=>{if(help)helpDialog.current?.showModal();else helpDialog.current?.close();},[help]);
  useEffect(()=>{
    let live=true,loading=false;const controller=new AbortController();
    const load=async()=>{if(loading)return;loading=true;try{const response=await fetch('/api/generator/workbench',{cache:'no-store',signal:controller.signal});const data=await response.json();if(!response.ok)throw new Error(data.error);if(live){setRuns(data.runs);setReady(data.ready);setReason(data.reason||'');setBudget(data.campaignBudget);setReadError('');}}catch(e){if(live)setReadError(e instanceof Error?e.message:'Unable to load projects.');}finally{loading=false;}};
    void load();const timer=setInterval(()=>void load(),5000);return()=>{live=false;controller.abort();clearInterval(timer);};
  },[]);
  useEffect(()=>{
    setDetail(null);setReadError('');if(!selected)return;
    let live=true,loading=false;const controller=new AbortController();
    const load=async()=>{if(loading)return;loading=true;try{const response=await fetch(`/api/generator/workbench?run=${encodeURIComponent(selected)}`,{cache:'no-store',signal:controller.signal});const data=await response.json();if(!response.ok)throw new Error(data.error);if(live){setDetail(data);setReadError('');}}catch(e){if(live)setReadError(e instanceof Error?e.message:'Unable to load this app.');}finally{loading=false;}};
    void load();const timer=setInterval(()=>void load(),2500);return()=>{live=false;controller.abort();clearInterval(timer);};
  },[selected]);
  function select(id:string){setSelected(id);setCreating(false);setError('');setEditing('');editRequest.current=null;window.history.replaceState(null,'',`/create?run=${encodeURIComponent(id)}`);}
  function newApp(){setCreating(true);setError('');window.history.replaceState(null,'','/create');}
  async function create(){
    if(busy)return;setBusy(true);setError('');
    const combined=mode==='detailed'?`${prompt}\n\nREQUIRED BEHAVIOR\n${requirements}\n\nDESIGN\n${design}`:prompt;
    const value={title:name,prompt:combined,briefingMode:mode,localScopeAccepted:scopeAccepted,profile:appProfile},fingerprint=JSON.stringify(value);
    if(createRequest.current&&createRequest.current.body!==fingerprint){setError('A previous submission has an uncertain outcome. Restore that brief or reload the project list before making a different request.');setBusy(false);return;}
    createRequest.current||={id:crypto.randomUUID(),body:fingerprint};
    try{const response=await fetch('/api/generator/workbench',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...value,requestId:createRequest.current.id})});const data=await response.json();if(!response.ok){if(response.status<500)createRequest.current=null;throw new Error(data.error);}setRuns(current=>[data.run,...current.filter(r=>r.runId!==data.run.runId)]);createRequest.current=null;select(data.run.runId);}
    catch(e){setError(e instanceof Error?e.message:'Submission uncertain. Retry uses the same request ID.');}finally{setBusy(false);}
  }
  async function edit(){
    if(busy||!detail?.delivery)return;setBusy(true);setError('');
    const value={runId:detail.run.runId,baseHash:detail.delivery.candidate.sourceHash,prompt:editing,scope:editScope},fingerprint=JSON.stringify(value);
    if(editRequest.current&&editRequest.current.body!==fingerprint){setError('The previous edit outcome is uncertain. Refresh before sending a different change.');setBusy(false);return;}
    editRequest.current||={id:crypto.randomUUID(),body:fingerprint};
    try{const response=await fetch('/api/generator/workbench',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...value,requestId:editRequest.current.id})});const data=await response.json();if(!response.ok){if(response.status<500)editRequest.current=null;throw new Error(data.error);}editRequest.current=null;setEditing('');setDetail(current=>current?{...current,run:data.run}:current);}
    catch(e){setError(e instanceof Error?e.message:'Edit submission uncertain. Current app preserved.');}finally{setBusy(false);}
  }
  async function cancel(){if(!detail||busy)return;setBusy(true);setError('');try{const response=await fetch('/api/generator/workbench',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'cancel',runId:detail.run.runId})});const data=await response.json();if(!response.ok)throw new Error(data.error);setDetail(current=>current?{...current,run:data.run}:current);}catch(e){setError(e instanceof Error?e.message:'Unable to stop.');}finally{setBusy(false);}}
  async function deleteProject(){if(!deleteTarget||busy)return;setBusy(true);setError('');try{const response=await fetch('/api/generator/workbench',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',runId:deleteTarget.runId,deleteGeneratedFiles:deleteFiles})});const data=await response.json();if(!response.ok)throw new Error(data.error);setRuns(current=>current.filter(run=>run.runId!==deleteTarget.runId));if(selected===deleteTarget.runId){setSelected('');setDetail(null);window.history.replaceState(null,'','/create');}setDeleteTarget(null);setDeleteFiles(false);}catch(e){setError(e instanceof Error?e.message:'Unable to delete this project.');}finally{setBusy(false);}}
  async function resumeCapabilities(){if(!detail||busy)return;setBusy(true);setError('');try{const response=await fetch('/api/generator/workbench',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'resume-capabilities',runId:detail.run.runId})});const data=await response.json();if(!response.ok)throw new Error(data.error);setDetail(current=>current?{...current,run:data.run}:current);}catch(e){setError(e instanceof Error?e.message:'Unable to continue this app.');}finally{setBusy(false);}}
  const visibleRuns=runs.filter(run=>!superseded(run));
  const current=detail?.run.runId===selected?detail:null,active=runs.some(r=>!terminal(r.status)),latest=current?.snapshots.at(-1)?.snapshot;
  const currentDetails=current?.run.details&&typeof current.run.details==='object'?current.run.details as Record<string,unknown>:{};
  const capabilityGaps=Array.isArray(currentDetails.capabilityGaps)?currentDetails.capabilityGaps as CapabilityGap[]:[];
  const canResumeCapabilities=Boolean(current&&['capability-unavailable','capability-required'].includes(String(currentDetails.reason))&&!current.run.accepted&&current.run.budget.callCount<current.run.budget.maxProviderCalls);
  if(standalone)return <main>{readError?<p role="alert" className="p-8">{readError}</p>:current?.delivery?<WorkbenchPreview detail={current} standalone/>:<p className="p-8">This app has no approved preview yet.</p>}<Link href={`/create?run=${encodeURIComponent(selected)}`} className="fixed bottom-4 right-4 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-xs shadow-lg">← Back to editor</Link></main>;
  return <><PlatformHeader create/><main className="dk-create-surface min-h-screen bg-[#f7f6f3] p-3 text-[#111420] sm:p-6"><div className="dk-create-shell mx-auto min-h-[calc(100vh-3rem)] max-w-[1336px]">

    <div className="min-w-0 flex-1"><header className="dk-create-toolbar"><div><button onClick={newApp} className={creating?'is-active':''}>New app</button><button onClick={()=>{setCreating(false);setSelected('');setError('');window.history.replaceState(null,'','/create');}}>My apps</button>{administration&&<Link href="/admin/generator">Test lab</Link>}</div><div><select aria-label="Project" value={selected} onChange={e=>select(e.target.value)}><option value="">Select an app…</option>{visibleRuns.map(r=><option value={r.runId} key={r.runId}>{title(r)}</option>)}</select><button aria-label="Your profile" onClick={()=>setProfile(true)}>{account?profileInitials(account.name):'Account'}</button></div></header>
      <div className="p-4 sm:p-6"><div className="mb-5 flex flex-wrap justify-between gap-2 text-[11px] text-slate-500"><span className="font-semibold text-emerald-700">Your workspace · DevKiller Create</span><span>Usage {money(budget.spentMicros)} / {money(budget.maxCostMicros)}</span></div>
      {(error||readError)&&<p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error||readError}</p>}
      {creating?<section className="mx-auto max-w-3xl py-6"><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-rose-500">Start something useful</p><h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">What will you build?</h1><p className="mt-3 text-sm leading-6 text-slate-500">Bring your idea to life. Describe who it is for, what it should do, and the look you have in mind. Build, review and refine in one place.</p>
        <div className="my-5 flex gap-1 rounded-xl bg-slate-100 p-1 text-xs">{(['simple','detailed'] as const).map(m=><button key={m} onClick={()=>setMode(m)} aria-pressed={mode===m} className={`flex-1 rounded-lg p-2.5 capitalize ${mode===m?'bg-white font-semibold shadow-sm':'text-slate-500'}`}>{m==='simple'?'Simple prompt':'Detailed brief'}</button>)}</div>
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"><label className="block text-xs font-semibold">App name<input value={name} maxLength={80} onChange={e=>setName(e.target.value)} className={'mt-2 '+inputClass} placeholder="e.g. Studio Desk"/></label><label className="block text-xs font-semibold">Your idea<textarea value={prompt} maxLength={mode==='simple'?9000:5000} onChange={e=>setPrompt(e.target.value)} className={'mt-2 min-h-36 '+inputClass} placeholder="Who is it for? What should people be able to do? What should it look like?"/></label>
        {mode==='detailed'&&<><label className="block text-xs font-semibold">Required behavior & acceptance criteria<textarea value={requirements} maxLength={1800} onChange={e=>setRequirements(e.target.value)} className={'mt-2 min-h-24 '+inputClass}/></label><label className="block text-xs font-semibold">Visual direction<textarea value={design} maxLength={1500} onChange={e=>setDesign(e.target.value)} className={'mt-2 '+inputClass} placeholder="Mood, palette, layout, typography, things to avoid"/></label></>}
        <label className="block text-xs font-semibold">Data and accounts<select value={appProfile} onChange={e=>setAppProfile(e.target.value as 'browser'|'fullstack-private')} className={'mt-2 '+inputClass}><option value="browser">Browser app — local data</option><option value="fullstack-private">Private database — separate app accounts</option></select></label>
        <button onClick={()=>setHelp(true)} className="text-xs text-rose-500 underline underline-offset-4">How to create a good prompt?</button>
        <div className="rounded-xl bg-slate-50 p-4 text-xs leading-5 text-slate-600"><strong className="text-slate-800">Choose the app’s data model.</strong> Browser apps keep small data on this device. Private database apps use separate accounts and owner-only records. Team roles, public shared databases and payments need a different integration. Database structure is frozen after approval; interface and behavior edits remain available.<label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={scopeAccepted} onChange={e=>setScopeAccepted(e.target.checked)} className="mt-1 accent-rose-500"/><span>Use the selected profile and clearly report any unsupported requirements.</span></label></div>
        <p className="text-[11px] text-slate-500">Do not paste passwords or API keys here. Your cumulative API ceiling is shown above; every app is additionally limited to $1 and five calls. Opening the editor does not start a paid request.</p>
        {!ready&&<p className="text-xs text-amber-800">{reason}</p>}<button onClick={()=>void create()} disabled={busy||!ready||active||!scopeAccepted||name.trim().length<2||prompt.trim().length<20} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#111420] py-3 text-sm font-semibold text-white disabled:opacity-40"><Zap size={16}/>{busy?'Submitting…':active?'An app is already being worked on':'Build my app'}</button></div>
      </section>:!selected?<section className="dk-create-library"><h1>Your apps</h1><p>Your ideas, brought to life. Open a project to continue where you left off.</p><div className="dk-create-library-grid">{visibleRuns.filter(r=>r.status==='ready').map(r=><ProjectCard key={r.runId} project={{id:r.runId,title:title(r),kind:'create',status:r.status,updatedAt:r.updatedAt,href:'/create?run='+encodeURIComponent(r.runId),description:projectDescription(r),tags:['React',...(r.contract.capabilities.includes('database.postgres')?['Supabase']:[])]}} onOpen={()=>select(r.runId)} onDelete={()=>{setDeleteTarget(r);setDeleteFiles(false);}}/>)}</div>{!visibleRuns.some(r=>r.status==='ready')&&<button onClick={newApp} className="mt-6 rounded-xl bg-[#111420] px-5 py-3 text-sm text-white">Create your first app</button>}</section>:current?<div className="grid items-start gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm overflow-hidden min-h-[640px] max-h-[85vh]">
          {/* Header */}
          <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h1 className="text-sm font-bold tracking-tight text-slate-900">{title(current.run)}</h1>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse"/>
                <span className="text-[10px] font-medium text-slate-500 font-mono">DevKiller Agent · gpt-5.6-terra</span>
              </div>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider font-mono ${
              current.run.status === 'ready' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
              current.run.status === 'failed' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
              'bg-amber-50 text-amber-700 border border-amber-200'
            }`}>
              {current.run.status}
            </span>
          </div>

          {/* Quick stop/delete */}
          <div className="flex items-center justify-between py-2 text-[11px] text-slate-400 border-b border-slate-100">
            <span>{current.events.length} pipeline steps recorded</span>
            <div className="flex items-center gap-2">
              {!terminal(current.run.status) && (
                <button onClick={()=>void cancel()} disabled={busy} className="flex items-center gap-1 text-xs text-rose-500 hover:text-rose-600 font-medium">
                  <Square size={11}/> Stop
                </button>
              )}
              {terminal(current.run.status) && (
                <button onClick={()=>{setDeleteTarget(current.run);setDeleteFiles(false)}} className="flex items-center gap-1 text-xs text-slate-400 hover:text-rose-500">
                  <Trash2 size={12}/>
                </button>
              )}
            </div>
          </div>

          {/* Capabilities fallback if applicable */}
          {canResumeCapabilities && (
            <div className="my-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs">
              <p className="font-semibold text-amber-950">Valid request with staged services.</p>
              <p className="mt-1 text-[11px] leading-4 text-amber-900">Continue with verified usable app and safe mock fallbacks.</p>
              <button onClick={()=>void resumeCapabilities()} disabled={busy||!ready} className="mt-2 w-full rounded-lg bg-[#111420] py-1.5 text-xs font-semibold text-white">
                Continue with safe fallback
              </button>
            </div>
          )}

          {/* Antigravity-style Agent Stream & Step List */}
          <div className="flex-1 overflow-y-auto space-y-2.5 py-3 pr-1">
            {current.events.filter(e=>!e.type.startsWith('worker.')&&!e.type.startsWith('run.')||['run.ready','run.error','plan.confirmed'].includes(e.type)).map((e, idx) => (
              <div key={e.sequence || idx} className="group rounded-xl border border-slate-100 bg-slate-50/70 p-3 hover:bg-slate-50 hover:border-slate-200 transition">
                <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1 font-mono">
                  <span className="font-semibold text-rose-500 uppercase">{e.type.replace('.', ' → ')}</span>
                  <span>{new Date(e.createdAt).toLocaleTimeString()}</span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed break-words">{e.message}</p>
              </div>
            ))}
            {!terminal(current.run.status) && (
              <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50/50 p-3 text-xs text-rose-700">
                <span className="inline-block h-2 w-2 rounded-full bg-rose-500 animate-ping"/>
                <span>Agent is synthesizing & verifying in Playwright sandbox...</span>
              </div>
            )}
          </div>

          {/* Antigravity Interactive Chat Console */}
          <div className="mt-auto border-t border-slate-100 pt-3">
            <div className="mb-2 flex items-center justify-between text-[11px]">
              <span className="font-semibold text-slate-700">Refine with Agent</span>
              <div className="flex rounded-lg bg-slate-100 p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={()=>setEditScope('app')}
                  className={`rounded-md px-2 py-0.5 font-medium transition ${editScope==='app'?'bg-white text-slate-900 shadow-sm':'text-slate-500'}`}
                >
                  App + Logic
                </button>
                <button
                  type="button"
                  onClick={()=>setEditScope('style')}
                  className={`rounded-md px-2 py-0.5 font-medium transition ${editScope==='style'?'bg-white text-slate-900 shadow-sm':'text-slate-500'}`}
                >
                  CSS Style
                </button>
              </div>
            </div>

            <div className="relative">
              <textarea
                aria-label="Requested change"
                value={editing}
                maxLength={1800}
                onChange={e=>setEditing(e.target.value)}
                onKeyDown={e=>{
                  if(e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if(!busy && terminal(current.run.status) && editing.trim().length >= 4 && current.delivery) {
                      void edit();
                    }
                  }
                }}
                disabled={busy || !terminal(current.run.status) || !current.delivery}
                rows={2}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 pr-10 text-xs text-slate-900 placeholder-slate-400 outline-none focus:border-rose-400 focus:bg-white focus:ring-2 focus:ring-rose-100 transition resize-none disabled:opacity-50"
                placeholder={
                  !terminal(current.run.status)
                    ? 'Agent is building... chat activates once ready.'
                    : !current.delivery
                    ? 'App build pending verification.'
                    : 'Instruct agent (e.g. Make header dark, add export CSV, polish UI)...'
                }
              />
              <button
                type="button"
                onClick={()=>void edit()}
                disabled={busy || !terminal(current.run.status) || editing.trim().length < 4 || !ready || current.run.budget.callCount >= 5 || !current.delivery}
                className="absolute bottom-2.5 right-2 rounded-lg bg-rose-500 p-1.5 text-white hover:bg-rose-600 disabled:opacity-30 transition shadow-sm"
              >
                <Send size={13}/>
              </button>
            </div>

            <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
              <span>{current.run.budget.callCount}/5 API calls used</span>
              <span>Press Enter to send</span>
            </div>
          </div>
        </aside>
        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="flex flex-wrap justify-between gap-2 border-b border-slate-100 p-3"><nav aria-label="App workspace" className="flex gap-1">{([['preview',Eye],['source',Code2],['changes',History],['checks',ShieldCheck]] as const).map(([value,Icon])=><button key={value} onClick={()=>setTab(value)} aria-pressed={tab===value} className={`flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs capitalize ${tab===value?'bg-[#111420] text-white':'text-slate-500'}`}><Icon size={13}/>{value}</button>)}</nav>{current.delivery&&<div className="flex items-center gap-3 text-xs text-rose-500"><Link href={`/create/live?run=${encodeURIComponent(selected)}`} target="_blank" rel="noopener noreferrer">New tab ↗</Link><a href={`/api/generator/workbench?run=${encodeURIComponent(selected)}&download=zip`}>Export ZIP</a></div>}</div>
        {current.delivery&&!terminal(current.run.status)&&<p className="bg-amber-50 px-4 py-2 text-[11px] text-amber-800">Showing your last approved version while the new change is checked.</p>}
        {tab==='preview'&&(current.delivery?<WorkbenchPreview detail={current}/>:<div className="flex min-h-[480px] flex-col items-center justify-center gap-3 p-8 text-center"><Zap size={28} className="text-rose-500"/><p className="text-sm">{terminal(current.run.status)?'No approved preview was produced. Review the recorded activity.':'Your app will appear here after its first checks pass.'}</p><p className="max-w-md text-xs leading-5 text-slate-500">Source files and actual checks appear in the tabs as they become available. No unrelated app is used as a placeholder.</p></div>)}
        {tab==='source'&&<div className="space-y-3 p-4">{latest?.files.map(f=><details key={f.path} open><summary className="cursor-pointer rounded-lg bg-slate-50 p-3 font-mono text-xs">{f.path}</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-[#111420] p-4 text-[11px] leading-5 text-slate-200">{f.content}</pre></details>)}<p className="text-[11px] text-slate-500">Latest candidate · {latest?.revision||'No files yet'}. An unapproved candidate never replaces the preview.</p></div>}
        {tab==='changes'&&<div className="space-y-4 p-4">{current.snapshots.slice(1).map((s,i)=>{const before=current.snapshots[i].snapshot;return <section key={s.snapshot.revision}><h2 className="text-xs font-semibold">{before.revision} → {s.snapshot.revision}</h2>{s.snapshot.files.filter(f=>before.files.find(p=>p.path===f.path)?.hash!==f.hash).map(f=><details key={f.path} className="mt-2"><summary className="cursor-pointer text-xs text-rose-500">{f.path} · changed</summary><div className="mt-2 grid gap-2 md:grid-cols-2"><pre className="max-h-80 overflow-auto whitespace-pre-wrap bg-rose-50 p-3 text-[10px]">{before.files.find(p=>p.path===f.path)?.content}</pre><pre className="max-h-80 overflow-auto whitespace-pre-wrap bg-emerald-50 p-3 text-[10px]">{f.content}</pre></div></details>)}</section>;})}{current.snapshots.length<2&&<p className="text-xs text-slate-500">Changes appear after a second recorded revision. Source snapshots are immutable.</p>}</div>}
        {tab==='checks'&&<div className="space-y-3 p-4"><p className="text-xs leading-5 text-slate-600">These are executed checks, not a promise that every requirement or production risk is covered. Review your app before relying on it.</p>{current.events.filter(e=>e.type==='verification.finished').map(e=><details key={e.sequence} open><summary className="cursor-pointer text-xs font-semibold">Recorded verification #{e.sequence}</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap bg-slate-50 p-3 text-[11px]">{JSON.stringify(e.details,null,2)}</pre></details>)}</div>}
        </section></div>:<p className="p-8 text-sm text-slate-500">Loading this app…</p>}
      </div></div></div>{deleteTarget&&<div role="dialog" aria-modal="true" aria-labelledby="delete-project-title" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4"><section className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 id="delete-project-title" className="text-lg font-semibold">Delete {title(deleteTarget)}?</h2><p className="mt-2 text-sm leading-6 text-slate-600">The project will disappear from your list. Cost totals and a minimal audit record remain protected.</p><label className="mt-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4"><input type="checkbox" checked={deleteFiles} onChange={event=>setDeleteFiles(event.target.checked)} className="mt-1 accent-rose-500"/><span><strong className="block text-sm text-rose-950">Also permanently delete generated files</strong><span className="mt-1 block text-xs leading-5 text-rose-800">Removes generated source, compiled output, snapshots and stored provider responses. This cannot be undone.</span></span></label><div className="mt-6 flex justify-end gap-2"><button disabled={busy} onClick={()=>{setDeleteTarget(null);setDeleteFiles(false)}} className="rounded-xl border border-slate-200 px-4 py-2 text-sm">Cancel</button><button disabled={busy} onClick={()=>void deleteProject()} className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy?'Deleting…':'Delete project'}</button></div></section></div>}<ProfileModal open={profile} onClose={()=>setProfile(false)} account={account}/>
      <dialog ref={helpDialog} onCancel={()=>setHelp(false)} onClose={()=>setHelp(false)} className="fixed inset-0 m-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-sm backdrop:bg-slate-900/40"><h2 className="text-lg font-semibold">A useful prompt has a clear finish line.</h2><p className="mt-3 leading-6">Describe the audience, the main actions, the data to keep, and a visual direction. Add two or three concrete examples of what success looks like.</p><p className="mt-3 leading-6">Simple mode targets a small local MVP. Detailed mode gives the builder more precise requirements; it does not unlock unsupported integrations or guarantee production readiness.</p><button onClick={()=>setHelp(false)} className="mt-5 rounded-xl bg-[#111420] px-4 py-2 text-white">Got it</button></dialog>
    </main><PlatformFooter/></>;
}
