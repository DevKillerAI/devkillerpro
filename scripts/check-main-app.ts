import fs from 'node:fs/promises';
import { parsePilotOutput } from '../src/lib/server/generator/pilotProvider';

async function checkMainApp() {
  const dump = JSON.parse(await fs.readFile('scripts/pc-service-dump.json', 'utf8'));
  const build1 = dump.calls.find((c: any) => c.operation_id === 'build-1');
  const parsed: any = parsePilotOutput(build1.result);
  const app = parsed.files?.find((f: any) => f.path === 'src/App.tsx')?.content || '';
  
  // Find App component definition
  const idx = app.indexOf('export default function App');
  if (idx >= 0) {
    console.log(app.slice(idx, idx + 2500));
  }
}

checkMainApp().catch(console.error);
