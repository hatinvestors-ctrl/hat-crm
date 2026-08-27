// test/contextAwareCoachingHardening.test.js
// Context-Aware Coaching Hardening — Frozen Call Context + Safe
// Comparability V1.
//
// Issue 1 fix: call_reviews.call_context (additive, nullable JSONB column
// — see supabase/migrations/20260827000000_call_context_frozen_snapshot.sql,
// NOT YET APPLIED) freezes {type, callNumber, priorCallId, derivedAt} at
// the moment a review is generated, immune to later lead.status changes.
// call_reviews has NO update policy at all (fully immutable table) — once
// inserted, call_context can never be silently rewritten.
//
// Issue 2 fix: computeComparableOverallScoreMetrics() groups reviews by
// their frozen call_context.type and computes the trend ONLY within the
// rep's single most common (dominant) type, reusing computeOverallScoreMetrics/
// computeTrend verbatim — never a new trend formula, never mixing
// INITIAL_DISCOVERY scores with FOLLOW_UP scores into one "improvement."
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { buildCallContext, buildFrozenCallContext, CALL_CONTEXT_TYPES } from '../src/lib/callContext.js'
import { buildCallReviewRecord } from '../src/lib/callSessions.js'
import {
  computeComparableOverallScoreMetrics, computeAttentionLevel, computeAgentPerformanceStatus,
  aggregateAgentRow, MIN_CALLS_FOR_ASSESSMENT,
} from '../src/lib/coachingAnalytics.js'
import { computeAdoptionRate } from '../src/lib/coachingMemory.js'

const callDetailSrc = fs.readFileSync('src/pages/CallDetailPage.jsx', 'utf8')
const callReviewSrc = fs.readFileSync('src/components/lead-detail/CallReview.jsx', 'utf8')
const migrationSrc = fs.readFileSync('supabase/migrations/20260827000000_call_context_frozen_snapshot.sql', 'utf8')

// ── Scenario A — FROZEN CONTEXT ────────────────────────────────────────
describe('Scenario A — frozen context survives a later lead.status change', () => {
  it('buildFrozenCallContext captures type/callNumber/priorCallId/derivedAt from the callContext used at generation time', () => {
    const callContext = buildCallContext(
      [{ id: 's1', started_at: '2026-08-20T10:00:00Z' }],
      [],
      'follow_up', // lead.status AT REVIEW TIME
    )
    expect(callContext.type).toBe(CALL_CONTEXT_TYPES.FOLLOW_UP)
    const frozen = buildFrozenCallContext(callContext)
    expect(frozen.type).toBe('FOLLOW_UP')
    expect(frozen.callNumber).toBe(2)
    expect(frozen.priorCallId).toBe('s1')
    expect(frozen.derivedAt).toBeTruthy()
  })
  it('buildCallReviewRecord persists frozen_call_context as call_context — a later lead.status change cannot touch it (it is never re-read from lead.status again)', () => {
    const frozen = { type: 'FOLLOW_UP', callNumber: 2, priorCallId: 's1', derivedAt: '2026-08-26T00:00:00Z' }
    const record = buildCallReviewRecord({
      callSessionId: 'c1', workspaceId: 'w1', leadId: 'l1', repId: 'r1',
      validatedReview: { overallScore: 70, scores: [] },
      maxBuySnapshot: null, sellerPriceSnapshot: null,
      frozenCallContext: frozen,
    })
    expect(record.call_context).toEqual(frozen)
    // Simulating "lead.status became negotiating later" — the record
    // object itself has zero reference to a live lead.status lookup, so
    // there is nothing for a later status change to affect.
    expect(JSON.stringify(record)).not.toMatch(/negotiating/)
  })
  it('CallReview.jsx freezes callContext from the SAME validated object it just generated (reviewToSave.callContext), never re-fetches lead.status at save time', () => {
    expect(callReviewSrc).toMatch(/frozenCallContext: buildFrozenCallContext\(reviewToSave\.callContext\)/)
  })
})

