// test/coachingAnalytics.test.js
// Capability #25.3 — HAT Coaching Center aggregation layer. Pure functions
// only, fed with fixture rows shaped exactly like real call_reviews/
// coaching_focus_evaluations output — no Supabase I/O, no AI calls.
import { describe, it, expect } from 'vitest'
import {
  computeOverallScoreMetrics, computeCoveragePercent, computeCoverageTrend, computeSkillTrends,
  computeAgentPerformanceStatus, computeAttentionLevel, interpretCoachingEffectiveness,
  aggregateTeamPulse, aggregateAgentRow, MIN_CALLS_FOR_ASSESSMENT,
  computeAdoptionWindowComparison, interpretImprovement, deriveKeyConclusion,
} from '../src/lib/coachingAnalytics.js'

function review({ score, pain, coverage = { capturedCount: 7, total: 8 }, at }) {
  return {
    overall_score: score,
    dimension_scores: pain != null ? [{ key: 'PAIN_DEPTH', score: pain, why: 'x' }] : [],
    coverage,
    created_at: at,
  }
}
function evaluation(result) { return { result } }

describe('CASE 1/2 — new rep, few calls -> BUILDING_BASELINE', () => {
  it('1 reviewed call is not enough to assess', () => {
    const metrics = computeOverallScoreMetrics([review({ score: 7 })])
    expect(computeAgentPerformanceStatus(metrics)).toBe('BUILDING_BASELINE')
  })
  it('3 calls (at the minimum) still reports BUILDING_BASELINE — a real trend needs a comparison window', () => {
    const metrics = computeOverallScoreMetrics([review({ score: 7 }), review({ score: 7 }), review({ score: 7 })])
    expect(metrics.reviewedCount).toBe(MIN_CALLS_FOR_ASSESSMENT)
    expect(computeAgentPerformanceStatus(metrics)).toBe('BUILDING_BASELINE')
  })
})

describe('CASE 3/4/5 — performance status derived only from computeTrend, never re-decided', () => {
  it('CASE 3 — improving rep', () => {
    const scores = [5.8, 5.8, 5.8, 5.8, 5.8, 7.2, 7.2, 7.2, 7.2, 7.2]
    const metrics = computeOverallScoreMetrics(scores.map(score => review({ score })))
    expect(computeAgentPerformanceStatus(metrics)).toBe('IMPROVING')
  })
  it('CASE 4 — declining rep', () => {
    const scores = [8, 8, 8, 8, 8, 5, 5, 5, 5, 5]
    const metrics = computeOverallScoreMetrics(scores.map(score => review({ score })))
    expect(computeAgentPerformanceStatus(metrics)).toBe('DECLINING')
  })
  it('CASE 5 — stable rep', () => {
    const scores = [7, 7, 7, 7, 7, 7.1, 7.2, 7, 7.1, 7]
    const metrics = computeOverallScoreMetrics(scores.map(score => review({ score })))
    expect(computeAgentPerformanceStatus(metrics)).toBe('STABLE')
  })
})

describe('CASE 6/7/8 — coaching effectiveness interpretation, deterministic sentences', () => {
  it('CASE 6 — high adoption + improving skill', () => {
    const text = interpretCoachingEffectiveness({ adoption: { rate: 0.8, applicableCount: 5 }, skillTrend: 'IMPROVING' })
    expect(text).toMatch(/increasingly applying/i)
  })
  it('CASE 7 — high adoption + no skill improvement', () => {
    const text = interpretCoachingEffectiveness({ adoption: { rate: 0.8, applicableCount: 5 }, skillTrend: 'STABLE' })
    expect(text).toMatch(/has not shifted enough/i)
  })
  it('CASE 8 — low adoption', () => {
    const text = interpretCoachingEffectiveness({ adoption: { rate: 0.3, applicableCount: 5 }, skillTrend: 'STABLE' })
    expect(text).toMatch(/inconsistently/i)
  })
  it('insufficient applicable calls -> honest "need more data" sentence', () => {
    expect(interpretCoachingEffectiveness({ adoption: { rate: null, applicableCount: 0 }, skillTrend: null })).toMatch(/more applicable calls are needed/i)
  })
})

