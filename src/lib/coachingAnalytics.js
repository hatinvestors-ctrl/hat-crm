// src/lib/coachingAnalytics.js
// Capability #25.3 — HAT Coaching Center. Pure, deterministic aggregation
// only — no Supabase I/O, no AI calls (Part 30: zero new AI cost). Every
// function here operates on ALREADY-FETCHED rows from call_sessions/
// call_reviews/coaching_focuses/coaching_focus_evaluations — the exact
// canonical tables #25.1/#25.2 already certified live. Nothing here
// invents a second score model, a second adoption formula, or an AI-
// judged longitudinal metric (Part 2/32's hard rule).
import { COACHING_DIMENSIONS } from './callCoaching.js'
import { computeTrend, computeAdoptionRate, TREND_WINDOW_SIZE } from './coachingMemory.js'

// ── Canonical metric sources (Part 2 — documented, not duplicated) ──────
// Overall Score / Overall Score Trend  <- call_reviews.overall_score, chronological, via computeTrend()
// Coverage / Coverage Trend            <- call_reviews.coverage (the SAME snapshot shown on that call's own
//                                          Call Detail — reviewed calls only, so it lines up 1:1 with Overall
//                                          Score Trend's data set; call_sessions.coverage_snapshot exists for
//                                          UNREVIEWED calls too but is intentionally NOT mixed into this trend)
// Skill trend                          <- call_reviews.dimension_scores[key], chronological, via computeTrend()
// Coaching Adoption                    <- coaching_focus_evaluations.result, via computeAdoptionRate() (#25.2, reused verbatim)
// Mastery / focus continuity           <- coachingMemory.js (#25.2, untouched by this capability)

// ── Overall Score (Part 5) ───────────────────────────────────────────────
export function computeOverallScoreMetrics(reviewsChronological) {
  const scores = reviewsChronological.map(r => r.overall_score).filter(v => v != null)
  if (scores.length === 0) return { average: null, trend: computeTrend([]), reviewedCount: 0 }
  const average = scores.reduce((a, b) => a + b, 0) / scores.length
  return { average, trend: computeTrend(scores), reviewedCount: scores.length }
}

// ── Coverage (Part 6) — captured / total, using the SAME coverage shape
// getCallCoverage() already produces ({ capturedCount, total, dimensions }).
// PARTIAL is deliberately NOT counted as captured — conservative, matches
// how CAPTURED/PARTIAL/MISSING already render distinctly everywhere else
// in the product (never blurred into one "done" bucket). ──────────────
export function computeCoveragePercent(coverage) {
  if (!coverage || !coverage.total) return null
  return Math.round((coverage.capturedCount / coverage.total) * 100)
}

export function computeCoverageTrend(reviewsChronological) {
  const pcts = reviewsChronological.map(r => computeCoveragePercent(r.coverage)).filter(v => v != null)
  return computeTrend(pcts)
}

// ── Skill trends (Part 12/23) — canonical 9 dimensions only ─────────────
export function computeSkillTrends(reviewsChronological) {
  return COACHING_DIMENSIONS.map(dim => {
    const scores = reviewsChronological
      .map(r => r.dimension_scores?.find(s => s.key === dim.key)?.score)
      .filter(v => v != null)
    const trend = computeTrend(scores)
    return {
      key: dim.key,
      label: dim.label,
      current: scores.length ? scores[scores.length - 1] : null,
      recentAvg: trend.recentAvg,
      trend: trend.status,
      hasData: scores.length > 0,
    }
  })
}

// ── Agent Performance Status (Part 27) — distinct from Manager Attention,
// distinct from Call Verdict, distinct from Coaching Focus status. Derived
// ONLY from computeTrend()'s own output — never re-decided here. ────────
export const MIN_CALLS_FOR_ASSESSMENT = 3

export function computeAgentPerformanceStatus(overallScoreMetrics) {
  if (overallScoreMetrics.reviewedCount < MIN_CALLS_FOR_ASSESSMENT) return 'BUILDING_BASELINE'
  if (overallScoreMetrics.trend.status === 'INSUFFICIENT_DATA') return 'BUILDING_BASELINE'
  return overallScoreMetrics.trend.status // IMPROVING | DECLINING | STABLE
}

// ── Manager Attention (Part 7/26) — explicit deterministic rules, every
// threshold documented here (not buried in JSX per Part 26's instruction).
// Reasons are always returned alongside the level — never a bare label. ──
export const ATTENTION_ADOPTION_THRESHOLD = 0.5   // below this, with enough applicable calls, is a real problem
export const ATTENTION_MIN_APPLICABLE = 3          // "enough applicable calls" floor before adoption% is trusted
export const ATTENTION_REPEATED_NOT_APPLIED = 2     // 2+ NOT_APPLIED among the last 3 applicable evaluations
export const WATCH_ADOPTION_THRESHOLD = 0.7         // below this (but above the ATTENTION floor) is an early warning
export const WATCH_COVERAGE_THRESHOLD = 65          // coverage % below this is a real, callable-out gap

