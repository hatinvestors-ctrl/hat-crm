// test/calculations.test.js
// Release Readiness — Calculation Certification (Section 3).
// Expected values are derived INDEPENDENTLY from the formula documented in
// calculations.js's own comments, not by calling the function and
// asserting it equals itself.
import { describe, it, expect } from 'vitest'
import {
  calculateFlipMAO, calculateBrrrrMAO, calculateMAO, computeFlipBreakdown, computeBrrrrBreakdown,
  FLIP_MIN_PROFIT_TARGET, FLIP_STRONG_PROFIT, FLIP_PASS_MARGIN, BRRRR_MAX_CASH_LEFT_IN,
  getEffectiveOffer, calculateLiveOffer, isStoredOfferStale,
} from '../src/lib/calculations.js'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../src/lib/dealExplanation.js'
import { getGoldenLead } from './fixtures/goldenLeads.js'

// Independent closed-form re-derivation of calculateFlipMAO, per its own
// documented formula (calculations.js:123-137), holdMonths=6:
//   ppCoeff = 1.018 + 0.009*6 = 1.072
//   renoCoeff = 1.02 + 0.01*6 = 1.08
//   constant = arv*0.93 - 6*308 - 2450
//   MAO = (constant - reno*renoCoeff - target) / ppCoeff
function independentFlipMAO(arv, reno, target = FLIP_MIN_PROFIT_TARGET, holdMonths = 6) {
  const ppCoeff = 1.018 + 0.009 * holdMonths
  const renoCoeff = 1.02 + 0.01 * holdMonths
  const constant = arv * 0.93 - holdMonths * 308 - 2450
  return (constant - reno * renoCoeff - target) / ppCoeff
}

describe('FLIP — Max Buy (calculateFlipMAO)', () => {
  it('matches an independently-derived closed-form value (Hallock-shape input)', () => {
    const expected = independentFlipMAO(185000, 10000)
    expect(calculateFlipMAO(185000, 10000)).toBeCloseTo(expected, 6)
    expect(Math.round(calculateFlipMAO(185000, 10000) / 100) * 100).toBe(118400)
  })

  it('matches an independently-derived closed-form value (Club Duclay-shape input)', () => {
    const expected = independentFlipMAO(270000, 50000)
    expect(calculateFlipMAO(270000, 50000)).toBeCloseTo(expected, 6)
    expect(Math.round(calculateFlipMAO(270000, 50000) / 100) * 100).toBe(151900)
  })

  it('projected profit AT Max Buy equals the target profit by construction', () => {
    const arv = 220000, reno = 20000
    const mao = calculateFlipMAO(arv, reno)
    const profitAtMao = computeFlipBreakdown(mao, arv, reno).totalProfit
    expect(profitAtMao).toBeCloseTo(FLIP_MIN_PROFIT_TARGET, 4)
  })

  it('profit at an offer below Max Buy is greater than the target', () => {
    const arv = 220000, reno = 20000
    const mao = calculateFlipMAO(arv, reno)
    const profitBelow = computeFlipBreakdown(mao - 10000, arv, reno).totalProfit
    expect(profitBelow).toBeGreaterThan(FLIP_MIN_PROFIT_TARGET)
  })

  it('profit at an offer above Max Buy is less than the target', () => {
    const arv = 220000, reno = 20000
    const mao = calculateFlipMAO(arv, reno)
    const profitAbove = computeFlipBreakdown(mao + 10000, arv, reno).totalProfit
    expect(profitAbove).toBeLessThan(FLIP_MIN_PROFIT_TARGET)
  })

  it('returns null (never a fabricated ceiling) when ARV is missing', () => {
    expect(calculateFlipMAO(null, 10000)).toBeNull()
    expect(calculateFlipMAO(undefined, 10000)).toBeNull()
    expect(calculateFlipMAO(0, 10000)).toBeNull()
  })

  it('regression: null renovation cost must NEVER silently become $0 (the historical null->0 MAO bug)', () => {
    // This is the exact class of bug documented in calculations.js:126-131.
    // Renovation cost MUST be explicitly known; null/undefined/'' must
    // return null, never a MAO computed as if reno were $0.
    expect(calculateFlipMAO(220000, null)).toBeNull()
    expect(calculateFlipMAO(220000, undefined)).toBeNull()
    expect(calculateFlipMAO(220000, '')).toBeNull()
    // Sanity: reno=0 (a real, explicit zero) is legitimately different and SHOULD compute.
    expect(calculateFlipMAO(220000, 0)).not.toBeNull()
  })

  it('ARV sensitivity — higher ARV strictly increases Max Buy, all else equal', () => {
    const low = calculateFlipMAO(200000, 20000)
    const high = calculateFlipMAO(250000, 20000)
    expect(high).toBeGreaterThan(low)
  })

  it('rehab sensitivity — higher rehab strictly decreases Max Buy, all else equal', () => {
    const low = calculateFlipMAO(220000, 10000)
    const high = calculateFlipMAO(220000, 40000)
    expect(high).toBeLessThan(low)
  })

  it('holding-period sensitivity — longer hold decreases Max Buy (more holding cost eats into the ceiling)', () => {
    const short = calculateFlipMAO(220000, 20000, 3)
    const long = calculateFlipMAO(220000, 20000, 12)
    expect(long).toBeLessThan(short)
  })

  it('extreme rehab (rehab >> ARV) produces a negative Max Buy, not a crash or a fabricated positive number', () => {
    const mao = calculateFlipMAO(150000, 450000)
    expect(mao).not.toBeNull()
    expect(mao).toBeLessThan(0)
  })
})

