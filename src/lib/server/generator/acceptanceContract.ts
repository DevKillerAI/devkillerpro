import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { GeneratorIdentity } from './contract';

export const requirementPrioritySchema = z.enum(['mandatory', 'important', 'optional']);
export type RequirementPriority = z.infer<typeof requirementPrioritySchema>;

export const verificationTypeSchema = z.enum(['browser', 'runtime', 'static', 'visual', 'database', 'security', 'typecheck']);
export type VerificationType = z.infer<typeof verificationTypeSchema>;

export const acceptanceRequirementSchema = z.object({
  id: z.string().min(2).max(120).regex(/^[a-z0-9][a-z0-9._-]*$/i),
  source: z.enum(['user', 'platform', 'security', 'derived']),
  description: z.string().trim().min(3).max(1500),
  priority: requirementPrioritySchema,
  verificationType: verificationTypeSchema,
  immutable: z.boolean(),
  expectedEvidence: z.string().trim().min(3).max(600).optional(),
}).strict();
export type AcceptanceRequirement = z.infer<typeof acceptanceRequirementSchema>;

export const acceptanceContractSchema = z.object({
  version: z.literal('acceptance-contract-v1'),
  contractId: z.string().min(1).max(160),
  identity: z.object({
    ownerId: z.string(),
    projectId: z.string(),
    missionId: z.string(),
    environmentId: z.string(),
  }).strict(),
  title: z.string().trim().min(2).max(120),
  briefSummary: z.string().trim().min(5).max(3000),
  requirements: z.array(acceptanceRequirementSchema).min(1).max(100),
  createdAt: z.string(),
}).strict();
export type AcceptanceContract = z.infer<typeof acceptanceContractSchema>;

/** A retry keeps the first plan's timestamp without relaxing any requirement. */
export function preserveAcceptanceContract(current: AcceptanceContract, stored: unknown): AcceptanceContract {
  if (stored === undefined) return current;
  const prior = acceptanceContractSchema.parse(stored);
  if (JSON.stringify({...prior,createdAt:''}) !== JSON.stringify({...current,createdAt:''})) {
    throw new Error('WORKBENCH_ACCEPTANCE_CONFLICT: Stored requirements changed; no provider request was sent.');
  }
  return prior;
}

export type AcceptanceJourney = {
  name: string;
  requirementIds: string[];
  steps: { action: string; testId: string; value: string }[];
};
export type AcceptanceCheck = { id: string; passed: boolean; details: string };
export const acceptanceCheckId = (requirementId: string) => `requirement:${requirementId}`;

/** Structural minimum for a claimed behavior. Executed, source-bound assertions
 * still supply the evidence; a label or a filled input alone proves no feature. */
export function journeyProvesRequirement(requirementId: string, journey: AcceptanceJourney): boolean {
  const steps = journey.steps;
  const inputs = steps.filter(s => ['fill', 'select', 'check', 'uncheck'].includes(s.action));
  const changed = steps.findIndex(s => ['fill', 'select', 'check', 'uncheck', 'click'].includes(s.action));
  const assertions = steps.filter((s, index) => index > changed && ['text', 'count'].includes(s.action)
    && !inputs.some(input => input.testId === s.testId));
  if (changed < 0 || assertions.length === 0) return false;
  if (requirementId === 'feature.local-persistence') {
    const saveOrReload = steps.findIndex(s => s.action === 'reload' || s.action === 'click');
    return saveOrReload > changed && inputs.length > 0 && steps.some((s, index) => index > saveOrReload
      && assertions.includes(s) && (s.action === 'text' || s.action === 'count') && s.value.trim().length > 0);
  }
  if (requirementId === 'feature.data-entry') {
    const fill = steps.findIndex(s => s.action === 'fill');
    const submit = steps.findIndex((s, index) => index > fill && s.action === 'click');
    return fill >= 0 && submit > fill && steps.some((s, index) => index > submit && assertions.includes(s));
  }
  if (requirementId === 'feature.calculation-logic') {
    return inputs.some(s => s.action === 'fill' && /\d/.test(s.value))
      && assertions.some(s => s.action === 'text' && /\d/.test(s.value));
  }
  if (requirementId === 'feature.cart-management') {
    return steps.some(s => s.action === 'click') && new Set(assertions.map(s => s.testId)).size >= 2;
  }
  return true;
}