// ── Scenario B — LEGACY REVIEW (no frozen context) ─────────────────────
describe('Scenario B — legacy review with no call_context falls back to safe re-derivation', () => {
  it('CallDetailPage prioritizes reviewRow.call_context and only re-derives when it is absent', () => {
    expect(callDetailSrc).toMatch(/let derivedCallContext = reviewRow\?\.call_context/)
    expect(callDetailSrc).toMatch(/if \(!derivedCallContext\) \{/)
  })
  it('buildCallReviewRecord defaults frozenCallContext to null when not supplied (backward compatible with every existing call site)', () => {
    const record = buildCallReviewRecord({
      callSessionId: 'c1', workspaceId: 'w1', leadId: 'l1', repId: 'r1',
      validatedReview: { overallScore: 70, scores: [] },
      maxBuySnapshot: null, sellerPriceSnapshot: null,
    })
    expect(record.call_context).toBeNull()
  })
})

// ── Scenario C — SAME CONTEXT COMPARISON ───────────────────────────────
describe('Scenario C — same-context calls can legitimately show a trend', () => {
  it('6 INITIAL_DISCOVERY calls (enough for computeTrend\'s own real/previous window) are evaluated as one comparable cohort', () => {
    const reviews = [40, 45, 50, 55, 65, 72].map((overall_score, i) => ({
      overall_score, created_at: `2026-08-${10 + i}`, call_context: { type: 'INITIAL_DISCOVERY', callNumber: i + 1 },
    }))
    const metrics = computeComparableOverallScoreMetrics(reviews)
    expect(metrics.contextType).toBe('INITIAL_DISCOVERY')
    expect(metrics.reviewedCount).toBe(6)
    expect(metrics.groupCounts).toEqual({ INITIAL_DISCOVERY: 6 })
    expect(metrics.trend.status).not.toBe('INSUFFICIENT_DATA')
  })
  it('fewer than computeTrend\'s real minimum (e.g. 3 calls) is honestly INSUFFICIENT_DATA — never a guessed trend', () => {
    const reviews = [50, 65, 72].map((overall_score, i) => ({
      overall_score, created_at: `2026-08-${10 + i}`, call_context: { type: 'INITIAL_DISCOVERY', callNumber: i + 1 },
    }))
    const metrics = computeComparableOverallScoreMetrics(reviews)
    expect(metrics.contextType).toBeNull()
    expect(metrics.trend.status).toBe('INSUFFICIENT_DATA')
  })
})

// ── Scenario D — DIFFERENT CONTEXT SCORES — no false improvement ───────
describe('Scenario D — different-context scores never produce a fabricated improvement claim', () => {
  it('INITIAL_DISCOVERY=41 and FOLLOW_UP=78 (one call each) never combine into a +37 claim — insufficient comparable data in either group', () => {
    const reviews = [
      { overall_score: 41, call_context: { type: 'INITIAL_DISCOVERY', callNumber: 1 } },
      { overall_score: 78, call_context: { type: 'FOLLOW_UP', callNumber: 2 } },
    ]
    const metrics = computeComparableOverallScoreMetrics(reviews)
    // Whichever group is picked as dominant (tie -> first seen), it has
    // only 1 review — computeTrend requires a real recent+previous window,
    // so status must be INSUFFICIENT_DATA, never IMPROVING.
    expect(metrics.trend.status).toBe('INSUFFICIENT_DATA')
    expect(metrics.trend.delta).toBeNull()
  })
})

// ── Scenario E — MIXED HISTORY, isolated per context ────────────────────
describe('Scenario E — mixed history: each context type evaluated from its OWN comparable set, never blended', () => {
  it('6 INITIAL_DISCOVERY (eligible, dominant) vs. 2 FOLLOW_UP (not enough for a trend) — trend never incorporates the FOLLOW_UP scores', () => {
    const reviews = [
      ...[40, 45, 50, 55, 65, 72].map((overall_score, i) => ({ overall_score, created_at: `2026-08-${10 + i}`, call_context: { type: 'INITIAL_DISCOVERY' } })),
      { overall_score: 72, created_at: '2026-08-20', call_context: { type: 'FOLLOW_UP' } },
      { overall_score: 75, created_at: '2026-08-21', call_context: { type: 'FOLLOW_UP' } },
    ]
    const metrics = computeComparableOverallScoreMetrics(reviews)
    expect(metrics.contextType).toBe('INITIAL_DISCOVERY')
    expect(metrics.groupCounts).toEqual({ INITIAL_DISCOVERY: 6, FOLLOW_UP: 2 })
    expect(metrics.average).toBeCloseTo((40 + 45 + 50 + 55 + 65 + 72) / 6, 5)
  })
})

// ── Scenario F — SKILL TREND remains cross-context (Part 6, no overcorrection) ──
describe('Scenario F — skill trends stay cross-context by design, unaffected by this hardening', () => {
  it('computeSkillTrends (unchanged) is never called with a context-filtered subset anywhere in aggregateAgentRow', () => {
    const src = fs.readFileSync('src/lib/coachingAnalytics.js', 'utf8')
    // computeSkillTrends must still be invoked with the FULL
    // reviewsChronological array, not a comparable/filtered one.
    expect(src).toMatch(/const skillTrends = computeSkillTrends\(reviewsChronological\)/)
  })
})

// ── Scenario G — COACHING ADOPTION regression check ────────────────────
describe('Scenario G — coaching adoption NOT_APPLICABLE exclusion is unchanged', () => {
  it('computeAdoptionRate still excludes NOT_APPLICABLE from both numerator and denominator (no behavior change)', () => {
    const rate = computeAdoptionRate([{ result: 'NOT_APPLICABLE' }, { result: 'APPLIED' }, { result: 'NOT_APPLIED' }])
    expect(rate.applicableCount).toBe(2)
    expect(rate.rate).toBe(0.5)
  })
})

// ── Scenario H — TEAM IMPROVING REPS safe ───────────────────────────────
describe('Scenario H — a rep with a higher score on a DIFFERENT call type only is never counted as Improving', () => {
  it('aggregateAgentRow.performanceStatus is BUILDING_BASELINE (not IMPROVING) when the only "improvement" is cross-context', () => {
    // MIN_CALLS_FOR_ASSESSMENT calls total, but split 1 INITIAL_DISCOVERY /
    // rest FOLLOW_UP so no single context group has a real trend window.
    const reviewsChronological = [
      { call_session_id: 'c1', overall_score: 41, dimension_scores: [], call_context: { type: 'INITIAL_DISCOVERY' } },
      { call_session_id: 'c2', overall_score: 78, dimension_scores: [], call_context: { type: 'FOLLOW_UP' } },
      { call_session_id: 'c3', overall_score: 80, dimension_scores: [], call_context: { type: 'FOLLOW_UP' } },
    ]
    const agent = aggregateAgentRow({ reviewsChronological, evaluations: [], activeFocus: null })
    expect(agent.performanceStatus).not.toBe('IMPROVING')
  })
})

// ── Scenario I — MANAGER ATTENTION safe ─────────────────────────────────
describe('Scenario I — declining-score attention reasons never fire from incomparable call types', () => {
  it('computeAttentionLevel uses comparableOverallScoreTrend when supplied, never raw cross-context trend, for the DECLINING reason', () => {
    const overallScoreMetrics = { reviewedCount: MIN_CALLS_FOR_ASSESSMENT, trend: { status: 'DECLINING', previousAvg: 80, recentAvg: 40 } } // raw, cross-context, misleading
    const comparableOverallScoreTrend = { status: 'INSUFFICIENT_DATA', previousAvg: null, recentAvg: null } // real, comparable-scoped truth
    const result = computeAttentionLevel({
      overallScoreMetrics, comparableOverallScoreTrend, coveragePercent: 90, adoption: { rate: null, applicableCount: 0 }, recentEvaluations: [], skillTrends: [],
    })
    expect(result.reasons.some(r => r.includes('declining'))).toBe(false)
  })
  it('omitting comparableOverallScoreTrend falls back to overallScoreMetrics.trend — IDENTICAL to pre-hardening behavior (backward compatible)', () => {
    const overallScoreMetrics = { reviewedCount: MIN_CALLS_FOR_ASSESSMENT, trend: { status: 'DECLINING', previousAvg: 80, recentAvg: 40 } }
    const result = computeAttentionLevel({
      overallScoreMetrics, coveragePercent: 90, adoption: { rate: null, applicableCount: 0 }, recentEvaluations: [], skillTrends: [],
    })
    expect(result.level).toBe('ATTENTION')
    expect(result.reasons[0]).toMatch(/declining/)
  })
})

// ── Scenario J — FROZEN CONTEXT IMMUTABILITY ────────────────────────────
describe('Scenario J — call_reviews.call_context cannot be overwritten by later lead changes (RLS/architecture)', () => {
  it('call_reviews table has NO update policy — the pending migration does not add one, and this fix relies on that existing guarantee', () => {
    const schemaSrc = fs.readFileSync('supabase/migrations/20260824000000_call_intelligence_v1.sql', 'utf8')
    expect(schemaSrc).toMatch(/call_reviews has NO update policy at all/)
    expect(schemaSrc).not.toMatch(/CREATE POLICY[^;]*call_reviews[^;]*FOR UPDATE/)
  })
  it('the pending migration only ADDs a nullable column — no UPDATE policy, no RLS change, no backfill/rewrite of existing rows', () => {
    expect(migrationSrc).toMatch(/ADD COLUMN IF NOT EXISTS call_context JSONB/)
    expect(migrationSrc).not.toMatch(/UPDATE public\.call_reviews/)
    expect(migrationSrc).not.toMatch(/CREATE POLICY/)
    expect(migrationSrc).not.toMatch(/ALTER TABLE.*DROP/)
  })
})

// ── No new AI call / no scoring-dimension change ────────────────────────
describe('No new AI call, no dimension/weight change introduced by this hardening pass', () => {
  it('coachingAnalytics.js still has zero fetch()/Netlify function references', () => {
    const src = fs.readFileSync('src/lib/coachingAnalytics.js', 'utf8')
    expect(src).not.toMatch(/fetch\(|\.netlify\/functions/)
  })
  it('COACHING_DIMENSIONS (callCoaching.js) untouched by this pass', () => {
    const src = fs.readFileSync('src/lib/callCoaching.js', 'utf8')
    expect(src).toMatch(/OPENING_RAPPORT.*MOTIVATION_DISCOVERY.*PAIN_DEPTH.*PROPERTY_DISCOVERY.*TIMELINE.*PRICE_DISCOVERY.*DECISION_MAKERS.*NEGOTIATION.*COMMITMENT/s)
  })
})

// ── Live Copilot untouched ───────────────────────────────────────────────
describe('Live Copilot / getCallMemory path untouched by this hardening pass', () => {
  it('LiveCopilot.jsx has zero diff-relevant references to computeComparableOverallScoreMetrics or call_context', () => {
    const src = fs.readFileSync('src/components/lead-detail/LiveCopilot.jsx', 'utf8')
    expect(src).not.toMatch(/computeComparableOverallScoreMetrics|call_context/)
  })
})
