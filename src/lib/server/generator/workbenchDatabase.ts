import { createHash } from 'node:crypto';
import { identitySchema, sameIdentity, type GeneratorIdentity } from './contract';
import { createGeneratorSnapshot, type GeneratorSnapshot } from './versionedEdits';
import {
  applySupabasePilotMigrations, assertSupabasePilotEnvironmentBinding, ensureSupabasePilotEnvironment,
  inspectSupabasePilotPrerequisites, inspectSupabasePilotTableGuards, validateSupabasePilotMigrations,
  type SupabasePilotEnvironment, type SupabasePilotMigrationEvidence,
} from './supabasePilotEnvironment';

type TableGuard = Awaited<ReturnType<typeof inspectSupabasePilotTableGuards>>[number];
export type WorkbenchDatabase = {
  environment: SupabasePilotEnvironment;
  migrationEvidence: SupabasePilotMigrationEvidence;
  tableNames: string[];
  guards: TableGuard[];
};
export type WorkbenchDatabaseDependencies = {
  ensure: typeof ensureSupabasePilotEnvironment;
  apply: typeof applySupabasePilotMigrations;
  inspectGuards: typeof inspectSupabasePilotTableGuards;
};
const dependencies: WorkbenchDatabaseDependencies = {
  ensure: ensureSupabasePilotEnvironment, apply: applySupabasePilotMigrations, inspectGuards: inspectSupabasePilotTableGuards,
};
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const NAME = '[a-z][a-z0-9_]{0,62}';

function verifiedSnapshot(snapshot: GeneratorSnapshot) {
  const verified = createGeneratorSnapshot(snapshot);
  if (verified.hash !== snapshot.hash || verified.totalBytes !== snapshot.totalBytes || snapshot.schemaVersion !== 1 ||
    snapshot.files.some(file => verified.files.find(item => item.path === file.path)?.hash !== file.hash)) {
    throw new Error('Workbench database snapshot bytes do not match their recorded hashes.');
  }
  return verified;
}

/** Mask comments and string contents before inspecting SQL structure; the restricted database role remains the boundary. */
function sqlStructure(source: string): string {
  let result = '', index = 0;
  while (index < source.length) {
    if (source.startsWith('--', index)) {
      const end = source.indexOf('\n', index + 2); index = end < 0 ? source.length : end + 1; result += ' '; continue;
    }
    if (source.startsWith('/*', index)) {
      let depth = 1; index += 2;
      while (index < source.length && depth) {
        if (source.startsWith('/*', index)) { depth++; index += 2; }
        else if (source.startsWith('*/', index)) { depth--; index += 2; }
        else index++;
      }
      if (depth) throw new Error('Unterminated SQL comment.');
      result += ' '; continue;
    }
    if (source[index] === '"') throw new Error('Workbench migrations require unquoted lower-case identifiers.');
    if (source[index] === "'") {
      index++; let closed = false;
      while (index < source.length) {
        if (source[index] === "'" && source[index + 1] === "'") index += 2;
        else if (source[index] === "'") { index++; closed = true; break; }
        else index++;
      }
      if (!closed) throw new Error('Unterminated SQL string.');
      result += ' __literal__ '; continue;
    }
    if (source[index] === '$') {
      const tag = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (tag) {
        const end = source.indexOf(tag, index + tag.length);
        if (end < 0) throw new Error('Unterminated SQL string.');
        index = end + tag.length; result += ' __literal__ '; continue;
      }
    }
    result += source[index++].toLowerCase();
  }
  return result.trim().replace(/\s+/g, ' ');
}

function topLevelParts(value: string): string[] {
  const parts: string[] = [];
  let level = 0, start = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '(') level++;
    else if (value[index] === ')') { level--; if (level < 0) throw new Error('Unbalanced SQL structure.'); }
    else if (value[index] === ',' && level === 0) { parts.push(value.slice(start,index).trim()); start=index+1; }
  }
  if (level) throw new Error('Unbalanced SQL structure.');
  parts.push(value.slice(start).trim());
  return parts;
}

function topLevelConstraints(column: string): string {
  let depth = 0, result = '';
  for (const character of column) {
    if (character === '(') { depth++; result += ' '; }
    else if (character === ')') { depth--; result += ' '; }
    else if (depth === 0) result += character;
  }
  return result.replace(/\s+/g, ' ');
}

