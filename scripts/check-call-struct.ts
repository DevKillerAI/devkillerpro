import fs from 'node:fs/promises';

async function checkCalls() {
  const dump = JSON.parse(await fs.readFile('scripts/pc-service-dump.json', 'utf8'));
  for (const c of dump.calls) {
    console.log('Op:', c.operation_id, 'Result type:', typeof c.result);
    if (typeof c.result === 'object') {
      console.log('Keys:', Object.keys(c.result));
      if (c.result.text) {
        console.log('Result text preview:', c.result.text.slice(0, 300));
      }
    }
  }
}

checkCalls().catch(console.error);
