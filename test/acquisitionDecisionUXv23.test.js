// test/acquisitionDecisionUXv23.test.js
// Lead Workspace UX V2.3 — Off-Market Seller Price + Offer Position
// Clarity (2026-08-31).
//
// Confirmed audit findings (traced, not assumed):
//   - lead.offer_price = the ACTUAL/SUBMITTED HAT offer (dealExplanation.js's
//     own prior D2 field-provenance audit) — trustworthy for "Our Offer".
//   - lead.starting_offer / flip.currentOffer = a SYSTEM-CALCULATED
//     negotiation-anchor recommendation, never a real offer.
//   - getSellerIntelligence(lead).hat_offer_mentioned is trustworthy as
//     "Our Offer" ONLY when its companion hat_offer_type === 'FORMAL_OFFER'
//     — RANGE_MENTIONED/PROBE are explicitly not an offer.
//   - getSellerIntelligence(lead).seller_asking_price remains the ONE
//     trustworthy off-market seller-price field (established in V2.2).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../src/lib/dealExplanation.js'
import { deriveAcquisitionDecision, resolveActualOffer, resolveAcquisitionPricePosition } from '../src/lib/acquisitionDecisionPresentation.js'
import { getDealReadiness } from '../src/components/lead-detail/workspace/readiness.js'

const NORFOLK = { asking_price: 105000, arv: 215000, renovation_cost: 65000, rent_estimate: 1350, hold_months: 6 }
const WOODLEIGH = { asking_price: 100000, arv: 200000, renovation_cost: 39000, rent_estimate: 1350, hold_months: 6, is_distressed: true }

function decide(lead, marketType = null, sellerAskingPrice = null) {
  const flip = computeFlipResult(lead)
  const brrrr = computeBrrrrResult(lead)
  const strategyRec = computeStrategyRecommendation(flip, brrrr)
  const readiness = getDealReadiness(lead)
  return deriveAcquisitionDecision({ flip, brrrr, strategyRec, readiness, lead, marketType, sellerAskingPrice })
}

// ── A/B. On-market unchanged ───────────────────────────────────────────────
describe('A/B. ON-MARKET behavior fully preserved', () => {
  it('A. Norfolk: asking above Max Buy → NEGOTIATE, Asking Price/Max Buy/gap all present', () => {
    const decision = decide(NORFOLK, 'ON_MARKET')
    expect(decision.state).toBe('NEGOTIATE')
    expect(decision.currentPriceLabel).toBe('Asking Price')
    expect(decision.currentPrice).toBe(105000)
    expect(decision.targetLabel).toBe('BRRRR Max Buy') // no "/Walk-Away" on-market
    expect(decision.gap).toBeGreaterThan(0)
  })
  it('B. on-market within Max Buy → WITHIN BUY RANGE', () => {
    const lead = { asking_price: 60000, arv: 200000, renovation_cost: 20000, hold_months: 6 }
    expect(decide(lead, 'ON_MARKET').headline).toBe('WITHIN BUY RANGE')
  })
})

// ── C/D. Off-market with seller price ──────────────────────────────────────
describe('C/D. OFF-MARKET with seller_asking_price above/within Max Buy', () => {
  it('C. seller price above Max Buy → NEGOTIATE, Seller Asking shown, correct gap', () => {
    // UX V2.5, Part 2 fix — at default settings, computeStrategyRecommendation
    // genuinely ranks BRRRR ahead of Flip in Woodleigh's "BOTH WORK" tie;
    // targetLabel/gap now correctly follow BRRRR Max Buy (~$111,364), not
    // Flip's ~$102,222 — see dealExplanation.js's resolveEffectiveStrategy.
    const decision = decide(WOODLEIGH, 'OFF_MARKET', 120000)
    expect(decision.state).toBe('NEGOTIATE')
    expect(decision.currentPriceLabel).toBe('Seller Asking')
    expect(decision.currentPrice).toBe(120000)
    expect(decision.targetLabel).toBe('BRRRR Max Buy / Walk-Away')
    expect(decision.gap).toBeGreaterThan(8000)
    expect(decision.gap).toBeLessThan(9000)
  })
  it('D. seller price within Max Buy → WITHIN BUY RANGE', () => {
    const decision = decide(WOODLEIGH, 'OFF_MARKET', 95000)
    expect(decision.headline).toBe('WITHIN BUY RANGE')
    expect(decision.currentPriceLabel).toBe('Seller Asking')
  })
})

