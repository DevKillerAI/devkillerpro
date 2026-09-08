import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyVersionedEdits, createGeneratorSnapshot, DEFAULT_GENERATOR_EDIT_LIMITS,
  GeneratorEditError, readSnapshotContext,
  type GeneratorContextRequest, type GeneratorEditErrorCode, type GeneratorEditOperation,
  type GeneratorEditRequest, type GeneratorScope, type GeneratorSnapshot,
} from '../src/lib/server/generator/versionedEdits';

const scope: GeneratorScope = {
  ownerId: 'owner-1', projectId: 'project-1', missionId: 'mission-1', environmentId: 'preview-1',
};
const source = [
  { path: 'src/App.tsx', content: 'const color = "red";\r\nconst title = "Olá 🌎";\r\nexport default color;\r\n' },
  { path: 'src/other.ts', content: 'const untouched = true;\n' },
];

function fixture(): GeneratorSnapshot {
  return createGeneratorSnapshot({ scope, revision: 'r1', files: source });
}

function replacement(base: GeneratorSnapshot, path = 'src/App.tsx'): Extract<GeneratorEditOperation, { kind: 'replace' }> {
  return {
    kind: 'replace', path, expectedHash: base.files.find((file) => file.path === path)!.hash,
    search: '"red"', replacement: '"blue $&"',
  };
}

function request(base: GeneratorSnapshot, operations: readonly GeneratorEditOperation[] = [replacement(base)]): GeneratorEditRequest {
  return { scope, baseRevision: base.revision, baseHash: base.hash, newRevision: 'r2', operations };
}

function contextRequest(base: GeneratorSnapshot): GeneratorContextRequest {
  return {
    scope, baseRevision: base.revision, baseHash: base.hash,
    selections: [{ path: 'src/App.tsx', startLine: 2, endLine: 2 }],
    budget: { maxFiles: 1, maxBytes: 128, maxLines: 1 },
  };
}

function error(code: GeneratorEditErrorCode, action: () => unknown) {
  assert.throws(action, (cause: unknown) => cause instanceof GeneratorEditError && cause.code === code);
}

test('snapshot hashes are order-independent, byte-sensitive and immutable without changing inputs', () => {
  const input = structuredClone(source);
  const first = createGeneratorSnapshot({ scope, revision: 'r1', files: input });
  const second = createGeneratorSnapshot({ scope, revision: 'different', files: [...input].reverse() });
  assert.equal(first.hash, second.hash);
  assert.deepEqual(input, source);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.scope));
  assert.ok(Object.isFrozen(first.files));
  assert.ok(first.files.every(Object.isFrozen));
  input[0].content = 'mutated outside';
  assert.equal(first.files[0].content, source[0].content);
  const changed = createGeneratorSnapshot({ scope, revision: 'r1', files: [{ ...source[0], content: source[0].content.replaceAll('\r\n', '\n') }] });
  assert.notEqual(first.files[0].hash, changed.files[0].hash);
});

test('localized changes preserve other files, CRLF, Unicode and literal replacement characters', () => {
  const base = fixture();
  const next = applyVersionedEdits(base, request(base));
  assert.equal(next.files[0].content, source[0].content.replace('"red"', () => '"blue $&"'));
  assert.deepEqual(next.files[1], base.files[1]);
  assert.equal(base.files[0].content, source[0].content);
  assert.deepEqual(next.parent, { revision: base.revision, hash: base.hash });
  assert.equal(next.revision, 'r2');
  assert.notEqual(next.hash, base.hash);
});

test('create and delete are explicit operations and subsequent revisions are bound to their base', () => {
  const base = fixture();
  const next = applyVersionedEdits(base, request(base, [
    { kind: 'create', path: 'src/new.ts', content: 'export const n = 1;\n' },
    { kind: 'delete', path: 'src/other.ts', expectedHash: base.files[1].hash },
  ]));
  assert.deepEqual(next.files.map((file) => file.path), ['src/App.tsx', 'src/new.ts']);
  error('STALE_BASE', () => applyVersionedEdits(next, request(base)));
  error('FILE_EXISTS', () => applyVersionedEdits(base, request(base, [{ kind: 'create', path: 'src/app.TSX', content: 'no' }])));
  error('MISSING_FILE', () => applyVersionedEdits(base, request(base, [{ kind: 'delete', path: 'src/missing.ts', expectedHash: base.files[0].hash }])));
});