export function validateWorkbenchDatabaseSource(snapshot: GeneratorSnapshot) {
  const verified = verifiedSnapshot(snapshot);
  const migrations = validateSupabasePilotMigrations(verified.files);
  if (!/^supabase\/migrations\/001_[a-z][a-z0-9_]*\.sql$/.test(migrations[0].path)) {
    throw new Error('Workbench requires an immutable initial migration named 001_<name>.sql.');
  }
  const tables = new Set<string>(), enabled = new Set<string>(), forced = new Set<string>();
  const requireTable = (name: string) => {
    if (!tables.has(name)) throw new Error('SQL targets an undeclared application table: app.' + name);
  };
  for (const migration of migrations) for (const original of migration.statements) {
    const sql = sqlStructure(original);
    const create = sql.match(new RegExp('^create table app\\.(' + NAME + ')\\s*\\(([\\s\\S]*)\\)$'));
    if (create) {
      const name = create[1];
      if (tables.has(name) || tables.size >= 16) throw new Error('Workbench supports 1–16 uniquely declared application tables.');
      const parts = topLevelParts(create[2]);
      const id = parts.find(part => /^id\s+uuid\b/.test(part));
      const owner = parts.find(part => /^owner_id\s+uuid\b/.test(part));
      const request = parts.find(part => /^request_id\s+uuid\b/.test(part));
      if (!id || (!/\bprimary key\b/.test(topLevelConstraints(id)) && !parts.some(part => /^(?:constraint [a-z][a-z0-9_]* )?primary key\s*\(\s*id\s*\)$/.test(part)))) {
        throw new Error('Every application table requires id UUID PRIMARY KEY.');
      }
      if (!owner || !/\bnot null\b/.test(topLevelConstraints(owner)) || !/\bdefault\b/.test(topLevelConstraints(owner)) || !/\bdefault\s+\(*auth\.uid\(\)\)*/.test(owner)) {
        throw new Error('Every application table requires owner_id UUID NOT NULL DEFAULT auth.uid().');
      }
      if (!request || !/\bnot null\b/.test(topLevelConstraints(request)) || /\bdefault\b/.test(topLevelConstraints(request)) ||
        !parts.some(part => /^(?:constraint [a-z][a-z0-9_]* )?unique\s*\(\s*owner_id\s*,\s*request_id\s*\)$/.test(part))) {
        throw new Error('Every application table requires client-generated request_id UUID NOT NULL and UNIQUE(owner_id, request_id).');
      }
      if (/\binherits\b|\bpartition by\b/.test(sql)) throw new Error('Inherited or partitioned generated tables are outside the Workbench runtime.');
      tables.add(name); continue;
    }
    const alter = sql.match(new RegExp('^alter table app\\.(' + NAME + ') (.+)$'));
    if (alter) {
      requireTable(alter[1]);
      if (alter[2] === 'enable row level security') enabled.add(alter[1]);
      else if (alter[2] === 'force row level security') forced.add(alter[1]);
      else if (!topLevelParts(alter[2]).every(part => /^add (?:column (?:if not exists )?[a-z][a-z0-9_]* |constraint [a-z][a-z0-9_]* (?:check|unique|foreign key)\b)/.test(part))) {
        throw new Error('Workbench ALTER TABLE is limited to additive columns/constraints and enabling/forcing RLS.');
      }
      continue;
    }
    const index = sql.match(new RegExp('^create (?:unique )?index (?:if not exists )?(?:app\\.)?' + NAME + ' on app\\.(' + NAME + ')\\b'));
    if (index) { requireTable(index[1]); continue; }
    const policy = sql.match(new RegExp('^(?:create|alter) policy ' + NAME + ' on app\\.(' + NAME + ')\\b'));
    if (policy) {
      requireTable(policy[1]);
      if (!/\bto authenticated\b/.test(sql) || /\bto authenticated\s*,/.test(sql)) throw new Error('Workbench policies must target only authenticated users.');
      continue;
    }
    const grant = sql.match(/^grant (select|insert|update|delete)(?:\s*,\s*(?:select|insert|update|delete))* on (?:table )?(.+) to authenticated$/);
    const revoke = sql.match(/^revoke (?:all|select|insert|update|delete)(?:\s*,\s*(?:select|insert|update|delete))* on (?:table )?(.+) from (?:anon|public|authenticated)(?:\s*,\s*(?:anon|public|authenticated))*$/);
    if (grant || revoke) {
      const targets = (grant ? grant[2] : revoke![1]).split(',').map(target => target.trim());
      for (const target of targets) {
        const name = target.match(new RegExp('^app\\.(' + NAME + ')$'))?.[1];
        if (!name) throw new Error('Generated grants may target only explicitly declared app tables.');
        requireTable(name);
      }
      continue;
    }
    throw new Error('SQL statement is outside the additive Workbench app-schema allowlist: '+sql.slice(0,100));
  }
  if (!tables.size) throw new Error('Workbench database migrations must create at least one application table.');
  for (const name of tables) if (!enabled.has(name) || !forced.has(name)) {
    throw new Error('Every application table must ENABLE and FORCE ROW LEVEL SECURITY: app.' + name);
  }
  return { migrations, tableNames:[...tables].sort() };
}

