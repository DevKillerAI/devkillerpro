import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:54322/postgres');

async function run() {
  const [lastRun] = await sql`SELECT id, contract->>'title' as title, status, details FROM dk_generator_v2.runs ORDER BY created_at DESC LIMIT 1`;
  console.log('Run ID:', lastRun?.id);
  console.log('Status:', lastRun?.status);
  console.log('Details:', JSON.stringify(lastRun?.details, null, 2));
  if (!lastRun?.id) return sql.end();
  const events = await sql`SELECT sequence, type, message, details FROM dk_generator_v2.events WHERE run_id = ${lastRun.id} ORDER BY sequence ASC`;
  console.log('--- Events ---');
  for (const e of events) {
    console.log(`[${e.sequence}] [${e.type}] ${e.message}`);
    if (e.type.includes('verification') || e.type.includes('error') || e.type.includes('failed')) {
      console.log('   Details:', JSON.stringify(e.details, null, 2));
    }
  }
  await sql.end();
}

run().catch(console.error);
