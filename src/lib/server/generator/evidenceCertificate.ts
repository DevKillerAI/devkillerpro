import { createHash } from 'node:crypto';
import { acceptanceCheckId, type AcceptanceContract } from './acceptanceContract';
import type { PilotVerification } from './pilotVerifier';

export type TestEvidence = {
  id: string;
  name: string;
  passed: boolean;
  details: string;
  durationMs?: number;
};

export type ExecutionIdentityChain = {
  missionId: string;
  runId: string;
  workspaceId: string;
  artifactId: string;
  artifactVersion: string;
  buildId: string;
  sandboxId: string;
  qaRunId: string;
};

export type BuildEvidenceManifest = {
  format: 'devkiller-evidence-manifest-v1';
  identity: ExecutionIdentityChain;
  sourceHash: string;
  bundleHash?: string;
  generatorVersion: string;
  environmentVersion: string;
  acceptanceContractId: string;
  mandatoryCheckIds: string[];
  runtimeImageId?: string;
  tests: TestEvidence[];
  mandatoryRequirementsPassed: boolean;
  summary: string;
  createdAt: string;
};

export type VerifiedBuildCertificate = {
  format: 'devkiller-build-evidence-v2';
  certificateId: string;
  identity: ExecutionIdentityChain;
  sourceHash: string;
  bundleHash: string;
  manifestDigest: string;
  attestation: 'unsigned-integrity-manifest';
  verifiedAt: string;
  checksSummary: {
    total: number;
    passed: number;
    failed: number;
  };
  verificationPassed: true;
};

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Creates an immutable Build Evidence Manifest tying code, acceptance contract, tests, and execution environment.
 */
export function createBuildEvidenceManifest(args: {
  identity: ExecutionIdentityChain;
  sourceHash: string;
  bundleHash?: string;
  generatorVersion: string;
  environmentVersion: string;
  acceptanceContract: AcceptanceContract;
  verification: PilotVerification;
}): BuildEvidenceManifest {
  const { identity, sourceHash, bundleHash, generatorVersion, environmentVersion, acceptanceContract, verification } = args;
  if (sourceHash !== verification.sourceHash || environmentVersion !== verification.verifierVersion
    || identity.missionId !== acceptanceContract.identity.missionId || identity.workspaceId !== acceptanceContract.identity.projectId) {
    throw new Error('Evidence identity does not match the verified source, runtime and acceptance contract.');
  }
  if (bundleHash && (!verification.compiledFiles.length || bundleHash !== hash(JSON.stringify(verification.compiledFiles)))) {
    throw new Error('Evidence bundle hash does not match the compiled artifacts.');
  }

  const tests: TestEvidence[] = verification.checks.map(check => ({
    id: check.id,
    name: check.id,
    passed: check.passed,
    details: check.details,
  }));

  const mandatoryChecks = acceptanceContract.requirements.filter(r => r.priority === 'mandatory');
  const mandatoryCheckIds = mandatoryChecks.map(r => acceptanceCheckId(r.id));
  const allMandatoryPassed = mandatoryCheckIds.length > 0 && mandatoryCheckIds.every(id => {
    const matchingChecks = verification.checks.filter(c => c.id === id);
    return matchingChecks.length === 1 && matchingChecks[0].passed;
  });

  return {
    format: 'devkiller-evidence-manifest-v1',
    identity,
    sourceHash,
    bundleHash,
    generatorVersion,
    environmentVersion,
    acceptanceContractId: acceptanceContract.contractId,
    mandatoryCheckIds,
    runtimeImageId: verification.runtimeImageId,
    tests,
    mandatoryRequirementsPassed: allMandatoryPassed && verification.status === 'passed' && verification.failures.length === 0 && tests.every(test => test.passed),
    summary: `Build verification: ${verification.status.toUpperCase()} (${tests.filter(t => t.passed).length}/${tests.length} checks passed).`,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Compatibility name: returns an unsigned integrity record of executed checks.
 * It is not an authenticated signature or a certification of complete product quality.
 */
export function issueVerifiedBuildCertificate(manifest: BuildEvidenceManifest): VerifiedBuildCertificate {
  if (!manifest.mandatoryRequirementsPassed || !manifest.tests.length || !manifest.tests.every(test => test.passed)
    || new Set(manifest.tests.map(test => test.id)).size !== manifest.tests.length
    || !manifest.mandatoryCheckIds.length || !manifest.mandatoryCheckIds.every(id => manifest.tests.filter(test => test.id === id && test.passed).length === 1)) {
    throw new Error('Cannot issue Verified Build Certificate: mandatory requirements or verification checks failed.');
  }
  if (!manifest.bundleHash) {
    throw new Error('Cannot issue Verified Build Certificate: missing compiled bundle hash.');
  }

  // Hash the complete record, including checks, versions and runtime identity.
  const rawData = JSON.stringify(manifest);

  const manifestDigest = hash(rawData);
  const certificateId = `evidence-dk-${manifestDigest.slice(0, 24)}`;

  return {
    format: 'devkiller-build-evidence-v2',
    certificateId,
    identity: manifest.identity,
    sourceHash: manifest.sourceHash,
    bundleHash: manifest.bundleHash,
    manifestDigest,
    attestation: 'unsigned-integrity-manifest',
    verifiedAt: new Date().toISOString(),
    checksSummary: {
      total: manifest.tests.length,
      passed: manifest.tests.filter(t => t.passed).length,
      failed: manifest.tests.filter(t => !t.passed).length,
    },
    verificationPassed: true,
  };
}
