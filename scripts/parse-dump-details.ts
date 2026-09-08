import fs from 'node:fs/promises';
import { parsePilotOutput } from '../src/lib/server/generator/pilotProvider';

async function checkParsed() {
  const dump = JSON.parse(await fs.readFile('scripts/pc-service-dump.json', 'utf8'));
  for (const c of dump.calls) {
    console.log('\n================ OPERATION:', c.operation_id, '================');
    const parsed: any = parsePilotOutput(c.result);
    console.log('Status:', parsed.status);
    console.log('Summary:', parsed.summary);
    console.log('Files:', parsed.files?.map((f: any) => f.path));
    console.log('Journeys:', JSON.stringify(parsed.journeys, null, 2));

    const app = parsed.files?.find((f: any) => f.path === 'src/App.tsx')?.content || '';
    if (app) {
      console.log('\n--- Searching App.tsx for testIds ---');
      const lines = app.split('\n');
      lines.forEach((l: string, idx: number) => {
        if (l.includes('client-search') || l.includes('advance-status') || l.includes('activeTab') || l.includes('setActiveTab') || l.includes('data-testid')) {
          if (l.includes('client-search') || l.includes('advance-status') || l.includes('Tab') || l.includes('nav-')) {
            console.log(`L${idx + 1}: ${l.trim()}`);
          }
        }
      });
    }
  }
}

checkParsed().catch(console.error);
