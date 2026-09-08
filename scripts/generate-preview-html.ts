import postgres from 'postgres';
import { readPilotDelivery } from '@/lib/server/generator/pilotDelivery';
import { pilotPreviewDocument } from '@/lib/workspace/pilotPreview';
import { writeFile } from 'node:fs/promises';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');

async function main() {
  const [run] = await sql`
    SELECT id, accepted, owner_id FROM dk_generator_v2.runs 
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
  
  const doc = pilotPreviewDocument(delivery.compiledFiles, run.id, '12345678901234567890', {});
  await writeFile('k:/dk_war_room/agroops-preview.html', doc, 'utf8');
  console.log('Saved agroops-preview.html, length:', doc.length);
  
  // Let's inspect CSS in doc
  console.log('doc contains styles.css rules?', doc.includes('--canvas:#121914') || doc.includes('bg-'));
  await sql.end();
}
main();