describe('BRRRR — Max Buy (calculateBrrrrMAO)', () => {
  it('is gated on positive cash flow FIRST — negative/zero cash flow at any price returns null with a reason, never a fabricated MAO', () => {
    // Rent too low to cover the fixed 70%-of-ARV refi payment at any price.
    const r = calculateBrrrrMAO(150000, 20000, 400)
    expect(r.mao).toBeNull()
    expect(r.reason).toMatch(/cash flow/i)
  })

  it('cash-left-in cap is the ONLY price-dependent constraint (documented Section 22 bugfix) — verify at the solved Max Buy, cash left in is at the $30K cap', () => {
    const r = calculateBrrrrMAO(270000, 50000, 2200)
    expect(r.mao).not.toBeNull()
    expect(r.limitingFactor).toBe('CASH_LEFT_IN')
    const atMao = computeBrrrrBreakdown(r.mao, 270000, 50000, 2200)
    expect(atMao.totalCashInvested).toBeCloseTo(BRRRR_MAX_CASH_LEFT_IN, 1)
  })

  it('returns null with "ARV unknown" when ARV is missing', () => {
    expect(calculateBrrrrMAO(null, 20000, 1500).mao).toBeNull()
    expect(calculateBrrrrMAO(null, 20000, 1500).reason).toMatch(/ARV/i)
  })

  it('regression: null renovation cost must NEVER silently become $0', () => {
    const r1 = calculateBrrrrMAO(220000, null, 1500)
    const r2 = calculateBrrrrMAO(220000, undefined, 1500)
    expect(r1.mao).toBeNull()
    expect(r2.mao).toBeNull()
    expect(r1.reason).toMatch(/renovation/i)
  })

  it('returns null with "Rent estimate unknown" when rent is missing (never invents a rent)', () => {
    const r = calculateBrrrrMAO(220000, 20000, null)
    expect(r.mao).toBeNull()
    expect(r.reason).toMatch(/rent/i)
  })

  it('rent sensitivity — higher rent, holding ARV/reno fixed, never DECREASES Max Buy', () => {
    const low = calculateBrrrrMAO(220000, 20000, 1400)
    const high = calculateBrrrrMAO(220000, 20000, 2200)
    if (low.mao != null && high.mao != null) {
      expect(high.mao).toBeGreaterThanOrEqual(low.mao - 1) // tolerance for solver precision
    }
  })

  it('ARV sensitivity — higher ARV increases Max Buy (more refi proceeds to return cash)', () => {
    const low = calculateBrrrrMAO(200000, 20000, 1800)
    const high = calculateBrrrrMAO(260000, 20000, 1800)
    if (low.mao != null && high.mao != null) {
      expect(high.mao).toBeGreaterThan(low.mao)
    }
  })
})

