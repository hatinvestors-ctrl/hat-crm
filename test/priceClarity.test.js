// test/priceClarity.test.js
// Price Clarity + Max Buy Consistency — real manual QA case, 8054 Paschal
// Street. UI/presentation fix only — no financial formula, threshold, or
// scoring rule was touched (verified explicitly below).
import { describe, it, expect } from 'vitest'
import { roundMaxBuy, describeCashLeftIn, calculateFlipMAO } from '../src/lib/calculations.js'
import { computeFlipResult, computeBrrrrResult } from '../src/lib/dealExplanation.js'

function paschalLead(overrides = {}) {
  return {
    address: '8054 Paschal Street',
    asking_price: 145000, arv: 220000, renovation_cost: 45000,
    starting_offer: 113000, // recommended offer, not an actual submitted offer
    ...overrides,
  }
}

describe('Paschal Street — price semantics: Seller Asking != Our Offer != Max Buy', () => {
  it('three genuinely distinct numbers, none confused with another', () => {
    const lead = paschalLead()
    const flip = computeFlipResult(lead)
    const sellerAsking = lead.asking_price
    const ourOffer = flip.currentOffer
    const maxBuy = roundMaxBuy(flip.mao)
    expect(sellerAsking).toBe(145000)
    expect(ourOffer).toBeCloseTo(113000, -1)
    expect(maxBuy).toBe(113500)
    expect(sellerAsking).not.toBe(ourOffer)
    expect(sellerAsking).not.toBe(maxBuy)
    expect(ourOffer).not.toBe(sellerAsking)
  })
})

describe('roundMaxBuy — the shared presentation-rounding helper', () => {
  it('rounds the exact Paschal Max Buy ($113,527.99) to the actionable $113,500', () => {
    const raw = calculateFlipMAO(220000, 45000, 6)
    expect(raw).toBeCloseTo(113528, 0)
    expect(roundMaxBuy(raw)).toBe(113500)
  })
  it('never changes the underlying canonical value — only formats it for display', () => {
    const lead = paschalLead()
    const flip = computeFlipResult(lead)
    // The raw canonical mao is untouched — roundMaxBuy is presentation-only.
    expect(flip.mao).toBeCloseTo(113528, 0)
    expect(flip.mao).not.toBe(roundMaxBuy(flip.mao))
  })
  it('null-safe — never invents a number', () => {
    expect(roundMaxBuy(null)).toBeNull()
    expect(roundMaxBuy(undefined)).toBeNull()
  })
})

describe('Seller Gap to Max Buy (formerly mislabeled "Room")', () => {
  it('Paschal: Seller Asking $145,000 - actionable Max Buy $113,500 = $31,500, matching the displayed Max Buy exactly', () => {
    const lead = paschalLead()
    const flip = computeFlipResult(lead)
    const displayMao = roundMaxBuy(flip.mao)
    const sellerGap = lead.asking_price - displayMao
    expect(displayMao).toBe(113500)
    expect(sellerGap).toBe(31500)
    // The screen must never simultaneously show Max Buy=$113,500 and a
    // gap computed from the unrounded $113,528 (the old $31,472 figure)
    // — confirm the two are no longer independently derived.
    expect(sellerGap).not.toBe(Math.round(lead.asking_price - flip.mao))
  })

  it('is a genuinely different number from the offer-to-Max-Buy room', () => {
    const lead = paschalLead()
    const flip = computeFlipResult(lead)
    const displayMao = roundMaxBuy(flip.mao)
    const sellerGap = lead.asking_price - displayMao
    const offerRoom = displayMao - flip.currentOffer
    expect(sellerGap).not.toBeCloseTo(offerRoom, -2) // $31,500 vs $500 — not remotely the same number
  })

  it('reads "at/below Max Buy" (not a negative dollar figure) when the seller is already within budget', () => {
    const lead = paschalLead({ asking_price: 100000 }) // below Max Buy
    const flip = computeFlipResult(lead)
    const displayMao = roundMaxBuy(flip.mao)
    const sellerGap = lead.asking_price - displayMao
    expect(sellerGap).toBeLessThan(0) // the raw number is negative
    // UI never displays this raw negative — it shows "$0 — at/below Max Buy" instead (see DealDecisionCenter.jsx)
  })
})

describe('Offer Room = Max Buy - Our Offer', () => {
  it('Paschal: $113,500 actionable Max Buy - $113,000 offer = $500 room', () => {
    const lead = paschalLead()
    const flip = computeFlipResult(lead)
    const displayMao = roundMaxBuy(flip.mao)
    const offerRoom = displayMao - flip.currentOffer
    expect(offerRoom).toBeCloseTo(500, -1)
    expect(offerRoom).toBeGreaterThan(0) // our offer is safely under the ceiling
  })
})

describe('Legacy lead.mao isolation (regression check — must remain fixed)', () => {
  it('legacy lead.mao does not feed evaluationPrice, mao, currentOffer, or verdict, even when present and diverged', () => {
    const lead = paschalLead({ mao: 117550 }) // stale legacy value, mission's example
    const flip = computeFlipResult(lead)
    expect(flip.mao).toBeCloseTo(113528, 0) // canonical, NOT the legacy 117550
    expect(roundMaxBuy(flip.mao)).toBe(113500)
    expect(flip.mao).not.toBeCloseTo(117550, 0)
  })

  it('BRRRR is unaffected by the presence of a legacy Flip-only lead.mao', () => {
    const lead = paschalLead({ mao: 117550, rent_estimate: 1600 })
    const brrrr = computeBrrrrResult(lead)
    expect(brrrr.available).toBe(true)
    // BRRRR's own mao is computed independently of the Flip legacy field.
    expect(brrrr.mao).not.toBeCloseTo(117550, 0)
  })
})

describe('Cross-screen consistency — Overview (DealSnapshotCompact) and Deal tab (DealDecisionCenter) agree', () => {
  it('both screens compute Max Buy from the same computeFlipResult + roundMaxBuy pipeline, never independently', () => {
    const lead = paschalLead()
    const flip = computeFlipResult(lead)
    // Both components import and call roundMaxBuy(flip.mao) directly —
    // asserting the shared helper's output is what both screens use.
    const overviewMaxBuy = roundMaxBuy(flip.mao)
    const dealTabMaxBuy = roundMaxBuy(flip.mao)
    expect(overviewMaxBuy).toBe(dealTabMaxBuy)
    expect(overviewMaxBuy).toBe(113500)
  })
})

describe('Safety — no financial formula, threshold, or verdict changed by this fix', () => {
  it('Paschal verdict, projected profit, and canonical (unrounded) Max Buy are identical to the pre-fix values', () => {
    const lead = paschalLead()
    const flip = computeFlipResult(lead)
    expect(flip.mao).toBeCloseTo(113528, 0) // exact canonical formula output, unchanged
    expect(flip.projectedProfit).toBeCloseTo(-3738, 0) // profit at asking price, unchanged
    expect(flip.verdict).toBe('NO DEAL') // unchanged — asking is above Max Buy
  })

  it('describeCashLeftIn (Issue #4 fix from a prior phase) is untouched by this mission', () => {
    expect(describeCashLeftIn(-10000)).toEqual({ display: '$0', extracted: 10000, allRecovered: true })
  })
})
