// test/contextAwareCoachingFinalHardening.test.js
// Context-Aware Coaching — Comparable Trend Context + Release Readiness
// (Final Hardening). Fixes the two residual issues from the previous
// hardening pass:
//   Issue A — computeComparableOverallScoreMetrics() picked the "first
//     seen" group on a tie, which was deterministic but semantically
//     arbitrary. Now: eligibility (computeTrend's own real-window
//     requirement) -> largest eligible group -> most-recent-review
//     tiebreak -> honest no-claim if still ambiguous.
//   Issue B — Agent Profile could show "Overall Trend: Improving" with no
//     indication of WHICH call-context cohort that trend represents. Now
//     every trend display names its contextType via the one canonical
//     formatCallContextTypeLabel().
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { computeComparableOverallScoreMetrics, computeAttentionLevel, aggregateAgentRow } from '../src/lib/coachingAnalytics.js'
import { formatCallContextTypeLabel, formatCallContextLabel } from '../src/lib/callContext.js'
import { computeTrend, TREND_WINDOW_SIZE } from '../src/lib/coachingMemory.js'

const pageSrc = fs.readFileSync('src/pages/CoachingAgentProfilePage.jsx', 'utf8')
const callDetailSrc = fs.readFileSync('src/pages/CallDetailPage.jsx', 'utf8')

function reviewsForType(type, scores, startDay = 1) {
  return scores.map((overall_score, i) => ({
    overall_score, created_at: `2026-08-${String(startDay + i).padStart(2, '0')}`, call_context: { type },
  }))
}

// A real eligible cohort needs computeTrend to leave INSUFFICIENT_DATA —
// empirically that's TREND_WINDOW_SIZE + 1 real values (5 recent + 1
// previous with the canonical windowSize=5). Confirmed directly against
// the real function, never a re-invented constant in this test file.
const ELIGIBLE_COUNT = (() => {
  for (let n = 1; n <= 20; n++) {
    if (computeTrend(Array.from({ length: n }, (_, i) => 50 + i)).status !== 'INSUFFICIENT_DATA') return n
  }
  throw new Error('could not determine eligible count')
})()

describe('Sanity — ELIGIBLE_COUNT matches TREND_WINDOW_SIZE + 1 (canonical, not re-invented)', () => {
  it('is exactly TREND_WINDOW_SIZE + 1', () => {
    expect(ELIGIBLE_COUNT).toBe(TREND_WINDOW_SIZE + 1)
  })
})

// ── Scenario A — UNIQUE DOMINANT CONTEXT ───────────────────────────────
describe('Scenario A — unique dominant context (more calls, both eligible)', () => {
  it('Initial Discovery (5 calls) vs Follow-Up (3 calls) — Initial Discovery selected when both are eligible-sized enough to compare, else honestly reports the larger eligible one', () => {
    const reviews = [
      ...reviewsForType('INITIAL_DISCOVERY', Array.from({ length: ELIGIBLE_COUNT + 2 }, (_, i) => 40 + i), 1),
      ...reviewsForType('FOLLOW_UP', Array.from({ length: ELIGIBLE_COUNT }, (_, i) => 60 + i), 50),
    ]
    const metrics = computeComparableOverallScoreMetrics(reviews)
    expect(metrics.contextType).toBe('INITIAL_DISCOVERY')
    expect(metrics.comparableCalls).toBe(ELIGIBLE_COUNT + 2)
  })
})

