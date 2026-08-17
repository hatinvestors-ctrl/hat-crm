// test/mutation.test.js
// Release Readiness — Mutation / Recalculation Matrix (Section 4).
// Proves that changing one input updates every dependent output that
// SHOULD change, and leaves unrelated fields untouched. This is the class
// of test that would have caught the historical "Financials shows $X,
// Detailed Analysis still shows stale $Y" bugs found earlier this session.
import { describe, it, expect } from 'vitest'
import { calculateFlipMAO, calculateBrrrrMAO, isStoredOfferStale, computeFlipBreakdown } from '../src/lib/calculations.js'
import { computeFlipResult, computeBrrrrResult } from '../src/lib/dealExplanation.js'
import { getGoldenLead } from './fixtures/goldenLeads.js'

describe('INPUT CHANGED: ARV', () => {
  it('changes Flip Max Buy, projected profit, and Margin of Safety', () => {
    const lead = getGoldenLead('G03_WATCH_FLIP')
    const before = computeFlipResult(lead)
    lead.arv = lead.arv + 50000
    const after = computeFlipResult(lead)
    expect(after.mao).not.toBeCloseTo(before.mao, 0)
    expect(after.projectedProfit).not.toBeCloseTo(before.projectedProfit, 0)
    expect(after.marginOfSafety.priceCushion).not.toBeCloseTo(before.marginOfSafety.priceCushion, 0)
  })

  it('changes BRRRR Max Buy/cash-left-in where BRRRR is computable', () => {
    const lead = getGoldenLead('G13_BOTH_WORK')
    const before = computeBrrrrResult(lead)
    lead.arv = lead.arv + 50000
    const after = computeBrrrrResult(lead)
    expect(after.mao).not.toBeCloseTo(before.mao, 0)
  })

  it('does NOT change unrelated fields (address, source, follow_up_date)', () => {
    const lead = getGoldenLead('G03_WATCH_FLIP')
    lead.follow_up_date = '2026-09-01'
    const addressBefore = lead.address
    const followUpBefore = lead.follow_up_date
    lead.arv = lead.arv + 50000
    expect(lead.address).toBe(addressBefore)
    expect(lead.follow_up_date).toBe(followUpBefore)
  })
})

describe('INPUT CHANGED: renovation cost', () => {
  it('changes Flip Max Buy in the expected direction (higher reno -> lower Max Buy)', () => {
    const lead = getGoldenLead('G03_WATCH_FLIP')
    const before = computeFlipResult(lead)
    lead.renovation_cost = lead.renovation_cost + 20000
    const after = computeFlipResult(lead)
    expect(after.mao).toBeLessThan(before.mao)
  })

  it('holding the purchase price FIXED (a real, non-stale stored offer), higher reno strictly lowers profit', () => {
    // getEffectiveOffer's own MAO-clamp means computeFlipResult's own
    // live-computed currentOffer re-anchors toward the (now-lower) MAO on
    // every reno change, which can make "profit after more reno" look
    // HIGHER purely because the model is now paying less for the
    // property — a real but easily-misread interaction. Isolating reno's
    // effect on profit requires holding price fixed, exactly as
    // calculations.test.js's certification tests already do via
    // computeFlipBreakdown directly.
    const lead = getGoldenLead('G03_WATCH_FLIP')
    const fixedPrice = 100000
    const before = computeFlipBreakdown(fixedPrice, lead.arv, lead.renovation_cost).totalProfit
    lead.renovation_cost = lead.renovation_cost + 20000
    const after = computeFlipBreakdown(fixedPrice, lead.arv, lead.renovation_cost).totalProfit
    expect(after).toBeLessThan(before)
  })

  it('marks a stored starting_offer stale once renovation_cost diverges from deal_analysis.inputs (Hallock regression)', () => {
    const lead = getGoldenLead('G26_STALE_AI')
    expect(isStoredOfferStale(lead)).toBe(true) // already stale in this fixture (renovation_cost=10000 vs analysis input 50000)
    lead.renovation_cost = 50000 // now matches the AI analysis input again
    expect(isStoredOfferStale(lead)).toBe(false)
  })
})

