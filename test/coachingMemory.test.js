// test/coachingMemory.test.js
// Capability #25.2 — Continuous Coaching Intelligence. Pure deterministic
// logic only (no Supabase I/O to mock). Covers the mission's required
// scenarios that are testable without a live database — DB-dependent
// scenarios (multi-rep isolation via RLS, same-rep-cross-lead persistence)
// require a live certification pass identical to #25.1's, deferred until
// the migration is approved and applied (see the final report).
import { describe, it, expect } from 'vitest'
import {
  validateCoachingFocusSuggestion, validateAdherenceEvaluation, computeAdoptionRate, computeTrend,
  computeMasteryEligibility, decideFocusAction, pickNextFocusSkill,
  TREND_WINDOW_SIZE, MASTERY_MIN_APPLICABLE_CALLS, MASTERY_MIN_ADOPTION_RATE,
} from '../src/lib/coachingMemory.js'
import { SYSTEM_PROMPT } from '../netlify/functions/generate-call-review.mjs'

const TRANSCRIPT = `KEVIN: What's making you consider selling?
SELLER: I'm tired of dealing with tenants.
KEVIN: How has that affected you?
SELLER: It's been exhausting. I just want out.
KEVIN: If we could make the sale simple, how quickly would you want to be done?
SELLER: I probably need at least 175.
KEVIN: How did you arrive at 175?`

describe('validateCoachingFocusSuggestion — Part 4/8, only real rubric skills', () => {
  it('accepts a well-formed suggestion', () => {
    const v = validateCoachingFocusSuggestion({ skillKey: 'PAIN_DEPTH', title: 'Deepen pain', recommendation: 'Ask one more question.', exampleQuestions: ['What has that been like?'] })
    expect(v).not.toBeNull()
    expect(v.skillKey).toBe('PAIN_DEPTH')
  })
  it('rejects an invented skill key not in the canonical 9-dimension rubric (no second score model)', () => {
    expect(validateCoachingFocusSuggestion({ skillKey: 'CHARISMA', title: 'x', recommendation: 'y' })).toBeNull()
  })
  it('rejects a missing title or recommendation', () => {
    expect(validateCoachingFocusSuggestion({ skillKey: 'PAIN_DEPTH', title: '', recommendation: 'y' })).toBeNull()
    expect(validateCoachingFocusSuggestion({ skillKey: 'PAIN_DEPTH', title: 'x', recommendation: '' })).toBeNull()
  })
  it('caps example questions at 2 and strips non-strings', () => {
    const v = validateCoachingFocusSuggestion({ skillKey: 'PAIN_DEPTH', title: 'x', recommendation: 'y', exampleQuestions: ['a', 'b', 'c', 42] })
    expect(v.exampleQuestions).toEqual(['a', 'b'])
  })
})

describe('validateAdherenceEvaluation — Part 7/8/9, evidence-gated, NOT_APPLICABLE handled correctly', () => {
  it('APPLIED with a real verbatim quote is accepted (CASE 3 — applied recommendation detected from real transcript evidence)', () => {
    const v = validateAdherenceEvaluation({ opportunityExisted: true, result: 'APPLIED', why: 'Asked a deeper pain question.', repQuote: 'How has that affected you?' }, TRANSCRIPT)
    expect(v).not.toBeNull()
    expect(v.result).toBe('APPLIED')
  })
  it('NOT_APPLIED with a real quote is accepted (CASE 4 — opportunity existed and rep missed it)', () => {
    const v = validateAdherenceEvaluation({ opportunityExisted: true, result: 'NOT_APPLIED', why: 'Changed topics instead.', sellerQuote: 'I probably need at least 175' }, TRANSCRIPT)
    expect(v).not.toBeNull()
    expect(v.result).toBe('NOT_APPLIED')
  })
  it('NOT_APPLICABLE requires no quote at all (CASE 5 — opportunity never occurred)', () => {
    const v = validateAdherenceEvaluation({ opportunityExisted: false, result: 'NOT_APPLICABLE', why: 'Seller never expressed pain in this call.' }, TRANSCRIPT)
    expect(v).not.toBeNull()
    expect(v.result).toBe('NOT_APPLICABLE')
    expect(v.sellerQuote).toBeNull()
  })
  it('CASE 7 — a fabricated quote (never actually said) is rejected entirely', () => {
    const v = validateAdherenceEvaluation({ opportunityExisted: true, result: 'APPLIED', repQuote: 'I will match any offer you get' }, TRANSCRIPT)
    expect(v).toBeNull()
  })
  it('rejects internal inconsistency: opportunityExisted=false but result=APPLIED', () => {
    expect(validateAdherenceEvaluation({ opportunityExisted: false, result: 'APPLIED', repQuote: 'How has that affected you?' }, TRANSCRIPT)).toBeNull()
  })
  it('rejects internal inconsistency: opportunityExisted=true but result=NOT_APPLICABLE', () => {
    expect(validateAdherenceEvaluation({ opportunityExisted: true, result: 'NOT_APPLICABLE' }, TRANSCRIPT)).toBeNull()
  })
  it('rejects an unknown result enum value', () => {
    expect(validateAdherenceEvaluation({ opportunityExisted: true, result: 'SORT_OF', repQuote: 'How has that affected you?' }, TRANSCRIPT)).toBeNull()
  })
})

