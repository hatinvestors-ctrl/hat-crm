// src/lib/batchDataConfig.js
// Capability #10.5 — ONE place for every BatchData-related constant, so
// nothing is scattered/duplicated across the adapter, preflight, and UI
// (mission Section 21). This file has ZERO HAT-specific acquisition logic
// — it only configures the provider layer (mission Section 2's provider/
// acquisition-rules separation).

export const BATCHDATA_ENRICHMENT_TTL_DAYS = 1 // was a hardcoded 24h in #10.4; now the one place to change it
export const BATCHDATA_ENRICHMENT_TTL_MS = BATCHDATA_ENRICHMENT_TTL_DAYS * 24 * 60 * 60 * 1000

// A lead "in progress" longer than this is treated as abandoned (a crashed
// function, not a real concurrent request) rather than locked forever.
export const BATCHDATA_LOCK_STALE_MS = 2 * 60 * 1000

// Match-safety thresholds — centralized so #10.5's unit-aware scoring and
// any future tuning happens in one place, not scattered through
// classifyPersonMatch()'s body.
export const MATCH_TOKEN_OVERLAP_LIKELY = 2
export const MATCH_TOKEN_OVERLAP_AMBIGUOUS = 1

// How many of the most recent BatchData attempts (across all leads) to
// look at when deriving provider health (Section 14) — deliberately small,
// no new table, just reads recent enrichment_data.
export const HEALTH_SAMPLE_SIZE = 10
