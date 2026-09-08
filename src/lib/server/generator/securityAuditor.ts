import type { GeneratorSourceFile } from './versionedEdits';

export type SecurityViolation = {
  ruleId: string;
  severity: 'critical' | 'high' | 'medium';
  message: string;
  file: string;
  line?: number;
};

export type SecurityAuditResult = {
  passed: boolean;
  violations: SecurityViolation[];
  scannedFiles: string[];
};

const DANGEROUS_PATTERNS: Array<{
  id: string;
  severity: 'critical' | 'high' | 'medium';
  pattern: RegExp;
  message: string;
}> = [
  // 1. Secrets and credentials
  {
    id: 'sec.secret-token',
    severity: 'critical',
    pattern: /\b(?:sk-[a-zA-Z0-9_-]{16,}|ghp_[a-zA-Z0-9]{30,}|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|OPENAI_API_KEY|AWS_SECRET_ACCESS_KEY)\b/,
    message: 'Hardcoded secret or API credential found in candidate source.',
  },
  // 2. Dynamic code execution
  {
    id: 'sec.eval-injection',
    severity: 'critical',
    pattern: /\b(?:eval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*["'`]|setInterval\s*\(\s*["'`])/,
    message: 'Dangerous dynamic evaluation (eval or new Function) is strictly forbidden in generated apps.',
  },
  // 3. Dynamic script injection
  {
    id: 'sec.script-tag-injection',
    severity: 'critical',
    pattern: /document\.createElement\s*\(\s*['"]script['"]\s*\)|<\s*script\b[^>]*>/i,
    message: 'Dynamic script tag creation or raw <script> element injection detected.',
  },
  // 4. Raw WebSockets or unapproved network sockets
  {
    id: 'sec.raw-websocket',
    severity: 'critical',
    pattern: /\bnew\s+WebSocket\s*\(|\bnew\s+EventSource\s*\(/,
    message: 'Raw WebSocket or EventSource connection detected; generated apps must run offline in sandbox.',
  },
  // 5. Unsafe postMessage targetOrigin
  {
    id: 'sec.unsafe-postmessage-wildcard',
    severity: 'high',
    pattern: /window\.parent\.postMessage\s*\([^,]+,\s*['"]\*['"]\s*\)/,
    message: 'Unsafe wildcard targetOrigin ("*") in postMessage; must use explicit target origin or correlated host bridge.',
  },
  // 6. Direct external fetch
  {
    id: 'sec.direct-external-fetch',
    severity: 'high',
    pattern: /\bfetch\s*\(\s*['"`]https?:\/\/(?!localhost|127\.0\.0\.1)[^'"`]+\b/i,
    message: 'Direct external HTTP fetch call detected; generated apps must use approved host media/product bridges.',
  },
  // 7. Server environment leaks
  {
    id: 'sec.server-env-access',
    severity: 'critical',
    pattern: /\bprocess\.env\.[A-Z_]+/,
    message: 'Server process.env access found in client component source.',
  },
];

/**
 * Scans candidate source files for security, credential, and injection violations.
 */
export function auditGeneratorSecurity(files: readonly GeneratorSourceFile[]): SecurityAuditResult {
  const violations: SecurityViolation[] = [];

  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    for (const rule of DANGEROUS_PATTERNS) {
      if (rule.pattern.test(file.content)) {
        // Locate matching line
        let matchedLine = 1;
        for (let i = 0; i < lines.length; i++) {
          if (rule.pattern.test(lines[i])) {
            matchedLine = i + 1;
            break;
          }
        }
        violations.push({
          ruleId: rule.id,
          severity: rule.severity,
          message: rule.message,
          file: file.path,
          line: matchedLine,
        });
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    scannedFiles: files.map(f => f.path),
  };
}
