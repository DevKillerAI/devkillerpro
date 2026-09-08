import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/** Retired endpoint: never parse payloads, reserve credits, or enqueue V1 jobs. */
function retired() {
  return NextResponse.json({ success: false, enabled: false, code: 'GENERATOR_V1_DEPRECATED',
    error: 'The legacy mission queue is retired. Use the V2 generator at /create.',
    replacement: '/api/generator/workbench' }, { status: 410, headers: { 'Cache-Control': 'no-store' } });
}

export const GET = retired;
export const POST = retired;
export const DELETE = retired;
