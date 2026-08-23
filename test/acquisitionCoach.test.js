// test/acquisitionCoach.test.js
// Capability #24 — HAT Acquisition Coach. All deterministic logic lives in
// sellerStrategy.js/conversationSession.js (no LLM) — this suite drives it
// with lead/si fixtures built the same way LiveCopilot.jsx's applyFacts()
// would build them, without needing a browser or live mic.
import { describe, it, expect } from 'vitest'
import {
  getSellerIntelligence, mergeSellerIntelligence, getNextBestQuestion, getNextBestMove,
  getRealTimeEconomics, getCallCoverage, getWhatWeStillNeed, getDealGuardrail, formatPriceMovement,
  COVERAGE_DIMENSIONS,
} from '../src/lib/sellerStrategy.js'
import { inferConversationStage, detectFastSignals } from '../src/lib/conversationSession.js'

// Applies a patch the same way LiveCopilot.jsx's applyFacts() does —
// duplicated minimally here (not imported, since applyFacts lives inside
// the React component) so these tests exercise the same field-merge shape
// the live UI actually produces.
function applyPatch(lead, patch) {
  return { ...lead, distress_data: mergeSellerIntelligence(lead, patch) }
}

function baseLead(overrides = {}) {
  return { id: 'lead-1', address: '123 Main St', arv: 220000, renovation_cost: 45000, starting_offer: 145000, ...overrides }
}

describe('Part 36 — REQUIRED acceptance scenario (Main Street call)', () => {
  it('reproduces the exact expected final seller state and coverage by replaying the transcript facts in order', () => {
    let lead = baseLead()

    // "Maybe. I've actually been thinking about it."
    lead = applyPatch(lead, { open_to_sell: 'MAYBE' })
    // "I'm tired of dealing with it. The tenant moved out... don't want to put money into it."
    lead = applyPatch(lead, { pain_points: ['TENANT', 'VACANT', 'REPAIRS'], motivation_notes: "Tired of dealing with it; doesn't want to invest more." })
    // "The kitchen is old, the floors need work and the roof may need replacement."
    lead = applyPatch(lead, { condition_notes: 'Kitchen dated, floors need work, roof may need replacement.' })
    // "Probably within 30 days."
    lead = applyPatch(lead, { timeline: '<30_DAYS' })
    // "I was thinking about 180 thousand."
    lead = applyPatch(lead, { seller_asking_price: 180000 })
    // Kevin: "somewhere around 145" (rep-side number, never the seller's ask)
    lead = applyPatch(lead, { hat_offer_mentioned: 145000, hat_offer_type: 'RANGE_MENTIONED' })
    // "145 is too low. I probably need at least 175." -> objection + price change
    const si1 = getSellerIntelligence(lead)
    lead = applyPatch(lead, {
      objections: [...si1.objections, 'TOO_LOW'],
      seller_asking_price: 175000,
      seller_asking_price_history: [...si1.seller_asking_price_history, { value: si1.seller_asking_price, at: new Date().toISOString() }],
    })
    // "My neighbor sold for about 250, but his house was fully renovated." — reasoning only, no new structured field.
    // "No. My wife is on the title too."
    lead = applyPatch(lead, { decision_makers: 'Seller + Wife' })
    // "I don't want to do repairs. I'd rather sell it as-is."
    lead = applyPatch(lead, { desired_outcome: ['NO_REPAIRS'] })
    // "Actually, if you could close quickly and buy it as-is, I might consider 170."
    const si2 = getSellerIntelligence(lead)
    lead = applyPatch(lead, {
      seller_asking_price: 170000,
      seller_price_status: 'CONDITIONAL',
      seller_asking_price_history: [...si2.seller_asking_price_history, { value: si2.seller_asking_price, at: new Date().toISOString() }],
    })
    // "Call me Thursday afternoon."
    lead = applyPatch(lead, { follow_up_phrase: 'Thursday afternoon' })

    const si = getSellerIntelligence(lead)

    // Expected final seller state (Part 36)
    expect(si.pain_points.sort()).toEqual(['REPAIRS', 'TENANT', 'VACANT'].sort())
    expect(si.timeline).toBe('<30_DAYS')
    expect(si.condition_notes).toMatch(/kitchen/i)
    expect(si.seller_asking_price_history.map(h => h.value)).toEqual([180000, 175000])
    expect(si.seller_asking_price).toBe(170000) // current
    expect(si.decision_makers).toBe('Seller + Wife')
    expect(si.follow_up_phrase).toBe('Thursday afternoon')

    // Price movement: $180K → $175K → $170K, moved -$10K
    const movement = formatPriceMovement(si)
    expect(movement.chain).toBe('$180K → $175K → $170K')
    expect(movement.movedBy).toBe(-10000)

    // Expected coverage (Part 36) — all 8 captured
    const coverage = getCallCoverage(si)
    expect(coverage.capturedCount).toBe(8)
    expect(coverage.total).toBe(8)
    for (const dim of coverage.dimensions) expect(dim.status).toBe('CAPTURED')
  })

  it('"already asked" protection — after price is captured, the TOO_LOW objection stops recommending "Where were you hoping we\'d be?"', () => {
    let lead = baseLead()
    lead = applyPatch(lead, { open_to_sell: 'MAYBE', pain_points: ['TENANT'], timeline: '<30_DAYS' })
    lead = applyPatch(lead, { objections: ['TOO_LOW'] })
    let si = getSellerIntelligence(lead)
    const economics = getRealTimeEconomics(lead)
    const beforePrice = getNextBestMove(lead, si, economics)
    expect(beforePrice.ask).toMatch(/where were you hoping/i)

    // Seller answers the price question — objection is now resolved.
    lead = applyPatch(lead, { seller_asking_price: 175000 })
    si = getSellerIntelligence(lead)
    const afterPrice = getNextBestMove(lead, si, getRealTimeEconomics(lead))
    expect(afterPrice.ask).not.toMatch(/where were you hoping/i)
    // Moves on to the next genuinely-missing dimension instead of repeating.
    expect(afterPrice.ask).not.toBeNull()
  })

  it('CASE N — a question is never re-recommended once its dimension is CAPTURED (decision-tree structurally skips known fields)', () => {
    let lead = baseLead()
    lead = applyPatch(lead, { open_to_sell: 'YES', pain_points: ['TENANT'], timeline: '<30_DAYS', seller_asking_price: 175000 })
    const si = getSellerIntelligence(lead)
    const nbq = getNextBestQuestion(lead, si)
    // Timeline/pain/price already known — the recommended question must be
    // about decision makers (the next unknown), never re-ask any of those.
    expect(nbq).toMatch(/else|involved/i)
    expect(nbq).not.toMatch(/what would make you consider/i)
    expect(nbq).not.toMatch(/timeline/i)
  })
})

