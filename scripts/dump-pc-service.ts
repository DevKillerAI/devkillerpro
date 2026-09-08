import postgres from 'postgres';
import fs from 'node:fs/promises';

async function dumpPcService() {
  const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:54322/postgres');
  const runId = 'v2-app-9d280bacae52-afa20988-55cc-41dd-ba16-11dacb767b43';
  
  const [run] = await sql`SELECT * FROM dk_generator_v2.runs WHERE id = ${runId}`;
  const calls = await sql`SELECT * FROM dk_generator_v2.calls WHERE run_id = ${runId}`;
  const events = await sql`SELECT * FROM dk_generator_v2.events WHERE run_id = ${runId} ORDER BY created_at ASC`;
  const snapshots = await sql`SELECT * FROM dk_generator_v2.snapshots WHERE run_id = ${runId}`;
  
  const dump = { run, calls, events, snapshots };
  await fs.writeFile('scripts/pc-service-dump.json', JSON.stringify(dump, null, 2));
  console.log('Dumped PC Service run to scripts/pc-service-dump.json');
  console.log('Contract Prompt:', run.contract?.prompt);
  console.log('Status:', run.status);
  console.log('Details:', run.details);
  await sql.end();
}

dumpPcService().catch(console.error);
