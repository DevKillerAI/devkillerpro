import { createHash } from 'node:crypto';
import { z } from 'zod';

export const scopedId = z.string().min(1).max(180).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
export const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const identitySchema = z.object({
  ownerId: scopedId,
  projectId: scopedId,
  missionId: scopedId,
  environmentId: scopedId,
}).strict();
export type GeneratorIdentity = z.infer<typeof identitySchema>;

// App capabilities are conditional; DK account/profile/credits are platform requirements.
export const CAPABILITIES = [
  'react', 'database.postgres', 'database.sqlite', 'auth.email',
  'authorization.owner', 'storage.upload', 'export.csv', 'ai.text', 'ai.vision',
  'ai.image.generate', 'ai.image.edit', 'media.svg', 'media.video', 'media.webgl',
] as const;
export type Capability = typeof CAPABILITIES[number];

export const contractSchema = z.object({
  version: z.literal(1),
  engine: z.literal('v2'),
  identity: identitySchema,
  briefingMode: z.enum(['simple', 'detailed']),
  prompt: z.string().trim().min(3).max(30_000),
  outputLocale: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).max(35),
  delivery: z.enum(['local_preview', 'private_pilot', 'public_release']),
  runtime: z.object({ id: scopedId, version: scopedId }).strict(),
  capabilities: z.array(z.enum(CAPABILITIES)).min(1).max(CAPABILITIES.length),
  requirements: z.array(z.object({
    id: scopedId,
    description: z.string().trim().min(3).max(1500),
    acceptanceChecks: z.array(z.object({
      id: scopedId,
      description: z.string().trim().min(3).max(1500),
      kind: z.enum(['browser', 'api', 'database', 'visual', 'security', 'export']),
    }).strict()).min(1).max(20),
  }).strict()).min(1).max(50),
  budget: z.object({
    currency: z.literal('USD'),
    maxCostMicros: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    maxProviderCalls: z.number().int().min(1).max(100),
    maxRepairAttempts: z.number().int().min(0).max(10),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  const unique = (values: string[], name: string) => {
    if (new Set(values).size !== values.length) ctx.addIssue({ code: 'custom', message: `Duplicate ${name}.` });
  };
  unique(value.capabilities, 'capabilities');
  unique(value.requirements.map(r => r.id), 'requirements');
  unique(value.requirements.flatMap(r => r.acceptanceChecks.map(c => c.id)), 'acceptance checks');
  const has = (capability: Capability) => value.capabilities.includes(capability);
  if (has('database.postgres') && has('database.sqlite')) ctx.addIssue({ code: 'custom', message: 'Choose one database capability per runtime contract.' });
  if (has('auth.email') && (!has('database.postgres') || !has('authorization.owner'))) ctx.addIssue({ code: 'custom', message: 'Email authentication currently requires PostgreSQL and owner authorization.' });
  if (has('authorization.owner') && !has('auth.email')) ctx.addIssue({ code: 'custom', message: 'Owner authorization requires an explicit app identity capability.' });
});
export type GenerationContract = z.infer<typeof contractSchema>;

export function sameIdentity(a: GeneratorIdentity, b: GeneratorIdentity): boolean {
  return ['ownerId', 'projectId', 'missionId', 'environmentId'].every(key => a[key as keyof GeneratorIdentity] === b[key as keyof GeneratorIdentity]);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function contractFingerprint(value: GenerationContract): string {
  return createHash('sha256').update(canonical(contractSchema.parse(value))).digest('hex');
}

const baseChecks = ['build', 'startup', 'browser-core', 'scope-isolation', 'responsive-layout', 'source-export'];
const capabilityChecks: Record<Capability, string[]> = {
  react: [],
  'database.postgres': ['migration-fresh', 'migration-upgrade', 'persistence', 'database-concurrency'],
  'database.sqlite': ['migration-fresh', 'migration-upgrade', 'persistence', 'database-concurrency'],
  'auth.email': ['auth-session-lifecycle', 'auth-two-users'],
  'authorization.owner': ['authorization-cross-owner', 'authorization-anonymous'],
  'storage.upload': ['upload-validation', 'asset-isolation', 'asset-export'],
  'export.csv': ['csv-roundtrip'],
  'ai.text': ['ai-secret-isolation', 'ai-budget', 'ai-error-handling'],
  'ai.vision': ['ai-secret-isolation', 'ai-budget', 'ai-error-handling', 'vision-input'],
  'ai.image.generate': ['ai-secret-isolation', 'ai-budget', 'ai-error-handling', 'image-generation', 'asset-export'],
  'ai.image.edit': ['ai-secret-isolation', 'ai-budget', 'ai-error-handling', 'image-editing', 'asset-export'],
  'media.svg': ['svg-safety', 'svg-render-export'],
  'media.video': ['video-fallback', 'reduced-motion', 'media-performance'],
  'media.webgl': ['webgl-fallback', 'reduced-motion', 'media-performance'],
};

export function requiredCheckIds(value: GenerationContract): string[] {
  const contract = contractSchema.parse(value);
  const checks = new Set(baseChecks.map(id => `platform:${id}`));
  for (const capability of contract.capabilities) for (const check of capabilityChecks[capability]) {
    // Workbench preserves an accepted app's schema. Its database profile proves
    // replay/idempotency; staging an upgrade remains a distinct unsupported operation.
    const scopedCheck = contract.runtime.id === 'react-workbench' && check === 'migration-upgrade'
      ? 'migration-idempotency' : check;
    checks.add(`platform:${scopedCheck}`);
  }
  if (contract.delivery !== 'local_preview') for (const check of ['preview-access', 'backup-restore', 'resource-quotas']) checks.add(`platform:${check}`);
  if (contract.delivery === 'public_release') for (const check of ['deployment', 'monitoring', 'release-security-review']) checks.add(`platform:${check}`);
  for (const requirement of contract.requirements) for (const check of requirement.acceptanceChecks) checks.add(`requirement:${requirement.id}:${check.id}`);
  return [...checks].sort();
}
