// config/distress.config.ts — TYPE DEFINITIONS ONLY. No values.
// Sprint 1 (HAT AI OS foundation) — see docs/architecture/HAT_AI_OS.md
//
// Future config for the Distressed Lead Engine (see docs/architecture/HAT_AI_OS.md
// and documantation/HatCRM_NextGen_Architecture_Design.docx, Step 7). Governs
// signal weighting for the Distress Score and per-source reliability weighting
// for Data Confidence. This is a FUTURE capability — no collectors beyond the
// existing Redfin importer exist yet, and several potential future sources
// (evictions, liens, tax deeds, Zillow) require legal/compliance review before
// any engineering commitment (see architecture doc Step 9, risk #7).
//
// Sprint 1.1: now embeds shared ConfigMetadata instead of a bare `effectiveFrom`
// string (see config/config-metadata.ts).

import type { ConfigMetadata } from './config-metadata'

export type DistressSignalType =
  | 'price_drop'
  | 'long_dom'
  | 'back_on_market'
  | 'expired_listing'
  | 'probate'
  | 'tax_delinquency'
  | 'code_violation'
  | 'absentee_owner'
  | 'vacancy'
  | 'lien'
  | 'eviction'
  | 'tax_deed'

export interface DistressSignalWeight {
  signalType: DistressSignalType
  weight: number
  compoundingWithTypes?: DistressSignalType[]   // signals that amplify each other
}

export interface DataSourceReliability {
  source: string                 // e.g. 'redfin_email', 'county_tax_roll', 'mls_feed'
  reliabilityWeight: number      // 0–1, used to compute Data Confidence
  legallyCleared: boolean        // explicit flag — false blocks the collector from shipping
}

export interface DistressConfig {
  metadata: ConfigMetadata
  signalWeights: DistressSignalWeight[]
  sourceReliability: DataSourceReliability[]
  distressScoreThresholds: { reviewQueueMin: number }
}

// No populated values in Sprint 1. This entire capability is future work —
// see docs/architecture/HAT_AI_OS.md Step 7 for the full design.
