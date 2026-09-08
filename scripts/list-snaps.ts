import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');

async function main() {
  const snaps = await sql`
    SELECT candidate, created_at, snapshot FROM dk_generator_v2.snapshots 
    WHERE run_id = 'v2-app-9d280bacae52-85d226b1-fd10-4322-be29-5fed90a4cdd3'
    ORDER BY created_at ASC
  `;
  console.log('Snapshots count:', snaps.length);
  for (const s of snaps) {
    const c = s.candidate;
    console.log(c?.revision, c?.sourceHash?.slice(0, 10), s.created_at);
  }
  await sql.end();
}
main();