export function computeAttentionLevel({ overallScoreMetrics, coveragePercent, adoption, recentEvaluations, skillTrends }) {
  if (overallScoreMetrics.reviewedCount < MIN_CALLS_FOR_ASSESSMENT) {
    return { level: 'BUILDING_BASELINE', reasons: [`Only ${overallScoreMetrics.reviewedCount} reviewed call${overallScoreMetrics.reviewedCount === 1 ? '' : 's'} so far — need at least ${MIN_CALLS_FOR_ASSESSMENT} before a coaching signal is meaningful.`] }
  }

  const reasons = []

  // ATTENTION signals
  if (overallScoreMetrics.trend.status === 'DECLINING') {
    reasons.push(`Overall score declining (${round1(overallScoreMetrics.trend.previousAvg)} → ${round1(overallScoreMetrics.trend.recentAvg)}).`)
  }
  if (adoption.applicableCount >= ATTENTION_MIN_APPLICABLE && adoption.rate != null && adoption.rate < ATTENTION_ADOPTION_THRESHOLD) {
    reasons.push(`Coaching adoption is ${Math.round(adoption.rate * 100)}% across ${adoption.applicableCount} applicable calls.`)
  }
  const applicableRecent = (recentEvaluations || []).filter(e => e.result !== 'NOT_APPLICABLE').slice(-3)
  const notAppliedInRecent = applicableRecent.filter(e => e.result === 'NOT_APPLIED').length
  if (notAppliedInRecent >= ATTENTION_REPEATED_NOT_APPLIED) {
    reasons.push(`Ignored the current coaching focus in ${notAppliedInRecent} of the last ${applicableRecent.length} applicable calls.`)
  }
  if (reasons.length > 0) return { level: 'ATTENTION', reasons }

  // WATCH signals
  const watchReasons = []
  if (coveragePercent != null && coveragePercent < WATCH_COVERAGE_THRESHOLD) {
    const weakest = (skillTrends || []).filter(s => s.hasData).sort((a, b) => (a.current ?? 10) - (b.current ?? 10)).slice(0, 2)
    const names = weakest.map(s => s.label).join(' and ')
    watchReasons.push(names ? `${names} information ${weakest.length > 1 ? 'are' : 'is'} frequently missing (coverage ${coveragePercent}%).` : `Conversation coverage is low (${coveragePercent}%).`)
  }
  if (overallScoreMetrics.trend.status === 'STABLE' && (skillTrends || []).some(s => s.trend === 'DECLINING')) {
    const declining = skillTrends.filter(s => s.trend === 'DECLINING').map(s => s.label).join(', ')
    watchReasons.push(`Score is stable overall, but ${declining} ${skillTrends.filter(s => s.trend === 'DECLINING').length > 1 ? 'are' : 'is'} declining.`)
  }
  if (adoption.applicableCount > 0 && adoption.applicableCount < ATTENTION_MIN_APPLICABLE && adoption.rate != null && adoption.rate < WATCH_ADOPTION_THRESHOLD) {
    watchReasons.push(`Early sign: adoption is ${Math.round(adoption.rate * 100)}% so far, but only ${adoption.applicableCount} applicable call${adoption.applicableCount === 1 ? '' : 's'} — not yet enough to call it a real problem.`)
  }
  if (watchReasons.length > 0) return { level: 'WATCH', reasons: watchReasons }

  return { level: 'ON_TRACK', reasons: [] }
}

function round1(n) { return n == null ? null : Math.round(n * 10) / 10 }

// ── Coaching Effectiveness interpretation (Part 15) — one deterministic
// sentence, never a second AI call. ──────────────────────────────────────
export function interpretCoachingEffectiveness({ adoption, skillTrend }) {
  if (!adoption || adoption.applicableCount === 0) {
    return 'More applicable calls are needed to evaluate coaching effectiveness.'
  }
  const highAdoption = adoption.rate != null && adoption.rate >= 0.7
  const improving = skillTrend === 'IMPROVING'
  const declining = skillTrend === 'DECLINING'
  if (highAdoption && improving) {
    return 'The rep is increasingly applying the current coaching focus and the related skill score is improving.'
  }
  if (highAdoption && !improving && !declining) {
    return 'The rep is applying the current coaching focus consistently; the related skill score has not shifted enough yet to call a trend.'
  }
  if (!highAdoption || declining) {
    return 'Coaching is being applied inconsistently; the related skill has not yet improved.'
  }
  return 'More applicable calls are needed to evaluate coaching effectiveness.'
}

