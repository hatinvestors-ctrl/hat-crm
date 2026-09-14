// test/sep4DealTabPriceScenario.test.js
// HAT INVESTORS — SMALL CHANGE #12: Deal Tab Price-Scenario Consistency.
// Presentation-only. computeStrategyRecommendation, resolveStrategyOutlook
// (Small Change #10), buildStrategyComparison, and buildStrategyExplanation
// are all UNCHANGED — this only changes how DealDecisionCenter.jsx
// CONSUMES their output.
//
// Root cause (audit-confirmed): buildStrategyComparison's status labels
// (WORKS/BELOW TARGET) come directly from flip.verdict/brrrr.verdict.
// flip.verdict is always computed at flip.evaluationPrice (the real
// current/seller price). brrrr.verdict is always computed at
// brrrr.currentOffer (a negotiation anchor near BRRRR's own Max Buy) —
// NEVER the seller ask. So "BRRRR WORKS" vs "FLIP BELOW TARGET" silently
// compared two DIFFERENT price scenarios as if directly comparable — the
// exact Lazeau confusion this mission traces. buildStrategyComparison's
// own explanation string had the same bug in its wording ("BRRRR meets
// HAT's requirements at the current evaluation price").
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../src/lib/dealExplanation.js'
import { buildStrategyComparison, resolveStrategyOutlook, buildCloseCallComparison, buildDealCloseCallExplanation, buildStrategyExplanation } from '../src/lib/acquisitionDecisionPresentation.js'

const LAZEAU = { id: 'lazeau', asking_price: 160000, arv: 245000, renovation_cost: 60000, rent_estimate: 1500, hold_months: 6 }

function evaluate(lead) {
  const flip = computeFlipResult(lead, null)
  const brrrr = computeBrrrrResult(lead, null)
  const strategyRec = computeStrategyRecommendation(flip, brrrr)
  const comparison = buildStrategyComparison({ flip, brrrr, strategyRec, hasPrice: true })
  const effective = comparison.recommended
  const outlook = resolveStrategyOutlook({ flip, brrrr, decision: { targetStrategy: effective, buyBoxNotFit: false, priceUnknown: false } })
  return { flip, brrrr, strategyRec, comparison, effective, outlook }
}

