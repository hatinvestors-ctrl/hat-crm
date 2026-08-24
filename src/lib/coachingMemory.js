// src/lib/coachingMemory.js
// Capability #25.2 — Continuous Coaching Intelligence. Pure, deterministic
// functions only — no Supabase I/O, no LLM calls. This is the "SYSTEM
// determines longitudinal improvement from persisted historical data"
// half of the mission's hard rule (Part 9): the AI may analyze ONE call
// and suggest a focus/evaluate adherence for ONE call, but trend/adoption/
// mastery are always computed here from real historical rows, never asked
// of the model directly.
import { COACHING_DIMENSIONS, quoteAppearsInTranscript } from './callCoaching.js'

const VALID_SKILL_KEYS = new Set(COACHING_DIMENSIONS.map(d => d.key))
const ADHERENCE_RESULTS = new Set(['APPLIED', 'PARTIALLY_APPLIED', 'NOT_APPLIED', 'NOT_APPLICABLE'])

// ── AI output validation (Part 4/8) — never persist a raw model claim ──

// A coaching-focus suggestion from generate-call-review.mjs. Rejected
// (returns null) unless skill_key is a REAL rubric dimension — no second,
// invented skill taxonomy.
export function validateCoachingFocusSuggestion(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (!VALID_SKILL_KEYS.has(raw.skillKey)) return null
  if (typeof raw.title !== 'string' || !raw.title.trim()) return null
  if (typeof raw.recommendation !== 'string' || !raw.recommendation.trim()) return null
  return {
    skillKey: raw.skillKey,
    title: raw.title.trim().slice(0, 200),
    recommendation: raw.recommendation.trim().slice(0, 500),
    exampleQuestions: Array.isArray(raw.exampleQuestions) ? raw.exampleQuestions.filter(q => typeof q === 'string').slice(0, 2) : [],
  }
}

// An adherence determination for ONE call against the rep's then-active
// focus. Evidence-gated (Part 8/9): APPLIED/PARTIALLY_APPLIED/NOT_APPLIED
// all require at least one quote that genuinely appears in the real
// transcript — a claim with no verifiable evidence is dropped entirely
// (returns null) rather than persisted as an unfounded judgment.
// NOT_APPLICABLE never requires a quote (Part 7: "the opportunity never
// occurred" has no seller statement to point to).
export function validateAdherenceEvaluation(raw, transcriptText) {
  if (!raw || typeof raw !== 'object') return null
  if (!ADHERENCE_RESULTS.has(raw.result)) return null
  const opportunityExisted = raw.opportunityExisted === true
  // Internal consistency: the model can't claim no opportunity existed
  // AND a result other than NOT_APPLICABLE — deterministic guard, not
  // trusted from the model's own field alone.
  if (!opportunityExisted && raw.result !== 'NOT_APPLICABLE') return null
  if (opportunityExisted && raw.result === 'NOT_APPLICABLE') return null

  if (raw.result === 'NOT_APPLICABLE') {
    return { opportunityExisted: false, result: 'NOT_APPLICABLE', why: typeof raw.why === 'string' ? raw.why.slice(0, 300) : null, sellerQuote: null, repQuote: null }
  }

  const sellerOk = raw.sellerQuote && quoteAppearsInTranscript(raw.sellerQuote, transcriptText)
  const repOk = raw.repQuote && quoteAppearsInTranscript(raw.repQuote, transcriptText)
  if (!sellerOk && !repOk) return null // no verifiable evidence at all — reject

  return {
    opportunityExisted: true,
    result: raw.result,
    why: typeof raw.why === 'string' ? raw.why.slice(0, 300) : null,
    sellerQuote: sellerOk ? raw.sellerQuote : null,
    repQuote: repOk ? raw.repQuote : null,
  }
}

