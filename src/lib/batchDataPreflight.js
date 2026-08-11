// src/lib/batchDataPreflight.js
// Capability #10.5 — the ONE gate every paid BatchData call must pass
// through first. Pure decision logic, no fetch/DB calls itself, so it's
// trivially unit-testable and reusable from both the server-side function
// and (read-only, decision-only) any future UI that wants to preview
// whether a click would actually spend money before the user clicks.

import { BATCHDATA_ENRICHMENT_TTL_MS, BATCHDATA_LOCK_STALE_MS } from './batchDataConfig.js'

/**
 * @typedef {'READY_FOR_LOOKUP'|'ALREADY_ENRICHED'|'INSUFFICIENT_IDENTITY'|'EXCLUDED_PROPERTY'|'RECENT_PROVIDER_FAILURE'|'LOOKUP_IN_PROGRESS'} PreflightDecision
 */

/**
 * @param {object} lead
 * @param {boolean} [force] - operator explicitly wants to re-pay/override staleness (never overrides EXCLUDED_PROPERTY or LOOKUP_IN_PROGRESS)
 * @returns {{decision: PreflightDecision, reason: string}}
 */
export function batchDataPreflight(lead, force = false) {
  if (!lead) return { decision: 'INSUFFICIENT_IDENTITY', reason: 'No lead record' }

  // A genuinely in-flight request (another click/process started it and
  // hasn't finished) always blocks a second paid call, even with force —
  // force is for re-paying a COMPLETED lookup, not for racing an active one.
  const lockedAt = lead.enrichment_data?.batchdata_lock_at
  if (lockedAt && (Date.now() - new Date(lockedAt).getTime()) < BATCHDATA_LOCK_STALE_MS) {
    return { decision: 'LOOKUP_IN_PROGRESS', reason: 'Another BatchData lookup for this lead is already in progress' }
  }

  // Existing exclusion logic (Capability #10.2) is authoritative and is
  // NEVER overridden here, with or without force — a paid lookup on an
  // already-excluded property (e.g. HOA-owned common area) is exactly the
  // wasted spend Section 17/22's false-positive test guards against.
  if (lead.enrichment_data?.excluded) {
    return { decision: 'EXCLUDED_PROPERTY', reason: lead.enrichment_data?.excluded_reason || 'Property already excluded' }
  }

  if (!lead.address?.trim()) {
    return { decision: 'INSUFFICIENT_IDENTITY', reason: 'No property address on file' }
  }

  const lastErrorType = lead.enrichment_data?.skip_trace_status
  const lastErrorAt = lead.enrichment_data?.contact_enriched_at
  const isBillingOrAuthFailure = lastErrorType === 'BILLING_ERROR' || lastErrorType === 'AUTH_ERROR'
  if (!force && isBillingOrAuthFailure && lastErrorAt && (Date.now() - new Date(lastErrorAt).getTime()) < BATCHDATA_ENRICHMENT_TTL_MS) {
    // A billing/auth failure means the ACCOUNT is broken, not this lead —
    // retrying immediately just wastes another rejected (but still
    // request-cycle-costing) call against a provider we already know is down.
    return { decision: 'RECENT_PROVIDER_FAILURE', reason: `Last attempt failed with ${lastErrorType} — provider likely still unavailable` }
  }

  if (!force && lastErrorAt && (Date.now() - new Date(lastErrorAt).getTime()) < BATCHDATA_ENRICHMENT_TTL_MS) {
    return { decision: 'ALREADY_ENRICHED', reason: `Enriched within the last TTL window (${lastErrorAt})` }
  }

  return { decision: 'READY_FOR_LOOKUP', reason: 'Passed all pre-flight checks' }
}
