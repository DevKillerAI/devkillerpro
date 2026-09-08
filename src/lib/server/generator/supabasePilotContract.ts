import { createHash } from 'node:crypto';
import { z } from 'zod';
import { contractFingerprint, contractSchema, type GenerationContract, type GeneratorIdentity } from './contract';
import { createBriefboardContract, PILOT_MAX_MICROS, PILOT_MAX_PATCH_EDITS } from './pilotContract';
import { applyAuthorizedEdits } from './operationPolicy';
import type { GeneratorSnapshot } from './versionedEdits';

export const SUPABASE_PILOT_PATHS = ['src/App.tsx', 'src/styles.css', 'supabase/migrations/001_init.sql', 'supabase/migrations/002_priority.sql'] as const;
export const SUPABASE_PILOT_INITIAL_PATHS = SUPABASE_PILOT_PATHS.slice(0, 3);
export const SUPABASE_PILOT_BRIEF = `Build Privateboard, a polished responsive private task workspace with real Supabase email/password authentication and PostgreSQL persistence.
Return exactly src/App.tsx, src/styles.css, and supabase/migrations/001_init.sql. Do not produce package files, runtime configuration, secrets or tests. The platform supplies React 19, ReactDOM, @supabase/supabase-js 2.112.4 and compilation. Only import react, @supabase/supabase-js, and ./styles.css.
The browser receives window.__DK_SUPABASE__ = {url,anonKey,schema:'app',storageKey}. Instantiate createClient(url,anonKey,{db:{schema:'app'},auth:{storageKey,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}) once outside the component. For TypeScript cast window as needed. No hardcoded URLs/keys. LocalStorage is ONLY for the Supabase SDK session, NEVER task data. Use supabase.auth getSession/onAuthStateChange/signUp/signInWithPassword/signOut with proper error handling and listener cleanup. Local test email confirmation is disabled. Initial signed-out state is normal, not an error.
Sign-up and sign-in fields: data-testid login-email and login-password; buttons sign-up and sign-in. Show auth failures in auth-error. Signed-in users see sign-out. Do not display tasks from a prior session after logout/account change. Start empty, never seed samples.
CRUD app.tasks: id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id), title text not null with trimmed nonblank/max200 constraint, done boolean not null default false, request_id uuid not null, created_at timestamptz not null default now(). UNIQUE(owner_id,request_id) prevents duplicate submissions. Generate one request_id per attempted logical creation and retain it on ambiguous retry; a new logical submission gets a new UUID. Use .schema('app').from('tasks'). Do not send owner_id from the client; database assigns it. Database is authoritative. Preserve input and existing rows when a request fails. Disable conflicting buttons while saving.
Migration executes as restricted app schema owner, NOT postgres. app schema, auth.uid(), gen_random_uuid(), authenticated/anon roles already exist. Do not create extensions, roles, schemas or change auth/public/platform schemas. Enable AND FORCE RLS on app.tasks. Grant only SELECT/INSERT/UPDATE/DELETE on app.tasks to authenticated. No anon access. Policies for SELECT/DELETE must use owner_id=auth.uid(); INSERT WITH CHECK and UPDATE USING/WITH CHECK must reject cross-owner rows and ownership transfer. Do not use a subquery in a column DEFAULT; use the direct function default auth.uid(). No SECURITY DEFINER functions or privileged grants. No BEGIN/COMMIT; platform owns the transaction.
Allow add, edit title, toggle done/open, delete, All/Open/Done filtering. Test IDs: item-title/add-item, item-row per task, item-title-text per visible title, toggle-item native checkbox, edit-item/delete-item buttons inside row, edit-title/save-item/cancel-edit for editing, filter-all/filter-open/filter-done buttons. Empty title must not create a row. App failures use app-error. Persist across logout, new browser context and server restart; never claim success until server confirms.
English UI. Premium off-white/graphite/cyan, compact typography, clearly labelled inputs, accessible keyboard controls, polished empty/loading/error states, no horizontal overflow at 390px. No remote fonts/images, CSS @import, extra imports, fetch endpoints, timers simulating server success or invented progress. Keep combined sources below 40 KiB / 1200 lines. No council step. The platform independently tests your exact output and does not trust a generated test report.`;

const fileSchema = z.object({ path: z.enum(SUPABASE_PILOT_PATHS), content: z.string().min(1).max(50_000) }).strict();
export const privateboardBuildSchema = z.object({ summary: z.string().min(1).max(1800), files: z.array(fileSchema).length(3) }).strict()
  .refine(value => SUPABASE_PILOT_INITIAL_PATHS.every(p => value.files.filter(f => f.path === p).length === 1), 'Exactly the three initial files are required.')
  .refine(value => value.files.reduce((n, f) => n + Buffer.byteLength(f.content), 0) <= 40 * 1024 && value.files.reduce((n, f) => n + f.content.split('\n').length, 0) <= 1200, 'The reviewed source budget was exceeded.');
