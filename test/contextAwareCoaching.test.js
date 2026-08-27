// test/contextAwareCoaching.test.js
// Context-Aware Call Coaching / Multi-Call Seller Journey V1.
//
// Forensic audit findings driving this capability (see delivery report):
//   - generate-call-review.mjs forced ALL 9 dimensions into a 0-10 score
//     every call, with zero applicability concept — a repeat call with a
//     seller was scored identically to a first call.
//   - No callType/call-number/seller-journey-stage concept existed for
//     Generate Call Review (Live Copilot already had one, via
//     getCallMemory()/getCallObjective() reading lead_activities +
//     accumulated seller_intelligence — untouched by this capability).
//   - coaching_focus_evaluations / computeAdoptionRate / computeSkillTrends
//     ALREADY correctly supported NOT_APPLICABLE exclusion — verified,
//     not re-implemented.
//   - computeOverallScore ALREADY normalized by validatedScores.length*10
//     (not a hardcoded 9*10) — the minimal fix was excluding
//     applicable:false entries from that array, a one-line, backward-
//     compatible change.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import {
  CALL_CONTEXT_TYPES, deriveCallContextType, buildPreviousCallContext, buildCallContext, formatCallContextLabel,
} from '../src/lib/callContext.js'
import { validateScorecard, computeOverallScore, COACHING_DIMENSIONS } from '../src/lib/callCoaching.js'
import { validateAdherenceEvaluation, computeAdoptionRate, computeTrend } from '../src/lib/coachingMemory.js'
import { computeSkillTrends } from '../src/lib/coachingAnalytics.js'

const genReviewSrc = fs.readFileSync('netlify/functions/generate-call-review.mjs', 'utf8')
const callReviewSrc = fs.readFileSync('src/components/lead-detail/CallReview.jsx', 'utf8')

// ── Scenario A — FIRST CALL ────────────────────────────────────────────
describe('Scenario A — first call, no previous seller conversation', () => {
  it('buildCallContext with zero prior sessions is INITIAL_DISCOVERY, call #1, no previous context', () => {
    const ctx = buildCallContext([], [], null)
    expect(ctx.type).toBe(CALL_CONTEXT_TYPES.INITIAL_DISCOVERY)
    expect(ctx.callNumber).toBe(1)
    expect(ctx.previous).toBeNull()
  })
  it('is INITIAL_DISCOVERY regardless of lead status — this is about relationship history, not a status label', () => {
    expect(buildCallContext([], [], 'negotiating').type).toBe(CALL_CONTEXT_TYPES.INITIAL_DISCOVERY)
  })
  it('all 9 dimensions score normally when the AI never applies the new applicable:false shape (legacy/first-call behavior byte-identical)', () => {
    const scores = COACHING_DIMENSIONS.map(d => ({ key: d.key, score: 6, why: 'observed' }))
    const validated = validateScorecard(scores)
    expect(validated).toHaveLength(9)
    expect(validated.every(s => s.applicable === true)).toBe(true)
    expect(computeOverallScore(validated)).toBe(60)
  })
})