describe('legacy flat MAO (calculateMAO) — distinct formula, distinct purpose', () => {
  it('matches the documented 0.75xARV - Reno - 2450 formula exactly', () => {
    expect(calculateMAO(270000, 50000)).toBe(270000 * 0.75 - 50000 - 2450)
    expect(calculateMAO(185000, 10000)).toBe(185000 * 0.75 - 10000 - 2450)
  })

  it('regression evidence: legacy MAO for real Club Duclay/Hallock-shape inputs exactly matches the lead.mao values found during Last-Mile UX investigation', () => {
    expect(calculateMAO(270000, 50000)).toBe(150050)
    expect(calculateMAO(185000, 10000)).toBe(126300)
  })
})

describe('Margin of Safety tiers (computeFlipResult verdict)', () => {
  it('STRONG when profit >= $40,000', () => {
    const lead = getGoldenLead('G01_STRONG_FLIP')
    const r = computeFlipResult(lead)
    expect(r.available).toBe(true)
    expect(r.projectedProfit).toBeGreaterThanOrEqual(FLIP_STRONG_PROFIT)
    expect(r.verdict).toBe('STRONG')
  })

  it('PASS ("SOLID" display) when profit is in [target+margin, strong)', () => {
    const lead = getGoldenLead('G02_SOLID_FLIP')
    const r = computeFlipResult(lead)
    expect(r.available).toBe(true)
    expect(r.projectedProfit).toBeGreaterThanOrEqual(FLIP_MIN_PROFIT_TARGET + FLIP_PASS_MARGIN)
    expect(r.projectedProfit).toBeLessThan(FLIP_STRONG_PROFIT)
    expect(r.verdict).toBe('PASS')
  })

  it('WATCH when profit is in [target, target+margin)', () => {
    const lead = getGoldenLead('G03_WATCH_FLIP')
    const r = computeFlipResult(lead)
    expect(r.available).toBe(true)
    expect(r.projectedProfit).toBeGreaterThanOrEqual(FLIP_MIN_PROFIT_TARGET)
    expect(r.projectedProfit).toBeLessThan(FLIP_MIN_PROFIT_TARGET + FLIP_PASS_MARGIN)
    expect(r.verdict).toBe('WATCH')
  })

  it('NO DEAL when evaluated directly at a price above Max Buy (computeFlipBreakdown)', () => {
    const lead = getGoldenLead('G04_NO_DEAL')
    const mao = calculateFlipMAO(lead.arv, lead.renovation_cost)
    const profitAboveMao = computeFlipBreakdown(mao + 40000, lead.arv, lead.renovation_cost).totalProfit
    expect(profitAboveMao).toBeLessThan(FLIP_MIN_PROFIT_TARGET)
  })

  // ── F1 fix regression (see RELEASE-READINESS.md Finding #1) ──────────
  // computeFlipResult's CURRENT DEAL verdict/profit must be evaluated at
  // the real asking price, never silently swapped for the MAO-anchored
  // negotiated offer — a bad current price must read as a bad current
  // price, even while Max Buy (the negotiation opportunity) stays visible.
  it('FIXED — a real stored offer/asking price above a positive Max Buy now reports NO DEAL at the current price, while Max Buy stays visible for negotiation', () => {
    const lead = getGoldenLead('G04_NO_DEAL') // asking_price=204000, starting_offer=150000, Max Buy ≈ 118,395
    const r = computeFlipResult(lead)
    expect(r.available).toBe(true)
    expect(r.maoFeasible).toBe(true)
    expect(r.mao).toBeGreaterThan(0)
    // the current-deal verdict reflects the real evaluated price (the
    // concrete stored offer, since one is on file), not MAO
    expect(r.evaluationPrice).toBe(lead.starting_offer)
    expect(r.verdict).toBe('NO DEAL')
    expect(r.projectedProfit).toBeLessThan(FLIP_MIN_PROFIT_TARGET)
    // profit was computed from the real evaluation price, not from MAO
    const profitAtRealPrice = computeFlipBreakdown(lead.starting_offer, lead.arv, lead.renovation_cost).totalProfit
    expect(r.projectedProfit).toBeCloseTo(profitAtRealPrice, 4)
    // negotiation opportunity: the recommended/negotiated offer is still
    // returned, MAO-anchored, distinct from the (failing) current price
    expect(r.currentOffer).toBeLessThanOrEqual(r.mao + 1)
    expect(r.marginOfSafety.why).toMatch(/could work around/i)
  })

  it('current offer (negotiated/recommended) is NEVER shown above Max Buy — regression for the MAO-clamp (getEffectiveOffer)', () => {
    const lead = getGoldenLead('G05_OFFER_ABOVE_MAX_BUY')
    const r = computeFlipResult(lead)
    expect(r.available).toBe(true)
    // currentOffer (the negotiated offer) must be clamped to at/below mao
    expect(r.currentOffer).toBeLessThanOrEqual(r.mao + 1) // +1 float tolerance
  })

  it('a normal profitable Flip (asking price at or below Max Buy) is unaffected by the F1 fix — no regression', () => {
    const lead = getGoldenLead('G01_STRONG_FLIP') // asking_price=95000, well below Max Buy
    const r = computeFlipResult(lead)
    expect(r.evaluationPrice).toBe(lead.asking_price)
    expect(r.verdict).toBe('STRONG')
    expect(r.projectedProfit).toBeGreaterThanOrEqual(FLIP_STRONG_PROFIT)
  })

  it('the existing WATCH scenario is unaffected by the F1 fix — no regression', () => {
    const lead = getGoldenLead('G03_WATCH_FLIP') // asking_price below Max Buy, thin margin
    const r = computeFlipResult(lead)
    expect(r.evaluationPrice).toBe(lead.asking_price)
    expect(r.verdict).toBe('WATCH')
  })

  // ── F2 fix regression (see RELEASE-READINESS.md Finding #2) ──────────
  // A Max Buy at or below $0 must never be treated as a valid purchase
  // price — no positive profit may be computed from it, and the verdict
  // must be an unambiguous NO DEAL with a clear "not feasible" reason.
  it('extreme rehab (negative raw Max Buy) never crashes, and exposed Max Buy is null, not a negative number', () => {
    const lead = getGoldenLead('G29_EXTREME_REHAB')
    expect(() => computeFlipResult(lead)).not.toThrow()
    const r = computeFlipResult(lead)
    expect(r.available).toBe(true)
    expect(r.maoFeasible).toBe(false)
    expect(r.mao).toBeNull() // never exposed as a negative dollar figure
  })

  it('FIXED — extreme rehab (negative Max Buy) is NO DEAL with no positive profit and a clear infeasibility explanation', () => {
    const lead = getGoldenLead('G29_EXTREME_REHAB')
    const r = computeFlipResult(lead)
    expect(r.verdict).toBe('NO DEAL')
    expect(r.currentOffer).toBeNull() // no valid recommended offer on an infeasible deal
    expect(r.projectedProfit == null || r.projectedProfit <= 0).toBe(true) // never a positive profit
    expect(r.marginOfSafety.why).toMatch(/not economically feasible/i)
    expect(r.biggestRisk.join(' ')).toMatch(/no purchase price makes this flip work/i)
  })

  it('boundary — Max Buy exactly $0 is treated as infeasible (mao must be strictly > 0), not a valid free acquisition price', () => {
    // Construct a lead whose renovation cost drives raw Flip MAO to
    // exactly $0, using the same closed-form formula calculateFlipMAO
    // itself documents (holdMonths=6, target=$30,000):
    //   0 = (constant - reno*renoCoeff - target) / ppCoeff
    //   reno = (constant - target) / renoCoeff
    const arv = 200000, holdMonths = 6, target = FLIP_MIN_PROFIT_TARGET
    const renoCoeff = 1.02 + 0.01 * holdMonths
    const constant = arv * 0.93 - holdMonths * 308 - 2450
    const reno = (constant - target) / renoCoeff
    const rawMao = calculateFlipMAO(arv, reno, holdMonths)
    expect(rawMao).toBeCloseTo(0, 6)

    const lead = { arv, renovation_cost: reno, asking_price: 100000 }
    const r = computeFlipResult(lead)
    expect(r.maoFeasible).toBe(false) // 0 is not > 0 — boundary is strict
    expect(r.mao).toBeNull()
    expect(r.verdict).toBe('NO DEAL')
    expect(r.currentOffer).toBeNull()
    expect(r.projectedProfit == null || r.projectedProfit <= 0).toBe(true)
  })
})

