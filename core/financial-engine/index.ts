// core/financial-engine — INTERFACE DEFINITIONS ONLY. No implementation.
// Sprint 1 (HAT AI OS foundation) — see docs/architecture/HAT_AI_OS.md
//
// This module will eventually be the single source of truth for MAO, HML loan
// costs, closing costs, and holding costs. Today it exports type contracts only;
// the live, authoritative calculations remain in netlify/functions/*.mjs and
// src/lib/calculations.js until a future migration sprint switches call sites
// over to these engines (see Migration Strategy Step 8 in the architecture doc).

import type { FinancialConfig } from '../../config/financial.config'
import type { LenderProfile } from '../../config/lender.config'

/** Inputs common to every financial-engine calculation. */
export interface FinancialEngineInputs {
  purchasePrice: number
  arv: number | null
  renovationCost: number | null
  zip: string
  strategy: 'flip' | 'brrrr'
  holdMonthsOverride?: number
}

/** Result of computeMao(). Itemized so AI narration can explain the number faithfully. */
export interface MaoResult {
  mao: number
  formulaUsed: string
  components: {
    arvPortion: number
    renoDeduction: number
    minimumProfit: number
  }
}

/** Result of computeHmlLoan(). */
export interface HmlLoanResult {
  loanAmount: number
  monthlyPayment: number
  points: number
  fixedClosingCosts: number
  totalCashNeeded: number
}

/** Result of computeHoldingCosts(). */
export interface HoldingCostResult {
  perMonth: number
  totalForHoldPeriod: number
  holdMonthsUsed: number
  breakdown: {
    loanPayment: number
    taxes: number
    insurance: number
    hoa: number
    utilities: number
  }
}

/**
 * Computes the Maximum Allowable Offer for a deal.
 * NOT IMPLEMENTED — Sprint 1 defines the contract only.
 */
export declare function computeMao(
  inputs: FinancialEngineInputs,
  config: FinancialConfig
): MaoResult

/**
 * Computes hard-money-lender loan sizing and cash-needed-to-close.
 * NOT IMPLEMENTED — Sprint 1 defines the contract only.
 */
export declare function computeHmlLoan(
  inputs: FinancialEngineInputs,
  lender: LenderProfile
): HmlLoanResult

/**
 * Computes monthly and total holding costs for a given hold period.
 * NOT IMPLEMENTED — Sprint 1 defines the contract only.
 */
export declare function computeHoldingCosts(
  inputs: FinancialEngineInputs,
  config: FinancialConfig,
  holdMonths: number
): HoldingCostResult