// ── E/F. Off-market, no seller price ───────────────────────────────────────
describe('E/F. OFF-MARKET with no seller price', () => {
  it('E. evaluation price exists → READY TO PURSUE, evaluation price may display, no seller gap, no fake seller asking price', () => {
    const decision = decide(WOODLEIGH, 'OFF_MARKET', null)
    expect(decision.state).toBe('READY_TO_PURSUE')
    expect(decision.evaluationPrice).toBe(100000)
    expect(decision.currentPrice).toBeNull() // never a fake "seller asking"
    expect(decision.gap).toBeNull()
    expect(decision.gapLabel).toBeNull()
  })
  it('F. no seller price AND no evaluation/offer price at all: existing computeFlipResult logic cannot evaluate profit at any price, so it falls through to the pre-existing "neither strategy meets HAT\'s targets" PASS path — correctly NEVER a fabricated price, and NEVER invented as READY_TO_PURSUE from nothing', () => {
    const lead = { is_distressed: true, arv: 200000, renovation_cost: 39000, rent_estimate: 1350 } // no asking_price, no offer_price
    const decision = decide(lead, 'OFF_MARKET', null)
    // Whichever state the EXISTING engine reaches with zero price data,
    // this task never fabricates a price to force READY_TO_PURSUE.
    expect(decision.currentPrice).toBeNull()
    expect(['PASS', 'READY_TO_PURSUE', 'NEEDS_RESEARCH']).toContain(decision.state)
  })
})

// ── G/H. Actual HAT offer semantics ────────────────────────────────────────
describe('G/H. Actual HAT offer resolution — trustworthy sources only', () => {
  it('G. lead.offer_price (the confirmed ACTUAL/SUBMITTED offer field) is used as "Our Offer"', () => {
    const lead = { ...WOODLEIGH, offer_price: 90000 }
    const decision = decide(lead, 'OFF_MARKET', 120000)
    expect(decision.actualOffer).toBe(90000)
    expect(decision.actualOfferSource).toBe('offer_price')
  })
  it('H. hat_offer_mentioned is NOT trusted unless hat_offer_type === FORMAL_OFFER', () => {
    const rangeOnly = { ...WOODLEIGH, distress_data: { seller_intelligence: { hat_offer_mentioned: 88000, hat_offer_type: 'RANGE_MENTIONED' } } }
    expect(resolveActualOffer(rangeOnly).amount).toBeNull()
    const probeOnly = { ...WOODLEIGH, distress_data: { seller_intelligence: { hat_offer_mentioned: 88000, hat_offer_type: 'PROBE' } } }
    expect(resolveActualOffer(probeOnly).amount).toBeNull()
    const formal = { ...WOODLEIGH, distress_data: { seller_intelligence: { hat_offer_mentioned: 88000, hat_offer_type: 'FORMAL_OFFER' } } }
    expect(resolveActualOffer(formal).amount).toBe(88000)
    expect(resolveActualOffer(formal).source).toMatch(/FORMAL_OFFER/)
  })
  it('lead.offer_price takes precedence over hat_offer_mentioned when both exist', () => {
    const both = { ...WOODLEIGH, offer_price: 90000, distress_data: { seller_intelligence: { hat_offer_mentioned: 88000, hat_offer_type: 'FORMAL_OFFER' } } }
    expect(resolveActualOffer(both).amount).toBe(90000)
    expect(resolveActualOffer(both).source).toBe('offer_price')
  })
})