describe('getCallCoverage / getWhatWeStillNeed (Part 6/8/18)', () => {
  it('an empty seller_intelligence has all 8 dimensions MISSING', () => {
    const si = getSellerIntelligence(baseLead())
    const coverage = getCallCoverage(si)
    expect(coverage.capturedCount).toBe(0)
    expect(coverage.dimensions.every(d => d.status === 'MISSING')).toBe(true)
  })

  it('PAIN is PARTIAL with exactly one pain point, CAPTURED with two+', () => {
    const one = getCallCoverage(getSellerIntelligence(applyPatch(baseLead(), { pain_points: ['TENANT'] })))
    const two = getCallCoverage(getSellerIntelligence(applyPatch(baseLead(), { pain_points: ['TENANT', 'REPAIRS'] })))
    expect(one.dimensions.find(d => d.key === 'PAIN').status).toBe('PARTIAL')
    expect(two.dimensions.find(d => d.key === 'PAIN').status).toBe('CAPTURED')
  })

  it('getWhatWeStillNeed never lists a CAPTURED dimension, and caps at the requested limit', () => {
    const lead = applyPatch(baseLead(), { open_to_sell: 'YES', pain_points: ['TENANT', 'VACANT'] })
    const si = getSellerIntelligence(lead)
    const still = getWhatWeStillNeed(si, 2)
    expect(still).toHaveLength(2)
    expect(still.some(d => d.key === 'SELLING_INTEREST')).toBe(false) // captured
    expect(still.some(d => d.key === 'PAIN')).toBe(false) // captured
  })

  it('resolved items stop competing for attention — capturing everything empties the list', () => {
    let lead = baseLead()
    lead = applyPatch(lead, {
      open_to_sell: 'YES', pain_points: ['TENANT', 'VACANT'], condition_notes: 'ok',
      timeline: 'ASAP', seller_asking_price: 150000, decision_makers: 'Owner', follow_up_phrase: 'Friday',
    })
    expect(getWhatWeStillNeed(getSellerIntelligence(lead))).toHaveLength(0)
  })

  it('COVERAGE_DIMENSIONS is exactly the 8 dimensions from the Part 36 required scenario, in a stable order', () => {
    expect(COVERAGE_DIMENSIONS.map(d => d.key)).toEqual([
      'SELLING_INTEREST', 'MOTIVATION', 'PAIN', 'CONDITION', 'TIMELINE', 'PRICE', 'DECISION_MAKERS', 'FOLLOW_UP',
    ])
  })
})

