// test/callReviewQuality.test.js
// Capability #25.3A — Call Review Quality & Coaching Clarity. Every
// scenario here approximates the real manually-reviewed call that
// exposed these defects (Part 12) — objection duplication, duplicate
// coaching moments, corrupted transcript fragments, and a Strong Move
// contradicting a Missed Opportunity on the same behavior.
import { describe, it, expect } from 'vitest'
import {
  dedupeObjections, dedupeCoachingMoments, assessTranscriptQuality,
  verifyCoachingMoments, verifyStrongMoves, resolveCoachingConsistency, validateScorecard,
} from '../src/lib/callCoaching.js'
import { SYSTEM_PROMPT } from '../netlify/functions/generate-call-review.mjs'

describe('Part 2 — objection deduplication', () => {
  it('the exact real defect: [NEED_TO_THINK, SPOUSE_PARTNER, SPOUSE_PARTNER] collapses to two, order preserved', () => {
    expect(dedupeObjections(['NEED_TO_THINK', 'SPOUSE_PARTNER', 'SPOUSE_PARTNER'])).toEqual(['NEED_TO_THINK', 'SPOUSE_PARTNER'])
  })
  it('genuinely different objections are never deleted', () => {
    expect(dedupeObjections(['TOO_LOW', 'SPOUSE_PARTNER', 'NEED_TO_THINK'])).toEqual(['TOO_LOW', 'SPOUSE_PARTNER', 'NEED_TO_THINK'])
  })
  it('empty/non-array input never crashes', () => {
    expect(dedupeObjections([])).toEqual([])
    expect(dedupeObjections(null)).toEqual([])
  })
})

describe('Part 3 — coaching moment deduplication', () => {
  const transcript = `SELLER: My wife is on the title too.\nKEVIN: Does your wife need to be involved in this decision?\nKEVIN: What repairs does the house need?\nSELLER: The roof and kitchen.`

  it('the exact real defect: same wife/decision-maker quote pair reported twice collapses to one moment', () => {
    const moments = [
      { sellerQuote: 'My wife is on the title too.', repQuote: 'Does your wife need to be involved in this decision?', coach: 'Clarify her involvement level.' },
      { sellerQuote: 'My wife is on the title too.', repQuote: 'Does your wife need to be involved in this decision?', coach: 'Clarify wife involvement — same as above but reworded.' },
    ]
    const result = verifyCoachingMoments(moments, transcript)
    expect(result).toHaveLength(1)
  })
  it('genuinely distinct moments (different quotes) are both kept', () => {
    const moments = [
      { sellerQuote: 'My wife is on the title too.', coach: 'Wife involvement.' },
      { repQuote: 'What repairs does the house need?', coach: 'Moved to condition.' },
    ]
    expect(verifyCoachingMoments(moments, transcript)).toHaveLength(2)
  })
  it('dedupeCoachingMoments keeps the more complete entry (both quotes beats one quote)', () => {
    const moments = [
      { sellerQuote: 'My wife is on the title too.', coach: 'short' },
      { sellerQuote: 'My wife is on the title too.', repQuote: 'Does your wife need to be involved in this decision?', coach: 'more complete, has both quotes' },
    ]
    const result = dedupeCoachingMoments(moments)
    expect(result).toHaveLength(1)
    expect(result[0].repQuote).toBeTruthy()
  })
})

describe('Part 4 — transcript quality safety', () => {
  it('flags the exact real corrupted fragments as UNCERTAIN', () => {
    expect(assessTranscriptQuality('what are you talking about my wife 14')).toBe('UNCERTAIN')
    expect(assessTranscriptQuality('one for tea one 40')).toBe('UNCERTAIN')
  })
  it('a clean quote with a real unit/currency is RELIABLE, never flagged', () => {
    expect(assessTranscriptQuality('I need at least $175,000 for the property')).toBe('RELIABLE')
    expect(assessTranscriptQuality('We could close within 30 days if that works')).toBe('RELIABLE')
  })
  it('a normal clean sentence with no numbers at all is RELIABLE', () => {
    expect(assessTranscriptQuality('My wife is on the title too and needs to be involved')).toBe('RELIABLE')
  })
  it('a null/empty quote is never flagged (nothing to assess)', () => {
    expect(assessTranscriptQuality(null)).toBe('RELIABLE')
    expect(assessTranscriptQuality('')).toBe('RELIABLE')
  })
  it('verified moments carry an evidenceQuality tag derived from their own quotes', () => {
    const transcript = 'SELLER: what are you talking about my wife 14\nKEVIN: Can you clarify that?'
    const moments = [{ sellerQuote: 'what are you talking about my wife 14', coach: 'x' }]
    const result = verifyCoachingMoments(moments, transcript)
    expect(result[0].evidenceQuality).toBe('UNCERTAIN')
  })
})

describe('Part 5/6 — captured vs. score, dimension explainability', () => {
  it('a low score alongside real captured/missing text is preserved, never silently dropped', () => {
    const scores = [{ key: 'TIMELINE', score: 1, why: 'Rep never nailed down a concrete date.', captured: 'Seller said "ASAP".', missing: 'No target date or driver of urgency explored.' }]
    const validated = validateScorecard(scores)
    expect(validated[0].score).toBe(1)
    expect(validated[0].captured).toMatch(/ASAP/)
    expect(validated[0].missing).toMatch(/target date/)
  })
  it('missing captured/missing fields degrade gracefully to null, not a crash — backward compatible with older reviews', () => {
    const scores = [{ key: 'TIMELINE', score: 5, why: 'x' }]
    const validated = validateScorecard(scores)
    expect(validated[0].captured).toBeNull()
    expect(validated[0].missing).toBeNull()
  })
})

