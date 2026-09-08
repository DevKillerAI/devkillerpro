import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST() {
  return NextResponse.json({ success: false, code: 'GENERATOR_V1_DEPRECATED',
    error: 'The legacy intake analyzer is retired. Submit your brief to the V2 generator at /create.',
    replacement: '/api/generator/workbench' }, { status: 410, headers: { 'Cache-Control': 'no-store' } });
}
