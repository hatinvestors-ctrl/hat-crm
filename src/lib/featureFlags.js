// src/lib/featureFlags.js
// Capability #15.5.1 closure — the ONE flag controlling whether Kevin's
// Action Center reads V1 (derivePriority/off-market opportunity, computed
// live from ai_notes/enrichment_data) or V2 (stored decision_v2, computed
// deterministically and persisted by src/lib/decisionV2Persistence.js).
//
// Default is 'v1' — V2 only activates if this env var is explicitly set.
// ROLLBACK: set VITE_ACTION_CENTER_DECISION_ENGINE back to 'v1' (or unset
// it) in Netlify's environment variables and redeploy — no code change,
// no database change, no data loss. V1's own read path (ai_notes,
// enrichment_data) is completely untouched by V2 being active, so
// rollback is instant and safe in either direction.
export const ACTION_CENTER_DECISION_ENGINE =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ACTION_CENTER_DECISION_ENGINE) || 'v1'

export const isV2ActionCenter = ACTION_CENTER_DECISION_ENGINE === 'v2'
