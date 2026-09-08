import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');

async function main() {
  const [row] = await sql`
    SELECT snapshot FROM dk_generator_v2.snapshots 
    WHERE run_id = 'v2-app-9d280bacae52-47aca50e-679c-4d46-859a-14609c325793' 
    AND candidate->>'revision' = 'repair-1'
  `;
  const app = row.snapshot.files.find((f: any) => f.path === 'src/App.tsx');
  console.log('App.tsx total lines:', app.content.split(/\r?\n/).length);
  console.log('App.tsx total characters:', app.content.length);

  const testIds = [...app.content.matchAll(/data-testid=["']([^"']+)["']/g)].map(m => m[1]);
  console.log('Unique data-testids (' + new Set(testIds).size + '):');
  console.log([...new Set(testIds)].join(', '));

  console.log('\n--- First 60 lines of App.tsx ---');
  console.log(app.content.split(/\r?\n/).slice(0, 60).join('\n'));

  await sql.end();
}

main().catch(console.error);
