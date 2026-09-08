import postgres from 'postgres';
import { readPilotDelivery } from '@/lib/server/generator/pilotDelivery';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');

async function main() {
  const [run] = await sql`
    SELECT id, accepted FROM dk_generator_v2.runs 
    WHERE id = 'v2-app-9d280bacae52-85d226b1-fd10-4322-be29-5fed90a4cdd3'
  `;
  const snaps = await sql`
    SELECT snapshot, candidate FROM dk_generator_v2.snapshots 
    WHERE run_id = 'v2-app-9d280bacae52-85d226b1-fd10-4322-be29-5fed90a4cdd3'
  `;
  const saved = snaps.find((s: any) => s.candidate.revision === run.accepted?.revision);
  if (!saved || !run?.accepted) return;
  const delivery = await readPilotDelivery(saved.snapshot, run.accepted);
  if (!delivery) return;
  const js = delivery.compiledFiles.find((f: any) => f.path === 'assets/app.js')?.content || '';
  console.log('--- LAST 500 CHARACTERS OF app.js ---');
  console.log(js.slice(-500));
  await sql.end();
}
main();
