import { createHash } from 'node:crypto';

/** The caller must derive this scope from authenticated authorization, not model output. */
export type GeneratorScope = Readonly<{
  ownerId: string;
  projectId: string;
  missionId: string;
  environmentId: string;
}>;

export type GeneratorSourceFile = Readonly<{ path: string; content: string }>;
export type GeneratorSnapshotFile = GeneratorSourceFile & Readonly<{ hash: string }>;
export type GeneratorSnapshot = Readonly<{
  schemaVersion: 1;
  scope: GeneratorScope;
  revision: string;
  hash: string;
  parent: Readonly<{ revision: string; hash: string }> | null;
  files: readonly GeneratorSnapshotFile[];
  totalBytes: number;
}>;

export type GeneratorEditLimits = Readonly<{
  maxFiles: number;
  maxFileBytes: number;
  maxSnapshotBytes: number;
  maxOperations: number;
  maxPatchBytes: number;
  maxContextFiles: number;
  maxContextSelections: number;
  maxContextBytes: number;
  maxContextLines: number;
}>;

export const DEFAULT_GENERATOR_EDIT_LIMITS: GeneratorEditLimits = Object.freeze({
  maxFiles: 256,
  maxFileBytes: 512 * 1024,
  maxSnapshotBytes: 4 * 1024 * 1024,
  maxOperations: 64,
  maxPatchBytes: 512 * 1024,
  maxContextFiles: 12,
  maxContextSelections: 24,
  maxContextBytes: 96 * 1024,
  maxContextLines: 1600,
});

export type GeneratorEditErrorCode =
  | 'INVALID_INPUT' | 'UNSAFE_PATH' | 'PROTECTED_PATH' | 'PATH_COLLISION'
  | 'LIMIT_EXCEEDED' | 'SCOPE_MISMATCH' | 'STALE_BASE' | 'INVALID_SNAPSHOT'
  | 'MISSING_FILE' | 'FILE_EXISTS' | 'STALE_FILE' | 'CONFLICTING_OPERATIONS'
  | 'MATCH_NOT_UNIQUE' | 'NO_CHANGE' | 'INVALID_RANGE';

export class GeneratorEditError extends Error {
  constructor(public readonly code: GeneratorEditErrorCode, message: string) {
    super(message);
    this.name = 'GeneratorEditError';
  }
}

type BoundRequest = Readonly<{
  scope: GeneratorScope;
  baseRevision: string;
  baseHash: string;
}>;

export type GeneratorEditOperation =
  | Readonly<{ kind: 'replace'; path: string; expectedHash: string; search: string; replacement: string }>
  | Readonly<{ kind: 'create'; path: string; content: string }>
  | Readonly<{ kind: 'delete'; path: string; expectedHash: string }>;

export type GeneratorEditRequest = BoundRequest & Readonly<{
  newRevision: string;
  operations: readonly GeneratorEditOperation[];
}>;

export type GeneratorContextRequest = BoundRequest & Readonly<{
  selections: readonly Readonly<{ path: string; startLine: number; endLine: number }>[];
  budget: Readonly<{ maxFiles: number; maxBytes: number; maxLines: number }>;
}>;

export type GeneratorContext = Readonly<{
  scope: GeneratorScope;
  baseRevision: string;
  baseHash: string;
  totalBytes: number;
  totalLines: number;
  selections: readonly Readonly<{
    path: string;
    fileHash: string;
    startLine: number;
    endLine: number;
    totalFileLines: number;
    content: string;
  }>[];
}>;

const SCOPE_KEYS = ['ownerId', 'projectId', 'missionId', 'environmentId'] as const;
const HASH_FORMAT = /^[a-f0-9]{64}$/;
const IDENTIFIER_FORMAT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,179}$/;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9]|conin\$|conout\$|clock\$)(?:\.|$)/i;
const PROTECTED_SEGMENTS = new Set([
  '.git', '.github', '.gitlab', '.hg', '.svn', '.ssh', '.aws', '.azure', '.gcloud',
  '.devkiller', '.codex', '.agents', '.harness', '__harness__', 'harness',
  'node_modules', '.next', 'secrets', 'credentials',
]);

function fail(code: GeneratorEditErrorCode, message: string): never {
  throw new GeneratorEditError(code, message);
}

function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_INPUT', 'Expected an object.');
  }
}

function array(value: unknown): void {
  if (!Array.isArray(value)) fail('INVALID_INPUT', 'Expected an array.');
}

function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !IDENTIFIER_FORMAT.test(value)) {
    fail('INVALID_INPUT', 'Identifiers must be nonempty alphanumeric, underscore or hyphen tokens, at most 180 characters.');
  }
}

function scope(value: unknown): asserts value is GeneratorScope {
  object(value);
  for (const key of SCOPE_KEYS) identifier(value[key]);
}

