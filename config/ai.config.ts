// config/ai.config.ts — TYPE DEFINITIONS ONLY. No values.
// Sprint 1 (HAT AI OS foundation) — see docs/architecture/HAT_AI_OS.md
//
// Future single source of truth for per-task model selection, token/temperature
// settings, and prompt versioning — resolving today's pattern of each of the
// ~15 Netlify functions hard-coding 'claude-haiku-4-5-20251001' and its own
// max_tokens/temperature independently. This is the config platform/ai/model-router
// (see platform/ai/model-router/README.md) will read from once implemented.
//
// Sprint 1.1: AiConfig now embeds shared ConfigMetadata so the whole model-
// routing table's version can be recorded per AI run, in addition to each
// individual task's own promptVersion (see config/config-metadata.ts).

import type { ConfigMetadata } from './config-metadata'

export type ModelProvider = 'anthropic'   // extensible if a second provider is ever added

export interface AiTaskConfig {
  taskId: string                // 'core-analysis' | 'comps' | 'negotiation-plan' | ...
  provider: ModelProvider
  model: string                 // e.g. 'claude-haiku-4-5-20251001'
  maxTokens: number
  temperature: number
  promptVersion: string         // ties to history/README.md's ai_runs.prompt_version
  timeoutMs: number
}

export interface AgentTaskConfig extends AiTaskConfig {
  maxSteps: number              // bounds an agent's decision() loop — see agents/README.md
  costCeilingUsd: number
}

export interface AiConfig {
  metadata: ConfigMetadata
  tasks: AiTaskConfig[]
  agentTasks: AgentTaskConfig[]
  defaultTimeoutMs: number
}

// No populated values in Sprint 1. Future sprint will export, e.g.:
// export const HAT_AI_CONFIG: AiConfig = { ... }
