// test/sep4DealStrategyStatusAndFlipOffer.test.js
// HAT INVESTORS — SMALL CHANGE #14: Deal Tab Strategy Status + Flip Offer
// Economics Clarity. UX/PRESENTATION ONLY.
//
// Part A — resolveDealStrategyStatus (acquisitionDecisionPresentation.js,
// NEW, non-protected) reclassifies the Deal tab's "None — neither
// strategy qualifies" headline for the honest case where a strategy
// fails AT THE SELLER ASK but has a genuinely feasible lower Max Buy
// (Newman's shape). Reuses the SAME flip.maoFeasible/brrrr.available
// facts buildStrategyComparison already computed; never overrides
// strategyRec.preferredStrategy or `effective` itself.
//
// Part B — buildFlipPriceScenarios computes Seller Ask / Suggested Offer
// / Max Buy profit ALL via the SAME canonical computeFlipBreakdown
// read-only scenario helper (calculations.js, UNCHANGED) that
// buildDealOpportunitySummary [Small Change #3/#6] already uses for
// "profit at Max Buy" — no new formula, no duplicated calculation.
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../src/lib/dealExplanation.js'
import { buildStrategyComparison, resolveDealStrategyStatus, buildFlipPriceScenarios, resolveStrategyOutlook } from '../src/lib/acquisitionDecisionPresentation.js'

const NEWMAN = { id: 'newman', asking_price: 228890, arv: 250000, renovation_cost: 50000, hold_months: 6 }
const LAZEAU = { id: 'lazeau', asking_price: 160000, arv: 245000, renovation_cost: 60000, rent_estimate: 1500, hold_months: 6 }

function evaluate(lead) {
  const flip = computeFlipResult(lead, null)
  const brrrr = computeBrrrrResult(lead, null)
  const strategyRec = computeStrategyRecommendation(flip, brrrr)
  const comparison = buildStrategyComparison({ flip, brrrr, strategyRec, hasPrice: true })
  return { flip, brrrr, strategyRec, comparison, effective: comparison.recommended }
}

describe('TEST A — Newman: Strategy Status is honest, Flip Offer scenarios use canonical calculation', () => {
  const { flip, brrrr, comparison, effective } = evaluate(NEWMAN)
  const status = resolveDealStrategyStatus({ flip, brrrr, effective })
  const scenarios = buildFlipPriceScenarios({ flip, lead: NEWMAN, underwritingSettings: null })

  it('does NOT say "None — neither strategy qualifies" when Flip has a feasible lower Max Buy', () => {
    expect(effective).toBeNull() // canonical strategyRec.preferredStrategy is still 'NONE' — unchanged
    expect(status).toBeTruthy()
    expect(status.flip.label).toBe('Viable at lower price')
    expect(status.brrrr.label).toBe('Needs rent estimate')
    expect(status.explanation).not.toMatch(/neither strategy qualifies/i)
  })
  it('Ask/ARV/Rehab/Suggested Offer/Max Buy/current profit unchanged', () => {
    expect(NEWMAN.asking_price).toBe(228890)
    expect(NEWMAN.arv).toBe(250000)
    expect(NEWMAN.renovation_cost).toBe(50000)
    expect(Math.round(flip.currentOffer)).toBeCloseTo(133800, -2)
    expect(Math.round(flip.mao / 100) * 100).toBe(134500)
    expect(Math.round(flip.projectedProfit)).toBe(-71168)
  })
  it('Suggested Offer profit is computed via the canonical computeFlipBreakdown scenario helper, not hardcoded', () => {
    expect(scenarios.suggestedOffer.price).toBe(flip.currentOffer)
    expect(Math.round(scenarios.suggestedOffer.profit)).toBe(30768)
    expect(scenarios.suggestedOffer.breakdown).toBeTruthy()
    expect(scenarios.suggestedOffer.meetsTarget).toBe(true)
  })
  it('Max Buy profit is computed via the SAME canonical scenario helper, displaying the actual value (not a hardcoded $30,000)', () => {
    expect(Math.round(scenarios.maxBuy.profit)).toBe(30000)
    expect(scenarios.maxBuy.profit).not.toBe(30000) // genuinely computed float, not the literal integer
    expect(scenarios.maxBuy.breakdown).toBeTruthy()
  })
  it('Seller Ask scenario reuses flip.projectedProfit/flip.breakdown directly — no recomputation', () => {
    expect(scenarios.sellerAsk.price).toBe(flip.evaluationPrice)
    expect(scenarios.sellerAsk.profit).toBe(flip.projectedProfit)
    expect(scenarios.sellerAsk.breakdown).toBe(flip.breakdown)
    expect(scenarios.sellerAsk.meetsTarget).toBe(false)
  })
})

