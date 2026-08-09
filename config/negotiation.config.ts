// config/negotiation.config.ts — TYPE DEFINITIONS ONLY. No values.
// Sprint 1 (HAT AI OS foundation) — see docs/architecture/HAT_AI_OS.md
//
// Resolves the negotiation anchor/room-factor model currently living only inside
// generate-core-analysis.mjs, duplicated a second time inside that same file
// (architecture doc Step 1, §1.14). Populating this file with real values is
// explicitly deferred to a future sprint. Note: this config governs NUMBERS only
// (room factor, credibility floor, keyword weights) — the persuasion doctrine
// text (Voss/Klaff/Cardone/etc. in netlify/functions/lib/negotiation-core.mjs)
// is prompt content, not config, and stays out of this file by design.
//
// Sprint 1.1: now embeds shared ConfigMetadata instead of a bare `effectiveFrom`
// string (see config/config-metadata.ts).

import type { ConfigMetadata } from './config-metadata'

export interface WeightedKeyword {
  keyword: string
  weight: number
}

export interface RoomFactorModel {
  baseRoomFactorPct: number         // e.g. 0.50 — starting room as % of gap
  motivationReductionPerPoint: number  // e.g. 0.02 — room shrinks per motivation point
  minRoomFactorPct: number          // floor on room factor
}

export interface CredibilityFloorModel {
  baseFloorPctOfAsk: number         // e.g. 0.80
  motivationRelaxPerPoint: number   // e.g. 0.008
  minFloorPctOfAsk: number          // absolute floor, e.g. 0.72
  neverBelowPctOfAsk: number        // hard floor, e.g. 0.65
}

export interface NegotiationConfig {
  metadata: ConfigMetadata
  motivationKeywords: WeightedKeyword[]   // same shape/source as buybox distress keywords
  motivationScoreCap: number
  roomFactorModel: RoomFactorModel
  credibilityFloorModel: CredibilityFloorModel
  competitiveModeRules: { maxGapPctForFullMao: number; maxGapPctForNearMao: number }
}

// No populated values in Sprint 1. Future sprint will export, e.g.:
// export const JAX_NEGOTIATION_CONFIG: NegotiationConfig = { ... }
