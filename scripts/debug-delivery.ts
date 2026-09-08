import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pilotArtifactDirectory } from '@/lib/server/generator/pilotRuntime';
import { sameCandidate } from '@/lib/server/generator/releaseGate';
import { pilotBundleHash } from '@/lib/server/generator/pilotDelivery';

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
  
  const dir = pilotArtifactDirectory(snap.snapshot);
  const text = await readFile(path.join(dir, 'delivery.json'), 'utf8');
  const result = JSON.parse(text);
  
  console.log('accepted:', run.accepted);
  console.log('result.candidate:', result.candidate);
  console.log('sameCandidate:', sameCandidate(run.accepted, result.candidate));
  console.log('compiledFiles length:', result.compiledFiles?.length);
  console.log('compiledFiles paths:', result.compiledFiles?.map((f: any) => f.path));
  console.log('pilotBundleHash matches:', pilotBundleHash(result.compiledFiles) === result.compiledHash);
  console.log('calculated hash:', pilotBundleHash(result.compiledFiles));
  console.log('result.compiledHash:', result.compiledHash);

  await sql.end();
}
main();