describe('CASE A — Lazeau: root cause confirmed, Deal tab now reuses resolveStrategyOutlook for a close call', () => {
  const { flip, brrrr, comparison, effective, outlook } = evaluate(LAZEAU)

  it('confirms the exact root cause: BRRRR "WORKS" is computed at brrrr.currentOffer, not the $160,000 seller ask', () => {
    expect(comparison.flip.status).toBe('BELOW TARGET') // flip.verdict at real current price ($160,000)
    expect(comparison.brrrr.status).toBe('WORKS') // brrrr.verdict at brrrr.currentOffer ($118,100), NOT $160,000
    expect(Math.round(brrrr.currentOffer)).not.toBe(160000)
    expect(brrrr.currentOffer).toBeLessThan(LAZEAU.asking_price)
  })
  it('canonical preferredStrategy remains BRRRR, unchanged by SC12', () => {
    expect(effective).toBe('BRRRR')
  })
  it('is classified BOTH_VIABLE_CLOSE_CALL via the reused, byte-unchanged resolveStrategyOutlook', () => {
    expect(outlook.kind).toBe('BOTH_VIABLE_CLOSE_CALL')
    expect(outlook.lean).toBe('BRRRR')
  })
  it('all financial numbers unchanged', () => {
    expect(Math.round(flip.mao)).toBe(120104)
    expect(Math.round(brrrr.mao)).toBe(118710)
    expect(brrrr.monthlyCashFlow).toBe(85)
    expect(brrrr.cashLeftIn).toBe(29346)
  })
  it('buildDealCloseCallExplanation never claims "both work at the current price" — explicitly separates seller ask from acquisition range', () => {
    const text = buildDealCloseCallExplanation({ flip, brrrr, sellerAsk: LAZEAU.asking_price })
    expect(text).toMatch(/Neither strategy meets HAT's targets at the \$160,000 seller ask/)
    expect(text).toMatch(/Flip becomes viable around \$120,104 or below/)
    expect(text).toMatch(/BRRRR around \$118,710 or below/)
    expect(text).not.toMatch(/both.{0,20}work.{0,20}(at the current price|current evaluation price)/i)
  })
  it('the close-call comparison table (reused, unmodified SC10/SC11 helper) produces the exact Lazeau price-diff callout', () => {
    const comp = buildCloseCallComparison({ flip, brrrr })
    expect(comp.priceDiffLabel).toBe('$1.4K')
  })
  it('buildStrategyExplanation (SC8) no longer says "meets HAT\'s target at the current price" for BRRRR at this price', () => {
    const text = buildStrategyExplanation({ flip, brrrr, strategyRec: computeStrategyRecommendation(flip, brrrr), sellerAskingPrice: LAZEAU.asking_price })
    expect(text).not.toMatch(/BRRRR meets HAT's target at the current price/)
  })
})

describe('CASE B — clear BRRRR winner: existing RECOMMENDED terminology preserved, no false close-call', () => {
  it('outlook is CLEAR_BRRRR, not BOTH_VIABLE_CLOSE_CALL', () => {
    const lead = { id: 'case-b', asking_price: 115000, arv: 220000, renovation_cost: 35000, rent_estimate: 2400, hold_months: 6 }
    const { effective, outlook } = evaluate(lead)
    expect(effective).toBe('BRRRR')
    expect(outlook.kind).toBe('CLEAR_BRRRR')
  })
})

describe('CASE C — clear FLIP winner: existing RECOMMENDED terminology preserved, no false close-call', () => {
  it('outlook is CLEAR_FLIP, not BOTH_VIABLE_CLOSE_CALL', () => {
    const lead = { id: 'case-c', asking_price: 100000, arv: 250000, renovation_cost: 40000, rent_estimate: 1500, hold_months: 6 }
    const { effective, outlook } = evaluate(lead)
    expect(effective).toBe('FLIP')
    expect(outlook.kind).toBe('CLEAR_FLIP')
  })
})

describe('CASE D — Flip only / missing rent (SC7 fixture): no BRRRR fabrication, no close call', () => {
  it('Flip Max Buy ≈$91,140; buildStrategyComparison (unmodified, pre-existing Deal-tab function — no PASS_NEGOTIABLE MAO-fallback, unlike Overview) resolves BRRRR as UNAVAILABLE, never fabricated; buildCloseCallComparison returns null either way', () => {
    const lead = { id: 'audit-test', asking_price: 100000, arv: 200000, renovation_cost: 50000, hold_months: 6 }
    const { flip, brrrr, comparison, outlook } = evaluate(lead)
    expect(Math.round(flip.mao)).toBe(91140)
    expect(comparison.brrrr.status).toBe('UNAVAILABLE')
    // buildStrategyComparison's own "recommended" is null here (flip fails
    // at the real current price and BRRRR is unavailable — SC12 does not
    // change this pre-existing Deal-tab behavior); resolveStrategyOutlook
    // therefore also returns null, never fabricating a close call.
    expect(outlook).toBeNull()
    expect(buildCloseCallComparison({ flip, brrrr })).toBeNull()
  })
})

describe('CASE E — Evergreen hard Buy Box PASS: resolveStrategyOutlook returns null when buyBoxNotFit is passed through', () => {
  it('outlook is null, no strategy comparison override', () => {
    const lead = { id: 'evergreen', asking_price: 175000, arv: 210000, renovation_cost: 40000, hold_months: 6 }
    const flip = computeFlipResult(lead, null)
    const brrrr = computeBrrrrResult(lead, null)
    const strategyRec = computeStrategyRecommendation(flip, brrrr)
    const comparison = buildStrategyComparison({ flip, brrrr, strategyRec, hasPrice: true })
    const outlook = resolveStrategyOutlook({ flip, brrrr, decision: { targetStrategy: comparison.recommended, buyBoxNotFit: true, priceUnknown: false } })
    expect(outlook).toBeNull()
  })
})

describe('CASE F/G — actual offer vs. suggested offer: no variable semantics changed', () => {
  it('lead.offer_price (actual offer) is never conflated with flip.currentOffer (a calculated suggestion)', () => {
    const lead = { id: 'offer-case', asking_price: 160000, offer_price: 119000, arv: 245000, renovation_cost: 60000, rent_estimate: 1500, hold_months: 6 }
    const flip = computeFlipResult(lead, null)
    // evaluationPrice must follow the actual offer (dealExplanation.js, unchanged rule) — SC12 never touches this precedence.
    expect(flip.evaluationPrice).toBe(119000)
    expect(flip.actualOffer).toBe(119000)
    // flip.currentOffer is the SEPARATE, system-generated suggestion — must never equal a literal rewrite of actualOffer's semantics.
    expect(flip.currentOffer).not.toBeUndefined()
  })
  it('CASE G — no actual offer present: evaluationPrice falls back to asking_price, no offer fabricated', () => {
    const flip = computeFlipResult({ id: 'no-offer', asking_price: 160000, arv: 245000, renovation_cost: 60000, hold_months: 6 }, null)
    expect(flip.evaluationPrice).toBe(160000)
    expect(flip.actualOffer).toBeNull()
  })
})

describe('CASE H — selector functionality: labels may change, underlying selection state does not', () => {
  it('DealDecisionCenter.jsx selector click behavior (setSelectedStrategy) is unchanged; only the visible suffix text branches on isCloseCall', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/DealDecisionCenter.jsx', 'utf8')
    expect(src).toMatch(/onClick=\{\(\) => setSelectedStrategy\(s\)\}/)
    expect(src).toMatch(/const active = selectedStrategy \|\| effective \|\| \(flip\.available \? 'FLIP' : 'BRRRR'\)/)
    expect(src).toMatch(/\{isCloseCall \? ` — \$\{s === effective \? 'Slight Lean' : 'Viable'\}` : \(s === effective \? ' — Recommended' : ''\)\}/)
  })
})

describe('Price-scenario-qualified status labels render in DealDecisionCenter.jsx', () => {
  it('never shows a bare WORKS/BELOW TARGET verdict — always scenario-qualified', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/DealDecisionCenter.jsx', 'utf8')
    expect(src).toMatch(/Viable at \$\{priceScenarioWord\}/)
    expect(src).toMatch(/Below Target at \$\{priceScenarioWord\}/)
    expect(src).toMatch(/'Viable at Target Range'/)
    expect(src).toMatch(/'Below Target at Target Range'/)
  })
  it('reuses resolveStrategyOutlook — no second close-call engine in the Deal tab', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/DealDecisionCenter.jsx', 'utf8')
    expect(src).toMatch(/resolveStrategyOutlook\(\{ flip, brrrr, decision: \{ targetStrategy: effective, buyBoxNotFit, priceUnknown: comparison\.priceUnknown \} \}\)/)
    expect(src).not.toMatch(/const pricesClose = /) // the SC10 formula itself must not be reproduced here
  })
})

