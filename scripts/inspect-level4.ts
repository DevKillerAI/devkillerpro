import postgres from 'postgres';
import { parsePilotOutput } from '../src/lib/server/generator/pilotProvider';

async function run() {
  const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:54322/postgres');
  const calls = await sql`SELECT operation_id, status, result FROM dk_generator_v2.calls WHERE run_id = 'v2-app-9d280bacae52-473a6e15-7f2b-4491-8625-236192f12a4c'`;
  console.log('Calls count:', calls.length);
  const buildCall = calls.find((x: any) => x.operation_id === 'build-1') || calls[0];
  if (buildCall?.result) {
    const parsed = parsePilotOutput<any>(buildCall.result);
    const appTsx = parsed.files?.find((f: any) => f.path === 'src/App.tsx')?.content || '';
    console.log('App.tsx top 80 lines:');
    console.log(appTsx.split('\n').slice(0, 80).join('\n'));


  }
  await sql.end();
}

run().catch(console.error);
