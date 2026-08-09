// config/scoring.config.ts — TYPE DEFINITIONS ONLY. No values.
// Sprint 1 (HAT AI OS foundation) — see docs/architecture/HAT_AI_OS.md
//
// Resolves the two incompatible verdict vocabularies currently in production —
// generate-core-analysis.mjs's 5-band MAKE OFFER/NEGOTIATE/LONG SHOT/WATCH/DEAD
// LEAD vs analyze-deal.mjs's 3-band BUY/CONDITIONAL/PASS (architecture doc Step 1,
// §1.12). Populating this file with real, reconciled values — including deciding
// on ONE verdict vocabulary — is explicitly deferred to a future sprint.
//
// Sprint 1.1: now embeds shared ConfigMetadata instead of a bare `effectiveFrom`
// string (see config/config-metadata.ts).

import type { ConfigMetadata } from './config-metadata'

export interface ScoreBand {
  minPoints: number
  points: number
  label?: string
}

export interface RubricCategory {
  name: string                 // e.g. 'Deal Return', 'Price Gap', 'Seller Signals'
  maxPoints: number
  bands: ScoreBand[]
}

export interface VerdictBand {
  verdict: string               // the ONE allowed vocabulary entry
  minScore: number
  requiresDealMathAtMao: boolean
}

export interface ScoringConfig {
  metadata: ConfigMetadata
  rubric: RubricCategory[]
  verdictBands: VerdictBand[]   // ordered, single source of truth for verdict vocabulary
  dataQualityPenalties: { condition: string; penaltyPoints: number }[]
}

// No populated values in Sprint 1. Future sprint will export, e.g.:
// export const JAX_SCORING_CONFIG: ScoringConfig = { ... }