// ── Team Pulse (Part 5/15) — team-wide Score Trend, Coverage Trend, and
// Coaching Adoption in one compact summary, plus Improving Reps / Needs
// Attention counts derived from the SAME per-rep attention/performance
// objects the Agent Table already computes — never a second calculation. ──
export function aggregateTeamPulse(reviewsChronological, attentionByRep, allEvaluations = [], performanceByRep = {}) {
  const overall = computeOverallScoreMetrics(reviewsChronological)
  const coverageTrend = computeCoverageTrend(reviewsChronological)
  const coveragePcts = reviewsChronological.map(r => computeCoveragePercent(r.coverage)).filter(v => v != null)
  const avgCoverage = coveragePcts.length ? Math.round(coveragePcts.reduce((a, b) => a + b, 0) / coveragePcts.length) : null
  const needsAttentionCount = Object.values(attentionByRep || {}).filter(a => a.level === 'ATTENTION').length
  const improvingRepsCount = Object.values(performanceByRep || {}).filter(s => s === 'IMPROVING').length
  // Team-wide adoption — the SAME computeAdoptionRate() every per-rep
  // calculation already uses, just fed the whole workspace's evaluations
  // at once rather than one rep's. Not a new formula.
  const teamAdoption = computeAdoptionRate(allEvaluations)
  return {
    overallScore: overall,
    coverage: { average: avgCoverage, trend: coverageTrend },
    adoption: teamAdoption,
    callsReviewed: reviewsChronological.length,
    needsAttentionCount,
    improvingRepsCount,
  }
}

// ── Improvement Summary (Part 11) — before/after windows for a single
// rep, all from real persisted data, no fabricated deltas when a window
// has no data. ────────────────────────────────────────────────────────────
export function computeAdoptionWindowComparison(evaluationsChronological) {
  const applicable = (evaluationsChronological || []).filter(e => e.result !== 'NOT_APPLICABLE')
  if (applicable.length < 2) return { before: null, after: null, beforeCount: applicable.length, afterCount: 0 }
  const mid = Math.ceil(applicable.length / 2)
  const before = computeAdoptionRate(applicable.slice(0, mid))
  const after = computeAdoptionRate(applicable.slice(mid))
  return { before: before.rate, after: after.rate, beforeCount: before.applicableCount, afterCount: after.applicableCount }
}

export function interpretImprovement({ overallTrend, adoptionWindow }) {
  const hasScoreData = overallTrend && overallTrend.status !== 'INSUFFICIENT_DATA'
  const hasAdoptionData = adoptionWindow && adoptionWindow.before != null && adoptionWindow.after != null
  if (!hasScoreData && !hasAdoptionData) return 'More reviewed calls are needed to assess improvement.'
  const scoreImproving = overallTrend?.status === 'IMPROVING'
  const adoptionImproving = hasAdoptionData && adoptionWindow.after >= adoptionWindow.before
  const adoptionConsistent = hasAdoptionData && adoptionWindow.after >= 0.7
  if (scoreImproving && (!hasAdoptionData || adoptionConsistent)) {
    return 'Rep is improving and increasingly applying the current coaching focus.'
  }
  if (scoreImproving && hasAdoptionData && !adoptionConsistent) {
    return 'Score is improving, but coaching adoption remains inconsistent.'
  }
  if (!hasScoreData) return 'More reviewed calls are needed to assess improvement.'
  return 'More reviewed calls are needed to assess improvement.'
}

// ── Key Conclusion (Part 12) — one deterministic sentence per call, from
// already-persisted review fields only. No new AI call, no free-text
// generation here. ────────────────────────────────────────────────────────
export function deriveKeyConclusion({ review, evaluation }) {
  if (!review) return null
  if (evaluation?.result === 'APPLIED') return 'Previous coaching focus applied.'
  if (evaluation?.result === 'NOT_APPLIED') return 'Previous coaching focus not applied.'
  if (review.missed_opportunity?.summary) return review.missed_opportunity.summary
  if (review.strengths?.[0]) return review.strengths[0]
  return null
}

// ── Per-agent aggregate row (Part 8/9) — one function feeding both the
// Team table and the Agents browse page, never two competing calculations. ──
export function aggregateAgentRow({ reviewsChronological, evaluations, activeFocus }) {
  const overallScoreMetrics = computeOverallScoreMetrics(reviewsChronological)
  const coverageTrend = computeCoverageTrend(reviewsChronological)
  const coveragePcts = reviewsChronological.map(r => computeCoveragePercent(r.coverage)).filter(v => v != null)
  const coveragePercent = coveragePcts.length ? Math.round(coveragePcts[coveragePcts.length - 1]) : null
  const adoption = computeAdoptionRate(evaluations || [])
  const skillTrends = computeSkillTrends(reviewsChronological)
  const focusSkillTrend = activeFocus ? skillTrends.find(s => s.key === activeFocus.skill_key)?.trend : null
  const attention = computeAttentionLevel({
    overallScoreMetrics, coveragePercent, adoption,
    recentEvaluations: evaluations, skillTrends,
  })
  const performanceStatus = computeAgentPerformanceStatus(overallScoreMetrics)
  return {
    callsReviewed: overallScoreMetrics.reviewedCount,
    overallScore: overallScoreMetrics,
    performanceStatus,
    coveragePercent,
    coverageTrend,
    adoption,
    activeFocus: activeFocus || null,
    focusSkillTrend,
    skillTrends,
    attention,
    effectiveness: activeFocus ? interpretCoachingEffectiveness({ adoption, skillTrend: focusSkillTrend }) : null,
  }
}

export { TREND_WINDOW_SIZE }
