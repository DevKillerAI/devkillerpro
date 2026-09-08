import postgres from 'postgres';
import { retrieveWorkbenchGrounding } from '../src/lib/server/generator/workbenchGrounding';
import { createWorkbenchQualityPlan } from '../src/lib/server/generator/workbenchQuality';

async function run() {
  const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:54322/postgres');
  const events = await sql`SELECT run_id, message, details FROM dk_generator_v2.events WHERE type = 'knowledge.retrieved' ORDER BY created_at DESC LIMIT 5`;
  console.log('--- DB KNOWLEDGE EVENTS ---');
  console.log(JSON.stringify(events, null, 2));

  // Test retrieval directly for Level 10 prompt
  console.log('\n--- DIRECT RETRIEVAL TEST FOR ERP ---');
  const prompt = 'Crie um sistema ERP completo de gestão industrial e suprimentos corporativos...';
  const quality = createWorkbenchQualityPlan(prompt, 'detailed');
  console.log('Quality Plan:', JSON.stringify(quality, null, 2));

  const grounding = await retrieveWorkbenchGrounding(prompt, quality, 'test-rag');
  console.log('Grounding Mode:', grounding.mode);
  console.log('Grounding Hit IDs:', grounding.hitIds);
  console.log('Grounding Text Preview (first 500 chars):', grounding.text.slice(0, 500));

  await sql.end();
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
