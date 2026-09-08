import { createHash } from 'node:crypto';
import { z } from 'zod';
import { contractSchema, contractFingerprint, type GenerationContract } from './contract';

// A deliberately bounded benchmark, not the admission policy for arbitrary v2 apps.
export const PILOT_CAMPAIGN = 'pilot-20260903';
export const PILOT_MAX_MICROS = 3_000_000;
export const PILOT_VERIFIER_VERSION = 'briefboard-v1';
export const PILOT_PATHS = ['src/App.tsx', 'src/styles.css'] as const;
export const PILOT_MAX_PATCH_EDITS = 16;
export const PILOT_BRIEF = `Create Briefboard, a polished responsive React workspace for managing small tasks.
This is a browser-only local MVP, with no login, backend, database server, external APIs or network dependencies.
Start empty. Let the user add a task with a required nonblank title, edit its title, mark it done or open, and delete it.
Provide All, Open and Done filters. Persist real tasks in localStorage under briefboard-items-v1 across page reloads; never automatically insert sample records.
Use a clean premium off-white/graphite interface with a cyan accent, clear empty states, keyboard accessible controls, and mobile layout without horizontal overflow.
Keep all user-visible copy in English. Do not promise server synchronization or multi-user accounts.
Provide src/App.tsx (default React component export) and src/styles.css only. React, ReactDOM, the entry point and the build environment are supplied by DevKiller.
The acceptance interface must use these data-testid attributes:
item-title (labelled input for adding); add-item (button); item-row (one per task); item-title-text (visible title inside each row);
toggle-item (native checkbox inside each row); edit-item and delete-item (buttons inside each row);
edit-title (labelled title input while editing); save-item and cancel-edit (buttons while editing);
filter-all, filter-open, filter-done (buttons). Empty title submissions must not create items.
Use imports only from react. Keep the combined source below 32 KiB and 1200 lines. Do not fetch anything, import packages or styles from the internet, or generate build scripts.
The platform tests the built application independently; do not write or change test code.`;

export const pilotBuildSchema = z.object({
  summary: z.string().min(1).max(1800),
  files: z.array(z.object({ path: z.enum(PILOT_PATHS), content: z.string().min(1).max(100_000) }).strict()).length(2),
}).strict().refine(value => new Set(value.files.map(file => file.path)).size === 2, 'Both source files must be provided exactly once.')
  .refine(value => value.files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0) <= 32 * 1024 && value.files.reduce((sum, file) => sum + file.content.split('\n').length, 0) <= 1200, 'Pilot sources exceed the reviewed incremental-edit context budget.');

export const pilotBuildJsonSchema = {
  type: 'object', additionalProperties: false, required: ['summary', 'files'], properties: {
    summary: { type: 'string' },
    files: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'object', additionalProperties: false, required: ['path', 'content'], properties: {
      path: { type: 'string', enum: [...PILOT_PATHS] }, content: { type: 'string' },
    } } },
  },
};
export const pilotPatchSchema = z.object({ summary: z.string().min(1).max(1800), edits: z.array(z.object({
  path: z.enum(PILOT_PATHS), search: z.string().min(1).max(30_000), replacement: z.string().max(40_000),
}).strict()).min(1).max(PILOT_MAX_PATCH_EDITS) }).strict();
export const pilotPatchJsonSchema = {
  type: 'object', additionalProperties: false, required: ['summary', 'edits'], properties: {
    summary: { type: 'string' }, edits: { type: 'array', minItems: 1, maxItems: PILOT_MAX_PATCH_EDITS, items: { type: 'object', additionalProperties: false, required: ['path', 'search', 'replacement'], properties: {
      path: { type: 'string', enum: [...PILOT_PATHS] }, search: { type: 'string' }, replacement: { type: 'string' },
    } } },
  },
};

export function createBriefboardContract(ownerId: string, requestId: string): GenerationContract {
  z.string().uuid().parse(requestId);
  const prefix = createHash('sha256').update(ownerId).digest('hex').slice(0, 12);
  const id = `${prefix}-${requestId}`;
  return contractSchema.parse({
    version: 1, engine: 'v2', identity: { ownerId, projectId: `v2-project-${id}`, missionId: `v2-pilot-${id}`, environmentId: `v2-env-${id}` },
    briefingMode: 'simple', prompt: PILOT_BRIEF, outputLocale: 'en', delivery: 'local_preview',
    runtime: { id: 'react-static-pilot', version: 'v1' }, capabilities: ['react'],
    requirements: [
      { id: 'items', description: 'Create, update, complete and remove real tasks.', acceptanceChecks: [
        { id: 'create', description: 'Create a task with its entered title.', kind: 'browser' },
        { id: 'empty-title', description: 'Reject empty task titles.', kind: 'browser' },
        { id: 'edit', description: 'Edit an existing task title.', kind: 'browser' },
        { id: 'toggle', description: 'Toggle completion with a checkbox.', kind: 'browser' },
        { id: 'delete', description: 'Delete an existing task.', kind: 'browser' },
      ] },
      { id: 'filters', description: 'Filter task status without changing saved data.', acceptanceChecks: ['all', 'open', 'done'].map(id => ({ id, description: `Show the correct tasks for the ${id} filter.`, kind: 'browser' })) },
      { id: 'persistence', description: 'Local browser persistence, not server synchronization.', acceptanceChecks: [{ id: 'reload', description: 'Preserve tasks across page reloads.', kind: 'browser' }] },
      { id: 'responsive', description: 'Useful mobile interface.', acceptanceChecks: [{ id: 'mobile', description: 'The app stays within a mobile viewport.', kind: 'visual' }] },
    ],
    budget: { currency: 'USD', maxCostMicros: PILOT_MAX_MICROS, maxProviderCalls: 5, maxRepairAttempts: 2 },
  });
}

export function assertPilotContract(contract: GenerationContract) {
  contractSchema.parse(contract);
  const expected = createBriefboardContract(contract.identity.ownerId, contract.identity.missionId.slice(-36));
  if (contract.prompt !== PILOT_BRIEF || contract.runtime.id !== 'react-static-pilot' || contract.runtime.version !== 'v1' ||
      contract.outputLocale !== 'en' || contract.delivery !== 'local_preview' || contract.capabilities.join(',') !== 'react' ||
      contract.budget.maxCostMicros > PILOT_MAX_MICROS || contract.budget.maxProviderCalls > 5 || contract.budget.maxRepairAttempts > 2 ||
      contractFingerprint(expected) !== contractFingerprint(contract))
    throw new Error('This pilot only supports the declared Briefboard benchmark. Generic v2 generation remains disabled.');
}
