// platform/ai/validators — INTERFACE DEFINITIONS ONLY. No implementation.
// Sprint 1 (HAT AI OS foundation) — see docs/architecture/HAT_AI_OS.md

export interface ValidationIssue {
  field: string
  expected: unknown
  actual: unknown
  severity: 'error' | 'warning'
}

export interface ValidationResult {
  status: 'passed' | 'failed' | 'not_applicable'
  issues: ValidationIssue[]
}

/**
 * Diffs parsed model output against the /core engine ground truth it was
 * built from, and validates shape/enum values.
 * NOT IMPLEMENTED — Sprint 1 defines the contract only.
 */
export declare function validateOutput(
  engineTruth: Record<string, unknown>,
  modelOutput: unknown,
  expectedSchema?: unknown
): ValidationResult