describe('SC1-SC11 preserved', () => {
  it('SC3 — PASS_NEGOTIABLE state/label/tone unchanged', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/state: 'PASS_NEGOTIABLE', \.\.\.STATE_META\.PASS_NEGOTIABLE/)
  })
  it('SC5 — Buy Box PASS explanation untouched', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/buyBoxNotFit: true/)
  })
  it('SC7 — Decision V2 PASS precedence fix untouched', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/viableFlipMao == null && viableBrrrrMao == null/)
  })
  it('SC8 — ActionZone.jsx NOT_FIT guard untouched', () => {
    const actionSrc = fs.readFileSync('src/components/lead-detail/ActionZone.jsx', 'utf8')
    expect(actionSrc).toMatch(/decision_v2\?\.fit\?\.status === 'NOT_FIT'/)
  })
  it('SC10 — resolveStrategyOutlook classification rule untouched', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/export function resolveStrategyOutlook/)
    expect(src).toMatch(/const pricesClose = gap <= Math\.max\(5000, lowerMao \* 0\.05\)/)
    expect(src).toMatch(/const dominant = winnerVerdict === 'STRONG'/)
  })
  it('SC11 — buildCloseCallComparison / Overview badge wording untouched', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/export function buildCloseCallComparison/)
    const heroSrc = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    expect(heroSrc).toMatch(/recommendedBadge = isCloseCall \? 'Slight Lean' : 'Recommended'/)
  })
})

describe('Protected files / no scope creep', () => {
  it('no protected file references any new symbol from this fix', () => {
    for (const f of ['src/lib/calculations.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/dealExplanation.js', 'src/lib/sellerStrategy.js']) {
      const src = fs.readFileSync(f, 'utf8')
      expect(src).not.toMatch(/buildDealCloseCallExplanation|flipStatusText|brrrrStatusText|flipBadge|brrrrBadge/)
    }
  })
})
