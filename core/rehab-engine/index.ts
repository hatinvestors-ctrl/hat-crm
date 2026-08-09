// core/rehab-engine — INTERFACE DEFINITIONS ONLY. No implementation.
// Sprint 1 (HAT AI OS foundation) — see docs/architecture/HAT_AI_OS.md
//
// Sprint 1.1 correction: this engine now consumes RehabConfig (config/rehab.config.ts)
// for condition-tier cost brackets, instead of incorrectly relying on FinancialConfig,
// which was never designed to hold renovation cost bands (see rehab.config.ts's
// header comment for the full explanation). FinancialConfig is still used where this
// engine needs to reason about deal-level math (max-budget solving against MAO/flip/
// BRRRR thresholds), since that arithmetic genuinely belongs to FinancialConfig's
// domain (selling costs, MAO formula params).

import type { RehabConfig, ConditionTier, RehabCostBracket } from '../../config/rehab.config'
import type { FinancialConfig } from '../../config/financial.config'

export type { ConditionTier, RehabCostBracket } from '../../config/rehab.config'

export interface MaxRehabBudgetResult {
  maxForFlip: number | null
  maxForBrrrr: number | null
  limitingStrategy: 'flip' | 'brrrr' | 'both_impossible' | null
}

/**
 * Maps a condition tier to its cost bracket, per RehabConfig.
 * NOT IMPLEMENTED — Sprint 1 defines the contract only; Sprint 1.1 corrects its
 * config dependency from FinancialConfig to RehabConfig.
 */
export declare function bracketRehabCost(
  tier: ConditionTier,
  config: RehabConfig
): RehabCostBracket

/**
 * Solves for the maximum renovation budget that still makes the deal work,
 * for a given asking price / ARV, when actual renovation cost is unknown.
 * Requires FinancialConfig (MAO formula, selling costs) to evaluate deal-level
 * thresholds, in addition to RehabConfig for the condition-tier cost bands.
 * NOT IMPLEMENTED — Sprint 1 defines the contract only; Sprint 1.1 corrects its
 * config dependency to include RehabConfig alongside FinancialConfig.
 */
export declare function computeMaxRehabBudget(
  askingPrice: number,
  arv: number,
  financialConfig: FinancialConfig,
  rehabConfig: RehabConfig
): MaxRehabBudgetResult
