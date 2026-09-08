import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');

async function main() {
  const runs = await sql`
    SELECT id, status, details, created_at, updated_at 
    FROM dk_generator_v2.runs 
    ORDER BY created_at DESC 
    LIMIT 3
  `;
  for (const r of runs) {
    console.log('--- RUN ---');
    console.log('ID:', r.id);
    console.log('Status:', r.status);
    console.log('Created:', r.created_at);
    console.log('Certificate:', r.details?.certificate?.id);
    console.log('Verification status:', r.details?.verification?.status);
  }
  
  if (runs.length > 0) {
    const latest = runs[0];
    const [call] = await sql`
      SELECT result FROM dk_generator_v2.calls 
      WHERE run_id = ${latest.id} AND result IS NOT NULL 
      LIMIT 1
    `;
    if (call?.result) {
      const parsed = typeof call.result === 'string' ? JSON.parse(call.result) : call.result;
      const text = parsed.output?.find((x: any) => x.type === 'message')?.content?.[0]?.text;
      if (text) {
        try {
          const structured = JSON.parse(text);
          console.log('Files generated:', structured.files?.map((f: any) => f.path));
          const app = structured.files?.find((f: any) => f.path === 'src/App.tsx')?.content || '';
          console.log('App.tsx length:', app.length);
          console.log('App.tsx first 30 lines:\n', app.split('\n').slice(0, 30).join('\n'));
        } catch (err) {
          console.log('Parse error for structured result:', err);
        }
      }
    }
  }

  await sql.end();
}

main().catch(console.error);
