import { writeFile } from 'node:fs/promises';
import postgres from 'postgres';
import { readPilotDelivery } from '../src/lib/server/generator/pilotDelivery';
import { pilotPreviewDocument } from '../src/lib/workspace/pilotPreview';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');

async function main() {
  const [run] = await sql`
    SELECT id, accepted FROM dk_generator_v2.runs 
    WHERE id = 'v2-app-9d280bacae52-47aca50e-679c-4d46-859a-14609c325793'
  `;
  const snaps = await sql`
    SELECT snapshot, candidate FROM dk_generator_v2.snapshots 
    WHERE run_id = ${run.id}
  `;
  const saved = snaps.find((s: any) => s.candidate.revision === run.accepted.revision);
  if (!saved) throw new Error('Saved snapshot not found');
  const delivery = await readPilotDelivery(saved.snapshot, run.accepted);
  if (!delivery) throw new Error('Delivery not found');

  const doc = pilotPreviewDocument(delivery.compiledFiles, run.id, '12345678901234567890', {});
  await writeFile('k:/dk_war_room/pome-preview.html', doc, 'utf8');
  console.log('Successfully generated k:/dk_war_room/pome-preview.html! File length:', doc.length);
  await sql.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
