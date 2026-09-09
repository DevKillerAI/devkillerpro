import { applyVersionedEdits, type GeneratorSnapshot } from './versionedEdits';
import { repairWorkbenchClientTypes } from './workbenchClientRepair';
import type { PilotVerification } from './pilotVerifier';

export type WorkbenchCompilerRepair = Readonly<{
  snapshot: GeneratorSnapshot;
  kind: 'missing-typed-arrow-parameter-close' | 'ref-strict-null-assertion' | 'missing-react-namespace-import' | 'react-children-namespace-repair' | 'type-cast-overlap-repair' | 'react-namespace-global-import' | 'supabase-client-initialization-repair' | 'platform-supabase-types';
  path: string;
  line: number;
  column: number;
}>;

const BUILD_LOCATION = /(?:^|\s)([^\s:]+\.(?:tsx|ts)):(\d+):(\d+):/g;
const TS_DIAGNOSTIC_LOCATION = /(?:^|\s)([^\s:]+\.(?:tsx|ts)):(\d+):(\d+)\s+TS(\d+):/g;
const TYPED_ARRAY_PARAMETER = /\(\[\s*[A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*){1,7}\s*\]\s*:\s*(?:any|unknown)\s*$/;

function offsetAtUtf8Column(content: string, line: number, column: number): number | null {
  if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 0) return null;
  let offset = 0;
  for (let current = 1; current < line; current++) {
    const newline = content.indexOf('\n', offset);
    if (newline < 0) return null;
    offset = newline + 1;
  }
  const lineEnd = content.indexOf('\n', offset);
  const end = lineEnd < 0 ? content.length : lineEnd;
  const text = content.slice(offset, end);
  let bytes = 0, codeUnits = 0;
  for (const character of text) {
    if (bytes === column) return offset + codeUnits;
    bytes += Buffer.byteLength(character, 'utf8');
    codeUnits += character.length;
    if (bytes > column) return null;
  }
  return bytes === column ? offset + codeUnits : null;
}

export function applyKnownWorkbenchCompilerRepair(
  base: GeneratorSnapshot,
  report: PilotVerification,
  newRevision: string,
): WorkbenchCompilerRepair | null {
  // 1. esbuild Syntax Repair: Missing ")" before "=>" in typed array parameters
  const buildDetails = report.checks.find(check => check.id === 'platform:build' && !check.passed)?.details ?? '';
  if (buildDetails.includes('Expected ")" but found "=>"')) {
    for (const match of buildDetails.matchAll(BUILD_LOCATION)) {
      const reportedPath = match[1].replace(/\\/g, '/');
      const file = base.files.find(item => reportedPath === item.path || reportedPath.endsWith(`/${item.path}`));
      if (!file) continue;
      const line = Number(match[2]), column = Number(match[3]);
      const reportedOffsets = [offsetAtUtf8Column(file.content, line, column), offsetAtUtf8Column(file.content, line, column - 1)];
      for (const arrowOffset of reportedOffsets) {
        if (arrowOffset === null) continue;
        if (arrowOffset < 0 || file.content.slice(arrowOffset, arrowOffset + 2) !== '=>') continue;
        const lineStart = file.content.lastIndexOf('\n', arrowOffset - 1) + 1;
        const prefix = file.content.slice(lineStart, arrowOffset);
        if (!TYPED_ARRAY_PARAMETER.test(prefix.slice(-320))) continue;
        const replacement = `${file.content.slice(0, arrowOffset)})${file.content.slice(arrowOffset)}`;
        const snapshot = applyVersionedEdits(base, {
          scope: base.scope,
          baseRevision: base.revision,
          baseHash: base.hash,
          newRevision,
          operations: [{ kind: 'replace', path: file.path, expectedHash: file.hash, search: file.content, replacement }],
        });
        return { snapshot, kind: 'missing-typed-arrow-parameter-close', path: file.path, line, column };
      }
    }
  }

  // 2. TypeScript Semantic Repair: React namespace missing when using React.ChangeEvent / React.FC
  const tsDetails = report.checks.find(check => check.id === 'platform:typescript-typecheck' && !check.passed)?.details ?? '';
  const clientRepair=repairWorkbenchClientTypes(base,tsDetails,newRevision);
  if(clientRepair)return clientRepair;
  if (tsDetails.includes('TS2503: Cannot find namespace \'React\'')) {
    for (const file of base.files) {
      if ((file.path.endsWith('.tsx') || file.path.endsWith('.ts')) && file.content.includes('React.')) {
        let replacement = file.content;
        if (!/^import\s+React\b/m.test(file.content)) {
          if (/^import\s*\{/m.test(file.content)) {
            replacement = file.content.replace(/^import\s*\{/m, 'import React, {');
          } else {
            replacement = `import React from 'react';\n${file.content}`;
          }
        } else {
          // If import React is already present, unprefix React types (e.g. React.FormEvent)
          const typesNeeded = ['FormEvent', 'ChangeEvent', 'MouseEvent', 'KeyboardEvent', 'ReactNode', 'FC'].filter(t => replacement.includes(`React.${t}`));
          if (typesNeeded.length) {
            for (const t of typesNeeded) {
              replacement = replacement.replace(new RegExp(`\\bReact\\.${t}\\b`, 'g'), t);
            }
            if (/^import\s+(?:React,\s*)?\{/m.test(replacement)) {
              replacement = replacement.replace(/^import\s+(?:React,\s*)?\{/m, `import React, { ${typesNeeded.map(t => `type ${t}`).join(', ')}, `);
            }
          }
        }
        if (replacement !== file.content) {
          const snapshot = applyVersionedEdits(base, {
            scope: base.scope,
            baseRevision: base.revision,
            baseHash: base.hash,
            newRevision,
            operations: [{ kind: 'replace', path: file.path, expectedHash: file.hash, search: file.content, replacement }],
          });
          return { snapshot, kind: 'missing-react-namespace-import', path: file.path, line: 1, column: 1 };
        }
      }
    }
  }


  // Type assertions, null suppression, and invented backend configuration are not repairs.
  return null;
}

