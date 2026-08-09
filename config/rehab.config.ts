// config/rehab.config.ts — TYPE DEFINITIONS ONLY. No values.
// Sprint 1.1 (HAT AI OS architecture correction) — see docs/architecture/HAT_AI_OS.md
//
// Added in Sprint 1.1 review to fix a mismatch identified during architecture
// review: core/rehab-engine expects renovation cost brackets by condition tier,
// but FinancialConfig (Sprint 1) never defined them — FinancialConfig only ever
// covered purchase/holding/selling cost assumptions, not renovation cost bands.
// This resolves that gap with its own dedicated config, consumed by rehab-engine
// instead of rehab-engine incorrectly relying on FinancialConfig for something
// FinancialConfig was never designed to hold.
//
// Source material for future population (not populated here): the condition-tier
// cost bands currently narrated ad hoc, and differently, inside the prompt text
// of generate-core-analysis.mjs, generate-ai-notes.mjs, and estimate-reno.mjs —
// see architecture doc Step 1 for the general duplication pattern this follows.

import type { ConfigMetadata } from './config-metadata'

export type ConditionTier = 'move_in_ready' | 'light' | 'medium' | 'heavy' | 'unknown'

/** A renovation-component category, e.g. 'kitchen', 'bathrooms', 'roof', 'hvac'. */
export interface RehabComponentCategory {
  category: string
  typicalCostRange: { low: number; high: number }
  notes?: string
}

/** Cost bracket for a given condition tier, with an optional $/sqft basis as an
 *  alternative or supplement to a flat dollar range. */
export interface RehabCostBracket {
  tier: ConditionTier
  flatRange: { low: number; high: number }
  costPerSqftRange?: { low: number; high: number }
  assumedDefault: number          // used when condition is described but not itemized
  componentCategories?: RehabComponentCategory[]
}

/** Market-specific rehab defaults — rehab costs vary by market (labor/material
 *  cost differences), so this is keyed by market like the other config files. */
export interface RehabConfig {
  metadata: ConfigMetadata
  brackets: RehabCostBracket[]
  unknownConditionAssumedTier: ConditionTier   // e.g. 'medium' — matches today's
                                                 // "assume $50K when unknown" pattern
}

// No populated values in Sprint 1.1. Future sprint will export, e.g.:
// export const JAX_REHAB_CONFIG: RehabConfig = { ... }