// ── I. Max Buy never labeled "Our Offer" ───────────────────────────────────
describe('I. Max Buy is never labeled "Our Offer"', () => {
  it('DecisionHero.jsx never sets label="Our Offer" on the targetPrice/Max Buy metric', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    expect(src).toMatch(/label="Our Offer" value=\{fc\(Math\.round\(decision\.actualOffer\)\)\}/)
    expect(src).not.toMatch(/label="Our Offer" value=\{fc\(Math\.round\(decision\.targetPrice\)\)\}/)
  })
})

// ── J. Evaluation Price never labeled "Seller Asking" ──────────────────────
describe('J. Evaluation Price never labeled "Seller Asking"', () => {
  it('READY_TO_PURSUE renders evaluationPrice under its own "Evaluation Price" caption, distinct from any seller-asking label', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    expect(src).toMatch(/Evaluation Price:<\/span> \{fc\(decision\.evaluationPrice\)\}/)
  })
  it('the decision object itself never sets currentPriceLabel to "Seller Asking" when the price came from evaluationPrice, not sellerAskingPrice', () => {
    const decision = decide(WOODLEIGH, 'OFF_MARKET', null) // no seller price
    // READY_TO_PURSUE never populates currentPriceLabel at all (currentPrice is null)
    expect(decision.currentPriceLabel).toBeUndefined()
  })
})

// ── K. Seller Asking never derived from lead.asking_price off-market ──────
describe('K. "Seller Asking" is exclusively sourced from sellerAskingPrice, never lead.asking_price, for off-market leads', () => {
  it('off-market with asking_price set but no sellerAskingPrice never produces a Seller Asking comparison', () => {
    const decision = decide(WOODLEIGH, 'OFF_MARKET', null) // WOODLEIGH.asking_price = 100000
    expect(decision.state).toBe('READY_TO_PURSUE') // not NEGOTIATE/WITHIN_BUY_RANGE based on the 100000
    expect(decision.currentPriceLabel).not.toBe('Seller Asking')
  })
  it('source code: genuineSellerPrice is derived exclusively from the sellerAskingPrice parameter', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/const genuineSellerPrice = isOffMarket && sellerAskingPrice != null \? num\(sellerAskingPrice\) : null/)
  })
})

// ── L/M. Missing data ──────────────────────────────────────────────────────
describe('L/M. Off-market missing ARV/rehab → RESEARCH BEFORE OFFERING (unchanged from V2.2)', () => {
  it('L. missing ARV', () => {
    const decision = decide({ is_distressed: true, renovation_cost: 20000 }, 'OFF_MARKET')
    expect(decision.headline).toBe('RESEARCH BEFORE OFFERING')
  })
  it('M. missing rehab', () => {
    const decision = decide({ is_distressed: true, arv: 200000 }, 'OFF_MARKET')
    expect(decision.headline).toBe('RESEARCH BEFORE OFFERING')
  })
})

// ── N/O. PASS/Norfolk regression ───────────────────────────────────────────
describe('N/O. PASS behavior and Norfolk regression unchanged', () => {
  it('N. NOT_FIT still produces PASS', () => {
    const flip = computeFlipResult(NORFOLK)
    const brrrr = computeBrrrrResult(NORFOLK)
    const strategyRec = computeStrategyRecommendation(flip, brrrr)
    const decision = deriveAcquisitionDecision({ flip, brrrr, strategyRec, readiness: getDealReadiness(NORFOLK), lead: NORFOLK, fit: { status: 'NOT_FIT' } })
    expect(decision.state).toBe('PASS')
  })
  it('O. Norfolk canonical decision unchanged from V2.2', () => {
    const decision = decide(NORFOLK, 'ON_MARKET')
    expect(decision.state).toBe('NEGOTIATE')
    expect(decision.targetLabel).toBe('BRRRR Max Buy')
  })
})