export const privateboardBuildJsonSchema = { type: 'object', additionalProperties: false, required: ['summary', 'files'], properties: {
  summary: { type: 'string' }, files: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'object', additionalProperties: false,
    required: ['path', 'content'], properties: { path: { type: 'string', enum: SUPABASE_PILOT_INITIAL_PATHS }, content: { type: 'string' } } } },
} };
export const privateboardPatchSchema = z.object({ summary: z.string().min(1).max(1800), edits: z.array(z.object({
  path: z.enum(SUPABASE_PILOT_PATHS), search: z.string().min(1).max(40_000), replacement: z.string().max(40_000),
}).strict()).min(1).max(PILOT_MAX_PATCH_EDITS) }).strict();
export const privateboardPatchJsonSchema = { type: 'object', additionalProperties: false, required: ['summary', 'edits'], properties: {
  summary: { type: 'string' }, edits: { type: 'array', minItems: 1, maxItems: PILOT_MAX_PATCH_EDITS, items: { type: 'object', additionalProperties: false,
    required: ['path', 'search', 'replacement'], properties: { path: { type: 'string', enum: [...SUPABASE_PILOT_PATHS] }, search: { type: 'string' }, replacement: { type: 'string' } } } },
} };
export const privateboardUpgradeSchema = z.object({ summary: z.string().min(1).max(1800), sql: z.string().min(1).max(8000) }).strict();
export const privateboardUpgradeJsonSchema = { type: 'object', additionalProperties: false, required: ['summary', 'sql'], properties: {
  summary: { type: 'string' }, sql: { type: 'string' },
} };

export function createPrivateboardContract(ownerId: string, requestId: string): GenerationContract {
  const base = createBriefboardContract(ownerId, requestId);
  return contractSchema.parse({ ...base, prompt: SUPABASE_PILOT_BRIEF,
    runtime: { id: 'react-supabase-pilot', version: 'v1' },
    capabilities: ['react', 'database.postgres', 'auth.email', 'authorization.owner'],
    requirements: base.requirements.map(requirement => requirement.id === 'persistence'
      ? { ...requirement, description: 'Server-side PostgreSQL persistence independent of browser storage.',
        acceptanceChecks: [...requirement.acceptanceChecks, { id: 'server-restart', description: 'Keep the same authenticated owner records after restarting the dedicated database process.', kind: 'database' }] } : requirement),
    budget: { currency: 'USD', maxCostMicros: PILOT_MAX_MICROS, maxProviderCalls: 5, maxRepairAttempts: 2 },
  });
}
export function assertPrivateboardContract(contract: GenerationContract) {
  const expected = createPrivateboardContract(contract.identity.ownerId, contract.identity.missionId.slice(-36));
  if (contractFingerprint(contract) !== contractFingerprint(expected)) throw new Error('Only the fixed Privateboard database/Auth benchmark is authorized.');
}

/** A changed initial migration receives a different isolated environment; refinements and upgrades retain it. */
export function privateboardEnvironmentIdentity(snapshot: GeneratorSnapshot): GeneratorIdentity {
  const migration = snapshot.files.find(file => file.path === SUPABASE_PILOT_PATHS[2]);
  if (!migration) throw new Error('Initial migration is missing.');
  return { ...snapshot.scope, environmentId: `v2-db-${createHash('sha256').update(snapshot.scope.environmentId + ':' + migration.hash).digest('hex').slice(0, 32)}` };
}

export function applyPrivateboardPatch(snapshot: GeneratorSnapshot, proposed: unknown, operationId: string, allowedPaths: readonly string[], now = Date.now()) {
  const patch = privateboardPatchSchema.parse(proposed);
  const next = applyAuthorizedEdits(snapshot, { scope: snapshot.scope, baseRevision: snapshot.revision, baseHash: snapshot.hash, newRevision: operationId,
    operations: patch.edits.map(edit => ({ kind: 'replace' as const, ...edit, expectedHash: snapshot.files.find(f => f.path === edit.path)?.hash ?? '' })),
  }, { operationId, identity: snapshot.scope, baseHash: snapshot.hash, baseRevision: snapshot.revision, allowedPaths: [...allowedPaths], allowCreate: false, allowDelete: false, expiresAt: now + 60_000 }, now);
  return { snapshot: next, summary: patch.summary };
}
export function applyPrivateboardUpgrade(snapshot: GeneratorSnapshot, proposed: unknown, now = Date.now()) {
  const upgrade = privateboardUpgradeSchema.parse(proposed);
  const operationId = 'upgrade-1';
  const next = applyAuthorizedEdits(snapshot, { scope: snapshot.scope, baseRevision: snapshot.revision, baseHash: snapshot.hash, newRevision: operationId,
    operations: [{ kind: 'create', path: SUPABASE_PILOT_PATHS[3], content: upgrade.sql }],
  }, { operationId, identity: snapshot.scope, baseHash: snapshot.hash, baseRevision: snapshot.revision, allowedPaths: [SUPABASE_PILOT_PATHS[3]], allowCreate: true, allowDelete: false, expiresAt: now + 60_000 }, now);
  return { snapshot: next, summary: upgrade.summary };
}
