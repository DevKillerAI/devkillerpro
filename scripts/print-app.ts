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
  const saved = snaps.find((s: any) => s.candidate.revision === run?.accepted?.revision);
  if (!saved) return;
  const file = saved.snapshot.files.find((f: any) => f.path === 'src/App.tsx');
  if (file) console.log(file.content);
  await sql.end();
}
main();
