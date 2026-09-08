import fs from 'node:fs/promises';

async function analyze() {
  const dump = JSON.parse(await fs.readFile('scripts/pc-service-dump.json', 'utf8'));
  const build1 = dump.calls.find((c: any) => c.operation_id === 'build-1');
  const repair1 = dump.calls.find((c: any) => c.operation_id === 'repair-1');
  
  const parsed = typeof build1.result === 'string' ? JSON.parse(build1.result) : build1.result;
  console.log('=== BUILD-1 JOURNEYS ===');
  console.log(JSON.stringify(parsed.journeys, null, 2));

  const app = parsed.files?.find((f: any) => f.path === 'src/App.tsx')?.content || '';
  
  // Find where client-search is in App.tsx
  const lines = app.split('\n');
  lines.forEach((l: string, idx: number) => {
    if (l.includes('client-search') || l.includes('advance-status') || l.includes('tab-') || l.includes('nav-')) {
      console.log(`L${idx + 1}: ${l.trim()}`);
    }
  });

  // What is the initial tab or screen rendered?
  console.log('\n=== INITIAL TAB / SCREEN ===');
  lines.forEach((l: string, idx: number) => {
    if (l.includes('useState') && (l.includes('tab') || l.includes('view') || l.includes('screen') || l.includes('page'))) {
      console.log(`L${idx + 1}: ${l.trim()}`);
    }
  });
}

analyze().catch(console.error);
