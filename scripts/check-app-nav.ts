import fs from 'node:fs/promises';
import { parsePilotOutput } from '../src/lib/server/generator/pilotProvider';

async function checkAppNav() {
  const dump = JSON.parse(await fs.readFile('scripts/pc-service-dump.json', 'utf8'));
  const build1 = dump.calls.find((c: any) => c.operation_id === 'build-1');
  const parsed: any = parsePilotOutput(build1.result);
  const app = parsed.files?.find((f: any) => f.path === 'src/App.tsx')?.content || '';
  
  // Find where nav is in App.tsx
  const lines = app.split('\n');
  lines.forEach((l: string, idx: number) => {
    if (l.includes('<nav') || l.includes('setPage') || l.includes('data-testid="nav-') || l.includes('data-testid="tab-')) {
      console.log(`L${idx + 1}: ${l.trim()}`);
    }
  });
}

checkAppNav().catch(console.error);