// ── Scenario B — TIED COUNTS, DIFFERENT RECENCY ────────────────────────
describe('Scenario B — tied eligible counts broken by recency, never by score or insertion order', () => {
  it('Initial Discovery and Follow-Up tied at the same count — Follow-Up wins because its most recent review is newer', () => {
    const initial = reviewsForType('INITIAL_DISCOVERY', Array.from({ length: ELIGIBLE_COUNT }, (_, i) => 80 - i), 1) // HIGHER scores, but OLDER
    const followUp = reviewsForType('FOLLOW_UP', Array.from({ length: ELIGIBLE_COUNT }, (_, i) => 40 + i), 20) // LOWER scores, but NEWER
    const metrics = computeComparableOverallScoreMetrics([...initial, ...followUp])
    expect(metrics.contextType).toBe('FOLLOW_UP') // recency wins, NOT the higher-scoring group
  })
  it('never picks the higher-scoring group merely for having a higher score — same setup, confirm the average reflects the recency winner not the score winner', () => {
    const initial = reviewsForType('INITIAL_DISCOVERY', Array.from({ length: ELIGIBLE_COUNT }, () => 90), 1)
    const followUp = reviewsForType('FOLLOW_UP', Array.from({ length: ELIGIBLE_COUNT }, () => 30), 20)
    const metrics = computeComparableOverallScoreMetrics([...initial, ...followUp])
    expect(metrics.contextType).toBe('FOLLOW_UP')
    expect(metrics.average).toBe(30)
  })
})

// ── Scenario C — TIED COUNTS, NO SAFE UNIQUE WINNER ────────────────────
describe('Scenario C — tie that cannot be safely broken returns no trend claim, never an arbitrary pick', () => {
  it('identical most-recent created_at across two eligible groups of equal size -> contextType null, INSUFFICIENT_DATA', () => {
    const initial = reviewsForType('INITIAL_DISCOVERY', Array.from({ length: ELIGIBLE_COUNT }, (_, i) => 50 + i), 1)
    const followUp = reviewsForType('FOLLOW_UP', Array.from({ length: ELIGIBLE_COUNT }, (_, i) => 60 + i), 1)
    // Force the exact same most-recent timestamp on both groups.
    initial[initial.length - 1].created_at = '2026-08-30'
    followUp[followUp.length - 1].created_at = '2026-08-30'
    const metrics = computeComparableOverallScoreMetrics([...initial, ...followUp])
    expect(metrics.contextType).toBeNull()
    expect(metrics.trend.status).toBe('INSUFFICIENT_DATA')
  })
})

// ── Scenario D — MORE CALLS BUT NOT ENOUGH TREND DATA ───────────────────
describe('Scenario D — a bigger but ineligible cohort is never selected merely for its size', () => {
  it('Initial Discovery has more total calls but neither group reaches the eligible threshold -> no cohort claims comparability', () => {
    const reviews = [
      ...reviewsForType('INITIAL_DISCOVERY', [41, 50, 55], 1), // 3, below ELIGIBLE_COUNT
      ...reviewsForType('FOLLOW_UP', [70, 75], 10), // 2, below ELIGIBLE_COUNT
    ]
    const metrics = computeComparableOverallScoreMetrics(reviews)
    expect(metrics.contextType).toBeNull()
    expect(metrics.comparableCalls).toBe(0)
    expect(metrics.trend.status).toBe('INSUFFICIENT_DATA')
  })
})

// ── Scenario E — CROSS-CONTEXT FALSE IMPROVEMENT (regression) ─────────
describe('Scenario E — cross-context false improvement stays blocked', () => {
  it('Initial Discovery=41, Follow-Up=78 (1 each) never becomes an improvement claim', () => {
    const metrics = computeComparableOverallScoreMetrics([
      { overall_score: 41, created_at: '2026-08-01', call_context: { type: 'INITIAL_DISCOVERY' } },
      { overall_score: 78, created_at: '2026-08-02', call_context: { type: 'FOLLOW_UP' } },
    ])
    expect(metrics.trend.status).toBe('INSUFFICIENT_DATA')
    expect(metrics.contextType).toBeNull()
  })
})