// ── Adoption (Part 11) — NOT_APPLICABLE excluded from the denominator ──
// PARTIALLY_APPLIED counts as half credit (documented choice — the
// mission's own example never disambiguates full vs. half weight for a
// partial, since it used zero PARTIALLY_APPLIED calls; half credit is the
// most defensible default and is documented here, not silently assumed
// downstream).
export function computeAdoptionRate(evaluations) {
  const applicable = evaluations.filter(e => e.result !== 'NOT_APPLICABLE')
  if (applicable.length === 0) return { rate: null, applicableCount: 0, appliedCount: 0, partialCount: 0, notAppliedCount: 0 }
  const appliedCount = applicable.filter(e => e.result === 'APPLIED').length
  const partialCount = applicable.filter(e => e.result === 'PARTIALLY_APPLIED').length
  const notAppliedCount = applicable.filter(e => e.result === 'NOT_APPLIED').length
  const rate = (appliedCount + 0.5 * partialCount) / applicable.length
  return { rate, applicableCount: applicable.length, appliedCount, partialCount, notAppliedCount }
}

// ── Rolling trend (Part 10) — recent-N vs. previous-N, never one-call-
// vs-one-call. `values` is ordered OLDEST-FIRST (chronological). ──
export const TREND_WINDOW_SIZE = 5
export const TREND_IMPROVE_THRESHOLD = 0.5 // delta on the same 0-10 scale as dimension scores
export const TREND_DECLINE_THRESHOLD = -0.5

export function computeTrend(values, { windowSize = TREND_WINDOW_SIZE } = {}) {
  const clean = (values || []).filter(v => v != null && Number.isFinite(v))
  const recent = clean.slice(-windowSize)
  const previous = clean.slice(-2 * windowSize, -windowSize)
  if (recent.length === 0 || previous.length === 0) {
    return { status: 'INSUFFICIENT_DATA', recentAvg: recent.length ? avg(recent) : null, previousAvg: null, delta: null, recentCount: recent.length, previousCount: previous.length }
  }
  const recentAvg = avg(recent)
  const previousAvg = avg(previous)
  const delta = recentAvg - previousAvg
  const status = delta >= TREND_IMPROVE_THRESHOLD ? 'IMPROVING' : delta <= TREND_DECLINE_THRESHOLD ? 'DECLINING' : 'STABLE'
  return { status, recentAvg, previousAvg, delta, recentCount: recent.length, previousCount: previous.length }
}

function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length }

// ── Mastery eligibility (Part 12/13) — conservative, deterministic, never
// AI-decided. All three conditions required; falling short of ANY one
// means "keep coaching it," never a premature promotion. ──
export const MASTERY_MIN_APPLICABLE_CALLS = 5
export const MASTERY_MIN_ADOPTION_RATE = 0.8

export function computeMasteryEligibility({ applicableCount, adoptionRate, dimensionTrend }) {
  const reasons = []
  if (applicableCount < MASTERY_MIN_APPLICABLE_CALLS) reasons.push(`fewer than ${MASTERY_MIN_APPLICABLE_CALLS} applicable calls (${applicableCount})`)
  if (adoptionRate == null || adoptionRate < MASTERY_MIN_ADOPTION_RATE) reasons.push(`adoption rate below ${Math.round(MASTERY_MIN_ADOPTION_RATE * 100)}%`)
  if (dimensionTrend === 'DECLINING') reasons.push('dimension trend is declining')
  return { eligible: reasons.length === 0, reasons }
}

// ── Focus continuity (Part 14) — a new focus is proposed ONLY when the
// current one is genuinely resolved. Never generate a fresh focus after
// every call just because the AI suggested one. ──
export function decideFocusAction({ masteryEligible }) {
  return masteryEligible ? 'RESOLVE_MASTERED' : 'KEEP_ACTIVE'
}

// Deterministic next-skill picker (Part 14) — the lowest average
// dimension score across the recent window, excluding whatever skill was
// just resolved. The AI may phrase the new focus's recommendation text,
// but never chooses WHICH skill becomes the new focus.
export function pickNextFocusSkill(dimensionAverages, excludeSkillKey) {
  const candidates = Object.entries(dimensionAverages || {}).filter(([key]) => key !== excludeSkillKey)
  if (candidates.length === 0) return null
  candidates.sort((a, b) => a[1] - b[1])
  return candidates[0][0]
}
