import postgres from 'postgres';
import { parsePilotOutput } from '../src/lib/server/generator/pilotProvider';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');

async function run() {
  const latest = await sql`SELECT id FROM dk_generator_v2.runs ORDER BY created_at DESC LIMIT 1`;
  const runId = latest[0]?.id;
  console.log('Inspecting Run:', runId);
  const calls = await sql`SELECT operation_id, status, result FROM dk_generator_v2.calls WHERE run_id = ${runId}`;
  console.log('Calls found:', calls.length);
  for (const c of calls) {
    console.log('Operation:', c.operation_id, 'Status:', c.status);
    if (c.result) {
      const parsed = parsePilotOutput<any>(c.result);
      console.log('Result keys:', Object.keys(parsed));
      console.log('Files:', parsed.files?.map((f: any) => f.path));
      console.log('Journeys count:', parsed.journeys?.length);
      console.log('Journeys raw:', JSON.stringify(parsed.journeys, null, 2));
      const appTsx = parsed.files?.find((f: any) => f.path === 'src/App.tsx')?.content || '';
      console.log('App.tsx length:', appTsx.length);
      const buttons = [...appTsx.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map(m => m[0].slice(0, 100));
      console.log('App.tsx buttons:', buttons);
      const testIds = [...appTsx.matchAll(/data-testid=["']([^"']+)["']/g)].map(m => m[1]);
      console.log('App.tsx data-testids:', testIds);

    }
  }
  await sql.end();
}

run().catch(console.error);

