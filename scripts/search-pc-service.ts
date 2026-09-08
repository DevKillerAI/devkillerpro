import postgres from 'postgres';

async function searchCalls() {
  const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:54322/postgres');
  const calls = await sql`SELECT run_id, result::text as res FROM dk_generator_v2.calls WHERE result::text LIKE '%client-search%' OR result::text LIKE '%advance-status%'`;
  console.log('Matching calls:', calls.length);
  for (const c of calls) {
    console.log('Matched run_id:', c.run_id);
    const [run] = await sql`SELECT contract, details FROM dk_generator_v2.runs WHERE id = ${c.run_id}`;
    console.log('Run contract:', run?.contract?.prompt?.slice(0, 300));
    console.log('Run details:', JSON.stringify(run?.details, null, 2).slice(0, 500));
  }
  await sql.end();
}

searchCalls().catch(console.error);