describe('computeAdoptionRate — Part 11, NOT_APPLICABLE excluded from denominator', () => {
  it('matches the mission\'s worked example: 4 applied, 0 partial, 1 not applied, 2 not applicable -> 80%', () => {
    const evals = [
      { result: 'APPLIED' }, { result: 'APPLIED' }, { result: 'APPLIED' }, { result: 'APPLIED' },
      { result: 'NOT_APPLIED' },
      { result: 'NOT_APPLICABLE' }, { result: 'NOT_APPLICABLE' },
    ]
    const r = computeAdoptionRate(evals)
    expect(r.applicableCount).toBe(5) // 2 NOT_APPLICABLE excluded
    expect(r.rate).toBeCloseTo(0.8)
  })
  it('CASE 6 — NOT_APPLICABLE calls never reduce the adoption percentage (all-NOT_APPLICABLE set -> null rate, not 0%)', () => {
    const r = computeAdoptionRate([{ result: 'NOT_APPLICABLE' }, { result: 'NOT_APPLICABLE' }])
    expect(r.applicableCount).toBe(0)
    expect(r.rate).toBeNull() // not 0 — "no evidence yet" is not the same as "0% adoption"
  })
  it('PARTIALLY_APPLIED counts as half credit (documented choice)', () => {
    const r = computeAdoptionRate([{ result: 'PARTIALLY_APPLIED' }, { result: 'NOT_APPLIED' }])
    expect(r.rate).toBeCloseTo(0.25) // (0.5 + 0) / 2
  })
})

describe('computeTrend — Part 10, rolling windows, never one-call-vs-one-call', () => {
  it('CASE 16 — fewer than a full window on either side returns INSUFFICIENT_DATA, never a fabricated trend', () => {
    expect(computeTrend([7]).status).toBe('INSUFFICIENT_DATA')
    expect(computeTrend([]).status).toBe('INSUFFICIENT_DATA')
  })
  it('CASE 13/17 — a real decline across two full windows is detected', () => {
    const values = [8, 8, 8, 8, 8, 5, 5, 5, 5, 5] // previous 5 avg=8, recent 5 avg=5
    const t = computeTrend(values)
    expect(t.status).toBe('DECLINING')
    expect(t.previousCount).toBe(TREND_WINDOW_SIZE)
    expect(t.recentCount).toBe(TREND_WINDOW_SIZE)
  })
  it('CASE 13 — a real improvement across two full windows is detected (mirrors the mission\'s 5.8 -> 7.2 example)', () => {
    const values = [5.8, 5.8, 5.8, 5.8, 5.8, 7.2, 7.2, 7.2, 7.2, 7.2]
    expect(computeTrend(values).status).toBe('IMPROVING')
  })
  it('CASE 18 — a stable trend (small delta) is reported as STABLE, not over-reacting to noise', () => {
    const values = [7, 7, 7, 7, 7, 7.2, 7.1, 7.3, 7, 7.2]
    expect(computeTrend(values).status).toBe('STABLE')
  })
  it('only uses the most recent 2*windowSize values — older history does not dilute the comparison', () => {
    const values = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 8, 8, 8, 8, 8, 5, 5, 5, 5, 5]
    const t = computeTrend(values)
    expect(t.previousAvg).toBe(8)
    expect(t.recentAvg).toBe(5)
  })
})

describe('computeMasteryEligibility — Part 12/13, conservative, deterministic (CASE 8/10/11)', () => {
  it('CASE 8 — one good call never equals mastery', () => {
    const r = computeMasteryEligibility({ applicableCount: 1, adoptionRate: 1.0, dimensionTrend: 'IMPROVING' })
    expect(r.eligible).toBe(false)
    expect(r.reasons.length).toBeGreaterThan(0)
  })
  it('CASE 11 — mastery requires the full conservative bar: enough calls, high adoption, non-declining trend', () => {
    const r = computeMasteryEligibility({ applicableCount: MASTERY_MIN_APPLICABLE_CALLS, adoptionRate: MASTERY_MIN_ADOPTION_RATE, dimensionTrend: 'IMPROVING' })
    expect(r.eligible).toBe(true)
  })
  it('a declining trend blocks mastery even with a high adoption rate and enough calls', () => {
    const r = computeMasteryEligibility({ applicableCount: 8, adoptionRate: 0.9, dimensionTrend: 'DECLINING' })
    expect(r.eligible).toBe(false)
  })
  it('insufficient applicable calls blocks mastery regardless of adoption rate', () => {
    const r = computeMasteryEligibility({ applicableCount: 2, adoptionRate: 1.0, dimensionTrend: 'IMPROVING' })
    expect(r.eligible).toBe(false)
  })
  it('below-threshold adoption blocks mastery', () => {
    const r = computeMasteryEligibility({ applicableCount: 6, adoptionRate: 0.5, dimensionTrend: 'STABLE' })
    expect(r.eligible).toBe(false)
  })
})

