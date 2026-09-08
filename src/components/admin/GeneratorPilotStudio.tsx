"use client";
import { useEffect, useReducer, useRef, useState } from 'react';
import Link from 'next/link';
import { acceptsPilotStorageMessage, PILOT_PREVIEW_SANDBOX, pilotPreviewDocument, validPilotStorage } from '@/lib/workspace/pilotPreview';
import type { PilotRun, PilotEvent, PilotSavedSnapshot } from '@/lib/server/generator/pilotStore';
import type { PilotDelivery } from '@/lib/server/generator/pilotDelivery';
import { PILOT_BENCHMARKS, PILOT_BENCHMARK_LABELS, PRIVATEBOARD_PREVIEW_SANDBOX, isAcceptedPrivateboardDelivery, privateboardPreviewUrl, pilotBenchmarkForRuntime, pilotBenchmarkLabel, pilotPreviewState, readPilotCheckReport, type PilotBenchmark, type PilotBenchmarkReadiness, type PilotPreviewState } from '@/lib/workspace/pilotBenchmarks';
import { INITIAL_PILOT_UI_ERRORS, pilotUiErrors } from '@/lib/workspace/pilotUiErrors';

type Detail = { run: PilotRun; events: PilotEvent[]; snapshots: PilotSavedSnapshot[]; delivery: PilotDelivery | null; preview: PilotPreviewState };
const money = (micros: number) => `$${(micros / 1_000_000).toFixed(4)}`;
const terminal = (status: string) => ['ready', 'failed', 'cancelled'].includes(status);