/** Any initial SQL repair gets an isolated environment; accepted UI/CSS edits retain their exact frozen schema. */
export function workbenchEnvironmentIdentity(snapshot: GeneratorSnapshot): GeneratorIdentity {
  const { migrations } = validateWorkbenchDatabaseSource(snapshot);
  const schemaFingerprint = sha(JSON.stringify(migrations.map(({ path, hash }) => ({ path, hash }))));
  return identitySchema.parse({ ...snapshot.scope,
    environmentId:'wb-db-' + sha(snapshot.scope.environmentId + ':' + schemaFingerprint).slice(0,32) });
}

/** Accepted app edits freeze SQL. Future staged upgrade callers must explicitly opt into append-only additions. */
export function assertWorkbenchMigrationContinuity(base: GeneratorSnapshot, next: GeneratorSnapshot, options: { allowNewMigrations?: boolean } = {}) {
  const previous = validateWorkbenchDatabaseSource(base).migrations, current = validateWorkbenchDatabaseSource(next).migrations;
  if (!sameIdentity(identitySchema.parse(base.scope), identitySchema.parse(next.scope))) throw new Error('An edit cannot replace its accepted database scope.');
  for (const migration of previous) if (!current.some(item => item.path === migration.path && item.hash === migration.hash)) {
    throw new Error('Accepted database migrations are immutable; add a new migration instead.');
  }
  if (!options.allowNewMigrations && current.length !== previous.length) {
    throw new Error('Accepted database schema is immutable. App edits cannot add SQL until staged upgrades are supported.');
  }
  if (current.some(item => !previous.some(old => old.path === item.path) && item.path <= previous[previous.length-1].path)) {
    throw new Error('New database migrations must follow every accepted migration.');
  }
}

export const inspectWorkbenchDatabasePrerequisites = inspectSupabasePilotPrerequisites;

/** Provisions an isolated app database and applies exact-hash migrations; never resets or removes an environment. */
export async function prepareWorkbenchDatabase(
  snapshot: GeneratorSnapshot, signal?: AbortSignal, adapter: WorkbenchDatabaseDependencies = dependencies,
  expectedIdentity?: GeneratorIdentity,
): Promise<WorkbenchDatabase> {
  signal?.throwIfAborted();
  const { tableNames, migrations } = validateWorkbenchDatabaseSource(snapshot);
  const identity = workbenchEnvironmentIdentity(snapshot);
  if (expectedIdentity && !sameIdentity(identity, identitySchema.parse(expectedIdentity))) throw new Error('Database identity changed from the accepted delivery.');
  const environment = await adapter.ensure(identity, signal);
  assertSupabasePilotEnvironmentBinding(environment, identity);
  signal?.throwIfAborted();
  const migrationEvidence = await adapter.apply(environment, snapshot.files, signal);
  const fingerprint = sha(JSON.stringify(migrations.map(({ path, hash }) => ({ path, hash }))));
  if (migrationEvidence.scopeHash !== environment.scopeHash || migrationEvidence.fingerprint !== fingerprint ||
    migrationEvidence.files.length !== migrations.length || migrations.some(file =>
      !migrationEvidence.files.some(applied => applied.path === file.path && applied.hash === file.hash && Number.isFinite(Date.parse(applied.appliedAt))))) {
    throw new Error('Database migration receipts do not match the source and environment.');
  }
  signal?.throwIfAborted();
  const guards = await adapter.inspectGuards(environment, tableNames, signal);
  signal?.throwIfAborted();
  if (guards.length !== tableNames.length || tableNames.some(name => {
    const matches = guards.filter(guard => guard.table === 'app.' + name);
    return matches.length !== 1 || !matches[0].enabled || !matches[0].forced || !matches[0].ownerMigrator;
  })) throw new Error('Database tables failed their actual RLS/ownership catalog checks.');
  // Catalog flags do not prove policy correctness. Independent cross-owner CRUD tests remain mandatory.
  return { environment, migrationEvidence, tableNames, guards };
}
