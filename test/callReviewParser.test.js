// test/callReviewParser.test.js
// Call Review JSON Hardening — production bug fix. Regresses the real
// failure: "Call review response was not valid JSON." on a real,
// high-coverage production call (7/8 coverage, active coaching focus,
// decision-maker + objection facts captured — exactly the rich-schema
// shape most likely to exceed a too-small max_tokens budget). No raw
// production response was recoverable (the function logged nothing at
// the time — see delivery report) — fixtures below reconstruct the
// PLAUSIBLE truncation shape from the real, current SYSTEM_PROMPT schema
// (netlify/functions/generate-call-review.mjs), not invented fields.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { extractBalancedJson, parseCallReviewResponse, fmtParseErrorForUser, PARSE_ERROR } from '../src/lib/callReviewParser.js'
import { SYSTEM_PROMPT } from '../netlify/functions/generate-call-review.mjs'

const COMPLETE_REVIEW = {
  scores: [{ key: 'OPENING_RAPPORT', score: 8, why: 'Good rapport.', captured: 'Friendly opening.', missing: '' }],
  strengths: ['Clear opening'],
  missedOpportunity: { summary: 'Moved to price too fast.', sellerQuote: 'I need 180.', repQuote: 'How did you land on that?', betterQuestion: 'What would make this work for you?', why: 'Skipped motivation depth.' },
  coachingMoments: [{ sellerQuote: 'My wife is on the title too.', repQuote: 'Does she need to be involved?', coach: 'Good follow-up.', betterQuestion: '', why: 'Clarified decision maker.' }],
  strongMoves: [{ sellerQuote: 'I need 180.', repQuote: 'How did you land on that?', why: 'Direct question.', nuance: 'STRONG' }],
  sellerOutcomeSummary: 'Seller wants $180,000, tenant/taxes/repairs are motivators, wife is a decision maker.',
  primaryCoachingFocus: { skillKey: 'PAIN_DEPTH', title: 'Go deeper on pain', recommendation: 'Ask a follow-up before moving to price.', exampleQuestions: ['What has this cost you emotionally?'] },
  focusAdherence: { opportunityExisted: true, result: 'PARTIALLY_APPLIED', why: 'Asked once, did not follow up.', sellerQuote: 'It has been stressful.', repQuote: 'I hear you.' },
}
const COMPLETE_JSON = JSON.stringify(COMPLETE_REVIEW)

describe('extractBalancedJson — real brace-balance scanning, not a greedy regex', () => {
  it('extracts a complete object exactly, ignoring trailing prose', () => {
    const { json, complete } = extractBalancedJson(COMPLETE_JSON + '\n\nHope this helps!')
    expect(complete).toBe(true)
    expect(JSON.parse(json)).toEqual(COMPLETE_REVIEW)
  })
  it('never confuses a brace inside a quoted string for a real structural brace', () => {
    const withBraceInQuote = `{"summary": "she said {this is fine} to me", "score": 5}`
    const { json, complete } = extractBalancedJson(withBraceInQuote)
    expect(complete).toBe(true)
    expect(JSON.parse(json)).toEqual({ summary: 'she said {this is fine} to me', score: 5 })
  })
  it('correctly detects a genuinely truncated object — the real Ventnor-style production symptom, reconstructed from the real schema', () => {
    // Truncated partway through the coachingMoments array — exactly the
    // shape a max_tokens cutoff on this real, large schema would produce.
    const truncated = COMPLETE_JSON.slice(0, COMPLETE_JSON.indexOf('"coachingMoments"') + 40)
    const { complete } = extractBalancedJson(truncated)
    expect(complete).toBe(false)
  })
  it('returns null json when no opening brace exists at all', () => {
    expect(extractBalancedJson('no json here').json).toBeNull()
  })
})