export function GeneratorPilotStudio({ brief }: { brief: string }) {
  const [runs, setRuns] = useState<PilotRun[]>([]), [selected, setSelected] = useState('');
  const [benchmark, setBenchmark] = useState<PilotBenchmark>('briefboard');
  const [benchmarks, setBenchmarks] = useState<PilotBenchmarkReadiness[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null), [busy, setBusy] = useState(false);
  const [errors, reportError] = useReducer(pilotUiErrors, INITIAL_PILOT_UI_ERRORS);
  const [tab, setTab] = useState<'preview' | 'source' | 'changes' | 'checks'>('preview');
  const requestIds = useRef<Partial<Record<PilotBenchmark, string>>>({});
  useEffect(() => {
    let live = true; let loading = false; const controller = new AbortController();
    const load = async () => { if (loading) return; loading = true; try {
      const response = await fetch('/api/generator/pilot', { cache: 'no-store', signal: controller.signal });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (!live) return; setRuns(data.runs); setBenchmarks(data.benchmarks || []); reportError({ type: 'runs-result', error: '' }); if (!selected && data.runs[0]) setSelected(data.runs[0].runId);
    } catch (error) { if (live) reportError({ type: 'runs-result', error: error instanceof Error ? error.message : 'Unable to load pilot.' }); } finally { loading = false; } };
    void load(); const timer = setInterval(() => void load(), 4000);
    return () => { live = false; controller.abort(); clearInterval(timer); };
  }, [selected]);
  useEffect(() => {
    setDetail(null); reportError({ type: 'select-run', runId: selected }); if (!selected) return;
    let live = true; let loading = false; const controller = new AbortController();
    const load = async () => { if (loading) return; loading = true; try {
      const response = await fetch(`/api/generator/pilot?run=${encodeURIComponent(selected)}`, { cache: 'no-store', signal: controller.signal });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (live) { setDetail(data); reportError({ type: 'detail-result', runId: selected, error: '' }); }
    } catch (error) { if (live) reportError({ type: 'detail-result', runId: selected, error: error instanceof Error ? error.message : 'Unable to load progress.' }); } finally { loading = false; } };
    void load(); const timer = setInterval(() => void load(), 2000);
    return () => { live = false; controller.abort(); clearInterval(timer); };
  }, [selected]);
  async function start() {
    const requestedBenchmark = benchmark;
    setBusy(true); reportError({ type: 'action-result', error: '' }); requestIds.current[requestedBenchmark] ||= crypto.randomUUID();
    try { const response = await fetch('/api/generator/pilot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestIds.current[requestedBenchmark], benchmark: requestedBenchmark }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setSelected(data.run.runId); setRuns(current => [data.run, ...current.filter(run => run.runId !== data.run.runId)]); delete requestIds.current[requestedBenchmark];
    } catch (error) { reportError({ type: 'action-result', error: `${PILOT_BENCHMARK_LABELS[requestedBenchmark]} test request: ${error instanceof Error ? error.message : 'Submission uncertain. Retry uses the same request ID.'}` }); } finally { setBusy(false); }
  }
  async function cancel() {
    if (!detail) return; setBusy(true); reportError({ type: 'action-result', error: '' });
    try { const response = await fetch('/api/generator/pilot', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: detail.run.runId, action: 'cancel' }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
    } catch (error) { reportError({ type: 'action-result', error: `Stop ${pilotBenchmarkLabel(detail.run.contract.runtime)} (${detail.run.runId}): ${error instanceof Error ? error.message : 'Unable to stop the pilot.'}` }); } finally { setBusy(false); }
  }
  const active = runs.some(run => !terminal(run.status));
  const budget = runs[0]?.campaignBudget || detail?.run.campaignBudget;
  const latest = detail?.snapshots.at(-1)?.snapshot;
  const readiness = benchmarks.find(item => item.id === benchmark);
  const selectedBenchmark = detail ? pilotBenchmarkForRuntime(detail.run.contract.runtime) : null;
  const approvedPrivateboard = detail ? isAcceptedPrivateboardDelivery(detail.run, detail.delivery) : false;
  const preview = detail ? detail.preview || pilotPreviewState(detail.run.contract.runtime) : null;
  const selectedBrief = readiness?.brief || (benchmark === 'briefboard' ? brief : 'Loading the fixed Privateboard acceptance brief…');
  const budgetExhausted = budget ? budget.spentMicros + budget.reservedMicros >= budget.maxCostMicros : false;
  const visibleEvents = detail?.events.filter((event, index, events) => event.type !== 'provider.progress' || events[index - 1]?.message !== event.message) || [];
  return <main className="min-h-screen bg-[#f7f6f3] p-4 text-[#111420] sm:p-8"><div className="mx-auto max-w-[1500px] space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><div className="flex flex-wrap gap-4 text-xs"><Link href="/create" className="font-semibold text-slate-600">← App builder home</Link><Link href="/admin" className="text-slate-500">Owner administration</Link></div><p className="mt-5 text-[10px] font-bold uppercase tracking-[.22em] text-rose-500">DevKiller · quality environment</p><h1 className="mt-2 text-2xl font-bold tracking-tight">Generator quality lab</h1><p className="mt-2 max-w-2xl text-sm text-slate-500">Fixed technical benchmarks exercise real builds, recorded checks, isolated data environments and scoped edits without affecting user projects.</p></div>
      <div className="flex flex-wrap items-end gap-2"><label className="text-[10px] text-slate-500">Next fixed benchmark<select aria-label="Next fixed benchmark" value={benchmark} disabled={busy} onChange={event => setBenchmark(event.target.value as PilotBenchmark)} className="mt-1 block rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs text-[#111420] disabled:opacity-40">{PILOT_BENCHMARKS.map(value => <option key={value} value={value}>{PILOT_BENCHMARK_LABELS[value]} · {value === 'briefboard' ? 'browser-only' : 'Supabase'}</option>)}</select></label>
      <button onClick={() => void start()} disabled={busy || active || budgetExhausted || !readiness?.available} className="rounded-xl bg-[#111420] px-5 py-3 text-xs font-bold text-white disabled:opacity-40">{busy ? 'Working…' : `Run ${PILOT_BENCHMARK_LABELS[benchmark]} paid test`}</button></div>
    </header>
    <div className="grid gap-3 sm:grid-cols-3">{[['Shared campaign ceiling', '$3.00'], ['Estimated API usage', money(budget?.spentMicros || 0)], ['Held for pending / uncertain calls', money(budget?.reservedMicros || 0)]].map(([label, value]) => <section key={label} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-[11px] text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></section>)}</div>
    <p className="text-[11px] text-slate-500">The $3 ceiling is shared by both benchmarks and all retries. Usage is estimated from reported tokens, not an invoice. {benchmark === 'privateboard' ? 'Privateboard tests a dedicated local Supabase database and authentication; it is not a production deployment.' : 'Briefboard is browser-only: no app backend or server synchronization.'} No image generation is included. Paid tests require an explicit request through this button or an authorized operator command. Opening this page never starts a test or provider call.</p>
    <section aria-live="polite" className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xs font-semibold">{PILOT_BENCHMARK_LABELS[benchmark]} prerequisites</h2><span className={`text-[10px] ${readiness?.available ? 'text-emerald-700' : 'text-amber-700'}`}>{readiness ? readiness.available ? 'Compiler and provider ready to submit' : 'Submission unavailable' : 'Checking submission prerequisites…'}</span></div><p className="mt-2 text-[11px] leading-5 text-slate-500">{readiness?.prerequisites.join(' · ') || 'Reading the fixed benchmark and runtime requirements.'}</p>{readiness?.reason && <p className="mt-1 text-[11px] text-amber-800">{readiness.reason}</p>}<p className="mt-1 text-[11px] text-slate-500">{active ? 'A pilot is already active. Open its recorded progress below; another test cannot be queued.' : budgetExhausted ? 'This shared campaign has no unreserved budget remaining.' : 'Readiness permits submission only. Acceptance and database checks must still pass before any delivery is approved.'}</p></section>
    {errors.runs && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">Run list refresh failed: {errors.runs}</p>}
    {errors.detail && errors.selectedRunId === selected && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">Selected run refresh failed: {errors.detail}</p>}
    {errors.action && <div role="alert" className="flex items-start justify-between gap-3 rounded-xl bg-rose-50 p-4 text-sm text-rose-700"><p className="min-w-0 break-words">Previous action notice — {errors.action}</p><button type="button" onClick={() => reportError({ type: 'action-result', error: '' })} className="shrink-0 text-xs underline">Dismiss notice</button></div>}
    <details className="rounded-2xl border border-slate-200 bg-white p-4 text-xs"><summary className="cursor-pointer font-semibold">{PILOT_BENCHMARK_LABELS[benchmark]} test brief & acceptance interface</summary><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap font-sans leading-6 text-slate-600">{selectedBrief}</pre></details>
    {!!runs.length && <label className="flex flex-wrap items-center gap-3 text-xs text-slate-500">Pilot run<select aria-label="Pilot run" value={selected} onChange={event => setSelected(event.target.value)} className="max-w-full rounded-lg border border-slate-200 bg-white p-2">{runs.map(run => <option key={run.runId} value={run.runId}>{pilotBenchmarkLabel(run.contract.runtime)} · {new Date(run.createdAt).toLocaleString('en-US')} · {run.status}</option>)}</select></label>}
    {detail && <div className="grid items-start gap-5 xl:grid-cols-[310px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between"><h2 className="text-sm font-bold">{pilotBenchmarkLabel(detail.run.contract.runtime)} development</h2><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px]">{detail.run.status}</span></div><p className="mt-2 text-[10px] text-slate-500">{detail.run.contract.runtime.id}/{detail.run.contract.runtime.version} · recorded events resume after refresh</p>
        {!terminal(detail.run.status) && <button onClick={() => void cancel()} disabled={busy} className="mt-3 text-xs font-semibold text-rose-500">Stop this pilot</button>}
        <ol className="mt-5 max-h-[660px] space-y-5 overflow-auto">{visibleEvents.map(event => <li key={event.sequence} className="border-l-2 border-rose-100 pl-3"><p className="text-[9px] text-slate-400">{new Date(event.createdAt).toLocaleTimeString('en-US')} · #{event.sequence}</p>{event.type === 'run.error' && event.message.trim().startsWith('[') ? <details className="mt-1 text-xs leading-5"><summary className="cursor-pointer">The edit response did not match the allowed format. No partial changes were applied.</summary><pre className="mt-2 whitespace-pre-wrap break-words text-[10px] text-slate-500">{event.message}</pre></details> : <p className="mt-1 break-words text-xs leading-5">{event.message}</p>}</li>)}</ol>
      </aside>
      <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-3"><nav aria-label="Pilot output" className="flex flex-wrap gap-1">{(['preview', 'source', 'changes', 'checks'] as const).map(value => <button key={value} onClick={() => setTab(value)} aria-pressed={tab === value} className={`rounded-lg px-3 py-2 text-xs capitalize ${tab === value ? 'bg-[#111420] text-white' : 'text-slate-500'}`}>{value}</button>)}</nav>{detail.delivery && <a href={`/api/generator/pilot?run=${encodeURIComponent(selected)}&download=zip`} className="text-xs font-semibold text-rose-500">Export approved ZIP ↗</a>}</div>
        {tab === 'preview' && (detail.delivery && selectedBenchmark === 'briefboard' && preview?.kind === 'browser-local' ? <PilotLivePreview key={detail.delivery.candidate.sourceHash} runId={detail.run.runId} ownerId={detail.run.ownerId} delivery={detail.delivery} /> : detail.delivery && approvedPrivateboard ? <PrivateboardPreview key={privateboardCandidateKey(detail.run.runId, detail.delivery)} runId={detail.run.runId} delivery={detail.delivery} /> : <div className="space-y-3 p-12 text-center text-sm text-slate-500">{selectedBenchmark === 'privateboard' ? <><p>{preview?.reason || 'Database preview requires runtime startup. No browser-storage substitute is used.'}</p><p className="text-xs">No exact accepted database delivery is available. Sources and recorded checks remain accessible; this is not a database preview.</p></> : <p>{selectedBenchmark === null ? preview?.reason : terminal(detail.run.status) ? 'No delivery was promoted. Sources and recorded failures remain available.' : 'The preview appears only after the exact candidate passes the required checks.'}</p>}</div>)}
        {tab === 'source' && <div className="space-y-4 p-4">{latest ? <><p className="text-xs text-slate-500">Latest recorded source · {latest.revision} · {latest.hash === detail.delivery?.candidate.sourceHash ? 'matches the approved delivery' : 'not an approved delivery'}. {selectedBenchmark === 'privateboard' && 'SQL migrations are shown as source; viewing them does not apply or roll back database changes.'}</p>{latest.files.map(file => <details key={file.path} open className="overflow-hidden rounded-xl border border-slate-200"><summary className="cursor-pointer break-all bg-slate-50 px-3 py-2 font-mono text-xs">{file.path} · {latest.revision}{file.path.endsWith('.sql') ? ' · database migration' : ''}</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap bg-[#111420] p-4 text-[11px] leading-5 text-slate-200">{file.content}</pre></details>)}</> : <p className="text-xs text-slate-500">No source snapshot has been recorded yet.</p>}</div>}
        {tab === 'changes' && <div className="space-y-4 p-4">{detail.snapshots.length < 2 ? <p className="text-xs text-slate-500">A second immutable revision is required for a comparison.</p> : <PilotChanges snapshots={detail.snapshots} database={selectedBenchmark === 'privateboard'} />}</div>}
        {tab === 'checks' && <PilotChecks detail={detail} />}
      </section>
    </div>}
  </div></main>;
}

function PilotChanges({ snapshots, database }: { snapshots: PilotSavedSnapshot[]; database: boolean }) {
  const before = snapshots.at(-2)!.snapshot, after = snapshots.at(-1)!.snapshot;
  const paths = Array.from(new Set([...before.files.map(file => file.path), ...after.files.map(file => file.path)]));
  return <><p className="text-xs text-slate-500">{before.revision} → {after.revision}. {database ? 'Exact source and SQL migration comparison. Viewing this diff does not apply migrations or roll back a database.' : 'Exact source comparison. This browser-only pilot has no database migration or rollback.'}</p>{paths.map(path => {
    const old = before.files.find(item => item.path === path), file = after.files.find(item => item.path === path);
    if (old?.hash === file?.hash) return <p key={path} className="break-all text-xs text-emerald-700">✓ {path} unchanged</p>;
    const a = old ? old.content.split('\n') : [], b = file ? file.content.split('\n') : []; let start = 0, end = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
    return <section key={path} className="overflow-hidden rounded-xl border border-slate-200"><h3 className="break-all bg-slate-50 p-3 font-mono text-xs">{path} · {!old ? 'added' : !file ? 'removed' : `changed from line ${start + 1}`}</h3><pre className="max-h-96 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-5"><span className="text-rose-700">{a.slice(start, a.length - end).map(line => `− ${line}`).join('\n')}</span>{'\n'}<span className="text-emerald-700">{b.slice(start, b.length - end).map(line => `+ ${line}`).join('\n')}</span></pre></section>;
  })}</>;
}

function PilotChecks({ detail }: { detail: Detail }) {
  const report = [...detail.events].reverse().filter(event => event.type === 'verification.finished').map(event => readPilotCheckReport(event.details)).find(Boolean);
  const checks = report?.checks || detail.delivery?.checks || [];
  const limitations = report?.limitations || detail.delivery?.limitations || [];
  const revision = report?.revision || detail.delivery?.finalRevision;
  return <div className="space-y-4 p-4"><p className="text-xs text-slate-500">{revision ? `Recorded verification for ${revision}.` : 'No completed verification report has been recorded.'} Individual checks are evidence, not approval of a different candidate. Compilation is not a full TypeScript semantic check.</p>
    {!!checks.length && <ul className="space-y-2">{checks.map((check, index) => <li key={`${check.id}-${index}`} className="rounded-xl border border-slate-200 p-3"><div className="flex flex-wrap justify-between gap-2"><p className="break-all font-mono text-[10px]">{check.id}</p><span className={`text-[10px] font-semibold ${check.passed ? 'text-emerald-700' : 'text-rose-700'}`}>{check.passed ? 'Passed' : 'Failed'}</span></div><p className="mt-1 break-words text-xs leading-5 text-slate-500">{check.details}</p></li>)}</ul>}
    {!!report?.failures.length && <section className="rounded-xl bg-rose-50 p-3 text-xs text-rose-800"><h3 className="font-semibold">Recorded failures</h3><ul className="mt-2 list-disc space-y-1 pl-4">{report.failures.map((failure, index) => <li key={index}>{failure}</li>)}</ul></section>}
    {!!limitations.length && <section className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900"><h3 className="font-semibold">Recorded limitations</h3><ul className="mt-2 list-disc space-y-1 pl-4">{limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></section>}
    {detail.delivery && <section className="rounded-xl border border-slate-200 p-3 text-xs text-slate-500"><h3 className="font-semibold text-[#111420]">Approved compiled output · {detail.delivery.candidate.revision}</h3><p className="mt-2 break-all font-mono text-[10px]">{detail.delivery.compiledHash}</p><ul className="mt-2 space-y-1">{detail.delivery.compiledFiles.map(file => <li key={file.path} className="font-mono text-[10px]">{file.path}</li>)}</ul></section>}
  </div>;
}

const privateboardCandidateKey = (runId: string, delivery: PilotDelivery) => [runId, delivery.candidate.revision, delivery.candidate.sourceHash, delivery.candidate.contractHash, delivery.candidate.runtimeDigest].join(':');

function PrivateboardPreview({ runId, delivery }: { runId: string; delivery: PilotDelivery }) {
  const sourceHash = delivery.candidate.sourceHash;
  const candidateKey = privateboardCandidateKey(runId, delivery);
  const pending = useRef<AbortController | null>(null);
  const [session, setSession] = useState<{ candidateKey: string; url: string; attempt: number } | null>(null);
  const [starting, setStarting] = useState(false), [failure, setFailure] = useState('');
  useEffect(() => {
    setSession(null); setStarting(false); setFailure('');
    return () => { pending.current?.abort(); pending.current = null; };
  }, [runId, sourceHash, candidateKey]);
  async function startPreview() {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    setStarting(true); setFailure('');
    try {
      const response = await fetch('/api/generator/pilot/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, sourceHash }), signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Database preview could not be started.');
      const url = privateboardPreviewUrl(data.url, window.location.origin);
      if (data.sourceHash !== sourceHash || !url) throw new Error('The preview response does not match the approved candidate or isolated app address.');
      if (pending.current !== controller || controller.signal.aborted) return;
      setSession(current => ({ candidateKey, url, attempt: (current?.attempt || 0) + 1 }));
    } catch (error) {
      if (pending.current === controller && !controller.signal.aborted) setFailure(error instanceof Error ? error.message : 'Database preview could not be started. Retry is available.');
    } finally {
      if (pending.current === controller && !controller.signal.aborted) { pending.current = null; setStarting(false); }
    }
  }
  const currentSession = session?.candidateKey === candidateKey ? session : null;
  return <><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><div><p className="text-xs font-semibold">Privateboard database preview · {delivery.candidate.revision}</p><p className="mt-1 text-[10px] text-slate-500">Dedicated local Supabase runtime · real authentication and database storage · not a production deployment</p></div><div className="flex flex-wrap items-center gap-3"><button onClick={() => void startPreview()} disabled={starting} className="rounded-lg bg-[#111420] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{starting ? 'Starting database preview…' : currentSession ? 'Reconnect preview' : failure ? 'Retry database preview' : 'Start database preview'}</button>{currentSession && <a href={currentSession.url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-rose-500">Open app ↗</a>}</div></div>
    {failure && <p role="alert" className="bg-amber-50 p-3 text-xs text-amber-800">{failure}</p>}
    {currentSession ? <iframe key={`${candidateKey}:${currentSession.attempt}`} title="Privateboard isolated database preview" data-testid="privateboard-preview" sandbox={PRIVATEBOARD_PREVIEW_SANDBOX} referrerPolicy="no-referrer" src={currentSession.url} onError={() => { setSession(null); setFailure('The database preview could not be loaded. Start it again to reconnect.'); }} className="h-[720px] w-full border-0 bg-white" /> : <p className="p-12 text-center text-sm text-slate-500">{starting ? 'Starting the approved candidate’s database runtime. No new generation is requested.' : 'Database preview requires runtime startup. Click Start database preview to open the accepted candidate; this does not start a paid generation.'}</p>}
  </>;
}

function PilotLivePreview({ runId, ownerId, delivery }: { runId: string; ownerId: string; delivery: PilotDelivery }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [failure, setFailure] = useState('');
  const [context, setContext] = useState<{ nonce: string; key: string; document: string } | null>(null);
  useEffect(() => {
    const nonce = crypto.randomUUID(); const key = `dk-v2-preview:${ownerId}:${runId}`;
    let values: Record<string, string> = {};
    try { const stored = JSON.parse(localStorage.getItem(key) || '{}'); if (validPilotStorage(stored)) values = stored; } catch { /* Start safely empty if browser storage is unavailable. */ }
    setContext({ nonce, key, document: pilotPreviewDocument(delivery.compiledFiles, runId, nonce, values) });
  }, [delivery.compiledHash, ownerId, runId]);
  useEffect(() => {
    if (!context) return;
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !acceptsPilotStorageMessage(event.data, runId, context.nonce)) return;
      try { localStorage.setItem(context.key, JSON.stringify(event.data.values)); setFailure(''); }
      catch { setFailure('Preview data could not be saved in this browser. Keep this page open or export the app; changes may be lost on reload.'); }
    };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, [context, runId]);
  return <><div className="flex flex-wrap justify-between gap-2 border-b border-slate-100 px-4 py-2 text-[10px] text-slate-500"><span>Isolated preview · browser data scoped to this pilot</span><span>{delivery.checks.filter(check => check.passed).length} recorded checks · {delivery.refinementVerified ? 'localized edit verified' : 'initial app verified; refinement not yet approved'}</span></div>{failure && <p role="alert" className="bg-amber-50 p-3 text-xs text-amber-800">{failure}</p>}{context ? <iframe ref={frame} title="Briefboard isolated preview" data-testid="pilot-preview" sandbox={PILOT_PREVIEW_SANDBOX} srcDoc={context.document} className="h-[720px] w-full border-0 bg-white" /> : <p className="p-8 text-xs text-slate-500">Preparing isolated preview…</p>}</>;
}
