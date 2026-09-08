import test from 'node:test';
import assert from 'node:assert/strict';
import { assessWorkbenchCapabilities } from '../src/lib/server/generator/workbenchContract';
import { extractAcceptanceContract, validateAcceptanceCompliance } from '../src/lib/server/generator/acceptanceContract';
import type { GeneratorIdentity } from '../src/lib/server/generator/contract';

const dummyIdentity: GeneratorIdentity = {
  ownerId: 'user-audit-123456',
  projectId: 'v2-project-audit-123456',
  missionId: 'v2-app-audit-123456',
  environmentId: 'v2-env-audit-123456',
};

test('Regression: banco persistente, proibido usar localStorage como armazenamento principal', () => {
  const brief = 'Crie o sistema PC Service com banco persistente, proibido usar localStorage como armazenamento principal. Cadastro de clientes com nome e telefone obrigatórios.';

  // 1. Assessment without fullstack profile: must NOT silently downgrade to local.persistence
  const planWithoutFullstack = assessWorkbenchCapabilities(brief, { fullstackDatabase: false });
  assert.equal(planWithoutFullstack.available.includes('local.persistence'), false, 'local.persistence must NOT be admitted when localStorage is forbidden');
  const dbGap = planWithoutFullstack.deferred.find(gap => gap.id === 'supabase.database');
  assert.ok(dbGap, 'supabase.database gap must be recorded');
  assert.match(dbGap.fallback, /forbidden by contract/i, 'Fallback must explain that localStorage downgrade is forbidden');

  // 2. Acceptance contract extraction: must extract mandatory server-persistence and forbid local-persistence
  const contract = extractAcceptanceContract({
    identity: dummyIdentity,
    title: 'PC Service',
    brief,
  });

  const serverReq = contract.requirements.find(r => r.id === 'feature.server-persistence');
  assert.ok(serverReq, 'Mandatory server-persistence requirement must be present');
  assert.equal(serverReq.priority, 'mandatory');
  assert.equal(serverReq.verificationType, 'database');

  const localReq = contract.requirements.find(r => r.id === 'feature.local-persistence');
  assert.equal(localReq, undefined, 'feature.local-persistence must NOT be extracted when localStorage is forbidden');

  // 3. Verification compliance fails closed if only browser preview checks are provided
  const browserOnlyChecks = new Map([
    ['platform.clean-startup', { passed: true, details: 'Clean boot' }],
    ['platform.typescript-typecheck', { passed: true, details: 'Types valid' }],
    ['platform.responsive-layout', { passed: true, details: 'Responsive' }],
    ['security.secrets-isolation', { passed: true, details: 'No secrets' }],
    ['security.safe-execution', { passed: true, details: 'Safe' }],
    ['feature.data-entry', { passed: true, details: 'Form works' }],
  ]);

  const compliance = validateAcceptanceCompliance(contract, browserOnlyChecks);
  assert.equal(compliance.compliant, false, 'Build must NOT be compliant without server database verification');
  assert.ok(compliance.mandatoryFailures.some(f => f.requirement.id === 'feature.server-persistence'), 'Must fail on feature.server-persistence');

  // 4. Assessment with fullstack profile active: database.postgres is an available first-class capability
  const planWithFullstack = assessWorkbenchCapabilities(brief, { fullstackDatabase: true });
  assert.ok(planWithFullstack.available.includes('database.postgres'), 'database.postgres must be available in fullstack mode');
  assert.equal(planWithFullstack.deferred.some(g => g.id === 'supabase.database'), false, 'supabase.database must not be deferred when fullstack is active');
});

test('Instruction Coherence: WORKBENCH_INSTRUCTIONS must be cohesive and free of patch contradictions', async () => {
  const { WORKBENCH_INSTRUCTIONS } = await import('../src/lib/server/generator/workbenchContract');
  const { PILOT_PATCH_RULES } = await import('../src/lib/server/generator/pilotPatchRecovery');
  const { parsePilotOutput, PilotProviderError } = await import('../src/lib/server/generator/pilotProvider');

  // 1. WORKBENCH_INSTRUCTIONS must NOT contain patch directives (those belong only in incremental edits)
  assert.equal(WORKBENCH_INSTRUCTIONS.includes(PILOT_PATCH_RULES), false, 'Fresh build instructions must not include patch search/replace rules');
  assert.doesNotMatch(WORKBENCH_INSTRUCTIONS, /SEARCH\/REPLACE edits/i, 'Build instructions must not demand SEARCH/REPLACE edits');

  // 2. The browser-only profile must never advertise a backend it does not provision.
  assert.match(WORKBENCH_INSTRUCTIONS, /does not provide PostgreSQL/i);
  assert.match(WORKBENCH_INSTRUCTIONS, /separately provisioned fullstack profile/i);
  assert.doesNotMatch(WORKBENCH_INSTRUCTIONS, /fullstack persistence is supported/i);

  // 3. Error reporting for incomplete output must include helpful diagnosis
  assert.throws(
    () => parsePilotOutput({ status: 'incomplete', output: [], incomplete_details: { reason: 'max_output_tokens' } }),
    (err: unknown) => {
      assert.ok(err instanceof PilotProviderError);
      assert.equal(err.code, 'PILOT_OUTPUT_INCOMPLETE');
      assert.match(err.message, /reason: max_output_tokens/i);
      return true;
    }
  );
});
