// core/scoring-engine — INTERFACE DEFINITIONS ONLY. No implementation.
// Sprint 1 (HAT AI OS foundation) — see docs/architecture/HAT_AI_OS.md

import type { ScoringConfig } from '../../config/scoring.config'
import type { MaoResult } from '../financial-engine'
import type { FlipResult } from '../flip-engine'
import type { CashFlowResult } from '../brrrr-engine'

export interface DealScoreSubscore {
  name: string
  score: number
  max: number
  rationale: string
}

export interface DealScoreResult {
  totalScore: number
  subscores: DealScoreSubscore[]
  verdict: string
  verdictReason: string
  dealWorksAtMao: boolean
}

/**
 * Evaluates the full Deal Score rubric and determines the canonical verdict.
 * NOT IMPLEMENTED — Sprint 1 defines the contract only.
 */
export declare function scoreDeal(
  mao: MaoResult,
  flip: FlipResult | null,
  brrrr: CashFlowResult | null,
  config: ScoringConfig
): DealScoreResult
