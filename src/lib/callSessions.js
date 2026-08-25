// src/lib/callSessions.js
// Capability #25.1 — Persistent Call Intelligence. Pure record-building
// functions only (no Supabase I/O here — that stays in the components, so
// this stays fully unit-testable). Builds exactly the rows
// supabase/migrations/20260824000000_call_intelligence_v1.sql expects.
//
// HONESTY CONTRACT: never persists a full transcript, never persists raw
// audio (there is no raw audio anywhere in this codebase to persist).
// Only structured facts + the already quote-verified coaching snippets
// from Capability #24's guardrails (verifyCoachingMoments/verifyStrongMoves).
import { getCallCoverage, formatPriceMovement } from './sellerStrategy.js'
import { dedupeObjections } from './callCoaching.js'

// Called once per Live Copilot session, at session creation — NOT at End
// Call. repId/workspaceId are captured at the moment the call starts
// (Part 8) and never re-derived from lead.assigned_to.
export function createCallIdentity({ workspaceId, repId }) {
  return {
    callId: crypto.randomUUID(),
    workspaceId,
    repId,
    startedAt: new Date().toISOString(),
  }
}

// Phase 1 — inserted the moment the rep clicks "End Call" (before the
// outcome form is even filled in). Everything here IS already known at
// that point: identity/timing/seller-state/coverage. Deterministic, no
// AI — coverage_snapshot reuses the SAME getCallCoverage() Capability #24
// already computes live, so an unreviewed call still shows real coverage
// on the Calls page (Part 17's chosen option). outcome/follow_up_date/
// summary are intentionally NOT here — see buildCallSessionFinalizeUpdate.
export function buildCallSessionInsert({ identity, lead, si, endedAt }) {
  const movement = formatPriceMovement(si)
  const startedAtMs = new Date(identity.startedAt).getTime()
  const endedAtMs = new Date(endedAt).getTime()
  const durationSeconds = Number.isFinite(startedAtMs) && Number.isFinite(endedAtMs)
    ? Math.max(0, Math.round((endedAtMs - startedAtMs) / 1000))
    : null

  return {
    id: identity.callId,
    workspace_id: identity.workspaceId,
    lead_id: lead.id,
    rep_id: identity.repId,
    started_at: identity.startedAt,
    ended_at: endedAt,
    duration_seconds: durationSeconds,
    outcome: null,
    follow_up_date: null,
    summary: null,
    seller_price_initial: movement ? (si.seller_asking_price_history?.[0]?.value ?? movement.current ?? null) : null,
    seller_price_final: si.seller_asking_price ?? null,
    seller_price_movement: movement ? movement.movedBy : null,
    // Part 2 — defensive second pass: dedupe again at persistence time
    // even though LiveCopilot.jsx now dedupes at the source, so any other
    // future caller of this builder can't reintroduce the same defect.
    objections: si.objections?.length ? dedupeObjections(si.objections) : null,
    coverage_snapshot: getCallCoverage(si),
  }
}

// Phase 2 — the ONE allowed update (Save & Schedule step), matching the
// migration's "outcome IS NULL" RLS guard: this can only ever succeed once
// per row. Never touches identity/timing/seller fields set in Phase 1.
export function buildCallSessionFinalizeUpdate({ outcome, followUpDate, note }) {
  return {
    outcome: outcome ?? null,
    follow_up_date: followUpDate || null,
    summary: note?.trim() || null,
  }
}

// Builds the exact call_reviews row to insert when Generate Call Review
// succeeds. `validatedReview` is ALREADY the output of validateScorecard/
// verifyCoachingMoments/verifyStrongMoves (Part 5) — this function never
// re-derives or loosens that validation, only shapes it into a DB row.
export function buildCallReviewRecord({ callSessionId, workspaceId, leadId, repId, validatedReview, maxBuySnapshot, sellerPriceSnapshot }) {
  return {
    call_session_id: callSessionId,
    workspace_id: workspaceId,
    lead_id: leadId,
    rep_id: repId,
    overall_score: validatedReview.overallScore ?? null,
    dimension_scores: validatedReview.scores?.length ? validatedReview.scores : null,
    coverage: validatedReview.coverage ?? null,
    strengths: validatedReview.strengths?.length ? validatedReview.strengths : null,
    missed_opportunity: validatedReview.missedOpportunity ?? null,
    coaching_moments: validatedReview.coachingMoments?.length ? validatedReview.coachingMoments : null,
    strong_moves: validatedReview.strongMoves?.length ? validatedReview.strongMoves : null,
    max_buy_snapshot: maxBuySnapshot ?? null,
    seller_price_snapshot: sellerPriceSnapshot ?? null,
    recommended_focus: validatedReview.recommendedFocus ?? null,
  }
}

// Part 13/14 — Calls History filtering, pure over already-fetched rows
// (no query-building here; the Supabase query itself does the workspace/
// role scoping via RLS — this only applies the UI-selected filters on top).
export function filterCallSessions(sessions, { repId, reviewedOnly, notReviewedOnly, outcome } = {}) {
  return sessions.filter(s => {
    if (repId && repId !== 'ALL' && s.rep_id !== repId) return false
    if (reviewedOnly && !s.hasReview) return false
    if (notReviewedOnly && s.hasReview) return false
    if (outcome && outcome !== 'ALL' && s.outcome !== outcome) return false
    return true
  })
}