describe('Strategy Recommendation (computeStrategyRecommendation)', () => {
  it('Flip only — BRRRR unavailable (missing rent)', () => {
    const lead = getGoldenLead('G09_MISSING_RENT')
    const flip = computeFlipResult(lead)
    const brrrr = computeBrrrrResult(lead)
    expect(brrrr.available).toBe(false)
    const rec = computeStrategyRecommendation(flip, brrrr)
    if (flip.verdict !== 'NO DEAL') expect(rec.preferredStrategy).toBe('FLIP')
  })

  it('neither strategy AVAILABLE (missing core data) -> NONE, never a fabricated recommendation', () => {
    const lead = getGoldenLead('G07_MISSING_ARV')
    const flip = computeFlipResult(lead)
    const brrrr = computeBrrrrResult(lead)
    expect(flip.available).toBe(false)
    expect(brrrr.available).toBe(false)
    const rec = computeStrategyRecommendation(flip, brrrr)
    expect(rec.preferredStrategy).toBe('NONE')
  })

  it('both work -> BOTH, with a preferred side named when their tiers differ', () => {
    const lead = getGoldenLead('G13_BOTH_WORK')
    const flip = computeFlipResult(lead)
    const brrrr = computeBrrrrResult(lead)
    expect(flip.verdict).not.toBe('NO DEAL')
    expect(brrrr.available).toBe(true)
    expect(brrrr.verdict).not.toBe('NO DEAL')
    const rec = computeStrategyRecommendation(flip, brrrr)
    expect(rec.preferredStrategy).toBe('BOTH')
  })
})

describe('getEffectiveOffer / offer staleness', () => {
  it('isStoredOfferStale detects a renovation-cost mismatch between deal_analysis.inputs and the current lead (Hallock-shape regression)', () => {
    const lead = getGoldenLead('G26_STALE_AI')
    expect(isStoredOfferStale(lead)).toBe(true)
  })

  it('a stored offer is trusted only when NOT stale', () => {
    const freshLead = getGoldenLead('G03_WATCH_FLIP')
    freshLead.starting_offer = 100000
    expect(isStoredOfferStale(freshLead)).toBe(false)
    const mao = calculateFlipMAO(freshLead.arv, freshLead.renovation_cost)
    expect(getEffectiveOffer(freshLead, mao)).toBe(100000)
  })

  it('calculateLiveOffer never returns a value above Max Buy, even for a negative Max Buy (sign-safety regression)', () => {
    // Underwater deal: negative MAO. The cap formula must move AWAY from
    // zero regardless of sign (documented fix in calculations.js).
    const negativeMao = -64317
    const offer = calculateLiveOffer(negativeMao, 58000)
    expect(offer).toBeLessThanOrEqual(negativeMao)
  })
})
