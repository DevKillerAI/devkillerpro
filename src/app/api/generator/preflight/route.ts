import { NextResponse } from 'next/server';
import { accessContext, accessError, enforceRateLimit } from '@/lib/server/access';
import { contractSchema } from '@/lib/server/generator/contract';
import { evaluatePreflight, RUNTIME_PACKS } from '@/lib/server/generator/preflight';
import { inspectCurrentV2Readiness } from '@/lib/server/generator/readiness';
import {isSameOriginRequest} from '@/lib/server/requestOrigin';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };

export async function GET(req: Request) {
  try {
    const access = await accessContext(req);
    if (access.internal || access.role !== 'admin') throw new Error('FORBIDDEN');
    return NextResponse.json(await inspectCurrentV2Readiness(), { headers });
  } catch (error) {
    const known = accessError(error);
    return NextResponse.json({ error: known?.error || 'Unable to inspect generator readiness.' }, { status: known?.status || 503, headers });
  }
}

// Administrative draft inspection only. Does not authorize the submitted project IDs,
// accept verification evidence, persist state, start work, or call any model.
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return NextResponse.json({ error: 'Origin not allowed.' }, { status: 403, headers });
  try {
    const access = await accessContext(req);
    if (access.internal || access.role !== 'admin') throw new Error('FORBIDDEN');
    await enforceRateLimit(access, 'generator:preflight', 20, 60);
    const reader = req.body?.getReader();
    if (!reader) return NextResponse.json({ error: 'A contract is required.' }, { status: 400, headers });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 128 * 1024) { await reader.cancel(); return NextResponse.json({ error: 'Contract is too large.' }, { status: 413, headers }); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    let value: unknown;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return NextResponse.json({ error: 'Invalid contract JSON.' }, { status: 400, headers }); }
    const parsed = contractSchema.safeParse(value);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid v2 contract.', fields: parsed.error.issues.map(issue => issue.path.join('.')) }, { status: 400, headers });
    if (parsed.data.identity.ownerId !== access.userId) throw new Error('FORBIDDEN');
    const readiness = await inspectCurrentV2Readiness();
    const result = evaluatePreflight(parsed.data, {
      identity: parsed.data.identity,
      runtimePacks: RUNTIME_PACKS, executorEnabled: readiness.executorEnabled,
      availableCapabilities: readiness.observation?.runtimeAvailable ? ['react'] : [],
      monetaryReservationsAvailable: Boolean(readiness.observation?.reservationsAvailable),
    });
    return NextResponse.json({ ...result, inspectionOnly: true }, { headers });
  } catch (error) {
    const known = accessError(error);
    return NextResponse.json({ error: known?.error || 'Unable to inspect the contract.' }, { status: known?.status || 503, headers });
  }
}
