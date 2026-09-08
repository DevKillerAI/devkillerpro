import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');

async function main() {
  const [run] = await sql`
    SELECT id, status, accepted, details 
    FROM dk_generator_v2.runs 
    WHERE id = 'v2-app-9d280bacae52-85d226b1-fd10-4322-be29-5fed90a4cdd3'
  `;
  console.log('Accepted:', run.accepted);
  console.log('Verification checks:', run.details?.verification?.checks);
  console.log('Verification summary:', run.details?.verification?.summary);

  const [snap] = await sql`
    SELECT snapshot, candidate 
    FROM dk_generator_v2.snapshots 
    WHERE run_id = 'v2-app-9d280bacae52-85d226b1-fd10-4322-be29-5fed90a4cdd3'
    ORDER BY created_at DESC 
    LIMIT 1
  `;
  if (snap?.snapshot) {
    const parsed = typeof snap.snapshot === 'string' ? JSON.parse(snap.snapshot) : snap.snapshot;
    console.log('Snapshot files:', parsed.files?.map((f: any) => ({ path: f.path, size: f.content?.length })));
    const css = parsed.files?.find((f: any) => f.path.includes('css'))?.content;
    console.log('CSS content sample:', css?.slice(0, 300));
    const js = parsed.files?.find((f: any) => f.path.includes('app.js'))?.content;
    console.log('app.js size:', js?.length);
  }

  await sql.end();
}

main().catch(console.error);