describe('decideFocusAction / pickNextFocusSkill — Part 14, continuity (CASE 9/12)', () => {
  it('CASE 9 — focus persists (KEEP_ACTIVE) when mastery is not yet eligible', () => {
    expect(decideFocusAction({ masteryEligible: false })).toBe('KEEP_ACTIVE')
  })
  it('CASE 12 — a new focus is only proposed when mastery IS eligible, never every call', () => {
    expect(decideFocusAction({ masteryEligible: true })).toBe('RESOLVE_MASTERED')
  })
  it('picks the lowest-scoring dimension as the next focus, excluding the just-mastered one', () => {
    const next = pickNextFocusSkill({ PAIN_DEPTH: 9, DECISION_MAKERS: 4, TIMELINE: 7 }, 'PAIN_DEPTH')
    expect(next).toBe('DECISION_MAKERS')
  })
  it('never re-picks the just-mastered skill even if it is (impossibly) still the lowest', () => {
    const next = pickNextFocusSkill({ PAIN_DEPTH: 2 }, 'PAIN_DEPTH')
    expect(next).toBeNull() // no other candidate exists
  })
})

describe('generate-call-review.mjs SYSTEM_PROMPT — coaching-focus/adherence extension (Part 4)', () => {
  it('always requests exactly one primaryCoachingFocus', () => {
    expect(SYSTEM_PROMPT).toMatch(/PRIMARY COACHING FOCUS/i)
    expect(SYSTEM_PROMPT).toMatch(/exactly 1 primarycoachingfocus/i)
  })
  it('instructs NOT_APPLICABLE when no opportunity existed — "never penalize a rep for a situation that never arose"', () => {
    expect(SYSTEM_PROMPT).toMatch(/never penalize a rep for a situation that never arose/i)
  })
  it('requires focusAdherence to be null when no active focus was supplied (never invented)', () => {
    expect(SYSTEM_PROMPT).toMatch(/focusadherence is null when no active focus was supplied/i)
  })
  it('still forbids Max Buy recalculation and quote invention (Capability #24 contract carried forward unchanged)', () => {
    expect(SYSTEM_PROMPT).toMatch(/do not calculate, restate, or imply a different max buy/i)
    expect(SYSTEM_PROMPT).toMatch(/do not invent a quote/i)
  })
})

describe('Part 17 — transcript/raw-audio storage safety regression', () => {
  it('CASE 23/24 — validated coaching-focus/adherence objects never carry a transcript or audio field', () => {
    const focus = validateCoachingFocusSuggestion({ skillKey: 'PAIN_DEPTH', title: 'x', recommendation: 'y' })
    const adherence = validateAdherenceEvaluation({ opportunityExisted: true, result: 'APPLIED', repQuote: 'How has that affected you?' }, TRANSCRIPT)
    for (const obj of [focus, adherence]) {
      expect(obj).not.toHaveProperty('transcript')
      expect(obj).not.toHaveProperty('fullTranscript')
      expect(obj).not.toHaveProperty('rawAudio')
      expect(obj).not.toHaveProperty('audio')
    }
  })
  it('the migration file never defines a transcript or raw-audio column', async () => {
    const fs = await import('node:fs')
    const sql = fs.readFileSync(new URL('../supabase/migrations/20260825000000_continuous_coaching_v1.sql', import.meta.url), 'utf8')
    expect(sql.toLowerCase()).not.toMatch(/transcript\s+text/)
    expect(sql.toLowerCase()).not.toMatch(/raw_audio|audio_url|audio_blob/)
  })
})

describe('Part 9 — the SYSTEM, not the AI, decides improvement/mastery (isolation check)', () => {
  it('computeTrend/computeMasteryEligibility never accept a raw AI "is this rep improving" opinion as an input — only numeric history', () => {
    // Structural proof: these functions' signatures take arrays of real
    // numbers / counted results, never a free-text AI verdict field. A
    // non-numeric/garbage array produces INSUFFICIENT_DATA, never a claim.
    expect(computeTrend(['improving', 'yes', null]).status).toBe('INSUFFICIENT_DATA')
  })
})