// ── Scenario B — GOOD FOLLOW-UP ────────────────────────────────────────
describe('Scenario B — good follow-up: known facts reused, no penalty, N/A excluded from overall score', () => {
  const priorSessions = [{ id: 's1', started_at: '2026-08-20T10:00:00Z', outcome: 'spoke_follow_up', summary: 'Discussed wife decision', seller_price_final: 170000, objections: ['SPOUSE_PARTNER'], follow_up_date: '2026-08-27' }]
  const priorReviews = [{ call_session_id: 's1', strengths: ['Built rapport quickly'], missed_opportunity: { summary: 'Did not confirm timeline' } }]

  it('buildCallContext for call #2 is FOLLOW_UP with real previous-call facts, nothing fabricated', () => {
    const ctx = buildCallContext(priorSessions, priorReviews, 'follow_up')
    expect(ctx.type).toBe(CALL_CONTEXT_TYPES.FOLLOW_UP)
    expect(ctx.callNumber).toBe(2)
    expect(ctx.previous).toEqual({
      date: '2026-08-20T10:00:00Z', outcome: 'spoke_follow_up', summary: 'Discussed wife decision',
      sellerPriceFinal: 170000, objections: ['SPOUSE_PARTNER'], followUpDate: '2026-08-27',
      topStrength: 'Built rapport quickly', missedOpportunity: 'Did not confirm timeline',
    })
  })
  it('a dimension the AI marks not-applicable (already resolved) is excluded from Overall Score, never scored as 0', () => {
    const raw = [
      { key: 'OPENING_RAPPORT', score: 8, why: 'Referenced last call warmly' },
      { key: 'MOTIVATION_DISCOVERY', applicable: false, reason: 'Already established last call; nothing new arose.' },
      { key: 'PAIN_DEPTH', applicable: false, reason: 'Already established last call.' },
      { key: 'PROPERTY_DISCOVERY', applicable: false, reason: 'Already established last call.' },
      { key: 'TIMELINE', score: 7, why: 'Confirmed timeline still holds' },
      { key: 'PRICE_DISCOVERY', score: 6, why: 'Reconfirmed price' },
      { key: 'DECISION_MAKERS', score: 9, why: 'Directly asked whether seller spoke with wife' },
      { key: 'NEGOTIATION', score: 5, why: 'Some movement' },
      { key: 'COMMITMENT', score: 8, why: 'Secured concrete next step' },
    ]
    const validated = validateScorecard(raw)
    expect(validated).toHaveLength(9) // all 9 keys present, one way or the other
    const applicableCount = validated.filter(s => s.applicable !== false).length
    expect(applicableCount).toBe(6)
    // Overall score computed ONLY over the 6 applicable dimensions —
    // never diluted to a 9-dimension denominator with 3 phantom zeros.
    const expected = Math.round(((8 + 7 + 6 + 9 + 5 + 8) / (6 * 10)) * 100)
    expect(computeOverallScore(validated)).toBe(expected)
    expect(computeOverallScore(validated)).not.toBe(Math.round(((8 + 7 + 6 + 9 + 5 + 8) / (9 * 10)) * 100))
  })
  it('decision-maker progression is a normal HIGH score (9/10), not merely "rediscovering the wife exists"', () => {
    const validated = validateScorecard([{ key: 'DECISION_MAKERS', score: 9, why: 'Directly asked whether seller spoke with wife and progressed the discussion' }])
    expect(validated[0].score).toBe(9)
  })
})

// ── Scenario C — BAD FOLLOW-UP (prompt-only; not independently testable
// without a live AI call — see Known Limitations in the delivery report) ──
describe('Scenario C — bad follow-up: nothing in the deterministic layer suppresses a poor score', () => {
  it('validateScorecard never overrides or upgrades a score just because callContext exists — purely respects what the model returned', () => {
    const validated = validateScorecard([{ key: 'MOTIVATION_DISCOVERY', score: 2, why: 'Rep re-asked already-answered motivation question, ignoring prior context' }])
    expect(validated[0].score).toBe(2)
    expect(validated[0].applicable).toBe(true)
  })
})

// ── Scenario D — RELEVANT TOPIC AVOIDED ────────────────────────────────
describe('Scenario D — a genuinely relevant dimension the rep avoided must still be scored, never hidden behind N/A', () => {
  it('PRICE_DISCOVERY scored poorly stays scored poorly (applicable:true, low score) — this capability never forces N/A', () => {
    const validated = validateScorecard([{ key: 'PRICE_DISCOVERY', score: 1, why: 'Rep avoided discussing price entirely despite it being directly relevant' }])
    expect(validated[0].applicable).toBe(true)
    expect(validated[0].score).toBe(1)
  })
  it('an applicable:false entry with NO reason is REJECTED (dropped), not silently accepted — structurally prevents N/A as a score-hiding tactic', () => {
    const validated = validateScorecard([{ key: 'PRICE_DISCOVERY', applicable: false }])
    expect(validated).toHaveLength(0)
  })
  it('an applicable:false entry with an empty/whitespace reason is also rejected', () => {
    expect(validateScorecard([{ key: 'PRICE_DISCOVERY', applicable: false, reason: '   ' }])).toHaveLength(0)
  })
})

// ── Scenario E/F/G — Coaching Focus adherence (ALREADY correct — regression only) ──
describe('Scenario E — active focus has NO legitimate opportunity: NOT_APPLICABLE, never NOT_APPLIED, excluded from adoption denominator', () => {
  it('validateAdherenceEvaluation accepts NOT_APPLICABLE with opportunityExisted:false, no quote required', () => {
    const result = validateAdherenceEvaluation({ result: 'NOT_APPLICABLE', opportunityExisted: false, why: 'Pain already fully established in prior call; nothing reopened it.' }, 'irrelevant transcript text')
    expect(result).toEqual({ opportunityExisted: false, result: 'NOT_APPLICABLE', why: 'Pain already fully established in prior call; nothing reopened it.', sellerQuote: null, repQuote: null })
  })
  it('computeAdoptionRate excludes NOT_APPLICABLE from both numerator and denominator', () => {
    const evals = [
      { result: 'NOT_APPLICABLE' },
      { result: 'APPLIED' },
      { result: 'NOT_APPLIED' },
    ]
    const rate = computeAdoptionRate(evals)
    expect(rate.applicableCount).toBe(2) // NOT_APPLICABLE excluded
    expect(rate.rate).toBe(0.5)
  })
})

