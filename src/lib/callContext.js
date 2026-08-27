// src/lib/callContext.js
// Context-Aware Call Coaching / Multi-Call Seller Journey V1.
//
// Pure, deterministic functions only — no Supabase I/O, no AI calls. This
// is the "does the system know a repeat call is part of a continuing
// seller journey" layer the forensic audit found missing.
//
// Deliberately NOT persisted anywhere new (no migration, no new column):
// everything here is re-derivable at any time from data that already
// exists — call_sessions.lead_id/started_at (to count prior calls with
// this seller) and lead.status (to distinguish negotiation/commitment
// stages) — so a caller can always recompute the exact same callContext
// later (e.g. for display) without needing a frozen snapshot.
//
// No new coaching dimension is introduced here (Part 7's explicit
// instruction against "dimension explosion") — this only classifies the
// CALL and summarizes what's REAL from a previous one; the 9 canonical
// COACHING_DIMENSIONS (callCoaching.js) are untouched.

// The 4 conversational contexts from the mission's Part 2. Deliberately a
// plain JS constant, not a DB enum — nothing here is persisted.
export const CALL_CONTEXT_TYPES = {
  INITIAL_DISCOVERY: 'INITIAL_DISCOVERY',
  FOLLOW_UP: 'FOLLOW_UP',
  NEGOTIATION_OFFER: 'NEGOTIATION_OFFER',
  COMMITMENT_CLOSING: 'COMMITMENT_CLOSING',
}

// Real, existing lead.status values (see ActionZone.jsx PLAYBOOKS — the
// one canonical status list already in the app) mapped to a call context.
// A brand-new lead with zero prior calls is ALWAYS INITIAL_DISCOVERY,
// regardless of status — this is about what stage the RELATIONSHIP is at
// when THIS call starts, not a generic status label.
const NEGOTIATION_STATUSES = new Set(['negotiating', 'offer_sent', 'rejected_not_accepted'])
const COMMITMENT_STATUSES = new Set(['offer_accepted', 'offer_signed', 'offer_pending_hat_signing', 'sold'])

/**
 * @param {number} priorCallCount - how many call_sessions already exist
 *   for this lead_id, strictly before this call's started_at.
 * @param {string|null} leadStatus - lead.status at the time of this call.
 */
export function deriveCallContextType(priorCallCount, leadStatus) {
  if (!priorCallCount || priorCallCount <= 0) return CALL_CONTEXT_TYPES.INITIAL_DISCOVERY
  if (leadStatus && COMMITMENT_STATUSES.has(leadStatus)) return CALL_CONTEXT_TYPES.COMMITMENT_CLOSING
  if (leadStatus && NEGOTIATION_STATUSES.has(leadStatus)) return CALL_CONTEXT_TYPES.NEGOTIATION_OFFER
  return CALL_CONTEXT_TYPES.FOLLOW_UP
}

// Compact Previous Conversation Context (Part 3) — built ONLY from real,
// already-persisted call_sessions/call_reviews columns for the single
// immediately-prior call with this seller. Never fabricated: any field
// that isn't actually on the row is simply omitted (null), never guessed.
export function buildPreviousCallContext(previousSession, previousReview) {
  if (!previousSession) return null
  return {
    date: previousSession.started_at ?? null,
    outcome: previousSession.outcome ?? null,
    summary: previousSession.summary ?? null,
    sellerPriceFinal: previousSession.seller_price_final ?? null,
    objections: previousSession.objections?.length ? previousSession.objections : null,
    followUpDate: previousSession.follow_up_date ?? null,
    // From the previous call's OWN review, if one exists — real, frozen
    // facts about what happened, never re-derived from current state.
    topStrength: previousReview?.strengths?.[0] ?? null,
    missedOpportunity: previousReview?.missed_opportunity?.summary ?? null,
  }
}

/**
 * Orchestrator — the ONE function callers use. `priorSessions`/
 * `priorReviews` are the caller's ALREADY-FETCHED rows for this lead_id
 * (a small, bounded, targeted query — same pattern as fetchActiveFocus()
 * in CallReview.jsx), not fetched here.
 *
 * @param {Array} priorSessions - call_sessions rows for this lead_id,
 *   started_at strictly before this call, any order.
 * @param {Array} priorReviews - call_reviews rows for this lead_id
 *   (any of them; only the one matching the most recent prior session is
 *   used).
 * @param {string|null} leadStatus
 */
export function buildCallContext(priorSessions, priorReviews, leadStatus) {
  const sorted = [...(priorSessions || [])].sort((a, b) => new Date(a.started_at) - new Date(b.started_at))
  const callNumber = sorted.length + 1
  const type = deriveCallContextType(sorted.length, leadStatus)
  const mostRecentPrior = sorted[sorted.length - 1] || null
  const mostRecentPriorReview = mostRecentPrior
    ? (priorReviews || []).find(r => r.call_session_id === mostRecentPrior.id) || null
    : null
  return {
    type,
    callNumber,
    priorCallId: mostRecentPrior?.id ?? null,
    previous: buildPreviousCallContext(mostRecentPrior, mostRecentPriorReview),
  }
}

// Context-Aware Coaching Hardening V1 — the MINIMAL frozen snapshot
// persisted with a review (call_reviews.call_context, once the pending
// migration is approved/applied — see supabase/migrations/
// 20260827000000_call_context_frozen_snapshot.sql). Deliberately does NOT
// include `previous` (the previous call's full facts) — that would
// duplicate data already durably stored on the prior call_sessions/
// call_reviews rows, reachable via priorCallId. Only the classification
// actually used when the review was generated is frozen.
export function buildFrozenCallContext(callContext) {
  if (!callContext) return null
  return {
    type: callContext.type,
    callNumber: callContext.callNumber,
    priorCallId: callContext.priorCallId ?? null,
    derivedAt: new Date().toISOString(),
  }
}

// Human-readable label for UI (Part 11/12, and Final Hardening Part 6) —
// the ONE canonical raw-enum -> friendly-label formatter. Every UI surface
// that needs to show a call-context type to a manager (Call Detail, Agent
// Profile's Overall Trend) must reuse this, never define its own mapping.
const TYPE_LABEL = {
  INITIAL_DISCOVERY: 'Initial Discovery',
  FOLLOW_UP: 'Follow-Up',
  NEGOTIATION_OFFER: 'Negotiation / Offer',
  COMMITMENT_CLOSING: 'Commitment / Closing',
}

export function formatCallContextTypeLabel(type) {
  if (!type) return null
  return TYPE_LABEL[type] || type
}

export function formatCallContextLabel(callContext) {
  if (!callContext) return null
  return `${formatCallContextTypeLabel(callContext.type)} · Call #${callContext.callNumber} with this seller`
}
