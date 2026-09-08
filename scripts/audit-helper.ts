import postgres from 'postgres';

async function run() {
  const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:54322/postgres');
  const rows = await sql`SELECT id, contract->>'title' as title, contract->>'prompt' as prompt, status, details FROM dk_generator_v2.runs ORDER BY created_at DESC LIMIT 40`;
  console.log('Total runs found:', rows.length);
  for (const r of rows) {
    console.log(`[${r.status}] ${r.id} | Title: ${r.title}`);
    if (r.prompt) {
      console.log('   Prompt preview:', r.prompt.slice(0, 150));
    }
  }
  await sql.end();
}

run().catch(console.error);