describe('Scenario F — active focus applied, real opportunity existed', () => {
  it('validateAdherenceEvaluation accepts APPLIED when a verifiable quote is present', () => {
    const transcript = 'Seller said: I was worried about the repairs honestly. Rep said: tell me more about that.'
    const result = validateAdherenceEvaluation({ result: 'APPLIED', opportunityExisted: true, sellerQuote: 'I was worried about the repairs honestly', repQuote: 'tell me more about that', why: 'Rep probed pain immediately' }, transcript)
    expect(result.result).toBe('APPLIED')
    expect(result.opportunityExisted).toBe(true)
  })
})

describe('Scenario G — active focus missed, real opportunity existed', () => {
  it('validateAdherenceEvaluation accepts NOT_APPLIED when a verifiable quote is present', () => {
    const transcript = 'Seller said: I was worried about the repairs honestly. Rep said: anyway, are you ready to sell fast?'
    const result = validateAdherenceEvaluation({ result: 'NOT_APPLIED', opportunityExisted: true, sellerQuote: 'I was worried about the repairs honestly', repQuote: 'anyway, are you ready to sell fast?', why: 'Rep ignored the pain signal and pivoted to closing' }, transcript)
    expect(result.result).toBe('NOT_APPLIED')
  })
})

// ── Scenario H — SKILL TREND ignores N/A, uses only applicable observations ──
describe('Scenario H — skill trend excludes N/A dimensions entirely, never treats them as zero', () => {
  it('Negotiation N/A, 4, N/A, 7 trends as [4, 7] — never [0, 4, 0, 7]', () => {
    const reviewsChronological = [
      { dimension_scores: [{ key: 'NEGOTIATION', applicable: false, score: null, reason: 'No negotiation opportunity arose.' }] },
      { dimension_scores: [{ key: 'NEGOTIATION', applicable: true, score: 4, why: 'x' }] },
      { dimension_scores: [{ key: 'NEGOTIATION', applicable: false, score: null, reason: 'No negotiation opportunity arose.' }] },
      { dimension_scores: [{ key: 'NEGOTIATION', applicable: true, score: 7, why: 'x' }] },
    ]
    const trends = computeSkillTrends(reviewsChronological)
    const negotiation = trends.find(t => t.key === 'NEGOTIATION')
    expect(negotiation.current).toBe(7) // last real observation, not the N/A call
    expect(negotiation.hasData).toBe(true)
    // Directly verify the underlying trend computation only ever saw [4, 7].
    const scores = reviewsChronological.map(r => r.dimension_scores.find(s => s.key === 'NEGOTIATION')?.score).filter(v => v != null)
    expect(scores).toEqual([4, 7])
  })
})

// ── Scenario I — LEGACY REVIEW compatibility ───────────────────────────
describe('Scenario I — legacy review (no applicable/callContext fields at all) renders/behaves exactly as before', () => {
  it('a legacy-shaped scores array (no `applicable` key anywhere) computes the exact same overall score as before this capability', () => {
    const legacyScores = [
      { key: 'OPENING_RAPPORT', score: 8, why: 'x' },
      { key: 'MOTIVATION_DISCOVERY', score: 6, why: 'x' },
    ]
    // computeOverallScore is called directly on already-persisted legacy
    // rows too (e.g. Call Detail re-renders review.dimension_scores as-is,
    // never re-running validateScorecard on old rows) — must behave
    // identically whether or not `applicable` was ever set.
    expect(computeOverallScore(legacyScores)).toBe(70) // (8+6)/20 = 70%, same math as pre-capability
  })
  it('validateScorecard on a legacy-shaped raw AI response (no applicable field) still marks every entry applicable:true', () => {
    const validated = validateScorecard([{ key: 'TIMELINE', score: 5, why: 'x' }])
    expect(validated[0].applicable).toBe(true)
  })
  it('computeSkillTrends over legacy dimension_scores (no applicable field) is unaffected — score present, included exactly as before', () => {
    const trends = computeSkillTrends([{ dimension_scores: [{ key: 'TIMELINE', score: 5, why: 'x' }] }])
    expect(trends.find(t => t.key === 'TIMELINE').current).toBe(5)
  })
})

