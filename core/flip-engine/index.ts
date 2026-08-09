// core/flip-engine — INTERFACE DEFINITIONS ONLY. No implementation.
// Sprint 1 (HAT AI OS foundation) — see docs/architecture/HAT_AI_OS.md

import type { FinancialConfig } from '../../config/financial.config'
import type { FinancialEngineInputs, HmlLoanResult, HoldingCostResult } from '../financial-engine'

export interface FlipResult {
  saleProceeds: number
  allInCost: number
  netProfit: number
  roi: number
  annualizedRoi: number
  holdMonthsUsed: number
}

/**
 * Computes net sale proceeds after selling costs.
 * NOT IMPLEMENTED — Sprint 1 defines the contract only.
 */
export declare function computeSaleProceeds(arv: number, config: FinancialConfig): number

/**
 * Computes total flip profit and ROI given financing/holding results from
 * financial-engine (this function does not recompute loan or holding costs).
 * NOT IMPLEMENTED — Sprint 1 defines the contract only.
 */
export declare function computeFlipProfit(
  inputs: FinancialEngineInputs,
  loan: HmlLoanResult,
  holding: HoldingCostResult,
  config: FinancialConfig
): FlipResult
