import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { createWorkbenchContract } from '../src/lib/server/generator/workbenchContract';
import { createPilotRun } from '../src/lib/server/generator/pilotStore';
import { PILOT_CAMPAIGN } from '../src/lib/server/generator/pilotContract';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');

async function main() {
  const [row] = await sql`SELECT contract FROM dk_generator_v2.runs WHERE id = 'v2-app-9d280bacae52-02e620f2-16c4-414b-9ea6-0d6de23e7dd2'`;
  const contractJson = typeof row.contract === 'string' ? JSON.parse(row.contract) : row.contract;
  const promptObj = typeof contractJson.prompt === 'string' ? JSON.parse(contractJson.prompt) : contractJson.prompt;
  const pomePrompt = promptObj.brief || promptObj.prompt || contractJson.prompt;
  
  const ownerId = 'e5b94265-5bfe-41fb-81a9-43efad7b2a83';
  const requestId = randomUUID();

  console.log(`Preparing POME Run (Request ID: ${requestId})`);
  console.log(`Prompt length: ${pomePrompt.length} characters`);

  const contract = createWorkbenchContract(ownerId, {
    requestId,
    title: 'POME — Plataforma de Gestão de Clima Escolar',
    prompt: pomePrompt,
    briefingMode: 'detailed',
    localScopeAccepted: true,
  });

  console.log('Contract Identity:', contract.identity);
  console.log('Capabilities:', contract.capabilities);
  console.log('Runtime:', contract.runtime);

  const run = await createPilotRun(contract, PILOT_CAMPAIGN, 100_000_000);
  console.log('\n>>> POME RUN CREATED SUCCESSFULLY! <<<');
  console.log('Run ID:', run.runId);
  console.log('Status:', run.status);
  console.log('Mission ID:', contract.identity.missionId);

  await sql.end();
}

main().catch(err => {
  console.error('Failed to launch POME run:', err);
  process.exit(1);
});
