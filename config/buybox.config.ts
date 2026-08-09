// config/buybox.config.ts — TYPE DEFINITIONS ONLY. No values.
// Sprint 1 (HAT AI OS foundation) — see docs/architecture/HAT_AI_OS.md
//
// Resolves the blocked-ZIP/preferred-ZIP duplication (3 locations, one already
// bypassed by a manual insertion script) and the two independently-weighted
// distress-keyword lists (architecture doc Step 1, §1.1/§1.2/§1.13). Populating
// this file with real values is explicitly deferred to a future sprint.
//
// Sprint 1.1: now embeds shared ConfigMetadata instead of a bare `effectiveFrom`
// string (see config/config-metadata.ts).

import type { ConfigMetadata } from './config-metadata'

export interface WeightedKeyword {
  keyword: string
  weight: number
}

export interface FinancialSenseCheckRule {
  maxSpreadPct: number
  requiresPreferredZip: boolean
}

export interface BuyBoxConfig {
  metadata: ConfigMetadata
  blockedZips: string[]
  propertyTypeSkips: string[]                  // condo, townhome, new construction, etc.
  distressKeywords: WeightedKeyword[]           // ONE weighted list — resolves §1.13
  skipKeywords: WeightedKeyword[]                // retail-ready / move-in-ready exclusion signals
  financialSenseCheck: FinancialSenseCheckRule
}

// No populated values in Sprint 1. Future sprint will export, e.g.:
// export const JAX_BUYBOX_CONFIG: BuyBoxConfig = { ... }
