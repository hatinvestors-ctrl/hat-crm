// config/config-metadata.ts — TYPE DEFINITIONS ONLY. No values.
// Sprint 1.1 (HAT AI OS architecture correction) — see docs/architecture/HAT_AI_OS.md
//
// Added in Sprint 1.1 review. Previously every config file carried only a bare
// `effectiveFrom: string` field, which is not enough to answer "exactly which
// configuration version produced this historical AI run?" — the core requirement
// of history/README.md's ai_runs.config_snapshot field. ConfigMetadata is the
// shared contract every /config file now embeds instead of restating its own
// ad hoc versioning fields.

/**
 * Shared metadata every config object must carry. Embedded as a `metadata` field
 * on each top-level config interface (MarketConfig, FinancialConfig, etc.)
 * rather than each config re-declaring its own market/effectiveFrom fields.
 */
export interface ConfigMetadata {
  /** Monotonically increasing or semver-style identifier for this exact config
   *  snapshot, e.g. 'jax-financial-v3'. This is what gets recorded verbatim in
   *  history/README.md's ai_runs.config_snapshot so a historical AI run can be
   *  traced to the precise config version that was live when it executed. */
  configVersion: string

  /** ISO date this version became active. */
  effectiveFrom: string

  /** Market this config applies to, e.g. 'jax'. Extensible to future markets. */
  market: string

  /** Optional human-readable description of what this version is / changed. */
  description?: string

  /** Optional explanation of WHY this version was created — e.g. "reconciled
   *  the 7% vs 8% selling-cost drift found in Sprint 1 review; going with 7%
   *  per deal_financials.selling_cost_pct as canonical." Encouraged for every
   *  config change once real values are populated (future sprint). */
  reason?: string
}
