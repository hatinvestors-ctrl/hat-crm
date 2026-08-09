// config/financial.config.ts — TYPE DEFINITIONS ONLY. No values.
// Sprint 1 (HAT AI OS foundation) — see docs/architecture/HAT_AI_OS.md
//
// Resolves the duplicated MAO formula (5 variants), selling-cost percentage
// (7% vs 8% live inconsistency), closing-cost constants, hold-period defaults,
// and insurance/tax assumptions currently scattered across analyze-deal.mjs,
// generate-core-analysis.mjs, generate-ai-notes.mjs, lib/negotiation-core.mjs,
// and deal_financials table defaults (architecture doc Step 1, §1.4/§1.5/§1.6/
// §1.8/§1.9). Populating this file with real, reconciled values is explicitly
// deferred to a future sprint (Migration Strategy Phase 2) — reconciling e.g.
// "is selling cost 7% or 8%?" is a business decision, not made by this scaffold.
//
// Sprint 1.1: now embeds shared ConfigMetadata instead of a bare `effectiveFrom`
// string, so a historical AI run's config_snapshot can be traced to an exact
// config version (see config/config-metadata.ts).

import type { ConfigMetadata } from './config-metadata'

export interface ClosingCosts {
  titleClosing: number
  titleLenderInsurance: number
  docStamps: number
  intangibleTax: number
}

export interface HoldingCostDefaults {
  insuranceMonthly: number
  taxesMonthly: number
  hoaMonthly: number
  utilitiesMonthly: number
}

export interface MaoFormulaParams {
  arvMultiplier: number      // e.g. 0.75
  minimumProfit: number      // the ONE agreed minimum-profit constant (resolves §1.4)
  includeClosingCostsInMao: boolean
}

export interface HoldMonthsDefaults {
  flip: number
  brrrr: number
}

export interface FinancialConfig {
  metadata: ConfigMetadata
  sellingCostPct: number             // single source — resolves the 7% vs 8% conflict
  closingCosts: ClosingCosts
  holdingCostDefaults: HoldingCostDefaults
  maoFormula: MaoFormulaParams
  holdMonthsDefaults: HoldMonthsDefaults
}

// No populated values in Sprint 1. Future sprint will export, e.g.:
// export const JAX_FINANCIAL_CONFIG: FinancialConfig = { ... }
