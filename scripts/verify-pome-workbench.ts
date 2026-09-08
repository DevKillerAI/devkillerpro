import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorkbenchContract, assessWorkbenchCapabilities, WORKBENCH_INSTRUCTIONS, workbenchBuildJsonSchema } from '../src/lib/server/generator/workbenchContract';
import { createWorkbenchQualityPlan } from '../src/lib/server/generator/workbenchQuality';
import { preparePilotRequest } from '../src/lib/server/generator/pilotProvider';
import { validateWorkbenchSource } from '../src/lib/server/generator/pilotRuntime';
import { createPilotSourceExport } from '../src/lib/server/generator/pilotVerifier';
import { typecheckGeneratorSource } from '../src/lib/server/generator/typescriptTypecheck';
import { auditGeneratorSecurity } from '../src/lib/server/generator/securityAuditor';
import { createGeneratorSnapshot } from '../src/lib/server/generator/versionedEdits';

import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');

async function main() {
  console.log('--- 1. Testing POME Domain Analysis & Contract Planning ---');
  const [row] = await sql`SELECT contract FROM dk_generator_v2.runs WHERE id = 'v2-app-9d280bacae52-02e620f2-16c4-414b-9ea6-0d6de23e7dd2'`;
  const contractJson = typeof row.contract === 'string' ? JSON.parse(row.contract) : row.contract;
  const promptObj = typeof contractJson.prompt === 'string' ? JSON.parse(contractJson.prompt) : contractJson.prompt;
  const pomePrompt = promptObj.brief || promptObj.prompt || contractJson.prompt;
  console.log(`Loaded POME prompt (${pomePrompt.length} characters)`);

  const qualityPlan = createWorkbenchQualityPlan(pomePrompt, 'simple');
  console.log('Quality Plan Domain:', qualityPlan.domain);
  console.log('Quality Plan Recipe:', qualityPlan.visualRecipe.id);
  console.log('Art Direction:', qualityPlan.artDirection);

  assert.equal(qualityPlan.domain, 'education-school-climate', 'Domain must be education-school-climate');
  assert.equal(qualityPlan.visualRecipe.id, 'restorative-school-hub', 'Recipe must be restorative-school-hub');

  const contract = createWorkbenchContract('e5b94265-5bfe-41fb-81a9-43efad7b2a83', {
    requestId: '02e620f2-16c4-414b-9ea6-0d6de23e7dd2',
    title: 'POME — Gestão do Clima Escolar',
    prompt: pomePrompt,
    briefingMode: 'simple',
    localScopeAccepted: true,
  });

  console.log('Contract Identity:', contract.identity);
  console.log('Contract Capabilities:', contract.capabilities);
  assert.ok(contract.capabilities.includes('react'), 'Must include react');

  const capPlan = assessWorkbenchCapabilities(pomePrompt, { fullstackDatabase: true });
  console.log('Deferred capabilities:', capPlan.deferred.map(d => d.id));
  assert.ok(!capPlan.deferred.some(d => d.id === 'supabase.database' || d.id === 'supabase.auth'), 'Database and Auth must NOT be deferred for fullstack app');

  console.log('\n--- 2. Testing Provider Request Assembly & Token Limits ---');
  const request = preparePilotRequest({
    instructions: WORKBENCH_INSTRUCTIONS,
    input: JSON.stringify({ brief: pomePrompt, outputLocale: contract.outputLocale, capabilityPlan: capPlan, qualityPlan }),
    schemaName: 'dk_workbench_build',
    schema: workbenchBuildJsonSchema,
    maxOutputTokens: 16000,
    transport: 'foreground-stream',
  });

  console.log('Request body serialized byte length:', request.bodyBytes, 'bytes');
  console.log('Request max output tokens:', request.maxOutputTokens);
  console.log('Request reserved micros:', request.reservedMicros);
  assert.ok(request.bodyBytes < 256 * 1024, 'Request must be within 256KB');
  assert.equal(request.maxOutputTokens, 16000);

  console.log('\n--- 3. Testing Multi-File Fullstack Snapshot & Validation ---');
  const mockPomeFiles = [
    {
      path: 'src/lib/types.ts',
      content: `
export interface Occurrence {
  id: string;
  studentName: string;
  category: 'bullying' | 'disruption' | 'conflict' | 'emotional_distress';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  restorativeAction?: string;
  status: 'open' | 'investigating' | 'restorative_session' | 'resolved';
  createdAt: string;
}

export interface ClimateMetric {
  category: string;
  score: number;
  trend: 'improving' | 'stable' | 'concerning';
}
      `.trim(),
    },
    {
      path: 'src/lib/supabase.ts',
      content: `
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'http://127.0.0.1:54321';
const supabaseKey = 'dummy-key';

export const supabase = createClient(supabaseUrl, supabaseKey);
      `.trim(),
    },
    {
      path: 'src/components/ClimateIndicators.tsx',
      content: `
import React from 'react';
import type { ClimateMetric } from '../lib/types';

export function ClimateIndicators({ metrics }: { metrics: ClimateMetric[] }) {
  return (
    <div data-testid="climate-indicators" className="metrics-grid">
      {metrics.map(m => (
        <div key={m.category} className="metric-card" data-testid={"metric-" + m.category}>
          <h4>{m.category}</h4>
          <span className="score">{m.score}/100</span>
          <span className={"trend trend-" + m.trend}>{m.trend}</span>
        </div>
      ))}
    </div>
  );
}
      `.trim(),
    },
    {
      path: 'src/components/OccurrenceModal.tsx',
      content: `
import React, { useState } from 'react';
import type { Occurrence } from '../lib/types';

export function OccurrenceModal({ onSave, onClose }: { onSave: (occ: Partial<Occurrence>) => void; onClose: () => void }) {
  const [student, setStudent] = useState('');
  const [desc, setDesc] = useState('');

  return (
    <div className="modal-overlay" data-testid="occurrence-modal">
      <div className="modal-content">
        <h3>Registrar Ocorrência Escolar</h3>
        <input
          data-testid="occurrence-student-input"
          value={student}
          onChange={e => setStudent(e.target.value)}
          placeholder="Nome do Estudante"
        />
        <textarea
          data-testid="occurrence-desc-input"
          value={desc}
          onChange={e => setDesc(e.target.value)}
          placeholder="Descrição dos Fatos (Comunicação Não Violenta)"
        />
        <button data-testid="occurrence-save-btn" onClick={() => { onSave({ studentName: student, description: desc }); onClose(); }}>
          Salvar
        </button>
        <button data-testid="occurrence-cancel-btn" onClick={onClose}>Cancelar</button>
      </div>
    </div>
  );
}
      `.trim(),
    },
    {
      path: 'src/components/NvcGuideModal.tsx',
      content: `
import React from 'react';

export function NvcGuideModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay" data-testid="nvc-guide-modal">
      <div className="modal-card">
        <h3>Guia de Mediação CNV (Comunicação Não Violenta)</h3>
        <p>1. Observação sem julgamento</p>
        <p>2. Identificação de Sentimentos</p>
        <p>3. Reconhecimento de Necessidades</p>
        <p>4. Formulação de Pedidos Concretos</p>
        <button data-testid="nvc-close-btn" onClick={onClose}>Entendido</button>
      </div>
    </div>
  );
}
      `.trim(),
    },
    {
      path: 'src/App.tsx',
      content: `
import React, { useState } from 'react';
import { Shield, HeartHandshake, PlusCircle, BookOpen } from 'lucide-react';
import { ClimateIndicators } from './components/ClimateIndicators';
import { OccurrenceModal } from './components/OccurrenceModal';
import { NvcGuideModal } from './components/NvcGuideModal';
import type { Occurrence, ClimateMetric } from './lib/types';
import './styles.css';

export default function App() {
  const [occurrences, setOccurrences] = useState<Occurrence[]>([
    {
      id: 'occ-1',
      studentName: 'Ana Clara',
      category: 'conflict',
      severity: 'medium',
      description: 'Desentendimento durante o recreio sobre a quadra de esportes.',
      restorativeAction: 'Círculo de mediação entre as turmas.',
      status: 'restorative_session',
      createdAt: '2026-09-05T10:00:00Z',
    },
  ]);
  const [showRegister, setShowRegister] = useState(false);
  const [showNvc, setShowNvc] = useState(false);

  const metrics: ClimateMetric[] = [
    { category: 'Segurança Psicológica', score: 88, trend: 'improving' },
    { category: 'Resolução Restaurativa', score: 92, trend: 'improving' },
    { category: 'Sentimento de Pertencimento', score: 81, trend: 'stable' },
  ];

  return (
    <div className="app-container" data-testid="pome-app">
      <header className="app-header">
        <div className="brand">
          <HeartHandshake className="brand-icon" />
          <h1>POME — Gestão do Clima Escolar</h1>
        </div>
        <div className="actions">
          <button data-testid="open-nvc-btn" onClick={() => setShowNvc(true)}>
            <BookOpen size={16} /> Guia CNV
          </button>
          <button data-testid="new-occurrence-btn" className="btn-primary" onClick={() => setShowRegister(true)}>
            <PlusCircle size={16} /> Nova Ocorrência
          </button>
        </div>
      </header>

      <main className="dashboard-content">
        <section className="metrics-section">
          <h2>Indicadores de Clima Relacional</h2>
          <ClimateIndicators metrics={metrics} />
        </section>

        <section className="occurrences-section">
          <h2>Ocorrências e Ações Restaurativas</h2>
          <div className="occurrences-list" data-testid="occurrences-table">
            {occurrences.map(o => (
              <div key={o.id} className="occurrence-row" data-testid={"occ-row-" + o.id}>
                <span className="student">{o.studentName}</span>
                <span className="desc">{o.description}</span>
                <span className="status-badge">{o.status}</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      {showRegister && (
        <OccurrenceModal
          onSave={newOcc => {
            setOccurrences(prev => [
              ...prev,
              {
                id: 'occ-' + Date.now(),
                studentName: newOcc.studentName || 'Estudante',
                category: 'conflict',
                severity: 'low',
                description: newOcc.description || '',
                status: 'open',
                createdAt: new Date().toISOString(),
              },
            ]);
          }}
          onClose={() => setShowRegister(false)}
        />
      )}

      {showNvc && <NvcGuideModal onClose={() => setShowNvc(false)} />}
    </div>
  );
}
      `.trim(),
    },
    {
      path: 'src/styles.css',
      content: `
:root {
  --canvas: #f8fafc;
  --surface: #ffffff;
  --primary: #0284c7;
  --accent: #059669;
  --text-main: #0f172a;
  --border: #e2e8f0;
}
body { margin: 0; background: var(--canvas); color: var(--text-main); font-family: sans-serif; }
.app-container { padding: 1.5rem; max-width: 1200px; margin: 0 auto; }
.app-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 1rem; }
.brand { display: flex; align-items: center; gap: 0.75rem; }
.metrics-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin: 1rem 0; }
.metric-card { background: var(--surface); padding: 1rem; border-radius: 8px; border: 1px solid var(--border); }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; }
.modal-content, .modal-card { background: #fff; padding: 1.5rem; border-radius: 8px; width: 450px; }
      `.trim(),
    },
    {
      path: 'supabase/migrations/001_init.sql',
      content: `
CREATE TABLE IF NOT EXISTS school_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_name TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  description TEXT NOT NULL,
  restorative_action TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE school_occurrences ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_occurrences_read ON school_occurrences FOR SELECT USING (true);
      `.trim(),
    },
  ];

  const snapshot = createGeneratorSnapshot({
    scope: contract.identity,
    revision: 'build-1',
    files: mockPomeFiles,
  });

  console.log(`Snapshot created with ${snapshot.files.length} files, total bytes:`, snapshot.files.reduce((a, b) => a + Buffer.byteLength(b.content), 0));
  
  // Validate workbench source
  const validated = validateWorkbenchSource(snapshot);
  assert.equal(validated.files.length, 8);
  console.log('validateWorkbenchSource passed successfully!');

  // Export
  const exported = createPilotSourceExport(snapshot);
  console.log('createPilotSourceExport succeeded, hash:', exported.hash);

  // Typecheck gate
  const tsReport = typecheckGeneratorSource(snapshot.files);
  console.log('typecheckGeneratorSource status:', tsReport.status);
  if (tsReport.status !== 'passed') {
    console.error('Typecheck diagnostics:', tsReport.diagnostics);
  }
  assert.equal(tsReport.status, 'passed', 'TypeScript semantic check must pass for modular components');

  // Security audit gate
  const secReport = auditGeneratorSecurity(snapshot.files);
  console.log('auditGeneratorSecurity passed:', secReport.passed);
  assert.ok(secReport.passed, 'Security audit must pass');

  console.log('\n ALL TESTS AND ENGINE CHECKS PASSED FOR POME ARCHITECTURE!');
  await sql.end();
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
