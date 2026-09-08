import postgres from 'postgres';

async function run() {
  const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:54322/postgres');
  const rows = await sql`SELECT id, contract->>'title' as title, status, details FROM dk_generator_v2.runs ORDER BY created_at DESC LIMIT 15`;
  for (const r of rows) {
    console.log(r.id, '|', r.title, '|', r.status, '|', r.details?.error || r.details?.reason || '');
  }
  await sql.end();
}

run().catch(console.error);