/** Produces exact requirement evidence; never copies a global journey result.
 * Database/auth runtimes must emit their own exact requirement checks. */
export function evaluateAcceptanceEvidence(contract: AcceptanceContract, journeys: AcceptanceJourney[], executed: readonly AcceptanceCheck[]): AcceptanceCheck[] {
  const exact = (id: string) => {
    const matches = executed.filter(check => check.id === id);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const platformIds: Record<string, string> = {
    'platform.clean-startup': 'platform:startup',
    'platform.typescript-typecheck': 'platform:typescript-typecheck',
    'platform.responsive-layout': 'platform:responsive-layout',
    'security.secrets-isolation': 'security:secrets-isolation',
    'security.safe-execution': 'security:safe-execution',
  };
  return contract.requirements.map(req => {
    const id = acceptanceCheckId(req.id);
    const authoritative = exact(id);
    if (authoritative && req.verificationType !== 'browser') return { ...authoritative };
    const platform = platformIds[req.id] && exact(platformIds[req.id]);
    if ((req.source === 'platform' || req.source === 'security') && platform) return { id, passed: platform.passed, details: platform.details };
    if (req.id === 'capability.image-generation' && req.verificationType === 'static') {
      const checks = ['image-generation', 'ai-budget', 'ai-error-handling', 'ai-secret-isolation', 'asset-export'].map(name => exact(`platform:${name}`));
      return { id, passed: checks.every(check => check?.passed === true), details: 'Static image host-bridge contract only; live provider generation was not executed by this verification.' };
    }
    if (req.verificationType === 'browser') {
      const linked = journeys.map((journey, index) => ({ journey, index })).filter(({ journey }) => journey.requirementIds.includes(req.id));
      const valid = linked.length > 0 && linked.every(({ journey, index }) => journeyProvesRequirement(req.id, journey)
        && [1440, 390].every(width => exact(`journey:${width}:${index + 1}`)?.passed === true));
      return { id, passed: valid, details: valid
        ? `Executed the source-bound assertions for ${req.id} at 1440px and 390px: ${linked.map(item => item.journey.name).join('; ')}. This proves the declared cases, not exhaustive product coverage.`
        : `No complete, explicit, executed journey evidence for ${req.id}. Legacy unbound journeys require requalification; aggregate browser success is insufficient.` };
    }
    return { id, passed: false, details: `No exact ${req.verificationType} evidence for ${req.id}. Simulated services and unrelated checks cannot satisfy it.` };
  });
}

const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Extracts the immutable Acceptance Contract deterministically BEFORE code generation.
 * Requirements are classified into 'mandatory', 'important', and 'optional'.
 * Mandatory requirements CANNOT be discarded or bypassed by model output.
 */
export function extractAcceptanceContract(args: {
  identity: GeneratorIdentity;
  title: string;
  brief: string;
  outputLocale?: string;
  capabilities?: readonly string[];
}): AcceptanceContract {
  const { identity, title, brief } = args;
  const text = normalize(brief);
  const requirements: AcceptanceRequirement[] = [];

  const add = (req: AcceptanceRequirement) => {
    if (!requirements.some(r => r.id === req.id)) {
      requirements.push(req);
    }
  };

  // 1. Mandatory Platform and Security Baseline
  add({
    id: 'platform.clean-startup',
    source: 'platform',
    description: 'The compiled React application boots cleanly without uncaught exceptions or error events in browser console.',
    priority: 'mandatory',
    verificationType: 'runtime',
    immutable: true,
    expectedEvidence: 'No console.error or uncaught window error during startup.',
  });

  add({
    id: 'platform.typescript-typecheck',
    source: 'platform',
    description: 'All application source files satisfy TypeScript semantic type checking without diagnostics errors.',
    priority: 'mandatory',
    verificationType: 'typecheck',
    immutable: true,
    expectedEvidence: 'ts.getPreEmitDiagnostics returns zero error diagnostics.',
  });

  add({
    id: 'platform.responsive-layout',
    source: 'platform',
    description: 'The interface renders without horizontal overflow or clipping across all target viewports (320px to 1920px).',
    priority: 'mandatory',
    verificationType: 'visual',
    immutable: true,
    expectedEvidence: 'document.documentElement.scrollWidth <= innerWidth + 2 across tested viewports.',
  });

  add({
    id: 'security.secrets-isolation',
    source: 'security',
    description: 'Application code contains no exposed API keys, bearer tokens, OpenAI endpoints, or server secrets.',
    priority: 'mandatory',
    verificationType: 'security',
    immutable: true,
    expectedEvidence: 'Static security scanner passes with zero secret leaks.',
  });

  add({
    id: 'security.safe-execution',
    source: 'security',
    description: 'Application contains no dynamic eval, raw WebSockets, unapproved script tags, or unvetted external network requests.',
    priority: 'mandatory',
    verificationType: 'security',
    immutable: true,
    expectedEvidence: 'No eval, Function constructor, script element injection, or direct external fetch.',
  });

  // 2. Domain and Functional Requirements Extracted from Brief
  const hasCart = /(?:carrinho|cart|sacola|bag|checkout|comprar|itens no carrinho)\b/.test(text);
  if (hasCart) {
    add({
      id: 'feature.cart-management',
      source: 'user',
      description: 'User must be able to add items to the cart, observe item count, and inspect total price.',
      priority: 'mandatory',
      verificationType: 'browser',
      immutable: true,
      expectedEvidence: 'Interactive journey clicking add-to-cart updates cart count and visible total.',
    });
  }

  const hasFilter = /(?:filtr(?:ar|o|os)|filter|busca(?:r)?|pesquisa(?:r)?|search|categorias?)\b/.test(text);
  if (hasFilter) {
    add({
      id: 'feature.search-filter',
      source: 'user',
      description: 'User must be able to search or filter listed records and observe filtered results.',
      priority: 'mandatory',
      verificationType: 'browser',
      immutable: true,
      expectedEvidence: 'Interaction with search/filter controls changes displayed items count or visible content.',
    });
  }

  const forbidsLocalStorage = /\b(?:proibido\s+(?:usar\s+)?localstorage|sem\s+localstorage|nao\s+use\s+localstorage|do\s+not\s+use\s+localstorage|never\s+use\s+localstorage|without\s+localstorage)\b/i.test(text);
  const hasServerDb = /(?:banco(?: de dados)? (?:real|persistente|obrigatorio)|server database|postgresql?|supabase)\b/i.test(text);
  const hasDatabase = /(?:banco(?: de dados)?|postgres|postgresql|supabase|server database)\b/i.test(text);

  if (hasServerDb || hasDatabase || forbidsLocalStorage) {
    add({
      id: 'feature.server-persistence',
      source: 'user',
      description: 'Persistent server-side storage in database (PostgreSQL); primary data must not reside exclusively in browser localStorage.',
      priority: 'mandatory',
      verificationType: 'database',
      immutable: true,
      expectedEvidence: 'Database record persisted in real database and accessible across independent browser contexts.',
    });
  }

  const hasPersistence = /(?:salv(?:ar|e)|persist(?:encia|ir|ência)|localstorage|recarregar|refresh|reload|guardar)\b/.test(text);
  if (hasPersistence && !forbidsLocalStorage && !hasServerDb && !hasDatabase) {
    add({
      id: 'feature.local-persistence',
      source: 'user',
      description: 'Created items and user edits must persist in browser localStorage across page reload.',
      priority: 'mandatory',
      verificationType: 'browser',
      immutable: true,
      expectedEvidence: 'Created record remains visible after page reload.',
    });
  }

  const hasModalOrForm = /(?:formulario|\bform\b|modal|dialog|cadastro|cadastrar|adicionar (?:novo |nova )?(?:registro|item|tarefa|cliente|pedido|contato|despesa|receita|produto)|criar (?:novo |nova )?(?:registro|item|tarefa|cliente|pedido|contato|despesa|receita|produto))\b/.test(text);
  if (hasModalOrForm) {
    add({
      id: 'feature.data-entry',
      source: 'user',
      description: 'User must be able to enter data through form controls and submit or save the record.',
      priority: 'mandatory',
      verificationType: 'browser',
      immutable: true,
      expectedEvidence: 'Form submission creates new visible record or updates existing record.',
    });
  }

  const hasCalculatorOrMath = /(?:calculadora|calcular|calculo|simula(?:cao|dor)|totais|resumo financeiro)\b/.test(text);
  if (hasCalculatorOrMath) {
    add({
      id: 'feature.calculation-logic',
      source: 'user',
      description: 'Numerical calculations and arithmetic operations must compute and display accurate results.',
      priority: 'mandatory',
      verificationType: 'browser',
      immutable: true,
      expectedEvidence: 'Inputting numeric values yields correct computed output.',
    });
  }

  if (args.capabilities?.includes('auth.email')) {
    add({ id: 'feature.app-authentication', source: 'user', priority: 'mandatory', verificationType: 'security', immutable: true,
      description: 'The selected private database profile uses real app accounts and isolated owner sessions.',
      expectedEvidence: 'Real account signup, password login, session refresh/logout and two-user server isolation checks; no simulated sessions.' });
  }

  // 3. Media & Capability specific requirements
  if (args.capabilities?.includes('ai.image.generate') || /(?:gerar imagem|dall-e|generate image)\b/.test(text)) {
    add({
      id: 'capability.image-generation',
      source: 'user',
      description: 'The image generation host bridge contract must include correlation, loading/error handling and a canvas export path. This static check does not prove a live provider result.',
      priority: 'mandatory',
      verificationType: 'static',
      immutable: true,
      expectedEvidence: 'Static bridge checks for image-generation, ai-budget, ai-error-handling, ai-secret-isolation and asset-export. Live provider results are separate runtime evidence.',
    });
  }

  const hash = createHash('sha256')
    .update(`${identity.missionId}:${title}:${brief}`)
    .digest('hex')
    .slice(0, 16);

  return acceptanceContractSchema.parse({
    version: 'acceptance-contract-v1',
    contractId: `acc-${identity.missionId}-${hash}`,
    identity,
    title,
    briefSummary: brief.slice(0, 3000),
    requirements,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Asserts that no mandatory requirement was lost or altered.
 * Throws an explicit error if a mandatory requirement is missing from the verification matrix.
 */
export function validateAcceptanceCompliance(
  contract: AcceptanceContract,
  checkedResults: Map<string, { passed: boolean; details: string }>
): {
  compliant: boolean;
  mandatoryFailures: { requirement: AcceptanceRequirement; reason: string }[];
  summary: string;
} {
  const mandatoryFailures: { requirement: AcceptanceRequirement; reason: string }[] = [];

  for (const req of contract.requirements) {
    if (req.priority === 'mandatory') {
      const result = checkedResults.get(acceptanceCheckId(req.id));
      if (!result) {
        mandatoryFailures.push({
          requirement: req,
          reason: `Mandatory requirement ${req.id} was not verified (no corresponding check executed).`,
        });
      } else if (!result.passed) {
        mandatoryFailures.push({
          requirement: req,
          reason: `Mandatory requirement ${req.id} FAILED: ${result.details}`,
        });
      }
    }
  }

  const compliant = mandatoryFailures.length === 0;
  const summary = compliant
    ? `All ${contract.requirements.filter(r => r.priority === 'mandatory').length} mandatory acceptance requirements PASSED.`
    : `Failed ${mandatoryFailures.length} mandatory acceptance requirements: ${mandatoryFailures.map(f => f.requirement.id).join(', ')}`;

  return { compliant, mandatoryFailures, summary };
}
