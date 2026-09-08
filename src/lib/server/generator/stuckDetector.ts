import { createHash } from 'node:crypto';

export type ErrorSignature = {
  category: string;
  normalizedMessage: string;
  file?: string;
  line?: number;
  route?: string;
  status?: number;
  fingerprint: string;
};

export type RepairAttemptRecord = {
  attemptId: string;
  errorSignature: ErrorSignature;
  hypothesis?: string;
  filesChanged: string[];
  diffHash: string;
  testPassedCount: number;
  testFailedCount: number;
  failedCheckIds: string[];
  timestamp: string;
};

export type StuckDecision = {
  stuck: boolean;
  reason?: 'same_error_signature' | 'same_failed_test' | 'same_patch_pattern' | 'no_test_improvement';
  message?: string;
  signature?: ErrorSignature;
  consecutiveOccurrences: number;
};

export function normalizeErrorSignature(rawMessage: string, context?: { file?: string; line?: number }): ErrorSignature {
  // Strip timestamps, random UUIDs, memory addresses, port numbers
  const cleaned = rawMessage
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>')
    .replace(/\b0x[0-9a-fA-F]+\b/g, '<HEX>')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g, '<TIME>')
    .replace(/:\d{2,5}\b/g, ':<PORT>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const category = cleaned.includes('typecheck') ? 'TYPECHECK'
    : cleaned.includes('syntax') || cleaned.includes('esbuild') || cleaned.includes('compile') ? 'BUILD'
    : cleaned.includes('overflow') ? 'RESPONSIVE'
    : cleaned.includes('journey:') || cleaned.includes('locator') ? 'JOURNEY'
    : cleaned.includes('timeout') ? 'TIMEOUT'
    : 'GENERAL';

  const file = context?.file;
  const line = context?.line;

  const rawFingerprint = `${category}|${file || ''}|${line || ''}|${cleaned}`;
  const fingerprint = createHash('sha256').update(rawFingerprint).digest('hex').slice(0, 16);

  return {
    category,
    normalizedMessage: cleaned.slice(0, 500),
    file,
    line,
    fingerprint,
  };
}

export class StuckDetector {
  private attempts: RepairAttemptRecord[] = [];

  recordAttempt(attempt: Omit<RepairAttemptRecord, 'attemptId' | 'timestamp'>): StuckDecision {
    const record: RepairAttemptRecord = {
      ...attempt,
      attemptId: `att-${this.attempts.length + 1}`,
      timestamp: new Date().toISOString(),
    };
    this.attempts.push(record);

    return this.evaluate();
  }

  evaluate(): StuckDecision {
    if (this.attempts.length < 2) {
      return { stuck: false, consecutiveOccurrences: 1 };
    }

    const latest = this.attempts[this.attempts.length - 1];
    const previous = this.attempts[this.attempts.length - 2];

    // 1. Same error fingerprint >= 2
    if (latest.errorSignature.fingerprint === previous.errorSignature.fingerprint) {
      let count = 0;
      for (let i = this.attempts.length - 1; i >= 0; i--) {
        if (this.attempts[i].errorSignature.fingerprint === latest.errorSignature.fingerprint) {
          count++;
        } else {
          break;
        }
      }
      if (count >= 2) {
        return {
          stuck: true,
          reason: 'same_error_signature',
          message: `Stuck loop detected: error signature "${latest.errorSignature.normalizedMessage.slice(0, 120)}" repeated ${count} times without resolution.`,
          signature: latest.errorSignature,
          consecutiveOccurrences: count,
        };
      }
    }

    // 2. Same patch pattern (same diffHash repeatedly applied)
    if (latest.diffHash && latest.diffHash === previous.diffHash) {
      return {
        stuck: true,
        reason: 'same_patch_pattern',
        message: 'Stuck loop detected: identical patch content was generated consecutively.',
        signature: latest.errorSignature,
        consecutiveOccurrences: 2,
      };
    }

    // 3. No test improvement over multiple attempts
    if (this.attempts.length >= 3) {
      const last3 = this.attempts.slice(-3);
      const allSameFails = last3.every(a => a.testFailedCount >= last3[0].testFailedCount);
      if (allSameFails) {
        return {
          stuck: true,
          reason: 'no_test_improvement',
          message: 'Stuck loop detected: 3 consecutive repair attempts yielded zero test improvement.',
          signature: latest.errorSignature,
          consecutiveOccurrences: 3,
        };
      }
    }

    return { stuck: false, consecutiveOccurrences: 1 };
  }

  getAttempts(): readonly RepairAttemptRecord[] {
    return this.attempts;
  }
}
