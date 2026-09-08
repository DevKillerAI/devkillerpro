import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');

async function main() {
  const calls = await sql`
    SELECT *
    FROM dk_generator_v2.calls
    ORDER BY created_at DESC
    LIMIT 5
  `;
  for (const c of calls) {
    console.log('--- CALL ---', Object.keys(c));
    console.log('run_id:', c.run_id, 'op:', c.operation_id, 'model:', c.model, 'status:', c.status);
    console.log('actual_micros:', c.actual_micros, 'usage:', c.usage);
    console.log('created_at:', c.created_at);
    console.log('result id:', c.result?.id);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