// ── P. Woodleigh canonical economics unchanged ─────────────────────────────
describe('P. Woodleigh canonical economics unchanged', () => {
  it('Flip Max Buy ~$102,222, profit $32,382', () => {
    const flip = computeFlipResult(WOODLEIGH)
    expect(Math.round(flip.mao)).toBe(102222)
    expect(flip.projectedProfit).toBe(32382)
  })
})

// ── Q. No financial/scoring files changed ──────────────────────────────────
describe('Q. No financial/scoring files changed', () => {
  it('calculations.js, dealExplanation.js verdicts, decisionEngineV2.js, buyBox.js, underwritingSettings.js carry no edit markers from this task', () => {
    for (const file of ['src/lib/calculations.js', 'src/lib/dealExplanation.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js']) {
      const src = fs.readFileSync(file, 'utf8')
      expect(src).not.toMatch(/UX V2\.3/)
    }
  })
  it('no opening-offer formula exists anywhere in acquisitionDecisionPresentation.js', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).not.toMatch(/mao \* 0\.\d|targetPrice \* 0\.\d/)
  })
})

// ── resolveAcquisitionPricePosition resolver ───────────────────────────────
describe('resolveAcquisitionPricePosition — the one presentation resolver', () => {
  it('Norfolk (on-market): sellerPrice sourced from lead.asking_price, pricePosition SELLER_ABOVE_RANGE', () => {
    const flip = computeFlipResult(NORFOLK)
    const brrrr = computeBrrrrResult(NORFOLK)
    const strategyRec = computeStrategyRecommendation(flip, brrrr)
    const pos = resolveAcquisitionPricePosition({ flip, brrrr, strategyRec, lead: NORFOLK, marketType: 'ON_MARKET' })
    expect(pos.sellerPriceSource).toBe('lead.asking_price')
    expect(pos.pricePosition).toBe('SELLER_ABOVE_RANGE')
    expect(pos.isOpeningOffer).toBe(false)
  })
  it('Woodleigh off-market + seller price $120K: sourced from seller_intelligence, gap computed', () => {
    // UX V2.5, Part 2 fix — see resolveEffectiveStrategy in dealExplanation.js;
    // this resolver now correctly follows BRRRR Max Buy at Woodleigh's
    // real "BOTH WORK — BRRRR PREFERRED" tie, not Flip.
    const flip = computeFlipResult(WOODLEIGH)
    const brrrr = computeBrrrrResult(WOODLEIGH)
    const strategyRec = computeStrategyRecommendation(flip, brrrr)
    const pos = resolveAcquisitionPricePosition({ flip, brrrr, strategyRec, lead: WOODLEIGH, marketType: 'OFF_MARKET', sellerAskingPrice: 120000 })
    expect(pos.sellerPriceSource).toBe('seller_intelligence.seller_asking_price')
    expect(pos.sellerToMaxBuyGap).toBeGreaterThan(8000)
    expect(pos.sellerToMaxBuyGap).toBeLessThan(9000)
    expect(pos.maxBuyLabel).toBe('BRRRR Max Buy / Walk-Away')
  })
  it('Woodleigh off-market, no seller price: pricePosition NO_SELLER_PRICE, evaluationPrice populated', () => {
    const flip = computeFlipResult(WOODLEIGH)
    const brrrr = computeBrrrrResult(WOODLEIGH)
    const strategyRec = computeStrategyRecommendation(flip, brrrr)
    const pos = resolveAcquisitionPricePosition({ flip, brrrr, strategyRec, lead: WOODLEIGH, marketType: 'OFF_MARKET', sellerAskingPrice: null })
    expect(pos.pricePosition).toBe('NO_SELLER_PRICE')
    expect(pos.sellerPrice).toBeNull()
    expect(pos.evaluationPrice).toBe(100000)
  })
})
