// test/callCoaching.test.js
// Capability #24 — Call Review deterministic guardrails: quote
// verification (never invent a coaching moment), scorecard validation
// (every score explainable), and the AI authority contract in
// generate-call-review.mjs's prompt.
import { describe, it, expect } from 'vitest'
import {
  quoteAppearsInTranscript, verifyCoachingMoments, verifyStrongMoves,
  validateScorecard, computeOverallScore, COACHING_DIMENSIONS,
} from '../src/lib/callCoaching.js'
import { SYSTEM_PROMPT } from '../netlify/functions/generate-call-review.mjs'

const TRANSCRIPT = `KEVIN: What's making you consider selling?
SELLER: I'm tired of dealing with it. The tenant moved out.
KEVIN: What kind of repairs?
SELLER: The kitchen is old and the roof may need replacement.
SELLER: I probably need at least 175.
KEVIN: How did you arrive at 175?`

describe('quoteAppearsInTranscript — real evidence only', () => {
  it('finds a genuine substring, case/punctuation-insensitive', () => {
    expect(quoteAppearsInTranscript("I'm tired of dealing with it", TRANSCRIPT)).toBe(true)
    expect(quoteAppearsInTranscript('how did you arrive at 175?', TRANSCRIPT)).toBe(true)
  })
  it('rejects a quote that was never actually said (a hallucination)', () => {
    expect(quoteAppearsInTranscript('I will definitely sell to you today', TRANSCRIPT)).toBe(false)
  })
  it('rejects empty/trivial input rather than matching everything', () => {
    expect(quoteAppearsInTranscript('', TRANSCRIPT)).toBe(false)
    expect(quoteAppearsInTranscript('ok', TRANSCRIPT)).toBe(false)
  })
})

describe('verifyCoachingMoments — Part 24, never a fake coaching moment reaches the UI', () => {
  it('keeps a moment whose quotes are real', () => {
    const moments = [{ sellerQuote: "I'm tired of dealing with it", repQuote: 'What kind of repairs?', coach: 'Moved to condition too fast.' }]
    expect(verifyCoachingMoments(moments, TRANSCRIPT)).toHaveLength(1)
  })
  it('drops a moment with an invented quote', () => {
    const moments = [{ sellerQuote: 'I will sign right now', coach: 'Fabricated.' }]
    expect(verifyCoachingMoments(moments, TRANSCRIPT)).toHaveLength(0)
  })
  it('drops a moment with no quote at all (nothing to verify against)', () => {
    expect(verifyCoachingMoments([{ coach: 'Vague criticism with no evidence.' }], TRANSCRIPT)).toHaveLength(0)
  })
  it('caps at 3 even if the model returns more', () => {
    const real = { sellerQuote: "I'm tired of dealing with it", coach: 'x' }
    const moments = Array.from({ length: 5 }, () => ({ ...real }))
    expect(verifyCoachingMoments(moments, TRANSCRIPT)).toHaveLength(3)
  })
  it('non-array input never crashes, returns empty', () => {
    expect(verifyCoachingMoments(null, TRANSCRIPT)).toEqual([])
    expect(verifyCoachingMoments(undefined, TRANSCRIPT)).toEqual([])
  })
  it('verifyStrongMoves applies the identical evidence rule (Part 25 — same philosophy, not a second one)', () => {
    const real = [{ sellerQuote: 'I probably need at least 175', repQuote: 'How did you arrive at 175?', why: 'Asked seller to justify before countering.' }]
    expect(verifyStrongMoves(real, TRANSCRIPT)).toHaveLength(1)
    const fake = [{ sellerQuote: 'I will pay you to take it', why: 'Fabricated.' }]
    expect(verifyStrongMoves(fake, TRANSCRIPT)).toHaveLength(0)
  })
})

describe('validateScorecard — Part 21, every score must be explainable, never a mystery number', () => {
  it('accepts a well-formed score', () => {
    const scores = [{ key: 'TIMELINE', score: 10, why: 'Seller clearly said within 30 days.' }]
    expect(validateScorecard(scores)).toHaveLength(1)
  })
  it('rejects a score with no "why"', () => {
    expect(validateScorecard([{ key: 'TIMELINE', score: 10 }])).toHaveLength(0)
  })
  it('rejects an out-of-range score', () => {
    expect(validateScorecard([{ key: 'TIMELINE', score: 15, why: 'x' }])).toHaveLength(0)
    expect(validateScorecard([{ key: 'TIMELINE', score: -1, why: 'x' }])).toHaveLength(0)
  })
  it('rejects an unknown dimension key (not in the documented rubric)', () => {
    expect(validateScorecard([{ key: 'MADE_UP_DIMENSION', score: 8, why: 'x' }])).toHaveLength(0)
  })
  it('every COACHING_DIMENSIONS key is unique and matches the rubric doc\'s 9 dimensions', () => {
    expect(COACHING_DIMENSIONS).toHaveLength(9)
    expect(new Set(COACHING_DIMENSIONS.map(d => d.key)).size).toBe(9)
  })
})

describe('computeOverallScore', () => {
  it('is a simple percentage of achieved vs possible points', () => {
    const scores = [{ key: 'TIMELINE', score: 10, why: 'x' }, { key: 'PRICE_DISCOVERY', score: 5, why: 'x' }]
    expect(computeOverallScore(scores)).toBe(75) // 15/20
  })
  it('returns null for an empty scorecard rather than 0 (0 would falsely imply a terrible call was scored)', () => {
    expect(computeOverallScore([])).toBeNull()
  })
})

describe('generate-call-review.mjs SYSTEM_PROMPT — AI authority + evidence contract', () => {
  it('forbids recalculating or restating Max Buy (same contract as the Comps Intelligence fix)', () => {
    expect(SYSTEM_PROMPT).toMatch(/do not calculate, restate, or imply a different max buy/i)
  })
  it('forbids recommending above the supplied Max Buy', () => {
    expect(SYSTEM_PROMPT).toMatch(/do not recommend or imply an offer above the supplied max buy/i)
  })
  it('explicitly forbids inventing a quote', () => {
    expect(SYSTEM_PROMPT).toMatch(/do not invent a quote/i)
  })
  it('explicitly instructs scoring on behavior, never on whether the seller agreed', () => {
    expect(SYSTEM_PROMPT).toMatch(/never on whether the seller ultimately agreed/i)
  })
  it('caps coaching moments/strengths/strong moves at 3, and missed opportunity at exactly 1', () => {
    expect(SYSTEM_PROMPT).toMatch(/max 3 strengths, max 3 coachingmoments, max 3 strongmoves/i)
    expect(SYSTEM_PROMPT).toMatch(/exactly 1 missedopportunity/i)
  })
})
