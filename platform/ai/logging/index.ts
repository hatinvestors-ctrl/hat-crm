// platform/ai/logging — INTERFACE DEFINITIONS ONLY. No implementation.
// Sprint 1 (HAT AI OS foundation) — see docs/architecture/HAT_AI_OS.md
// No ai_runs table exists yet — see history/README.md for the target schema.

export interface AiRunLogEntry {
  runId: string
  taskId: string
  leadId?: string
  agentId?: string
  workspaceId: string
  timestamp: string
  model: string
  promptVersion: string
  configSnapshot: Record<string, unknown>
  inputHash: string
  inputSummary: Record<string, unknown>
}

export interface AiRunLogResult {
  runId: string
  output: unknown
  outputRaw: string
  confidence: number | null
  latencyMs: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  validationStatus: 'passed' | 'failed' | 'not_applicable'
  validationNotes: Record<string, unknown> | null
}

/**
 * Writes the pre-call request record. Returns the run_id used to correlate
 * the eventual result record.
 * NOT IMPLEMENTED — Sprint 1 defines the contract only.
 */
export declare function logRunStart(entry: AiRunLogEntry): Promise<string>

/**
 * Writes the post-call result record against a previously-started run_id.
 * NOT IMPLEMENTED — Sprint 1 defines the contract only.
 */
export declare function logRunResult(result: AiRunLogResult): Promise<void>