test('every scope boundary is checked independently for edits and context reads', () => {
  const base = fixture();
  for (const key of ['ownerId', 'projectId', 'missionId', 'environmentId'] as const) {
    const other = { ...scope, [key]: 'other' };
    error('SCOPE_MISMATCH', () => applyVersionedEdits(base, { ...request(base), scope: other }));
    error('SCOPE_MISMATCH', () => readSnapshotContext(base, { ...contextRequest(base), scope: other }));
  }
});

test('base revision, source hash and per-file hash must all match', () => {
  const base = fixture();
  const hash = '0'.repeat(64);
  error('STALE_BASE', () => applyVersionedEdits(base, { ...request(base), baseRevision: 'old' }));
  error('STALE_BASE', () => applyVersionedEdits(base, { ...request(base), baseHash: hash }));
  error('STALE_BASE', () => applyVersionedEdits(base, { ...request(base), newRevision: 'r1' }));
  error('STALE_FILE', () => applyVersionedEdits(base, request(base, [{ ...replacement(base), expectedHash: hash } as GeneratorEditOperation])));
  error('STALE_BASE', () => readSnapshotContext(base, { ...contextRequest(base), baseHash: hash }));
  const tampered = { ...base, files: [{ ...base.files[0], content: 'changed' }, base.files[1]] };
  error('INVALID_SNAPSHOT', () => applyVersionedEdits(tampered, request(base)));
  error('INVALID_SNAPSHOT', () => readSnapshotContext({ ...base, totalBytes: 0 }, contextRequest(base)));
});

test('portable paths reject traversal, absolute paths, ADS, control characters and Windows aliases', () => {
  const unsafe = [
    '../outside.ts', 'src/../outside.ts', '/etc/passwd', '//server/share/x', 'C:/file.ts', 'C:file.ts',
    'src\\file.ts', '\\\\server\\share\\file', 'src//file.ts', 'src/./file.ts', 'src/',
    'src/file.ts:secret', 'src/a\0.ts', 'src/a\n.ts', 'src/a\r.ts', 'src/a\t.ts',
    'src/file.ts.', 'src/file.ts ', 'src/ file.ts', 'src/CON', 'src/aux.txt', 'src/LPT1.js',
    'src/CONIN$.txt', 'src/name?.ts', 'src/name*.ts', 'src/%2e%2e/file.ts', 'src/\u202efile.ts',
    'src/é.ts', '', 'a'.repeat(241),
  ];
  for (const path of unsafe) {
    error('UNSAFE_PATH', () => createGeneratorSnapshot({ scope, revision: 'r1', files: [{ path, content: 'x' }] }));
    const base = fixture();
    error('UNSAFE_PATH', () => applyVersionedEdits(base, request(base, [{ kind: 'create', path, content: 'x' }])));
  }
});

test('secrets and protected harness/platform paths cannot become sources or edits', () => {
  const protectedPaths = [
    '.env', '.ENV.local', 'src/.env.example', '.envrc', '.git/config', '.GiT/HEAD', '.github/workflows/run.yml',
    'harness/assertions.ts', 'src/HARNESS/check.ts', '__harness__/case.json', '.harness/check.ts',
    'scripts/harness.run.ts', '.devkiller/state.json', '.codex/config.toml', 'AGENTS.md',
    'src/credentials/token.json', 'private.pem', 'secrets/api.json', '.ssh/id_rsa', 'id_ed25519',
    'node_modules/x/index.js', '.next/BUILD_ID',
  ];
  for (const path of protectedPaths) {
    error('PROTECTED_PATH', () => createGeneratorSnapshot({ scope, revision: 'r1', files: [{ path, content: 'never' }] }));
    const base = fixture();
    error('PROTECTED_PATH', () => applyVersionedEdits(base, request(base, [{ kind: 'create', path, content: 'never' }])));
  }
});