function positiveInteger(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    fail('INVALID_INPUT', 'Limits must be positive safe integers.');
  }
}

/** Limits can only be tightened by a caller; raising the safety ceiling requires a code review. */
function resolveLimits(overrides: Partial<GeneratorEditLimits>): GeneratorEditLimits {
  object(overrides);
  const result = { ...DEFAULT_GENERATOR_EDIT_LIMITS };
  for (const key of Object.keys(overrides) as (keyof GeneratorEditLimits)[]) {
    if (!Object.hasOwn(DEFAULT_GENERATOR_EDIT_LIMITS, key)) fail('INVALID_INPUT', 'Unknown limit.');
    const value = overrides[key];
    positiveInteger(value);
    if (value > DEFAULT_GENERATOR_EDIT_LIMITS[key]) fail('LIMIT_EXCEEDED', 'Safety limits cannot be raised.');
    result[key] = value;
  }
  return result;
}

/**
 * Deliberately accepts only portable ASCII relative paths. No decoding, separator
 * replacement, case folding, or normalization is applied to a filesystem target.
 * Unicode source content is supported; Unicode filenames require a separate policy.
 */
function safePath(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || value.length > 240 ||
      /[^\x20-\x7e]|[\\<>:"|?*%]/.test(value) || value.startsWith('/')) {
    fail('UNSAFE_PATH', 'Path is not a portable relative source path.');
  }
  const segments = value.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || segment.trim() !== segment ||
        segment.endsWith('.') || WINDOWS_DEVICE.test(segment)) {
      fail('UNSAFE_PATH', 'Path contains an ambiguous or reserved segment.');
    }
    const lower = segment.toLowerCase();
    if (PROTECTED_SEGMENTS.has(lower) || /^\.env(?:[._-]|$)/.test(lower) || lower === '.envrc' ||
        /^(?:harness[.-]|agents\.md$|skill\.md$|id_(?:rsa|ed25519|ecdsa)(?:\.|$))/.test(lower) ||
        /\.(?:pem|key|p12|pfx|keystore|jks)$/.test(lower)) {
      fail('PROTECTED_PATH', 'Credentials, platform internals and verification harnesses are not editable sources.');
    }
  }
}

function textBytes(value: unknown, maxBytes: number): number {
  if (typeof value !== 'string') fail('INVALID_INPUT', 'Source content must be a string.');
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > maxBytes) fail('LIMIT_EXCEEDED', 'Text exceeds its byte limit.');
  // Reject strings whose UTF-8 representation would silently replace malformed surrogates.
  if (Buffer.from(value, 'utf8').toString('utf8') !== value) {
    fail('INVALID_INPUT', 'Text must have a lossless UTF-8 representation.');
  }
  return bytes;
}

function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function freezeScope(value: GeneratorScope): GeneratorScope {
  return Object.freeze({
    ownerId: value.ownerId, projectId: value.projectId,
    missionId: value.missionId, environmentId: value.environmentId,
  });
}