describe('parseCallReviewResponse — the real production bug, fixed', () => {
  it('a complete, well-formed response parses successfully', () => {
    const result = parseCallReviewResponse(COMPLETE_JSON, 'end_turn')
    expect(result.ok).toBe(true)
    expect(result.review).toEqual(COMPLETE_REVIEW)
  })
  it('THE REAL BUG — stop_reason max_tokens is now explicitly detected as truncation, never a generic "invalid JSON"', () => {
    const truncated = COMPLETE_JSON.slice(0, 200) // cut off mid-object, realistic for a rich call
    const result = parseCallReviewResponse(truncated, 'max_tokens')
    expect(result.ok).toBe(false)
    expect(result.code).toBe(PARSE_ERROR.TRUNCATED_OUTPUT)
  })
  it('even without a max_tokens stop_reason, an unclosed object is still caught as truncated (brace-balance, not just the API field)', () => {
    const truncated = COMPLETE_JSON.slice(0, 200)
    const result = parseCallReviewResponse(truncated, 'end_turn') // stop_reason says normal completion, but braces disagree
    expect(result.ok).toBe(false)
    expect(result.code).toBe(PARSE_ERROR.TRUNCATED_OUTPUT)
  })
  it('markdown code fences are stripped before parsing (pre-existing behavior, preserved)', () => {
    const fenced = '```json\n' + COMPLETE_JSON + '\n```'
    const result = parseCallReviewResponse(fenced, 'end_turn')
    expect(result.ok).toBe(true)
  })
  it('trailing prose after a complete object is ignored, not treated as corruption', () => {
    const withProse = COMPLETE_JSON + '\n\nLet me know if you need anything else!'
    const result = parseCallReviewResponse(withProse, 'end_turn')
    expect(result.ok).toBe(true)
  })
  it('a genuinely empty response is its own distinct error code, not lumped with invalid JSON', () => {
    expect(parseCallReviewResponse('', 'end_turn').code).toBe(PARSE_ERROR.EMPTY_RESPONSE)
    expect(parseCallReviewResponse('   ', 'end_turn').code).toBe(PARSE_ERROR.EMPTY_RESPONSE)
  })
  it('real malformed JSON (complete braces, but structurally invalid) is INVALID_JSON, distinct from truncation', () => {
    const malformed = '{"scores": [1, 2,], "trailing": "comma"}' // trailing comma — valid brace balance, invalid JSON
    const result = parseCallReviewResponse(malformed, 'end_turn')
    expect(result.ok).toBe(false)
    expect(result.code).toBe(PARSE_ERROR.INVALID_JSON)
  })
})

describe('fmtParseErrorForUser — no duplicated suffix (CallReview.jsx already appends its own)', () => {
  it('every message is short and does NOT contain the client\'s own appended suffix', () => {
    for (const code of Object.values(PARSE_ERROR)) {
      const msg = fmtParseErrorForUser(code)
      expect(msg).not.toMatch(/coverage above/i)
    }
  })
  it('truncation gets a distinct, honest message from generic invalid JSON', () => {
    expect(fmtParseErrorForUser(PARSE_ERROR.TRUNCATED_OUTPUT)).toMatch(/cut off/i)
    expect(fmtParseErrorForUser(PARSE_ERROR.INVALID_JSON)).not.toMatch(/cut off/i)
  })
})

describe('max_tokens budget — real fix for the real schema growth', () => {
  it('generate-call-review.mjs requests a larger budget than the original #24 size (2000)', () => {
    const src = fs.readFileSync('netlify/functions/generate-call-review.mjs', 'utf8')
    const match = src.match(/max_tokens:\s*(\d+)/)
    expect(match).toBeTruthy()
    expect(Number(match[1])).toBeGreaterThan(2000)
  })
})

describe('Diagnostic logging — real gap fix, never logs the transcript/PII', () => {
  it('generate-call-review.mjs logs parse failures with only safe metadata (code/stopReason/length), never the transcript or continuation text', () => {
    const src = fs.readFileSync('netlify/functions/generate-call-review.mjs', 'utf8')
    expect(src).toMatch(/console\.error\('\[generate-call-review\] parse failure'/)
    expect(src).toMatch(/continuationLength: continuation\.length/)
    // Never logs the raw continuation text or the transcript itself.
    expect(src).not.toMatch(/console\.\w+\([^)]*transcript/i)
    expect(src).not.toMatch(/console\.\w+\([^)]*\bcontinuation\b\)/)
  })
})

describe('Nothing else in the prompt/rubric/schema contract changed', () => {
  it('SYSTEM_PROMPT still forbids recalculating Max Buy and inventing quotes (regression, unchanged)', () => {
    expect(SYSTEM_PROMPT).toMatch(/do not calculate, restate, or imply a different max buy/i)
    expect(SYSTEM_PROMPT).toMatch(/do not invent a quote/i)
  })
  it('still caps coaching moments/strengths/strong moves at 3, missedOpportunity at exactly 1 (regression, unchanged)', () => {
    expect(SYSTEM_PROMPT).toMatch(/max 3 strengths, max 3 coachingmoments, max 3 strongmoves/i)
    expect(SYSTEM_PROMPT).toMatch(/exactly 1 missedopportunity/i)
  })
})
