// config/lender.config.ts — TYPE DEFINITIONS ONLY. No values.
// Sprint 1 (HAT AI OS foundation) — see docs/architecture/HAT_AI_OS.md
//
// Resolves the HML/BRRRR-refi assumption drift (rate 6.875% vs 6.9%, payment
// bracket rounding differences, closing-cost figure varying $1,600/$1,691/$2,450
// across files) currently found in lib/negotiation-core.mjs, analyze-deal.mjs,
// generate-core-analysis.mjs, and deal_financials table defaults (architecture
// doc Step 1, §1.6/§1.7). Populating this file with real values is explicitly
// deferred to a future sprint. Designed to support future lenders beyond the
// current single hard-money source ("Rob @ 3 Shacks").
//
// Sprint 1.1: LenderConfig now embeds shared ConfigMetadata instead of a bare
// `market` field (see config/config-metadata.ts). Individual LenderProfile/
// RefiProfile entries keep their own `effectiveFrom` since a single LenderConfig
// can contain multiple lender profiles adopted at different times.

import type { ConfigMetadata } from './config-metadata'

export interface FixedFees {
  titleInsurance: number
  docStamps: number
  intangibleTax: number
}

/** A hard-money / purchase-financing lender profile. */
export interface LenderProfile {
  id: string                       // e.g. 'rob-3shacks' today, extensible
  displayName: string
  purchaseLtcPct: number           // % of purchase price financed
  renoCoveragePct: number          // % of renovation cost financed
  annualRatePct: number
  pointsPct: number
  fixedFees: FixedFees
  effectiveFrom: string
}

/** A refinance-lender profile for the BRRRR "R" step. */
export interface RefiProfile {
  id: string                       // e.g. 'fl-dscr-30yr' today, extensible
  displayName: string
  ltvPct: number
  annualRatePct: number
  amortYears: number
  closingCostPct: number
  effectiveFrom: string
}

export interface LenderConfig {
  metadata: ConfigMetadata
  purchaseLenders: LenderProfile[]
  refiLenders: RefiProfile[]
  defaultPurchaseLenderId: string
  defaultRefiLenderId: string
}

// No populated values in Sprint 1. Future sprint will export, e.g.:
// export const JAX_LENDER_CONFIG: LenderConfig = { ... }
