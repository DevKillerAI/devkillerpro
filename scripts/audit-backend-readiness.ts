import { readFile } from 'node:fs/promises';
import { selectFoundation } from '../src/lib/server/foundations/registry';
import { determineDeliveryProfile } from '../src/lib/server/deliveryProfile';

async function main() {
  const manifest = JSON.parse(await readFile('.devkiller/discarded/mission_build-an-application--pr_1788293109658/artifacts/manifest.json', 'utf8'));
  const profile = determineDeliveryProfile(manifest.prompt);
  const foundation = selectFoundation(manifest.prompt, profile);
  console.log(JSON.stringify({ check: 'Original Set up request', expectedProvider: 'sqlite', actualProvider: foundation.provider, deliveryTier: profile.tier, reason: foundation.reason }));
  const simple = 'Build a local notes app. Save notes in SQLite. Delivery depth explicitly selected by the user: local_mvp.';
  console.log(JSON.stringify({check:'Simple SQLite request', provider:selectFoundation(simple,determineDeliveryProfile(simple)).provider}));
  const explicitLocal = 'Build a notes app. Delivery depth explicitly selected by the user: local_mvp. Do not include deployment or production infrastructure.';
  console.log(JSON.stringify({check:'Explicit MVP with excluded production', expectedTier:'local_mvp', actualTier:determineDeliveryProfile(explicitLocal).tier}));
  const previousFailure = JSON.parse(await readFile('.devkiller/discarded/mission_build-an-application--pr_1788293109658/artifacts/build.static-failure-3.json','utf8'));
  console.log(JSON.stringify({check:'Recorded preflight failure (historical evidence, not rerun)', ...previousFailure}));
}
void main();