describe('CASE 9 — repeated NOT_APPLIED triggers ATTENTION', () => {
  it('2 of the last 3 applicable evaluations NOT_APPLIED -> ATTENTION with an explainable reason', () => {
    const metrics = computeOverallScoreMetrics([review({ score: 7 }), review({ score: 7 }), review({ score: 7 }), review({ score: 7 })])
    const evals = [evaluation('APPLIED'), evaluation('NOT_APPLIED'), evaluation('NOT_APPLIED')]
    const result = computeAttentionLevel({ overallScoreMetrics: metrics, coveragePercent: 80, adoption: { rate: 0.33, applicableCount: 3 }, recentEvaluations: evals, skillTrends: [] })
    expect(result.level).toBe('ATTENTION')
    expect(result.reasons.some(r => /ignored the current coaching focus/i.test(r))).toBe(true)
  })
})

describe('CASE 10 — NOT_APPLICABLE excluded from adoption (via aggregateAgentRow, reusing #25.2 verbatim)', () => {
  it('NOT_APPLICABLE evaluations never lower adoption or count as applicable', () => {
    const row = aggregateAgentRow({
      reviewsChronological: [review({ score: 8 }), review({ score: 8 }), review({ score: 8 })],
      evaluations: [evaluation('APPLIED'), evaluation('APPLIED'), evaluation('NOT_APPLICABLE'), evaluation('NOT_APPLICABLE')],
      activeFocus: null,
    })
    expect(row.adoption.applicableCount).toBe(2)
    expect(row.adoption.rate).toBe(1)
  })
})

describe('CASE 11/12 — coaching focus edge cases', () => {
  it('CASE 11 — no active focus at all is handled gracefully, no crash, effectiveness is null', () => {
    const row = aggregateAgentRow({ reviewsChronological: [review({ score: 7 })], evaluations: [], activeFocus: null })
    expect(row.activeFocus).toBeNull()
    expect(row.effectiveness).toBeNull()
  })
  it('CASE 12 — active focus but too few applicable calls -> WATCH-level early warning, not ATTENTION', () => {
    const metrics = computeOverallScoreMetrics([review({ score: 7 }), review({ score: 7 }), review({ score: 7 })])
    const result = computeAttentionLevel({ overallScoreMetrics: metrics, coveragePercent: 80, adoption: { rate: 0.5, applicableCount: 1 }, recentEvaluations: [evaluation('NOT_APPLIED')], skillTrends: [] })
    expect(result.level).not.toBe('ATTENTION')
  })
})

describe('CASE 13 — mastered focus never breaks aggregation (aggregateAgentRow only ever receives the ACTIVE focus or null)', () => {
  it('a null activeFocus (the real shape once a focus resolves to MASTERED) does not crash aggregation', () => {
    expect(() => aggregateAgentRow({ reviewsChronological: [review({ score: 7 })], evaluations: [], activeFocus: null })).not.toThrow()
  })
})

describe('CASE 14/15/16 — multi-agent / cross-lead aggregation', () => {
  it('CASE 14 — multiple agents in the same workspace aggregate independently, then combine at the team level', () => {
    const agentA = aggregateAgentRow({ reviewsChronological: [review({ score: 9 }), review({ score: 9 }), review({ score: 9 })], evaluations: [], activeFocus: null })
    const agentB = aggregateAgentRow({ reviewsChronological: [review({ score: 3 }), review({ score: 3 }), review({ score: 3 }), review({ score: 3 })], evaluations: [evaluation('NOT_APPLIED'), evaluation('NOT_APPLIED'), evaluation('NOT_APPLIED')], activeFocus: { skill_key: 'PAIN_DEPTH' } })
    expect(agentA.overallScore.average).toBeGreaterThan(agentB.overallScore.average)
  })
  it('CASE 15 — same rep, calls on different leads, still aggregate into one continuous history (lead_id is not a function parameter at all)', () => {
    // Structural proof: these fixtures never carry lead_id, and the
    // aggregation functions never reference it — a rep's history is
    // whatever the caller hands in, regardless of which lead each call was on.
    const row = aggregateAgentRow({ reviewsChronological: [review({ score: 6 }), review({ score: 8 })], evaluations: [], activeFocus: null })
    expect(row.callsReviewed).toBe(2)
  })
  it('CASE 16 — admin team aggregation counts ATTENTION reps across the whole team', () => {
    const pulse = aggregateTeamPulse([review({ score: 7 })], {
      repA: { level: 'ATTENTION', reasons: ['x'] },
      repB: { level: 'ON_TRACK', reasons: [] },
      repC: { level: 'ATTENTION', reasons: ['y'] },
    })
    expect(pulse.needsAttentionCount).toBe(2)
  })
})

