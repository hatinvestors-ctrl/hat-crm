// platform/ai/memory — INTERFACE DEFINITIONS ONLY. No implementation.
// Sprint 1 (HAT AI OS foundation) — see docs/architecture/HAT_AI_OS.md

import type { PriorAiRun } from '../context-builder'

export interface MemoryQuery {
  leadId?: string
  agentId?: string
  taskId?: string
  onlyOutcomeVerified?: boolean
  limit?: number
}

/**
 * Fetches prior AI runs relevant to the given query, for use by Context Builder.
 * NOT IMPLEMENTED — Sprint 1 defines the contract only.
 */
export declare function recall(query: MemoryQuery): Promise<PriorAiRun[]>
