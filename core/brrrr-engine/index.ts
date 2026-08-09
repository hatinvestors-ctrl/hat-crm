// core/brrrr-engine — INTERFACE DEFINITIONS ONLY. No implementation.
// Sprint 1 (HAT AI OS foundation) — see docs/architecture/HAT_AI_OS.md

import type { FinancialConfig } from '../../config/financial.config'
import type { RefiProfile } from '../../config/lender.config'
import type { FinancialEngineInputs, HmlLoanResult, HoldingCostResult } from '../financial-engine'

export interface RefiResult {
  refiLoanAmount: number
  refiClosingCosts: number
  cashOutOrLeftIn: number
  totalCashInvested: number
  refiMonthlyPayment: number
}

export interface CashFlowResult {
  monthlyRent: number
  monthlyCashFlow: number
  annualCashFlow: number
  cashOnCashReturn: number | null
}

/**
 * Computes the BRRRR refinance outcome (loan size, closing costs, cash left in).
 * NOT IMPLEMENTED — Sprint 1 defines the contract only.
 */
export declare function computeRefinance(
  inputs: FinancialEngineInputs,
  loan: HmlLoanResult,
  holding: HoldingCostResult,
  refiProfile: RefiProfile
): RefiResult

/**
 * Computes post-refinance monthly/annual cash flow and cash-on-cash return.
 * NOT IMPLEMENTED — Sprint 1 defines the contract only.
 */
export declare function computeCashFlow(
  inputs: FinancialEngineInputs,
  refi: RefiResult,
  monthlyRent: number,
  config: FinancialConfig
): CashFlowResult
