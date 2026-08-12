// src/lib/decisionV2Persistence.js
// Capability #15.5.1 — the ONE centralized recalculate-and-store path for
// Decision Engine V2 (Section 3: "do not duplicate V2 calculation code
// across components"). Every real write path (lead creation, manual
// edits, BatchData enrichment) should call recalculateDecisionV2()
// instead of independently calling computeDecisionV2() + writing the
// result. Deterministic only — never calls an LLM (Section 7).
//
// Degrades safely when leads.decision_v2 doesn't exist yet (migration not
// applied — see supabase/migrations/20260812000000_decision_engine_v2_shadow.sql
// and 20260812010000_acquisition_override.sql): the write is attempted,
// and a "column does not exist" error is caught and swallowed so this
// NEVER blocks or fails the caller's real (V1) write. Nothing in this
// file is destructive or required for V1 to keep working.

import { computeDecisionV2, shouldTriggerV2Recalc } from './decisionEngineV2.js'

/**
 * @param {object} supabase - a Supabase client (browser or service-role)
 * @param {object} lead - the CURRENT full lead row (post-write)
 * @param {string} [trigger] - one of shouldTriggerV2Recalc's trigger names, or 'NEW_LEAD'/'MANUAL_RECALCULATION'
 * @returns {Promise<object|null>} the computed decision, or null if the write was skipped/failed silently
 */
export async function recalculateDecisionV2(supabase, lead, trigger = 'MANUAL_RECALCULATION') {
  if (!lead?.id) return null
  const marketType = lead.is_distressed ? 'off_market' : 'on_market'

  let decision
  try {
    decision = computeDecisionV2(lead, marketType, { trigger })
  } catch (err) {
    // Never let a V2 computation bug break the real (V1) write path that
    // called this — log and bail, exactly like batchdata-enrich.mjs's
    // existing non-fatal-error convention.
    console.warn('[decisionV2Persistence] computeDecisionV2 failed, skipping:', err.message)
    return null
  }

  const { error } = await supabase
    .from('leads')
    .update({ decision_v2: decision, decision_v2_updated_at: decision.calculated_at })
    .eq('id', lead.id)

  if (error && !/decision_v2/i.test(error.message || '')) {
    console.warn('[decisionV2Persistence] write failed (non-fatal):', error.message)
  }
  // Column-missing errors are expected until the migration is applied —
  // intentionally silent so this never surfaces as a user-facing failure.

  return decision
}

/**
 * Convenience wrapper for callers that already have an old/new lead pair
 * (e.g. useLeadUpdate.js) — decides whether to recalculate at all, using
 * the existing #15.2 trigger-decision logic, before doing any work.
 */
export async function maybeRecalculateDecisionV2(supabase, oldLead, newLead) {
  const { should, trigger } = shouldTriggerV2Recalc(oldLead, newLead)
  if (!should) return null
  return recalculateDecisionV2(supabase, newLead, trigger)
}
