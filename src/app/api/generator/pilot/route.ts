import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOwnerAdmin } from '@/lib/server/adminAccess';
import { accessError, enforceRateLimit } from '@/lib/server/access';
import { createBriefboardContract, PILOT_CAMPAIGN } from '@/lib/server/generator/pilotContract';
import { createPrivateboardContract } from '@/lib/server/generator/supabasePilotContract';
import { createPilotRun, getPilotRun, listPilotRuns, getPilotEvents, getPilotSnapshots, cancelPilotRun } from '@/lib/server/generator/pilotStore';
import { inspectBriefboardRuntime } from '@/lib/server/generator/pilotRuntime';
import { inspectPrivateboardRuntime } from '@/lib/server/generator/supabasePilotRuntime';
import { exportPilotZip, readPilotDelivery } from '@/lib/server/generator/pilotDelivery';
import { scopedId } from '@/lib/server/generator/contract';
import { PILOT_BENCHMARKS, PILOT_BENCHMARK_LABELS, pilotBenchmarkForRuntime, pilotPreviewState, type PilotBenchmark, type PilotBenchmarkReadiness } from '@/lib/workspace/pilotBenchmarks';
import type { PilotRun } from '@/lib/server/generator/pilotStore';
import {assertSameOriginRequest} from '@/lib/server/requestOrigin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
const contractForBenchmark = { briefboard: createBriefboardContract, privateboard: createPrivateboardContract };
const inspectRuntimeForBenchmark = { briefboard: inspectBriefboardRuntime, privateboard: inspectPrivateboardRuntime };
const presentRun = (run: PilotRun) => ({ ...run, benchmark: pilotBenchmarkForRuntime(run.contract.runtime), runtime: run.contract.runtime });
function benchmarkReadiness(ownerId: string, benchmark: PilotBenchmark, runtime: Awaited<ReturnType<typeof inspectBriefboardRuntime>>): PilotBenchmarkReadiness {
  const contract = contractForBenchmark[benchmark](ownerId, '00000000-0000-4000-8000-000000000000');
  const providerConfigured = Boolean(process.env.OPENAI_API_KEY);
  return {
    id: benchmark, label: PILOT_BENCHMARK_LABELS[benchmark], brief: contract.prompt, runtime: contract.runtime,
    available: runtime.available && providerConfigured, runtimeAvailable: runtime.available, providerConfigured,
    reason: !runtime.available ? runtime.reason : !providerConfigured ? 'Server provider credentials are not configured.' : null,
    prerequisites: benchmark === 'privateboard'
      ? ['Prepared compiler/browser runtime', 'Dedicated Supabase environment', 'Fresh and upgrade migrations', 'Authentication and cross-owner isolation checks']
      : ['Prepared compiler/browser runtime', 'Browser-only persistence and independent acceptance checks'],
  };
}
function errorResponse(error: unknown) {
  const access = accessError(error);
  const code = error instanceof Error ? error.message : '';
  const known: Record<string, string> = {
    PILOT_CAMPAIGN_BUSY: 'A pilot is already active. Open it instead of starting another.',
    PILOT_RUN_CONFLICT: 'This request ID already belongs to a different pilot contract.',
  };
  return NextResponse.json({ error: access?.error || known[code] || 'Unable to process the isolated pilot. No legacy mission was started.' }, { status: access?.status || (known[code] ? 409 : error instanceof z.ZodError ? 400 : 503), headers });
}
function sameOrigin(req: Request) { assertSameOriginRequest(req); }
async function boundedBody(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error('A request body is required.');
  const pieces: Uint8Array[] = []; let bytes = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 2048) { await reader.cancel(); throw new Error('Pilot request too large.'); } pieces.push(part.value); } }
  finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(pieces).toString('utf8')) as unknown;
}

export async function GET(req: Request) {
  try {
    const access = await requireOwnerAdmin(req);
    const url = new URL(req.url), id = url.searchParams.get('run');
    if (!id) {
      const [runs, runtime, databaseRuntime] = await Promise.all([
        listPilotRuns(access.userId, PILOT_CAMPAIGN),
        inspectBriefboardRuntime(),
        inspectPrivateboardRuntime(),
      ]);
      const benchmarks = [benchmarkReadiness(access.userId, 'briefboard', runtime), benchmarkReadiness(access.userId, 'privateboard', databaseRuntime)];
      return NextResponse.json({ ownerId: access.userId, runs: runs.map(presentRun), benchmarks, runtime, ceilingMicros: 3_000_000 }, { headers });
    }
    scopedId.parse(id);
    const run = await getPilotRun(id, access.userId);
    if (!run) return NextResponse.json({ error: 'Pilot not found.' }, { status: 404, headers });
    const [events, snapshots] = await Promise.all([getPilotEvents(id, access.userId), getPilotSnapshots(id, access.userId)]);
    const accepted = run.accepted && snapshots.find(item => item.candidate.revision === run.accepted?.revision && item.candidate.sourceHash === run.accepted?.sourceHash);
    const delivery = accepted && run.accepted ? await readPilotDelivery(accepted.snapshot, run.accepted) : null;
    const benchmark = pilotBenchmarkForRuntime(run.contract.runtime);
    if (url.searchParams.get('download') === 'zip') {
      if (!accepted || !delivery) return NextResponse.json({ error: 'No verified export is available for this pilot.' }, { status: 409, headers });
      const zip = await exportPilotZip(accepted.snapshot, delivery);
      return new Response(new Uint8Array(zip), { headers: { ...headers, 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${benchmark || 'pilot'}-v2.zip"`, 'X-Content-Type-Options': 'nosniff' } });
    }
    return NextResponse.json({ run: presentRun(run), events, snapshots, delivery, preview: pilotPreviewState(run.contract.runtime) }, { headers });
  } catch (error) { return errorResponse(error); }
}

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const access = await requireOwnerAdmin(req);
    await enforceRateLimit(access, 'generator:pilot:create', 6, 60);
    const body = z.object({ requestId: z.string().uuid(), benchmark: z.enum(PILOT_BENCHMARKS).default('briefboard') }).strict().parse(await boundedBody(req));
    const contract = contractForBenchmark[body.benchmark](access.userId, body.requestId);
    // An uncertain submission must remain recoverable even if its runtime later
    // becomes unavailable. The store still rejects changed benchmark contracts.
    if (await getPilotRun(contract.identity.missionId, access.userId)) {
      const run = await createPilotRun(contract, PILOT_CAMPAIGN);
      return NextResponse.json({ run: presentRun(run) }, { status: 202, headers });
    }
    const runtime = await inspectRuntimeForBenchmark[body.benchmark]();
    if (!runtime.available || !process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'The pilot runtime or server credentials are not ready. No provider call was started.' }, { status: 503, headers });
    const run = await createPilotRun(contract, PILOT_CAMPAIGN);
    return NextResponse.json({ run: presentRun(run) }, { status: 202, headers });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(req: Request) {
  try {
    sameOrigin(req);
    const access = await requireOwnerAdmin(req);
    const body = z.object({ runId: scopedId, action: z.literal('cancel') }).strict().parse(await boundedBody(req));
    const run = await cancelPilotRun(body.runId, access.userId);
    return NextResponse.json(run ? { run } : { error: 'Pilot not found.' }, { status: run ? 200 : 404, headers });
  } catch (error) { return errorResponse(error); }
}