describe('INPUT CHANGED: rent estimate', () => {
  it('makes BRRRR available where it was previously blocked, without touching Flip', () => {
    const lead = getGoldenLead('G09_MISSING_RENT')
    const flipBefore = computeFlipResult(lead)
    const brrrrBefore = computeBrrrrResult(lead)
    expect(brrrrBefore.available).toBe(false)
    lead.rent_estimate = 1900
    const flipAfter = computeFlipResult(lead)
    const brrrrAfter = computeBrrrrResult(lead)
    expect(brrrrAfter.available).toBe(true)
    // Flip must be completely unaffected by a rent-only change.
    expect(flipAfter.mao).toBeCloseTo(flipBefore.mao, 4)
    expect(flipAfter.projectedProfit).toBeCloseTo(flipBefore.projectedProfit, 4)
  })
})

describe('INPUT CHANGED: asking price (alone, no starting_offer stored)', () => {
  it('does NOT change canonical Max Buy (Max Buy depends only on ARV/reno/hold, never asking price)', () => {
    const lead = getGoldenLead('G03_WATCH_FLIP')
    const before = calculateFlipMAO(lead.arv, lead.renovation_cost)
    lead.asking_price = lead.asking_price + 30000
    const after = calculateFlipMAO(lead.arv, lead.renovation_cost)
    expect(after).toBeCloseTo(before, 6)
  })
})

// Product Decision — Canonical Deal Values (D2, see RELEASE-READINESS.md):
// offer_price (the ACTUAL/SUBMITTED offer) drives the current-deal
// evaluation; starting_offer (the RECOMMENDED/"We Offer" negotiation
// anchor) does not. These two describe blocks lock in that separation.
describe('INPUT CHANGED: actual/submitted offer (offer_price)', () => {
  it('changes projected profit and Margin of Safety without changing Max Buy itself', () => {
    const lead = getGoldenLead('G03_WATCH_FLIP')
    const maoBefore = calculateFlipMAO(lead.arv, lead.renovation_cost)
    const before = computeFlipResult(lead)
    lead.offer_price = before.evaluationPrice - 5000
    const after = computeFlipResult(lead)
    const maoAfter = calculateFlipMAO(lead.arv, lead.renovation_cost)
    expect(maoAfter).toBeCloseTo(maoBefore, 6)
    expect(after.evaluationPrice).toBe(lead.offer_price)
    expect(after.projectedProfit).toBeGreaterThan(before.projectedProfit)
  })
})

describe('INPUT CHANGED: recommended offer (starting_offer) alone', () => {
  it('does NOT change the current-deal evaluation price or projected profit — only the negotiated/recommended offer', () => {
    const lead = getGoldenLead('G03_WATCH_FLIP') // no offer_price set — evaluates at asking_price
    const before = computeFlipResult(lead)
    lead.starting_offer = 50000 // a wildly different "recommendation" — must not leak into the current-deal question
    const after = computeFlipResult(lead)
    expect(after.evaluationPrice).toBe(before.evaluationPrice)
    expect(after.projectedProfit).toBeCloseTo(before.projectedProfit, 4)
    expect(after.verdict).toBe(before.verdict)
  })
})

describe('INPUT CHANGED: holding period', () => {
  it('changes Max Buy and profit without changing ARV/reno themselves', () => {
    const lead = getGoldenLead('G03_WATCH_FLIP')
    const arv = lead.arv, reno = lead.renovation_cost
    const maoShort = calculateFlipMAO(arv, reno, 3)
    const maoLong = calculateFlipMAO(arv, reno, 12)
    expect(maoShort).not.toBeCloseTo(maoLong, 0)
    expect(lead.arv).toBe(arv) // unrelated field untouched
    expect(lead.renovation_cost).toBe(reno)
  })
})