function buildSnapshot(
  input: Readonly<{ scope: GeneratorScope; revision: string; files: readonly GeneratorSourceFile[] }>,
  limits: GeneratorEditLimits,
  parent: GeneratorSnapshot['parent'] = null,
): GeneratorSnapshot {
  object(input);
  scope(input.scope);
  identifier(input.revision);
  array(input.files);
  if (input.files.length > limits.maxFiles) fail('LIMIT_EXCEEDED', 'Too many source files.');
  const paths = new Set<string>();
  const segmentsByCanonicalPath = new Map<string, string>();
  const directories = new Set<string>();
  let totalBytes = 0;
  const files = Array.from(input.files, (file) => {
    object(file);
    safePath(file.path);
    const canonical = file.path.toLowerCase();
    if (paths.has(canonical)) fail('PATH_COLLISION', 'Source paths must be unique on Windows and Linux.');
    const segments = file.path.split('/');
    for (let count = 1; count <= segments.length; count++) {
      const prefix = segments.slice(0, count).join('/');
      const prefixKey = prefix.toLowerCase();
      const previous = segmentsByCanonicalPath.get(prefixKey);
      if (previous && previous !== prefix) fail('PATH_COLLISION', 'Directory casing must also be consistent across source paths.');
      segmentsByCanonicalPath.set(prefixKey, prefix);
      if (count < segments.length) {
        if (paths.has(prefixKey)) fail('PATH_COLLISION', 'A source file cannot also be a directory.');
        directories.add(prefixKey);
      } else if (directories.has(prefixKey)) {
        fail('PATH_COLLISION', 'A directory cannot also be a source file.');
      }
    }
    paths.add(canonical);
    totalBytes += textBytes(file.content, limits.maxFileBytes);
    if (totalBytes > limits.maxSnapshotBytes) fail('LIMIT_EXCEEDED', 'Snapshot exceeds its byte limit.');
    return Object.freeze({ path: file.path, content: file.content, hash: contentHash(file.content) });
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const hash = contentHash(`devkiller-source-v1\n${JSON.stringify(files.map((file) => [file.path, file.content]))}`);
  return Object.freeze({
    schemaVersion: 1, scope: freezeScope(input.scope), revision: input.revision, hash,
    parent: parent ? Object.freeze({ ...parent }) : null,
    files: Object.freeze(files), totalBytes,
  });
}

/** Creates an immutable, validated snapshot of model-editable sources only; performs no I/O. */
export function createGeneratorSnapshot(
  input: Readonly<{ scope: GeneratorScope; revision: string; files: readonly GeneratorSourceFile[] }>,
  limits: Partial<GeneratorEditLimits> = {},
): GeneratorSnapshot {
  return buildSnapshot(input, resolveLimits(limits));
}

function bindSnapshot(snapshot: GeneratorSnapshot, request: BoundRequest, limits: GeneratorEditLimits): GeneratorSnapshot {
  object(snapshot);
  object(request);
  scope(snapshot.scope);
  scope(request.scope);
  for (const key of SCOPE_KEYS) {
    if (snapshot.scope[key] !== request.scope[key]) fail('SCOPE_MISMATCH', 'Request does not belong to this snapshot scope.');
  }
  identifier(request.baseRevision);
  if (typeof request.baseHash !== 'string' || !HASH_FORMAT.test(request.baseHash)) {
    fail('INVALID_INPUT', 'A valid SHA-256 base hash is required.');
  }
  if (request.baseRevision !== snapshot.revision || request.baseHash !== snapshot.hash) {
    fail('STALE_BASE', 'The requested base is no longer the selected revision.');
  }
  const verified = buildSnapshot(snapshot, limits);
  if (snapshot.schemaVersion !== 1 || snapshot.hash !== verified.hash || snapshot.totalBytes !== verified.totalBytes ||
      snapshot.files.some((file) => verified.files.find((candidate) => candidate.path === file.path)?.hash !== file.hash)) {
    fail('INVALID_SNAPSHOT', 'Snapshot content or metadata does not match its recorded hash.');
  }
  return verified;
}

/**
 * Applies a batch atomically to an immutable base. No writes, execution, or fuzzy
 * matching occur. All expectedHash values refer to files in the original base.
 * Persistence must still use a compare-and-swap on baseRevision AND baseHash.
 */
export function applyVersionedEdits(
  snapshot: GeneratorSnapshot,
  request: GeneratorEditRequest,
  limitOverrides: Partial<GeneratorEditLimits> = {},
): GeneratorSnapshot {
  const limits = resolveLimits(limitOverrides);
  const base = bindSnapshot(snapshot, request, limits);
  identifier(request.newRevision);
  if (request.newRevision === base.revision) fail('STALE_BASE', 'A changed snapshot requires a new revision.');
  array(request.operations);
  if (request.operations.length === 0) fail('INVALID_INPUT', 'An explicit nonempty operation list is required.');
  if (request.operations.length > limits.maxOperations) fail('LIMIT_EXCEEDED', 'Too many edit operations.');

  const originals = new Map(base.files.map((file) => [file.path, file]));
  const result = new Map(base.files.map((file) => [file.path, { path: file.path, content: file.content }]));
  const occupiedPaths = new Set(base.files.map((file) => file.path.toLowerCase()));
  const touchedPaths = new Map<string, { kind: GeneratorEditOperation['kind']; path: string }>();
  let patchBytes = 0;

  for (const operation of request.operations) {
    object(operation);
    safePath(operation.path);
    if (!['create', 'replace', 'delete'].includes(operation.kind)) fail('INVALID_INPUT', 'Unknown edit operation.');
    const canonical = operation.path.toLowerCase();
    const previous = touchedPaths.get(canonical);
    if (previous && (previous.kind !== 'replace' || operation.kind !== 'replace' || previous.path !== operation.path)) {
      fail('CONFLICTING_OPERATIONS', 'Only sequential replacements may target the same path in one batch.');
    }
    touchedPaths.set(canonical, { kind: operation.kind, path: operation.path });
    patchBytes += Buffer.byteLength(operation.path, 'utf8');

    if (operation.kind === 'create') {
      if (occupiedPaths.has(canonical)) fail('FILE_EXISTS', 'Creation cannot overwrite an existing source path.');
      patchBytes += textBytes(operation.content, limits.maxFileBytes);
      if (patchBytes > limits.maxPatchBytes) fail('LIMIT_EXCEEDED', 'Patch exceeds its byte limit.');
      result.set(operation.path, { path: operation.path, content: operation.content });
      occupiedPaths.add(canonical);
    } else {
      const original = originals.get(operation.path);
      const current = result.get(operation.path);
      if (!original || !current) fail('MISSING_FILE', 'The exact source path must exist in the base revision.');
      if (operation.expectedHash !== original.hash) fail('STALE_FILE', 'The expected source file hash does not match.');
      if (operation.kind === 'delete') {
        result.delete(operation.path);
      } else {
        patchBytes += textBytes(operation.search, limits.maxPatchBytes) + textBytes(operation.replacement, limits.maxPatchBytes);
        if (patchBytes > limits.maxPatchBytes) fail('LIMIT_EXCEEDED', 'Patch exceeds its byte limit.');
        const match = operation.search ? current.content.indexOf(operation.search) : -1;
        if (match < 0 || current.content.indexOf(operation.search, match + 1) !== -1) {
          fail('MATCH_NOT_UNIQUE', 'Search text must match exactly once, including overlapping matches.');
        }
        const content = current.content.slice(0, match) + operation.replacement + current.content.slice(match + operation.search.length);
        textBytes(content, limits.maxFileBytes);
        result.set(operation.path, { path: operation.path, content });
      }
    }
    if (patchBytes > limits.maxPatchBytes || result.size > limits.maxFiles) fail('LIMIT_EXCEEDED', 'Patch exceeds its safety limits.');
  }
  const next = buildSnapshot({ scope: base.scope, revision: request.newRevision, files: [...result.values()] }, limits, {
    revision: base.revision, hash: base.hash,
  });
  if (next.hash === base.hash) fail('NO_CHANGE', 'Patch does not change the source snapshot.');
  return next;
}

function lineOffsets(content: string): number[] {
  const starts = [0];
  for (let index = content.indexOf('\n'); index !== -1; index = content.indexOf('\n', index + 1)) {
    if (index + 1 < content.length) starts.push(index + 1);
  }
  return starts;
}

/** Reads only explicitly selected inclusive, one-based line ranges; never silently truncates. */
export function readSnapshotContext(
  snapshot: GeneratorSnapshot,
  request: GeneratorContextRequest,
  limitOverrides: Partial<GeneratorEditLimits> = {},
): GeneratorContext {
  const limits = resolveLimits(limitOverrides);
  const base = bindSnapshot(snapshot, request, limits);
  object(request.budget);
  for (const value of [request.budget.maxFiles, request.budget.maxBytes, request.budget.maxLines]) positiveInteger(value);
  if (request.budget.maxFiles > limits.maxContextFiles || request.budget.maxBytes > limits.maxContextBytes ||
      request.budget.maxLines > limits.maxContextLines) fail('LIMIT_EXCEEDED', 'Requested context budget exceeds the safety ceiling.');
  array(request.selections);
  if (request.selections.length === 0) fail('INVALID_INPUT', 'Select explicit source ranges.');
  if (request.selections.length > limits.maxContextSelections) fail('LIMIT_EXCEEDED', 'Too many context ranges.');
  const sources = new Map(base.files.map((file) => [file.path, file]));
  const selectedFiles = new Set<string>();
  let totalBytes = 0;
  let totalLines = 0;
  const selections = Array.from(request.selections, (selection) => {
    object(selection);
    safePath(selection.path);
    const file = sources.get(selection.path);
    if (!file) fail('MISSING_FILE', 'Selected context file does not exist.');
    selectedFiles.add(file.path);
    if (selectedFiles.size > request.budget.maxFiles) fail('LIMIT_EXCEEDED', 'Context file budget exceeded.');
    const starts = lineOffsets(file.content);
    if (!Number.isSafeInteger(selection.startLine) || !Number.isSafeInteger(selection.endLine) ||
        selection.startLine < 1 || selection.endLine < selection.startLine || selection.endLine > starts.length) {
      fail('INVALID_RANGE', 'Line range must exist completely in the selected file.');
    }
    const content = file.content.slice(starts[selection.startLine - 1], starts[selection.endLine] ?? file.content.length);
    totalBytes += Buffer.byteLength(content, 'utf8');
    totalLines += selection.endLine - selection.startLine + 1;
    if (totalBytes > request.budget.maxBytes || totalLines > request.budget.maxLines) {
      fail('LIMIT_EXCEEDED', 'Selected context exceeds the requested budget; select narrower ranges.');
    }
    return Object.freeze({
      path: file.path, fileHash: file.hash, startLine: selection.startLine,
      endLine: selection.endLine, totalFileLines: starts.length, content,
    });
  });
  return Object.freeze({
    scope: base.scope, baseRevision: base.revision, baseHash: base.hash,
    totalBytes, totalLines, selections: Object.freeze(selections),
  });
}
