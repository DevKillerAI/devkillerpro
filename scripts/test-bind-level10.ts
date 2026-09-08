import postgres from 'postgres';
import { parsePilotOutput } from '../src/lib/server/generator/pilotProvider';
import { bindWorkbenchJourneysToSource } from '../src/lib/server/generator/workbenchJourneyBinding';
import { createGeneratorSnapshot } from '../src/lib/server/generator/versionedEdits';

async function run() {
  const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:54322/postgres');
  const [c] = await sql`SELECT result FROM dk_generator_v2.calls WHERE run_id = 'v2-app-9d280bacae52-c6c9cfa2-e50b-4b55-975a-8d335ac1dbca'`;
  const parsed = parsePilotOutput<any>(c.result);
  const snap = createGeneratorSnapshot({
    scope: { ownerId: 'owner-1', projectId: 'proj-1', missionId: 'miss-1', environmentId: 'env-1' },
    revision: 'build-1',
    files: parsed.files
  });
  
  try {
    const bound = bindWorkbenchJourneysToSource(parsed.journeys, snap);
    console.log('Bound successfully! Count:', bound.journeys.length);
    console.log('Findings:', bound.findings);
    console.log('Bound journeys:', JSON.stringify(bound.journeys, null, 2));
  } catch (err: any) {
    console.error('Failed to bind:', err.message);
  }
  await sql.end();
}

run().catch(console.error);
