import { z } from 'zod';

export const defectClassificationSchema = z.enum([
  'APPLICATION_DEFECT',
  'TEST_DEFECT',
  'REQUIREMENT_AMBIGUITY',
  'ENVIRONMENT_DEFECT',
  'PLATFORM_DEFECT',
  'UNKNOWN',
]);
export type DefectClassification = z.infer<typeof defectClassificationSchema>;

export const classifiedDefectSchema = z.object({
  id: z.string(),
  classification: defectClassificationSchema,
  reason: z.string().trim().min(3).max(1000),
  evidence: z.string().trim().min(3).max(4000),
  confidence: z.number().min(0).max(1),
  recommendedAction: z.string().trim().min(3).max(1000),
  sourceTarget: z.string().optional(),
}).strict();
export type ClassifiedDefect = z.infer<typeof classifiedDefectSchema>;

export type DefectDiagnosticInput = {
  failureMessage: string;
  sourceCode?: string;
  cssCode?: string;
  testStep?: { action: string; testId: string; value: string };
  isMandatoryRequirement?: boolean;
  browserConsoleErrors?: string[];
  compilationStderr?: string;
};

/**
 * Rigorously classifies observed failures.
 * RULE ZERO: If there is not rock-solid proof of an incorrect test,
 * it is classified as APPLICATION_DEFECT or UNKNOWN, NEVER TEST_DEFECT.
 */
export function classifyDefect(input: DefectDiagnosticInput): ClassifiedDefect {
  const { failureMessage, sourceCode = '', testStep, isMandatoryRequirement, browserConsoleErrors = [], compilationStderr = '' } = input;
  const lowerMsg = failureMessage.toLowerCase();

  // 1. Environment / Platform defects
  if (
    lowerMsg.includes('docker') ||
    lowerMsg.includes('econnrefused') ||
    lowerMsg.includes('enomem') ||
    lowerMsg.includes('timed out') && lowerMsg.includes('runner')
  ) {
    return {
      id: `env-${Date.now()}`,
      classification: 'ENVIRONMENT_DEFECT',
      reason: 'Sandbox or infrastructure runtime timed out or failed to start.',
      evidence: failureMessage.slice(0, 2000),
      confidence: 0.95,
      recommendedAction: 'Restart runner sandbox or retry without modifying application source.',
    };
  }

  // 2. Compilation or TypeScript defects
  if (compilationStderr || lowerMsg.includes('compilation did not complete') || lowerMsg.includes('typescript typecheck failed')) {
    return {
      id: `comp-${Date.now()}`,
      classification: 'APPLICATION_DEFECT',
      reason: 'Application source code failed compilation or TypeScript typecheck.',
      evidence: (compilationStderr || failureMessage).slice(0, 2000),
      confidence: 1.0,
      recommendedAction: 'Repair syntax or type mismatch in App.tsx or styles.css.',
      sourceTarget: 'src/App.tsx',
    };
  }

  // 3. Responsive / Overflow defects
  if (lowerMsg.includes('horizontal overflow') || lowerMsg.includes('scrollwidth > innerwidth')) {
    return {
      id: `resp-${Date.now()}`,
      classification: 'APPLICATION_DEFECT',
      reason: 'Application layout exceeds viewport width causing horizontal overflow on mobile.',
      evidence: failureMessage.slice(0, 2000),
      confidence: 1.0,
      recommendedAction: 'Ensure containers have max-width: 100%, avoid fixed pixel widths and negative margins on mobile.',
      sourceTarget: 'src/styles.css',
    };
  }

  // 4. Missing target element in DOM
  if (testStep && (lowerMsg.includes('element is not visible') || lowerMsg.includes('waiting for locator') || lowerMsg.includes('expected count') || lowerMsg.includes('expected visible text'))) {
    const hasDataTestId = sourceCode.includes(`data-testid="${testStep.testId}"`) || sourceCode.includes(`data-testid='${testStep.testId}'`);

    if (!hasDataTestId) {
      if (isMandatoryRequirement) {
        return {
          id: `app-missing-${Date.now()}`,
          classification: 'APPLICATION_DEFECT',
          reason: `Mandatory requirement control [data-testid="${testStep.testId}"] is missing from App.tsx.`,
          evidence: `Test expected control "${testStep.testId}", but it does not exist in JSX source.`,
          confidence: 1.0,
          recommendedAction: `Implement the missing interactive control with data-testid="${testStep.testId}".`,
          sourceTarget: 'src/App.tsx',
        };
      }
      return {
        id: `app-omitted-${Date.now()}`,
        classification: 'APPLICATION_DEFECT',
        reason: `Target control [data-testid="${testStep.testId}"] was omitted by the generator.`,
        evidence: `Control "${testStep.testId}" is absent from App.tsx.`,
        confidence: 0.9,
        recommendedAction: `Implement the interactive control with data-testid="${testStep.testId}".`,
        sourceTarget: 'src/App.tsx',
      };
    }

    // Element exists in source but is not visible or threw
    if (browserConsoleErrors.length > 0) {
      return {
        id: `app-crash-${Date.now()}`,
        classification: 'APPLICATION_DEFECT',
        reason: 'Application threw a runtime error before or during interaction.',
        evidence: browserConsoleErrors.join('\n').slice(0, 2000),
        confidence: 1.0,
        recommendedAction: 'Fix runtime exception in component event handler.',
        sourceTarget: 'src/App.tsx',
      };
    }

    // Element exists in DOM but visibility assertion failed
    return {
      id: `app-hidden-${Date.now()}`,
      classification: 'APPLICATION_DEFECT',
      reason: `Control [data-testid="${testStep.testId}"] exists in JSX but is hidden or obscured by CSS rules.`,
      evidence: failureMessage.slice(0, 2000),
      confidence: 0.85,
      recommendedAction: 'Check styles.css for display: none, opacity: 0, or zero dimension styles.',
      sourceTarget: 'src/styles.css',
    };
  }

  // 5. Default to UNKNOWN when evidence is inconclusive (NEVER TEST_DEFECT)
  return {
    id: `unk-${Date.now()}`,
    classification: 'UNKNOWN',
    reason: 'Inconclusive failure evidence; cannot confirm whether test, code, or environment is at fault.',
    evidence: failureMessage.slice(0, 2000),
    confidence: 0.5,
    recommendedAction: 'Collect full execution logs and trigger root-cause diagnostic inspection.',
  };
}