test('case-insensitive duplicate snapshots and differently cased replacement paths fail closed', () => {
  for (const paths of [
    ['src/App.ts', 'src/app.TS'], ['same.ts', 'same.ts'],
    ['src/one.ts', 'SRC/two.ts'], ['src/node', 'src/node/child.ts'], ['src/node/child.ts', 'src/node'],
  ]) {
    error('PATH_COLLISION', () => createGeneratorSnapshot({ scope, revision: 'r1', files: paths.map((path) => ({ path, content: 'x' })) }));
  }
  const base = fixture();
  error('MISSING_FILE', () => applyVersionedEdits(base, request(base, [{ ...replacement(base), path: 'SRC/App.tsx' }])));
});

test('empty, absent, repeated and overlapping matches are rejected without fuzzy replacement', () => {
  const base = createGeneratorSnapshot({ scope, revision: 'r1', files: [{ path: 'a.ts', content: 'aaa\nvalue value\n' }] });
  for (const search of ['', 'missing', 'value', 'aa']) {
    error('MATCH_NOT_UNIQUE', () => applyVersionedEdits(base, request(base, [{
      kind: 'replace', path: 'a.ts', expectedHash: base.files[0].hash, search, replacement: 'new',
    }])));
  }
});

test('failed multi-operation batches are atomic; sequential replacements use original file hashes', () => {
  const base = fixture();
  const before = JSON.stringify(base);
  error('MATCH_NOT_UNIQUE', () => applyVersionedEdits(base, request(base, [
    replacement(base),
    { kind: 'create', path: 'src/new.ts', content: 'new' },
    { ...replacement(base), search: 'not present' },
  ])));
  assert.equal(JSON.stringify(base), before);
  const next = applyVersionedEdits(base, request(base, [
    replacement(base), { ...replacement(base), search: '"blue $&"', replacement: '"green"' },
  ]));
  assert.ok(next.files[0].content.includes('"green"'));
  error('CONFLICTING_OPERATIONS', () => applyVersionedEdits(base, request(base, [
    replacement(base), { kind: 'delete', path: 'src/App.tsx', expectedHash: base.files[0].hash },
  ])));
  error('NO_CHANGE', () => applyVersionedEdits(base, request(base, [
    { ...replacement(base), replacement: '"red"' },
  ])));
});

test('file, snapshot, operation and cumulative patch limits fail atomically', () => {
  error('LIMIT_EXCEEDED', () => createGeneratorSnapshot({ scope, revision: 'r1', files: source }, { maxFiles: 1 }));
  error('LIMIT_EXCEEDED', () => createGeneratorSnapshot({ scope, revision: 'r1', files: source }, { maxFileBytes: 1 }));
  error('LIMIT_EXCEEDED', () => createGeneratorSnapshot({ scope, revision: 'r1', files: source }, { maxSnapshotBytes: 1 }));
  const base = fixture();
  error('LIMIT_EXCEEDED', () => applyVersionedEdits(base, request(base), { maxPatchBytes: 1 }));
  error('LIMIT_EXCEEDED', () => applyVersionedEdits(base, request(base, [replacement(base), replacement(base)]), { maxOperations: 1 }));
  error('LIMIT_EXCEEDED', () => applyVersionedEdits(base, request(base, [{ kind: 'create', path: 'new.ts', content: 'x' }]), { maxFiles: 2 }));
  error('LIMIT_EXCEEDED', () => createGeneratorSnapshot({ scope, revision: 'r1', files: [] }, {
    maxFiles: DEFAULT_GENERATOR_EDIT_LIMITS.maxFiles + 1,
  }));
});