describe('TEST B — actual offer present: no conflation of Seller Ask/Actual Offer/Suggested Offer/Max Buy', () => {
  it('lead.offer_price sets evaluationPrice/actualOffer; flip.currentOffer (Suggested Offer) stays a separate, system-generated value', () => {
    const lead = { id: 'offer-case', asking_price: 160000, offer_price: 119000, arv: 245000, renovation_cost: 60000, rent_estimate: 1500, hold_months: 6 }
    const flip = computeFlipResult(lead, null)
    expect(flip.evaluationPrice).toBe(119000)
    expect(flip.actualOffer).toBe(119000)
    expect(flip.currentOffer).not.toBeUndefined()
    const scenarios = buildFlipPriceScenarios({ flip, lead, underwritingSettings: null })
    // Seller Ask scenario reuses evaluationPrice (which correctly followed the actual offer) — never re-derived independently.
    expect(scenarios.sellerAsk.price).toBe(flip.evaluationPrice)
  })
})

describe('TEST C — Lazeau: close-call classification and all financial values unchanged', () => {
  it('remains BOTH_VIABLE_CLOSE_CALL with canonical BRRRR lean; resolveDealStrategyStatus is not invoked for a close call (effective is truthy)', () => {
    const { flip, brrrr, comparison, effective } = evaluate(LAZEAU)
    expect(effective).toBe('BRRRR')
    const outlook = resolveStrategyOutlook({ flip, brrrr, decision: { targetStrategy: effective, buyBoxNotFit: false, priceUnknown: false } })
    expect(outlook.kind).toBe('BOTH_VIABLE_CLOSE_CALL')
    expect(outlook.lean).toBe('BRRRR')
    expect(Math.round(flip.mao)).toBe(120104)
    expect(Math.round(brrrr.mao)).toBe(118710)
    expect(brrrr.monthlyCashFlow).toBe(85)
    expect(brrrr.cashLeftIn).toBe(29346)
    // A real recommendation exists (`effective` truthy) — resolveDealStrategyStatus must return null.
    expect(resolveDealStrategyStatus({ flip, brrrr, effective })).toBeNull()
  })
})

describe('TEST D — missing rent: no fabricated BRRRR economics', () => {
  it('resolveDealStrategyStatus reports BRRRR as needing a rent estimate, never a fabricated Max Buy', () => {
    const { flip, brrrr, effective } = evaluate(NEWMAN)
    const status = resolveDealStrategyStatus({ flip, brrrr, effective })
    expect(status.brrrr.label).toBe('Needs rent estimate')
    expect(status.brrrr.detail).toBeNull()
  })
})

describe('TEST E — hard Buy Box PASS: unaffected (resolveDealStrategyStatus is a Deal-tab-only, non-Buy-Box-aware helper, matching pre-existing DealDecisionCenter scope)', () => {
  it('a NOT_FIT lead still resolves flip/brrrr/comparison normally — no Buy Box logic touched by this presentation helper', () => {
    const lead = { id: 'evergreen', asking_price: 175000, arv: 210000, renovation_cost: 40000, hold_months: 6 }
    const { flip, brrrr, effective } = evaluate(lead)
    // Function still works read-only regardless of Buy Box status — it never queries fit/buyBoxNotFit, consistent with DealDecisionCenter's pre-SC14 scope.
    expect(() => resolveDealStrategyStatus({ flip, brrrr, effective })).not.toThrow()
  })
})

