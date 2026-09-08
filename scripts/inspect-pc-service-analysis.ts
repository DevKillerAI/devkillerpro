import fs from 'node:fs/promises';

async function inspectDump() {
  const dump = JSON.parse(await fs.readFile('scripts/pc-service-dump.json', 'utf8'));
  console.log('--- CALLS COUNT ---', dump.calls.length);
  for (const c of dump.calls) {
    console.log('Call op:', c.operation_id, 'Status:', c.status);
    const parsed = typeof c.result === 'string' ? JSON.parse(c.result) : c.result;
    if (parsed) {
      console.log('Summary:', parsed.summary);
      console.log('Files:', parsed.files?.map((f: any) => f.path));
      console.log('Journeys:', JSON.stringify(parsed.journeys, null, 2));
      const app = parsed.files?.find((f: any) => f.path === 'src/App.tsx')?.content || '';
      console.log('\nHas client-search in App.tsx?', app.includes('client-search'));
      console.log('Has advance-status in App.tsx?', app.includes('advance-status'));

      // Find occurrences of client-search and advance-status in App.tsx
      const searchMatches = [...app.matchAll(/.{0,100}client-search.{0,100}/g)].map(m => m[0]);
      console.log('client-search context:\n', searchMatches);
      
      const advanceMatches = [...app.matchAll(/.{0,100}advance-status.{0,100}/g)].map(m => m[0]);
      console.log('advance-status context:\n', advanceMatches);
    }
  }

  console.log('\n--- EVENTS ---');
  for (const e of dump.events) {
    console.log(`[${e.type}] ${e.message}`);
    if (e.details && Object.keys(e.details).length > 0) {
      console.log('   Details:', JSON.stringify(e.details).slice(0, 300));
    }
  }
}

inspectDump().catch(console.error);