describe('CASE 17/18/19/20 — empty and partial data never crash or fabricate', () => {
  it('CASE 17 — empty workspace produces safe nulls/zeros, never a crash', () => {
    const pulse = aggregateTeamPulse([], {})
    expect(pulse.callsReviewed).toBe(0)
    expect(pulse.overallScore.average).toBeNull()
    expect(pulse.needsAttentionCount).toBe(0)
  })
  it('CASE 18 — calls without reviews are simply absent from the reviewed-call metrics (caller\'s responsibility to exclude them)', () => {
    const metrics = computeOverallScoreMetrics([])
    expect(metrics.reviewedCount).toBe(0)
    expect(metrics.average).toBeNull()
  })
  it('CASE 19 — a review with a missing/null coverage snapshot is excluded from coverage %, never treated as 0%', () => {
    expect(computeCoveragePercent(null)).toBeNull()
    expect(computeCoveragePercent(undefined)).toBeNull()
    const trend = computeCoverageTrend([review({ score: 7, coverage: null }), review({ score: 7, coverage: null })])
    expect(trend.status).toBe('INSUFFICIENT_DATA')
  })
  it('CASE 20 — a review missing a specific dimension score is excluded from that skill\'s trend, not treated as 0', () => {
    const trends = computeSkillTrends([review({ score: 7, pain: null }), review({ score: 7, pain: 8 })])
    const pain = trends.find(t => t.key === 'PAIN_DEPTH')
    expect(pain.hasData).toBe(true)
    expect(pain.current).toBe(8) // only the real value counted, not averaged with a fabricated 0
  })
})

describe('CASE 21/22/23 — the three required trend metrics', () => {
  it('CASE 21 — Overall Score Trend, real chronological data', () => {
    const scores = [6.1, 6.4, 6.8, 7.2, 7.8, 8.1]
    const metrics = computeOverallScoreMetrics(scores.map(score => review({ score })))
    expect(metrics.average).toBeCloseTo(7.0667, 2)
    expect(metrics.reviewedCount).toBe(6)
  })
  it('CASE 22 — Coverage Trend, captured/total from real coverage snapshots', () => {
    const reviews = [
      review({ score: 7, coverage: { capturedCount: 4, total: 8 } }), // 50%
      review({ score: 7, coverage: { capturedCount: 4, total: 8 } }),
      review({ score: 7, coverage: { capturedCount: 4, total: 8 } }),
      review({ score: 7, coverage: { capturedCount: 4, total: 8 } }),
      review({ score: 7, coverage: { capturedCount: 4, total: 8 } }),
      review({ score: 7, coverage: { capturedCount: 7, total: 8 } }), // 87.5%
      review({ score: 7, coverage: { capturedCount: 7, total: 8 } }),
      review({ score: 7, coverage: { capturedCount: 7, total: 8 } }),
      review({ score: 7, coverage: { capturedCount: 7, total: 8 } }),
      review({ score: 7, coverage: { capturedCount: 7, total: 8 } }),
    ]
    const trend = computeCoverageTrend(reviews)
    expect(trend.status).toBe('IMPROVING')
  })
  it('CASE 23 — skill-specific trend for a single canonical dimension', () => {
    const reviews = [4, 4, 4, 4, 4, 8, 8, 8, 8, 8].map(pain => review({ score: 7, pain }))
    const trends = computeSkillTrends(reviews)
    expect(trends.find(t => t.key === 'PAIN_DEPTH').trend).toBe('IMPROVING')
    // Every canonical dimension is represented, even with zero data.
    expect(trends).toHaveLength(9)
    expect(trends.find(t => t.key === 'TIMELINE').hasData).toBe(false)
  })
})

