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
  
  const saved = snaps.find((s: any) => s.candidate.revision === run.accepted?.revision && s.candidate.sourceHash === run.accepted?.sourceHash);
  console.log('Found saved snapshot for accepted revision?', Boolean(saved));
  if (saved) {
    const delivery = await readPilotDelivery(saved.snapshot, run.accepted);
    console.log('Delivery loaded successfully?', Boolean(delivery));
    if (delivery) {
      console.log('Compiled files count:', delivery.compiledFiles?.length);
      console.log('Compiled files:', delivery.compiledFiles?.map((f: any) => ({ path: f.path, size: f.content.length })));
      const js = delivery.compiledFiles?.find((f: any) => f.path === 'assets/app.js')?.content;
      console.log('app.js size:', js?.length);
      console.log('app.js first 100 chars:', js?.slice(0, 100));
      const css = delivery.compiledFiles?.find((f: any) => f.path === 'assets/app.css')?.content;
      console.log('app.css size:', css?.length);
      console.log('app.css first 100 chars:', css?.slice(0, 100));
    }
  }

  await sql.end();
}
main().catch(console.error);
