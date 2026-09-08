import { readFile } from 'node:fs/promises';
import { database, closeDatabase } from '../src/lib/server/database';

async function main() {
  const configured = new URL(process.env.DATABASE_URL || 'invalid');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(configured.hostname)) throw new Error('Pilot setup is restricted to the configured local database.');
  if (!process.argv.includes('--apply')) throw new Error('Use --apply to create the isolated dk_generator_v2 schema. Existing app schemas are not changed.');
  const sql = [
    await readFile('scripts/sql/generator-v2-pilot.sql', 'utf8'),
    await readFile('scripts/sql/generator-v2-workbench.sql', 'utf8'),
  ].join('\n');
  const connection = await database().reserve();
  try { await connection.unsafe(sql); } finally { connection.release(); }
  const rows = await database()`select table_name from information_schema.tables where table_schema='dk_generator_v2' order by table_name`;
  console.log(JSON.stringify({ schema: 'dk_generator_v2', tables: rows.map(row => row.table_name), applied: true }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Setup failed'); process.exitCode = 1; }).finally(closeDatabase);