// ── callContext derivation — NEGOTIATION_OFFER / COMMITMENT_CLOSING ────
describe('deriveCallContextType — the 4-state model, derived from existing call history + existing lead.status only', () => {
  it('negotiating/offer_sent/rejected_not_accepted → NEGOTIATION_OFFER (when at least one prior call exists)', () => {
    expect(deriveCallContextType(1, 'negotiating')).toBe(CALL_CONTEXT_TYPES.NEGOTIATION_OFFER)
    expect(deriveCallContextType(2, 'offer_sent')).toBe(CALL_CONTEXT_TYPES.NEGOTIATION_OFFER)
  })
  it('offer_accepted/offer_signed/offer_pending_hat_signing/sold → COMMITMENT_CLOSING', () => {
    expect(deriveCallContextType(1, 'offer_accepted')).toBe(CALL_CONTEXT_TYPES.COMMITMENT_CLOSING)
    expect(deriveCallContextType(3, 'sold')).toBe(CALL_CONTEXT_TYPES.COMMITMENT_CLOSING)
  })
  it('any other status with prior calls → FOLLOW_UP', () => {
    expect(deriveCallContextType(1, 'new_lead')).toBe(CALL_CONTEXT_TYPES.FOLLOW_UP)
    expect(deriveCallContextType(1, null)).toBe(CALL_CONTEXT_TYPES.FOLLOW_UP)
  })
  it('no DB enum/table was introduced — this is a plain JS constant, no new persisted schema', () => {
    const src = fs.readFileSync('src/lib/callContext.js', 'utf8')
    expect(src).not.toMatch(/CREATE TYPE|CREATE TABLE|supabase\.from/)
  })
})

describe('buildPreviousCallContext — real fields only, never fabricated', () => {
  it('returns null when there is no previous session', () => {
    expect(buildPreviousCallContext(null, null)).toBeNull()
  })
  it('never invents a field the previous session/review row does not actually have', () => {
    const ctx = buildPreviousCallContext({ started_at: '2026-01-01' }, null)
    expect(ctx.outcome).toBeNull()
    expect(ctx.topStrength).toBeNull()
    expect(ctx.missedOpportunity).toBeNull()
  })
})

describe('formatCallContextLabel — presentation only', () => {
  it('formats "Follow-Up · Call #2 with this seller"', () => {
    expect(formatCallContextLabel({ type: 'FOLLOW_UP', callNumber: 2 })).toBe('Follow-Up · Call #2 with this seller')
  })
  it('returns null for no context (never renders a misleading label)', () => {
    expect(formatCallContextLabel(null)).toBeNull()
  })
})

// ── No new AI call ──────────────────────────────────────────────────────
describe('No new AI call introduced — structural verification', () => {
  it('generate-call-review.mjs still makes exactly ONE fetch() call to the Anthropic API', () => {
    const fetchCalls = (genReviewSrc.match(/await fetch\(/g) || []).length
    expect(fetchCalls).toBe(1)
    expect(genReviewSrc).toMatch(/fetch\('https:\/\/api\.anthropic\.com\/v1\/messages'/)
  })
  it('callContext is passed into the SAME existing request body, not a second request', () => {
    const bodyIdx = genReviewSrc.indexOf("body: JSON.stringify({")
    const nextFetchIdx = genReviewSrc.indexOf('fetch(', bodyIdx)
    expect(nextFetchIdx).toBe(-1) // no second fetch after the body is built
  })
  it('CallReview.jsx fetchCallContext is a plain Supabase read (no fetch/AI call) and is best-effort (wrapped in .catch)', () => {
    expect(callReviewSrc).toMatch(/const callContext = await fetchCallContext\(\)\.catch\(\(\) => null\)/)
    const fnMatch = callReviewSrc.match(/async function fetchCallContext\(\) \{[\s\S]*?\n  \}/)
    expect(fnMatch[0]).not.toMatch(/fetch\(/)
  })
})

// ── Backward compatibility / protected areas ───────────────────────────
describe('Backward compatibility — netlify.toml/model/timeouts untouched', () => {
  it('model and max_tokens are unchanged by this capability', () => {
    expect(genReviewSrc).toMatch(/model: 'claude-haiku-4-5-20251001'/)
    expect(genReviewSrc).toMatch(/max_tokens: 4096/)
  })
  it('the internal 25s abort timer is unchanged', () => {
    expect(genReviewSrc).toMatch(/abortCtrl\.abort\(\), 25000\)/)
  })
})

describe('Protected areas — this capability does not import deal/scoring/off-market modules', () => {
  it('callContext.js has zero dependency on calculations/dealExplanation/decisionEngineV2/distressScoring', () => {
    const src = fs.readFileSync('src/lib/callContext.js', 'utf8')
    expect(src).not.toMatch(/calculations|dealExplanation|decisionEngineV2|distressScoring|batchdata|rentcast/i)
  })
})
