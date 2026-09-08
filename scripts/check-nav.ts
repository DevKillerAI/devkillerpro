import fs from 'node:fs/promises';
import { parsePilotOutput } from '../src/lib/server/generator/pilotProvider';

async function checkNav() {
  const dump = JSON.parse(await fs.readFile('scripts/pc-service-dump.json', 'utf8'));
  const build1 = dump.calls.find((c: any) => c.operation_id === 'build-1');
  const parsed: any = parsePilotOutput(build1.result);
  const app = parsed.files?.find((f: any) => f.path === 'src/App.tsx')?.content || '';
  
  const returnIdx = app.lastIndexOf('return (');
  if (returnIdx >= 0) {
    console.log(app.slice(returnIdx, returnIdx + 1500));
  }
}

checkNav().catch(console.error);
