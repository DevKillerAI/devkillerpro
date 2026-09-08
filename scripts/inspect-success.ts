import postgres from 'postgres';
import { getPilotRun } from '../src/lib/server/generator/pilotStore';

async function inspect() {
  const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:54322/postgres');
  const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'dk_generator_v2'`;
  console.log('Tables:', tables.map(t => t.table_name));
  const snaps = await sql`SELECT run_id, snapshot FROM dk_generator_v2.snapshots WHERE run_id = 'v2-app-9d280bacae52-abbe7c59-6132-465b-8c8d-ceed9827cff9'`;
  console.log('Snapshots found:', snaps.length);
  const snap = snaps[0]?.snapshot;
  if (snap?.files) {
    console.log('\n--- SNAPSHOT FILES (' + snap.files.length + ' files) ---');
    snap.files.forEach((f: any) => console.log(` - ${f.path} (${f.content.length} bytes)`));
    const css = snap.files.find((f: any) => f.path === 'src/styles.css')?.content || '';
    console.log('\n--- CSS PREVIEW (:root TOKENS) ---');
    console.log(css.slice(0, 1200));
  }
  await sql.end();
}

inspect().catch(console.error);