describe('TEST F — clear Flip: unchanged, resolveDealStrategyStatus returns null (real recommendation exists)', () => {
  it('a clear Flip winner never gets the "viable at lower price" relabeling — it already has a real recommendation', () => {
    const lead = { id: 'case-c', asking_price: 100000, arv: 250000, renovation_cost: 40000, rent_estimate: 1500, hold_months: 6 }
    const { flip, brrrr, effective } = evaluate(lead)
    expect(effective).toBe('FLIP')
    expect(resolveDealStrategyStatus({ flip, brrrr, effective })).toBeNull()
  })
})

describe('TEST G — clear BRRRR: unchanged, resolveDealStrategyStatus returns null (real recommendation exists)', () => {
  it('a clear BRRRR winner never gets the "viable at lower price" relabeling', () => {
    const lead = { id: 'case-b', asking_price: 115000, arv: 220000, renovation_cost: 35000, rent_estimate: 2400, hold_months: 6 }
    const { flip, brrrr, effective } = evaluate(lead)
    expect(effective).toBe('BRRRR')
    expect(resolveDealStrategyStatus({ flip, brrrr, effective })).toBeNull()
  })
})

describe('Part — DealDecisionCenter.jsx integration, selector/edit behavior unchanged', () => {
  const dealSrc = fs.readFileSync('src/components/lead-detail/workspace/DealDecisionCenter.jsx', 'utf8')
  it('reuses resolveDealStrategyStatus/buildFlipPriceScenarios — no second strategy/financial engine', () => {
    expect(dealSrc).toMatch(/const dealStrategyStatus = priceKnown \? resolveDealStrategyStatus\(\{ flip, brrrr, effective \}\) : null/)
    expect(dealSrc).toMatch(/const flipScenarios = priceKnown && active === 'FLIP' \? buildFlipPriceScenarios/)
  })
  it('FLIP/BRRRR selector state and click behavior byte-identical to Small Change #13', () => {
    expect(dealSrc).toMatch(/const \[selectedStrategy, setSelectedStrategy\] = useState\(null\)/)
    expect(dealSrc).toMatch(/onClick=\{\(\) => setSelectedStrategy\(s\)\}/)
    expect(dealSrc).toMatch(/const active = selectedStrategy \|\| effective \|\| \(flip\.available \? 'FLIP' : 'BRRRR'\)/)
  })
  it('View Calculation infrastructure (CalculationDetails/CalculationRows) reused, not reimplemented', () => {
    expect(dealSrc).toMatch(/<CalculationDetails/)
    expect((dealSrc.match(/<CalculationDetails/g) || []).length).toBeGreaterThanOrEqual(3) // Suggested Offer + Max Buy + All-In Cost
  })
  it('SC13 layout hierarchy (Deal Inputs / Strategy Status / selector / Underwriting header) preserved', () => {
    expect(dealSrc).toMatch(/Deal Inputs<\/div>/)
    expect(dealSrc).toMatch(/Strategy Status<\/div>/)
    expect(dealSrc).toMatch(/\{active\} Underwriting<\/div>/)
  })
})

describe('SC1-SC13 preserved', () => {
  it('SC10 — resolveStrategyOutlook classification rule untouched', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/const pricesClose = gap <= Math\.max\(5000, lowerMao \* 0\.05\)/)
    expect(src).toMatch(/const dominant = winnerVerdict === 'STRONG'/)
  })
  it('SC12 — buildDealCloseCallExplanation / price-scenario status labels untouched', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/export function buildDealCloseCallExplanation/)
  })
  it('SC13 — PropertyInfoSection collapsed-by-default disclosure untouched', () => {
    const src = fs.readFileSync('src/pages/LeadDetailPage.jsx', 'utf8')
    expect(src).toMatch(/const \[showPropertyDetails, setShowPropertyDetails\] = useState\(false\)/)
  })
})

describe('Protected files / no scope creep', () => {
  it('no protected file references any new symbol from this fix', () => {
    for (const f of ['src/lib/calculations.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/dealExplanation.js', 'src/lib/sellerStrategy.js']) {
      const src = fs.readFileSync(f, 'utf8')
      expect(src).not.toMatch(/resolveDealStrategyStatus|buildFlipPriceScenarios/)
    }
  })
})