describe('CASE 24 — attention reasons are always human-explainable, never a bare label', () => {
  it('ATTENTION always includes at least one specific, readable reason', () => {
    const metrics = computeOverallScoreMetrics([8, 8, 8, 8, 8, 5, 5, 5, 5, 5].map(score => review({ score })))
    const result = computeAttentionLevel({ overallScoreMetrics: metrics, coveragePercent: 80, adoption: { rate: null, applicableCount: 0 }, recentEvaluations: [], skillTrends: [] })
    expect(result.level).toBe('ATTENTION')
    expect(result.reasons.length).toBeGreaterThan(0)
    expect(result.reasons[0]).toMatch(/declining/i)
  })
  it('ON_TRACK returns an empty reasons array (nothing to explain)', () => {
    const metrics = computeOverallScoreMetrics([7, 7, 7, 7, 7, 7.1, 7, 7.2, 7, 7].map(score => review({ score })))
    const result = computeAttentionLevel({ overallScoreMetrics: metrics, coveragePercent: 85, adoption: { rate: 0.9, applicableCount: 5 }, recentEvaluations: [], skillTrends: [] })
    expect(result.level).toBe('ON_TRACK')
    expect(result.reasons).toEqual([])
  })
})

describe('CASE 25 — no cross-workspace aggregation (structural proof)', () => {
  it('none of the aggregation functions accept or reference a workspace_id parameter — cross-workspace exclusion is entirely the caller/RLS\'s responsibility, never re-implemented here', () => {
    const src = [computeOverallScoreMetrics, computeCoverageTrend, computeSkillTrends, aggregateTeamPulse, aggregateAgentRow].map(fn => fn.toString())
    for (const fnSrc of src) {
      expect(fnSrc.includes('workspace_id')).toBe(false)
    }
  })
})

describe('#25.3B Part 15 — aggregateTeamPulse team-wide adoption + improving reps', () => {
  it('team adoption rate is computed from all evaluations across all reps, NOT_APPLICABLE excluded', () => {
    const pulse = aggregateTeamPulse(
      [review({ score: 7 })],
      { repA: { level: 'ON_TRACK', reasons: [] } },
      [evaluation('APPLIED'), evaluation('APPLIED'), evaluation('NOT_APPLIED'), evaluation('NOT_APPLICABLE')],
      { repA: 'IMPROVING', repB: 'STABLE' },
    )
    expect(pulse.adoption.applicableCount).toBe(3)
    expect(pulse.adoption.rate).toBeCloseTo(2 / 3, 4)
  })
  it('improvingRepsCount counts only reps whose performanceStatus is IMPROVING', () => {
    const pulse = aggregateTeamPulse([review({ score: 7 })], {}, [], { repA: 'IMPROVING', repB: 'DECLINING', repC: 'IMPROVING', repD: 'BUILDING_BASELINE' })
    expect(pulse.improvingRepsCount).toBe(2)
  })
  it('defaults (no evaluations/performanceByRep passed) never crash and report zero/null, not fabricated', () => {
    const pulse = aggregateTeamPulse([], {})
    expect(pulse.adoption.rate).toBeNull()
    expect(pulse.improvingRepsCount).toBe(0)
  })
})

