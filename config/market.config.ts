// config/market.config.ts — TYPE DEFINITIONS ONLY. No values.
// Sprint 1 (HAT AI OS foundation) — see docs/architecture/HAT_AI_OS.md
//
// Resolves the duplicated ZIP-tier/ARV-band/rent-band tables currently found in
// generate-core-analysis.mjs, generate-comps.mjs, generate-ai-notes.mjs, and
// scripts/daily-redfin-import/index.mjs (architecture doc Step 1, §1.2/§1.3/§1.10/§1.11).
// Populating this file with real, reconciled values is explicitly deferred to a
// future sprint (Migration Strategy Phase 2).
//
// Sprint 1.1: now embeds shared ConfigMetadata (configVersion/effectiveFrom/
// market/description/reason) instead of a bare `effectiveFrom` string, so a
// historical AI run's config_snapshot can be traced to an exact config version.

import type { ConfigMetadata } from './config-metadata'

/** A price or rent range with a stated baseline property profile. */
export interface Range {
  low: number
  high: number
  baseline: string   // e.g. '3/2' — the bed/bath profile the range assumes
}

/** Per-ZIP market profile. */
export interface ZipProfile {
  zip: string
  market: string                 // e.g. 'jax' — extensible to future markets
  tier: 'A' | 'B' | 'C' | 'blocked' | 'unknown'
  arvBand: Range
  rentBand: Range
  adjacentZips: string[]         // replaces ZIP_CLUSTERS duplication
}

/** A flat adjustment applied to a baseline ARV/rent estimate. */
export interface Adjustment {
  condition: string              // e.g. 'bedrooms=2', 'sqft<1000', 'bathrooms=1'
  deltaArv?: number
  deltaRent?: number
  note?: string
}

/** Full market configuration — one entry per market HAT operates in. */
export interface MarketConfig {
  metadata: ConfigMetadata
  zips: ZipProfile[]
  adjustments: Adjustment[]
}

// No populated values in Sprint 1. Future sprint will export, e.g.:
// export const JAX_MARKET_CONFIG: MarketConfig = { ... }