describe('Part 7 — contradictory coaching protection', () => {
  const transcript = `KEVIN: Have you thought about what you'd want for the property?\nSELLER: Somewhere around 150.\nKEVIN: How did you arrive at that number?`

  it('the exact real scenario: a Strong Move praising the same rep quote a Missed Opportunity criticizes is downgraded from STRONG to MIXED', () => {
    const strongMoves = [{ repQuote: "Have you thought about what you'd want for the property?", why: 'Direct, efficient price question.', nuance: 'STRONG' }]
    const missedOpportunity = { repQuote: "Have you thought about what you'd want for the property?", summary: 'Rep moved to price before understanding motivation/pain.' }
    const resolved = resolveCoachingConsistency({ strongMoves, coachingMoments: [], missedOpportunity })
    expect(resolved[0].nuance).toBe('MIXED')
  })
  it('an unrelated Strong Move (different quote) is never touched', () => {
    const strongMoves = [{ repQuote: 'How did you arrive at that number?', why: 'Good.', nuance: 'STRONG' }]
    const missedOpportunity = { repQuote: "Have you thought about what you'd want for the property?", summary: 'x' }
    const resolved = resolveCoachingConsistency({ strongMoves, coachingMoments: [], missedOpportunity })
    expect(resolved[0].nuance).toBe('STRONG')
  })
  it('a strong move already carrying a nuanced classification from the AI is respected, not overwritten', () => {
    const strongMoves = [{ repQuote: "Have you thought about what you'd want for the property?", why: 'x', nuance: 'GOOD_BUT_EARLY' }]
    const missedOpportunity = { repQuote: "Have you thought about what you'd want for the property?", summary: 'x' }
    const resolved = resolveCoachingConsistency({ strongMoves, coachingMoments: [], missedOpportunity })
    expect(resolved[0].nuance).toBe('GOOD_BUT_EARLY')
  })
  it('verifyStrongMoves defaults an invalid/missing nuance to STRONG (the safest, most literal reading)', () => {
    const moves = [{ repQuote: 'How did you arrive at that number?', why: 'x' }]
    const result = verifyStrongMoves(moves, transcript)
    expect(result[0].nuance).toBe('STRONG')
  })
})

describe('Part 12 — real call regression scenario (approximated fixture)', () => {
  // Seller: vacant, repairs, financial motivation, wants ASAP, ~$140-150K,
  // wife is decision maker. Rep: identifies wife, asks price early, never
  // deepens pain, no concrete follow-up.
  const transcript = `KEVIN: What's making you think about selling?
SELLER: The place has been vacant, needs repairs, and it's a financial burden. I want to move fast.
KEVIN: Is there anyone else who'd need to be involved?
SELLER: My wife is on the title too.
KEVIN: Have you thought about what you'd want for the property?
SELLER: Somewhere around 140 to 150 thousand.`

  it('objections list never contains a duplicate SPOUSE_PARTNER entry', () => {
    expect(dedupeObjections(['SPOUSE_PARTNER', 'SPOUSE_PARTNER'])).toEqual(['SPOUSE_PARTNER'])
  })
  it('the wife/decision-maker coaching moment appears at most once even if the model reports it twice', () => {
    const moments = [
      { sellerQuote: 'My wife is on the title too.', coach: 'Clarify her involvement.' },
      { sellerQuote: 'My wife is on the title too.', coach: 'Confirm wife alignment before closing.' },
    ]
    expect(verifyCoachingMoments(moments, transcript)).toHaveLength(1)
  })
  it('a price-question Strong Move is downgraded to a nuanced classification when a Missed Opportunity criticizes the same early-price behavior', () => {
    const strongMoves = [{ repQuote: "Have you thought about what you'd want for the property?", why: 'Clear, direct question.', nuance: 'STRONG' }]
    const missedOpportunity = { repQuote: "Have you thought about what you'd want for the property?", summary: 'Rep asked for price before deeply exploring the vacancy/repairs/financial pain the seller mentioned.' }
    const resolved = resolveCoachingConsistency({ strongMoves, coachingMoments: [], missedOpportunity })
    expect(resolved[0].nuance).not.toBe('STRONG')
  })
  it('no fabricated quote survives validation against this real transcript', () => {
    const moments = [{ sellerQuote: 'I will definitely sell to you today no matter what', coach: 'fabricated' }]
    expect(verifyCoachingMoments(moments, transcript)).toHaveLength(0)
  })
})

describe('SYSTEM_PROMPT — new instructions present (Part 5/7)', () => {
  it('instructs captured/missing distinction for a low score on a captured topic', () => {
    expect(SYSTEM_PROMPT).toMatch(/different questions/i)
    expect(SYSTEM_PROMPT).toMatch(/"captured"/i)
    expect(SYSTEM_PROMPT).toMatch(/"missing"/i)
  })
  it('instructs nuance classification and forbids flat STRONG when the same behavior is criticized elsewhere', () => {
    expect(SYSTEM_PROMPT).toMatch(/GOOD_BUT_EARLY/)
    expect(SYSTEM_PROMPT).toMatch(/must NOT be plain "STRONG"/i)
  })
  it('instructs distinct coaching moments only (no near-duplicate reporting)', () => {
    expect(SYSTEM_PROMPT).toMatch(/DISTINCT INSIGHTS ONLY/i)
  })
})