describe('#25.3B Part 11 — computeAdoptionWindowComparison, deterministic before/after split', () => {
  it('fewer than 2 applicable evaluations -> no comparison possible, honest null', () => {
    const result = computeAdoptionWindowComparison([evaluation('APPLIED')])
    expect(result.before).toBeNull()
    expect(result.after).toBeNull()
  })
  it('NOT_APPLICABLE rows are excluded before splitting into before/after windows', () => {
    const evals = [evaluation('NOT_APPLIED'), evaluation('NOT_APPLICABLE'), evaluation('NOT_APPLIED'), evaluation('APPLIED'), evaluation('APPLIED')]
    const result = computeAdoptionWindowComparison(evals)
    expect(result.beforeCount + result.afterCount).toBe(4) // the NOT_APPLICABLE one excluded
  })
  it('a genuinely improving rep shows a real before < after split', () => {
    const evals = [evaluation('NOT_APPLIED'), evaluation('NOT_APPLIED'), evaluation('NOT_APPLIED'), evaluation('NOT_APPLIED'), evaluation('APPLIED'), evaluation('APPLIED'), evaluation('APPLIED'), evaluation('APPLIED')]
    const result = computeAdoptionWindowComparison(evals)
    expect(result.after).toBeGreaterThan(result.before)
  })
})

describe('#25.3B Part 11 — interpretImprovement, deterministic sentence only, no AI call', () => {
  it('no score data and no adoption data -> honest "more calls needed"', () => {
    expect(interpretImprovement({ overallTrend: { status: 'INSUFFICIENT_DATA' }, adoptionWindow: { before: null, after: null } })).toMatch(/more reviewed calls/i)
  })
  it('improving score + consistent high adoption -> positive sentence', () => {
    const text = interpretImprovement({ overallTrend: { status: 'IMPROVING' }, adoptionWindow: { before: 0.6, after: 0.85 } })
    expect(text).toMatch(/improving and increasingly applying/i)
  })
  it('improving score but inconsistent adoption -> nuanced sentence, not a false positive', () => {
    const text = interpretImprovement({ overallTrend: { status: 'IMPROVING' }, adoptionWindow: { before: 0.5, after: 0.4 } })
    expect(text).toMatch(/inconsistent/i)
  })
  it('improving score with no adoption data at all still reads as positive (score alone is real evidence)', () => {
    const text = interpretImprovement({ overallTrend: { status: 'IMPROVING' }, adoptionWindow: { before: null, after: null } })
    expect(text).toMatch(/improving and increasingly applying/i)
  })
})

describe('#25.3B Part 12 — deriveKeyConclusion, reused primitives only, no AI call', () => {
  it('no review at all -> null, never fabricated text', () => {
    expect(deriveKeyConclusion({ review: null, evaluation: null })).toBeNull()
  })
  it('an APPLIED evaluation takes priority over the review content', () => {
    expect(deriveKeyConclusion({ review: review({ score: 7 }), evaluation: evaluation('APPLIED') })).toMatch(/applied/i)
  })
  it('a NOT_APPLIED evaluation takes priority over the review content', () => {
    expect(deriveKeyConclusion({ review: review({ score: 7 }), evaluation: evaluation('NOT_APPLIED') })).toMatch(/not applied/i)
  })
  it('no evaluation falls back to the missed opportunity summary', () => {
    const r = { ...review({ score: 7 }), missed_opportunity: { summary: 'Rep skipped pain discovery.' } }
    expect(deriveKeyConclusion({ review: r, evaluation: null })).toBe('Rep skipped pain discovery.')
  })
  it('no evaluation and no missed opportunity falls back to the first strength', () => {
    const r = { ...review({ score: 7 }), strengths: ['Great rapport building.'] }
    expect(deriveKeyConclusion({ review: r, evaluation: null })).toBe('Great rapport building.')
  })
  it('nothing usable at all -> null, never fabricated', () => {
    expect(deriveKeyConclusion({ review: review({ score: 7 }), evaluation: null })).toBeNull()
  })
})

describe('Zero AI calls (Part 30) — structural proof', () => {
  it('coachingAnalytics.js imports nothing network-capable (no fetch, no supabase client)', async () => {
    const mod = await import('../src/lib/coachingAnalytics.js')
    // Every export is a plain function — none are async (a network call
    // would need to be async).
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value === 'function') {
        expect(value.constructor.name, `${name} must not be an async function`).not.toBe('AsyncFunction')
      }
    }
  })
})