test('context retrieval returns only requested lines with byte-accurate content and source binding', () => {
  const base = fixture();
  const context = readSnapshotContext(base, contextRequest(base));
  assert.equal(context.selections.length, 1);
  assert.equal(context.selections[0].content, 'const title = "Olá 🌎";\r\n');
  assert.equal(context.selections[0].fileHash, base.files[0].hash);
  assert.equal(context.totalBytes, Buffer.byteLength(context.selections[0].content));
  assert.equal(context.totalLines, 1);
  assert.equal(context.baseHash, base.hash);
  assert.equal(context.baseRevision, 'r1');
  assert.equal(context.selections[0].totalFileLines, 3);
  assert.ok(Object.isFrozen(context));
  assert.ok(Object.isFrozen(context.selections));
  assert.ok(Object.isFrozen(context.selections[0]));
  assert.ok(!JSON.stringify(context).includes('untouched'));
});

test('context budgets reject excess instead of returning silent truncation', () => {
  const base = fixture();
  const requested = contextRequest(base);
  error('LIMIT_EXCEEDED', () => readSnapshotContext(base, { ...requested, budget: { ...requested.budget, maxBytes: 1 } }));
  error('LIMIT_EXCEEDED', () => readSnapshotContext(base, {
    ...requested, selections: [{ path: 'src/App.tsx', startLine: 1, endLine: 2 }],
  }));
  error('LIMIT_EXCEEDED', () => readSnapshotContext(base, {
    ...requested, selections: [...requested.selections, { path: 'src/other.ts', startLine: 1, endLine: 1 }],
    budget: { maxFiles: 1, maxBytes: 256, maxLines: 10 },
  }));
  error('LIMIT_EXCEEDED', () => readSnapshotContext(base, {
    ...requested, budget: { ...requested.budget, maxBytes: DEFAULT_GENERATOR_EDIT_LIMITS.maxContextBytes + 1 },
  }));
  error('LIMIT_EXCEEDED', () => readSnapshotContext(base, {
    ...requested, selections: Array.from({ length: 25 }, () => requested.selections[0]),
  }));
});

test('context refuses invalid ranges, missing files and protected paths; empty files remain explicit', () => {
  const base = fixture();
  for (const [startLine, endLine] of [[0, 1], [1, 4], [2, 1], [1.5, 2], [1, Infinity]]) {
    error('INVALID_RANGE', () => readSnapshotContext(base, {
      ...contextRequest(base), selections: [{ path: 'src/App.tsx', startLine, endLine }],
    }));
  }
  error('MISSING_FILE', () => readSnapshotContext(base, {
    ...contextRequest(base), selections: [{ path: 'missing.ts', startLine: 1, endLine: 1 }],
  }));
  error('PROTECTED_PATH', () => readSnapshotContext(base, {
    ...contextRequest(base), selections: [{ path: '.env', startLine: 1, endLine: 1 }],
  }));
  const empty = createGeneratorSnapshot({ scope, revision: 'r1', files: [{ path: 'empty.ts', content: '' }] });
  const result = readSnapshotContext(empty, {
    ...contextRequest(empty), selections: [{ path: 'empty.ts', startLine: 1, endLine: 1 }],
  });
  assert.equal(result.selections[0].content, '');
  assert.equal(result.totalBytes, 0);
  assert.equal(result.totalLines, 1);
});

test('invalid tokens, lossily encoded strings and unknown operations are rejected', () => {
  error('INVALID_INPUT', () => createGeneratorSnapshot({ scope: { ...scope, ownerId: '' }, revision: 'r1', files: [] }));
  error('INVALID_INPUT', () => createGeneratorSnapshot({ scope, revision: 'r1', files: [{ path: 'a.ts', content: '\ud800' }] }));
  error('INVALID_INPUT', () => createGeneratorSnapshot({ scope, revision: 'r1', files: [] }, { maxFiles: NaN }));
  error('INVALID_INPUT', () => createGeneratorSnapshot({ scope, revision: 'r1', files: [] }, { toString: 1 } as never));
  error('INVALID_INPUT', () => createGeneratorSnapshot({ scope, revision: 'r1', files: new Array(1) }));
  const base = fixture();
  error('INVALID_INPUT', () => applyVersionedEdits(base, request(base, [{ kind: 'upsert', path: 'a.ts', content: 'no' } as unknown as GeneratorEditOperation])));
  error('INVALID_INPUT', () => applyVersionedEdits(base, request(base, [])));
});
