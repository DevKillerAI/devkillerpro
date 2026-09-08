import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST() {
  return NextResponse.json(
    {
      error: 'GONE',
      code: 'DELIBERATE_V1_DEPRECATED',
      message: 'The V1 deliberation API is deprecated and disabled. Use the DevKiller V2 generator workflow at /create and /api/generator/workbench.',
      v2Endpoint: '/api/generator/workbench',
    },
    { status: 410 }
  );
}

export async function GET() {
  return NextResponse.json(
    {
      error: 'GONE',
      code: 'DELIBERATE_V1_DEPRECATED',
      message: 'The V1 deliberation API is deprecated and disabled. Use DevKiller V2 at /create.',
    },
    { status: 410 }
  );
}
