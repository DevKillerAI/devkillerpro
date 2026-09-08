import postgres from 'postgres';
import { readPilotDelivery } from '@/lib/server/generator/pilotDelivery';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');

async function main() {
  const [run] = await sql`
    SELECT id, accepted FROM dk_generator_v2.runs 
    WHERE id = 'v2-app-9d280bacae52-85d226b1-fd10-4322-be29-5fed90a4cdd3'
  `;
  const [snap] = await sql`
    SELECT snapshot FROM dk_generator_v2.snapshots 
    WHERE run_id = 'v2-app-9d280bacae52-85d226b1-fd10-4322-be29-5fed90a4cdd3'
    LIMIT 1
  `;
  try {
    const delivery = await readPilotDelivery(snap.snapshot, run.accepted);
    if (!delivery) return;
    console.log('Delivery loaded! compiledFiles:', delivery.compiledFiles?.map((f: any) => ({ path: f.path, size: f.content.length })));
    const css = delivery.compiledFiles?.find((f: any) => f.path.includes('.css'));
    console.log('Compiled CSS size:', css?.content.length);
    console.log('Compiled CSS sample:', css?.content.slice(0, 200));
  } catch (err) {
    console.error('Delivery load error:', err);
  }
  await sql.end();
}
main();