describe('getDealGuardrail (Part 14) — presentation only, Max Buy always sourced from the canonical engine', () => {
  it('Max Buy NOT READY when Flip/BRRRR inputs are missing, with a real reason', () => {
    const lead = { id: 'x', starting_offer: null } // no ARV/reno at all
    const si = getSellerIntelligence(lead)
    const economics = getRealTimeEconomics(lead)
    const guardrail = getDealGuardrail(lead, si, economics)
    expect(guardrail.maxBuyReady).toBe(false)
    expect(guardrail.maxBuyReason).toBeTruthy()
  })

  it('Max Buy is read verbatim from economics.bestCeiling — never recomputed independently', () => {
    const lead = baseLead()
    const si = getSellerIntelligence(applyPatch(lead, { seller_asking_price: 170000 }))
    const economics = getRealTimeEconomics(lead)
    const guardrail = getDealGuardrail(lead, si, economics)
    expect(guardrail.maxBuy).toBe(economics.bestCeiling)
    expect(guardrail.maxBuyStrategy).toBe(economics.bestCeilingStrategy)
  })

  it('gap is sellerPrice minus Max Buy — positive means seller is above Max Buy', () => {
    const lead = baseLead()
    const si = getSellerIntelligence(applyPatch(lead, { seller_asking_price: 999999 }))
    const economics = getRealTimeEconomics(lead)
    const guardrail = getDealGuardrail(lead, si, economics)
    expect(guardrail.gap).toBe(999999 - economics.bestCeiling)
    expect(guardrail.gap).toBeGreaterThan(0)
  })

  it('CASE P — Max Buy unavailable never crashes and never fabricates a number', () => {
    const lead = { id: 'y' }
    const si = getSellerIntelligence(lead)
    const economics = getRealTimeEconomics(lead)
    const guardrail = getDealGuardrail(lead, si, economics)
    expect(guardrail.maxBuyReady).toBe(false)
    expect(guardrail).not.toHaveProperty('maxBuy')
  })
})

describe('formatPriceMovement (Part 15)', () => {
  it('returns null when nothing is captured yet', () => {
    expect(formatPriceMovement(getSellerIntelligence(baseLead()))).toBeNull()
  })
  it('a single price with no history still renders (no movement)', () => {
    const si = getSellerIntelligence(applyPatch(baseLead(), { seller_asking_price: 180000 }))
    const m = formatPriceMovement(si)
    expect(m.chain).toBe('$180K')
    expect(m.movedBy).toBe(0)
  })
})

describe('Additional scenarios (Part 37)', () => {
  it('A — seller not interested: Next Best Question is null (respect "no"), Next Best Move ends respectfully', () => {
    const lead = applyPatch(baseLead(), { open_to_sell: 'NO' })
    const si = getSellerIntelligence(lead)
    expect(getNextBestQuestion(lead, si)).toBeNull()
    const move = getNextBestMove(lead, si, getRealTimeEconomics(lead))
    expect(move.move).toBe('END RESPECTFULLY')
  })

  it('B — no price given yet: coverage PRICE stays MISSING, guardrail sellerPrice is null (never fabricated)', () => {
    const lead = applyPatch(baseLead(), { open_to_sell: 'YES', pain_points: ['TENANT'] })
    const si = getSellerIntelligence(lead)
    expect(getCallCoverage(si).dimensions.find(d => d.key === 'PRICE').status).toBe('MISSING')
    expect(getDealGuardrail(lead, si, getRealTimeEconomics(lead)).sellerPrice).toBeNull()
  })

  it('F — spouse must decide: SPOUSE_PARTNER objection resolves once decision_makers is captured', () => {
    let lead = applyPatch(baseLead(), { objections: ['SPOUSE_PARTNER'] })
    let si = getSellerIntelligence(lead)
    expect(getNextBestMove(lead, si, getRealTimeEconomics(lead)).ask).toMatch(/talk together/i)
    lead = applyPatch(lead, { decision_makers: 'Wife' })
    si = getSellerIntelligence(lead)
    expect(getNextBestMove(lead, si, getRealTimeEconomics(lead)).ask).not.toMatch(/talk together/i)
  })

  it('D — seller changes price twice: history preserves both prior values in order', () => {
    let lead = baseLead()
    let si = getSellerIntelligence(lead)
    lead = applyPatch(lead, { seller_asking_price: 180000 })
    si = getSellerIntelligence(lead)
    lead = applyPatch(lead, { seller_asking_price: 175000, seller_asking_price_history: [...si.seller_asking_price_history, { value: si.seller_asking_price, at: 't1' }] })
    si = getSellerIntelligence(lead)
    lead = applyPatch(lead, { seller_asking_price: 170000, seller_asking_price_history: [...si.seller_asking_price_history, { value: si.seller_asking_price, at: 't2' }] })
    si = getSellerIntelligence(lead)
    expect(si.seller_asking_price_history.map(h => h.value)).toEqual([180000, 175000])
    expect(si.seller_asking_price).toBe(170000)
  })
})

describe('detectFastSignals / inferConversationStage — reused, not rebuilt (Part 2/5)', () => {
  it('a price-shaped utterance triggers the FAST path', () => {
    expect(detectFastSignals('I probably need at least $175,000').isFast).toBe(true)
  })
  it('stage reflects captured facts, not a linear wizard — jumping straight to price still resolves correctly', () => {
    const lead = applyPatch(baseLead(), { open_to_sell: 'YES', pain_points: ['TENANT'], timeline: 'ASAP', seller_asking_price: 150000 })
    const si = getSellerIntelligence(lead)
    expect(inferConversationStage(si)).not.toBe('OPENING')
  })
})
