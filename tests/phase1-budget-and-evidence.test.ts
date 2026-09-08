import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAcceptanceContract, validateAcceptanceCompliance } from '../src/lib/server/generator/acceptanceContract';
import { createBuildEvidenceManifest, issueVerifiedBuildCertificate } from '../src/lib/server/generator/evidenceCertificate';
import { reservePilotBudget, settlePilotBudget, type PilotBudget } from '../src/lib/server/generator/pilotStore';
import type { GeneratorIdentity } from '../src/lib/server/generator/contract';
import type { PilotVerification } from '../src/lib/server/generator/pilotVerifier';

const testIdentity: GeneratorIdentity = {
  ownerId: 'qa-owner-phase1',
  projectId: 'qa-project-phase1',
  missionId: 'qa-mission-phase1',
  environmentId: 'qa-env-phase1',
};

test('Phase 1 - Budget: reservePilotBudget rejects over-budget calls without expanding ceiling', () => {
  const budget: PilotBudget = {
    spentMicros: 2_500_000,
    reservedMicros: 400_000,
    callCount: 2,
    maxCostMicros: 3_000_000, // 3 USD ceiling
    maxProviderCalls: 5,
  };

  // 2.5M spent + 0.4M reserved + 0.2M requested = 3.1M > 3.0M -> MUST throw PILOT_BUDGET_LIMIT
  assert.throws(() => reservePilotBudget(budget, 200_000), /PILOT_BUDGET_LIMIT/);

  // Exactly reaching ceiling passes: 2.5M + 0.4M + 0.1M = 3.0M
  const reserved = reservePilotBudget(budget, 100_000);
  assert.equal(reserved.reservedMicros, 500_000);
  assert.equal(reserved.callCount, 3);
  assert.equal(reserved.maxCostMicros, 3_000_000); // Ceiling unchanged
});

test('Phase 1 - Evidence: server-persistence fails when verified only with browser journeys', () => {
  const contract = extractAcceptanceContract({
    identity: testIdentity,
    title: 'App com Banco Real Obrigatório',
    brief: 'Crie uma aplicação com banco de dados real PostgreSQL obrigatório e proibido usar localStorage.',
  });

  const serverDbReq = contract.requirements.find(r => r.id === 'feature.server-persistence');
  assert.ok(serverDbReq, 'server-persistence requirement must be present');
  assert.equal(serverDbReq.verificationType, 'database');

  // Simulation: browser journeys passed, but NO database check was executed
  const checkResults = new Map<string, { passed: boolean; details: string }>([
    ['platform.clean-startup', { passed: true, details: 'OK' }],
    ['platform.typescript-typecheck', { passed: true, details: 'OK' }],
    ['platform.responsive-layout', { passed: true, details: 'OK' }],
    ['security.secrets-isolation', { passed: true, details: 'OK' }],
    ['security.safe-execution', { passed: true, details: 'OK' }],
    // Requirement attempted to be approved by browser journey check
    ['requirement:application:journeys', { passed: true, details: 'Browser journeys passed' }],
  ]);

  // Direct compliance check fails if feature.server-persistence is missing or false
  const complianceWithoutDb = validateAcceptanceCompliance(contract, checkResults);
  assert.equal(complianceWithoutDb.compliant, false);
  assert.ok(complianceWithoutDb.mandatoryFailures.some(f => f.requirement.id === 'feature.server-persistence'));
});

test('Phase 1 - Evidence: VerifiedBuildCertificate requires manifestDigest and all mandatory checks', () => {
  const contract = extractAcceptanceContract({
    identity: testIdentity,
    title: 'Clean Minimal App',
    brief: 'Uma página limpa simples.',
  });

  const verification: PilotVerification = {
    status: 'passed',
    sourceHash: 'sha256-source-1234567890abcdef',
    verifierVersion: 'react-workbench-v2',
    compiledFiles: [{ path: 'dist/index.html', content: '<html></html>' }],
    checks: contract.requirements.map(req=>({id:'requirement:'+req.id,passed:true,details:'Executed requirement-specific fixture'})),
    failures: [],
    limitations: [],
    durationMs: 150,
  };

  const manifest = createBuildEvidenceManifest({
    identity: {
      missionId: testIdentity.missionId,
      runId: 'run-p1',
      workspaceId: testIdentity.projectId,
      artifactId: 'art-p1',
      artifactVersion: 'v1',
      buildId: 'build-p1',
      sandboxId: 'sandbox-p1',
      qaRunId: 'qa-p1',
    },
    sourceHash: verification.sourceHash,
    bundleHash: createHash('sha256').update(JSON.stringify(verification.compiledFiles)).digest('hex'),
    generatorVersion: 'devkiller-v2.1',
    environmentVersion: 'react-workbench-v2',
    acceptanceContract: contract,
    verification,
  });

  assert.equal(manifest.mandatoryRequirementsPassed, true);
  const cert = issueVerifiedBuildCertificate(manifest);
  assert.ok(cert.certificateId.startsWith('evidence-dk-'));
  assert.ok(cert.manifestDigest.length === 64, 'manifestDigest must be sha256 hex');
  assert.equal(cert.attestation, 'unsigned-integrity-manifest');
  assert.equal(cert.verificationPassed, true);
});