// ── Scenario F — SAME-CONTEXT IMPROVEMENT LABELED ──────────────────────
describe('Scenario F — a real same-context improvement is labeled with its context', () => {
  it('Initial Discovery improving over enough real observations reports IMPROVING with contextType INITIAL_DISCOVERY', () => {
    const scores = [30, 32, 34, 36, 38, 60, 62, 64, 66, 68] // previous window low, recent window high
    const reviews = reviewsForType('INITIAL_DISCOVERY', scores, 1)
    const metrics = computeComparableOverallScoreMetrics(reviews)
    expect(metrics.contextType).toBe('INITIAL_DISCOVERY')
    expect(metrics.trend.status).toBe('IMPROVING')
  })
  it('formatCallContextTypeLabel renders "Initial Discovery" for the UI label — the ONE canonical formatter, not a re-invented mapping', () => {
    expect(formatCallContextTypeLabel('INITIAL_DISCOVERY')).toBe('Initial Discovery')
    expect(formatCallContextTypeLabel('FOLLOW_UP')).toBe('Follow-Up')
    expect(formatCallContextTypeLabel('NEGOTIATION_OFFER')).toBe('Negotiation / Offer')
    expect(formatCallContextTypeLabel('COMMITMENT_CLOSING')).toBe('Commitment / Closing')
  })
  it('formatCallContextLabel (Call Detail) reuses the SAME type-label lookup, not a duplicate map', () => {
    expect(formatCallContextLabel({ type: 'FOLLOW_UP', callNumber: 3 })).toContain('Follow-Up')
  })
})

// ── Scenario G — MANAGER ATTENTION (regression, tightened) ────────────
describe('Scenario G — manager attention never raises a declining-score reason from an incomparable pair', () => {
  it('High Initial Discovery score followed by a lower Follow-Up score (1 each, not eligible) never produces a declining reason', () => {
    const comparable = computeComparableOverallScoreMetrics([
      { overall_score: 80, created_at: '2026-08-01', call_context: { type: 'INITIAL_DISCOVERY' } },
      { overall_score: 55, created_at: '2026-08-02', call_context: { type: 'FOLLOW_UP' } },
    ])
    const result = computeAttentionLevel({
      overallScoreMetrics: { reviewedCount: 5, trend: { status: 'DECLINING', previousAvg: 80, recentAvg: 55 } }, // raw would look declining
      comparableOverallScoreTrend: comparable.trend, // real: INSUFFICIENT_DATA
      coveragePercent: 90, adoption: { rate: null, applicableCount: 0 }, recentEvaluations: [], skillTrends: [],
    })
    expect(result.reasons.some(r => r.toLowerCase().includes('declining'))).toBe(false)
  })
  it('unrelated attention reasons (coverage/adoption/focus) are structurally untouched by this pass', () => {
    const src = fs.readFileSync('src/lib/coachingAnalytics.js', 'utf8')
    expect(src).toMatch(/ATTENTION_ADOPTION_THRESHOLD = 0\.5/)
    expect(src).toMatch(/WATCH_COVERAGE_THRESHOLD = 65/)
  })
})

// ── Scenario H — IMPROVING REPS (regression) ────────────────────────────
describe('Scenario H — a cross-context score increase never counts a rep as Improving', () => {
  it('aggregateAgentRow.performanceStatus is not IMPROVING when the only apparent gain is cross-context', () => {
    const reviewsChronological = [
      { call_session_id: 'c1', overall_score: 41, dimension_scores: [], call_context: { type: 'INITIAL_DISCOVERY' } },
      { call_session_id: 'c2', overall_score: 78, dimension_scores: [], call_context: { type: 'FOLLOW_UP' } },
    ]
    const agent = aggregateAgentRow({ reviewsChronological, evaluations: [], activeFocus: null })
    expect(agent.performanceStatus).not.toBe('IMPROVING')
  })
})

// ── Scenario I — IMPROVEMENT SUMMARY SAFE ───────────────────────────────
describe('Scenario I — Improvement Summary Overall Score row uses the comparable trend, never a raw cross-context delta', () => {
  it('Agent Profile computes improvementSentence from agent.overallScore.trend, which is now comparable-scoped', () => {
    expect(pageSrc).toMatch(/interpretImprovement\(\{ overallTrend: agent\.overallScore\.trend, adoptionWindow \}\)/)
  })
  it('the Overall Score row names its comparable context type and sample size when a real trend exists', () => {
    expect(pageSrc).toMatch(/formatCallContextTypeLabel\(agent\.overallScore\.trendContextType\)/)
    expect(pageSrc).toMatch(/Based on \{agent\.overallScore\.trendComparableCalls\} comparable/)
  })
  it('Coverage and Coaching Adoption rows in Improvement Summary are untouched (still their own independent before/after, no context-scoping added)', () => {
    expect(pageSrc).toMatch(/agent\.coverageTrend\.previousAvg\?\.toFixed\(0\)/)
    expect(pageSrc).toMatch(/adoptionWindow\.before != null && adoptionWindow\.after != null/)
  })
})

