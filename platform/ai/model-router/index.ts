// platform/ai/model-router — INTERFACE DEFINITIONS ONLY. No implementation.
// Sprint 1 (HAT AI OS foundation) — see docs/architecture/HAT_AI_OS.md

import type { BuiltPrompt } from '../prompt-builder'
import type { AiTaskConfig } from '../../../config/ai.config'

export interface ModelCallResult {
  rawResponseText: string
  model: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
  costUsd: number
}

/**
 * Resolves task settings from ai.config.ts and executes the model call.
 * NOT IMPLEMENTED — Sprint 1 defines the contract only.
 */
export declare function routeAndCall(
  prompt: BuiltPrompt,
  taskConfig: AiTaskConfig
): Promise<ModelCallResult>
