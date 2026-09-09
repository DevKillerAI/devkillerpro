import ts from 'typescript';
import path from 'node:path';
import type { GeneratorSourceFile } from './versionedEdits';
import {WORKBENCH_SUPABASE_SETTINGS_TYPE} from './workbenchClientContract';

export type TypecheckDiagnostic = { file: string; line: number; column: number; code: number; message: string };
export type TypecheckReport = { status: 'passed' | 'failed'; diagnostics: TypecheckDiagnostic[]; totalErrors: number; durationMs: number };

/** Check the actual browser library declarations. Candidate modules remain virtual. */
export function typecheckGeneratorSource(files: readonly GeneratorSourceFile[]): TypecheckReport {
  const started = Date.now();
  const root = path.resolve(process.cwd(), '.devkiller', 'typecheck-candidate');
  const normalize = (value: string) => path.resolve(value).replace(/\\/g, '/');
  const rootKey = normalize(root) + '/';
  const fileMap = new Map<string, string>();
  for (const file of files) {
    if (/\.(?:tsx?|jsx?)$/.test(file.path)) fileMap.set(normalize(path.join(root, file.path)), file.content);
  }
  const declaration = normalize(path.join(root, 'platform-browser.d.ts'));
  fileMap.set(declaration, `declare module '*.css' {}
interface Window { __DK_SUPABASE__?: ${WORKBENCH_SUPABASE_SETTINGS_TYPE} }
`);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
    moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true,
    allowJs: true, checkJs: true, noEmit: true, allowSyntheticDefaultImports: true,
    esModuleInterop: true, types: ['react', 'react-dom'], lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  };
  const host = ts.createCompilerHost(options);
  const originalRead = host.readFile.bind(host), originalExists = host.fileExists.bind(host);
  const originalDirectoryExists = host.directoryExists?.bind(host);
  host.fileExists = name => fileMap.has(normalize(name)) || (!normalize(name).startsWith(rootKey) && originalExists(name));
  host.readFile = name => fileMap.get(normalize(name)) ?? (normalize(name).startsWith(rootKey) ? undefined : originalRead(name));
  host.directoryExists = name => {
    const dir = normalize(name) + '/';
    return [...fileMap.keys()].some(key => key.startsWith(dir)) || Boolean(originalDirectoryExists?.(name));
  };
  host.getSourceFile = (name, languageVersion) => {
    const content = host.readFile(name);
    return content === undefined ? undefined : ts.createSourceFile(name, content, languageVersion, true);
  };
  const program = ts.createProgram([...fileMap.keys()], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program)
    .filter(item => item.category === ts.DiagnosticCategory.Error)
    .map(item => {
      const position = item.file?.getLineAndCharacterOfPosition(item.start ?? 0);
      const filename = item.file ? normalize(item.file.fileName) : 'platform';
      return { file: filename.startsWith(rootKey) ? filename.slice(rootKey.length) : path.basename(filename),
        line: (position?.line ?? 0) + 1, column: (position?.character ?? 0) + 1,
        code: item.code, message: ts.flattenDiagnosticMessageText(item.messageText, '\n') };
    });
  return { status: diagnostics.length ? 'failed' : 'passed', diagnostics, totalErrors: diagnostics.length, durationMs: Date.now() - started };
}