// ── Scenario J — SKILL TREND stays cross-context (regression) ──────────
describe('Scenario J — skill trend observations spanning multiple contexts are still included normally', () => {
  it('computeSkillTrends is still fed the FULL, unfiltered reviewsChronological — never a context-filtered subset', () => {
    const src = fs.readFileSync('src/lib/coachingAnalytics.js', 'utf8')
    expect(src).toMatch(/const skillTrends = computeSkillTrends\(reviewsChronological\)/)
  })
})

// ── Scenario K — FROZEN CONTEXT (regression) ────────────────────────────
describe('Scenario K — frozen context still wins over a later lead.status change', () => {
  it('CallDetailPage still prioritizes reviewRow.call_context before any re-derivation from current lead.status', () => {
    expect(callDetailSrc).toMatch(/let derivedCallContext = reviewRow\?\.call_context/)
  })
})

// ── Scenario L — LEGACY REVIEW (regression) ─────────────────────────────
describe('Scenario L — legacy review (no call_context) renders via safe fallback', () => {
  it('a review with no call_context is grouped as UNCLASSIFIED, never crashes, never silently merges into a real type', () => {
    const metrics = computeComparableOverallScoreMetrics([{ overall_score: 50, created_at: '2026-08-01' }])
    expect(metrics.groupCounts).toEqual({ UNCLASSIFIED: 1 })
    expect(metrics.contextType).toBeNull() // 1 review is not eligible either way
  })
})

// ── Scenario M — SAME OBJECT USED FOR SAVE (regression) ─────────────────
describe('Scenario M — no second derivation after AI generation', () => {
  it('CallReview.jsx freezes reviewToSave.callContext (the object already used to build the prompt), never re-derives context after the AI response', () => {
    const src = fs.readFileSync('src/components/lead-detail/CallReview.jsx', 'utf8')
    // Both real buildCallContext(...) call sites live inside fetchCallContext()
    // (its two return branches) — confirm that function itself, and confirm
    // it's invoked exactly once in generate(), BEFORE the fetch to
    // generate-call-review, and that the frozen snapshot downstream reads
    // the SAME already-generated object (reviewToSave.callContext) rather
    // than calling fetchCallContext/buildCallContext a second time.
    const fnMatch = src.match(/async function fetchCallContext\(\) \{[\s\S]*?\n  \}/)
    expect(fnMatch[0].match(/buildCallContext\(/g)?.length).toBe(2) // its own two branches, not a second derivation elsewhere
    const generateCalls = (src.match(/await fetchCallContext\(\)/g) || []).length
    expect(generateCalls).toBe(1)
    expect(src).toMatch(/const callContext = await fetchCallContext\(\)\.catch\(\(\) => null\)/)
    expect(src).toMatch(/frozenCallContext: buildFrozenCallContext\(reviewToSave\.callContext\)/)
  })
})

// ── Migration review (not applied) ──────────────────────────────────────
describe('Migration review — additive, non-destructive, not applied', () => {
  const migrationSrc = fs.readFileSync('supabase/migrations/20260827000000_call_context_frozen_snapshot.sql', 'utf8')
  it('adds exactly one nullable JSONB column, no default fabricating context, no backfill, no UPDATE, no policy change', () => {
    expect(migrationSrc).toMatch(/ADD COLUMN IF NOT EXISTS call_context JSONB/)
    expect(migrationSrc).not.toMatch(/DEFAULT '/) // no fabricated default value
    expect(migrationSrc).not.toMatch(/UPDATE public\.call_reviews SET/)
    expect(migrationSrc).not.toMatch(/CREATE POLICY|DROP POLICY|ALTER POLICY/)
    expect(migrationSrc).not.toMatch(/NOT NULL/)
  })
})
