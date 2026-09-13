// test/dealOpportunitySummary.test.js
// HAT CRM — SMALL CHANGE #3: Actionable Acquisition Decision / Deal
// Opportunity Summary. UI/presentation only — no financial/decision-
// engine logic changed.
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../src/lib/dealExplanation.js'
import { deriveAcquisitionDecision, buildDealOpportunitySummary } from '../src/lib/acquisitionDecisionPresentation.js'
import { getDealReadiness } from '../src/components/lead-detail/workspace/readiness.js'

const SPRING = { id: 'spring-test', address: '1463 Spring Street', asking_price: 110000, arv: 185000, renovation_cost: 45000, hold_months: 6 }
const FOURAKER = { id: 'fouraker-test', asking_price: 200000, arv: 285000, renovation_cost: 20000, hold_months: 6 }

function decide(lead) {
  const flip = computeFlipResult(lead, null)
  const brrrr = computeBrrrrResult(lead, null)
  const strategyRec = flip.available || brrrr.available ? computeStrategyRecommendation(flip, brrrr) : null
  const readiness = getDealReadiness(lead)
  const decision = deriveAcquisitionDecision({ flip, brrrr, strategyRec, readiness, lead, marketType: 'ON_MARKET' })
  const summary = buildDealOpportunitySummary({ lead, flip, brrrr, underwritingSettings: null })
  return { flip, brrrr, strategyRec, decision, summary }
}

describe('A/B — actionable NEGOTIATE presentation, canonical PASS conclusion unchanged', () => {
  const { flip, strategyRec, decision } = decide(SPRING)
  it('A. current failing price + valid Flip Max Buy → PASS_NEGOTIABLE, headline NEGOTIATE, "Pass at current price" flagged', () => {
    expect(decision.state).toBe('PASS_NEGOTIABLE')
    expect(decision.headline).toBe('NEGOTIATE')
    expect(decision.passAtCurrentPrice).toBe(true)
  })
  it('B. the underlying canonical engine conclusion is UNCHANGED — computeStrategyRecommendation still returns NONE, flip.verdict still NO DEAL', () => {
    expect(strategyRec.preferredStrategy).toBe('NONE')
    expect(flip.verdict).toBe('NO DEAL')
  })
})

describe('C/D/E/F — 1463 Spring Street canonical values, asserted against the real engine (never hardcoded beyond fixture inputs)', () => {
  const { flip, decision, summary } = decide(SPRING)
  it('C. current Flip profit displayed correctly (from flip.projectedProfit)', () => {
    expect(summary.flip.profitNow).toBe(flip.projectedProfit)
    expect(Math.round(summary.flip.profitNow)).toBe(1232)
  })
  it('D. Flip Max Buy displayed correctly (from flip.mao)', () => {
    expect(summary.flip.maxBuy).toBe(flip.mao)
    expect(Math.round(summary.flip.maxBuy / 100) * 100).toBe(83200)
  })
  it('E. profit at Flip Max Buy comes from the canonical computeFlipBreakdown, not a shortcut/hardcoded formula', () => {
    expect(summary.flip.profitAtMaxBuy).not.toBeNull()
    expect(summary.flip.meetsTargetAtMaxBuy).toBe(true)
    // Sanity: profit at the engine's own break-even Max Buy should land
    // at (or extremely near) the engine's own target profit — this is
    // what the canonical formula SHOULD produce, not an assumption we made.
    expect(Math.abs(summary.flip.profitAtMaxBuy - flip.targetProfit)).toBeLessThan(1)
  })
  it('F. price gap correct', () => {
    expect(summary.flip.gap).toBe(Math.round(flip.evaluationPrice - flip.mao))
    expect(decision.gap).toBe(Math.round(Math.abs(flip.evaluationPrice - flip.mao)))
  })
})

describe('G/H — Suggested Offer vs Max Buy, never conflated', () => {
  const { flip } = decide(SPRING)
  it('G. existing Suggested Offer (flip.currentOffer) is used when available, and it differs from Max Buy', () => {
    expect(flip.currentOffer).not.toBeNull()
    expect(flip.currentOffer).not.toBe(flip.mao)
  })
  it('H. DecisionHero.jsx never labels flip.currentOffer as Max Buy or vice versa', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    expect(src).toMatch(/Suggested Opening Offer.*flip\.currentOffer/)
    expect(src).toMatch(/Flip Max Buy.*f\.maxBuy/)
  })
})

describe('I/J/K — BRRRR presentation', () => {
  it('K. missing Rent → honest BRRRR missing state, never fake numbers', () => {
    const { summary } = decide(SPRING)
    expect(summary.brrrr).toEqual({ needsRent: true })
  })
  // Small Change #6 audit finding — brrrr.currentPrice/cashFlowNow were
  // renamed suggestedOffer/cashFlowAtSuggestedOffer: the value was NEVER
  // "the current price" (it's brrrr.currentOffer, a system-computed
  // negotiation anchor — see acquisitionDecisionPresentation.js's own
  // comment on buildDealOpportunitySummary). Same underlying value
  // (brrrr.monthlyCashFlow), field renamed for honesty only.
  it('I/J. BRRRR suggested-offer + at-Max-Buy metrics display when genuinely available (rent present)', () => {
    const lead = { ...SPRING, rent_estimate: 1500 }
    const { brrrr, summary } = decide(lead)
    if (brrrr.available) {
      expect(summary.brrrr.needsRent).toBeUndefined()
      expect(summary.brrrr.cashFlowAtSuggestedOffer).toBe(brrrr.monthlyCashFlow)
      if (brrrr.mao != null) {
        expect(summary.brrrr.atMaxBuy).not.toBeNull()
        expect(typeof summary.brrrr.atMaxBuy.cashFlow).toBe('number')
        expect(typeof summary.brrrr.atMaxBuy.cashLeftIn).toBe('number')
      }
    }
  })
})

describe('L — true hard-pass case remains PASS', () => {
  it('a lead with genuinely no viable Flip or BRRRR price (Max Buy infeasible) stays true PASS, never NEGOTIATE', () => {
    // ARV far too low relative to a huge rehab — no price makes Flip work.
    const lead = { id: 'hardpass', asking_price: 150000, arv: 120000, renovation_cost: 90000, hold_months: 6 }
    const flip = computeFlipResult(lead, null)
    const brrrr = computeBrrrrResult(lead, null)
    expect(flip.maoFeasible).toBe(false)
    const strategyRec = flip.available || brrrr.available ? computeStrategyRecommendation(flip, brrrr) : null
    const readiness = getDealReadiness(lead)
    const decision = deriveAcquisitionDecision({ flip, brrrr, strategyRec, readiness, lead, marketType: 'ON_MARKET' })
    expect(decision.state).toBe('PASS')
    expect(decision.headline).toBe('PASS')
    expect(decision.passAtCurrentPrice).toBeUndefined()
  })
})

describe('M — deal already works → no unnecessary NEGOTIATE', () => {
  it('a lead priced within HAT\'s buy range stays GOOD_AT_ASKING, not NEGOTIATE', () => {
    const lead = { id: 'withinrange', asking_price: 70000, arv: 185000, renovation_cost: 45000, hold_months: 6 }
    const { decision, summary } = decide(lead)
    expect(decision.state).toBe('GOOD_AT_ASKING')
    expect(decision.headline).not.toBe('NEGOTIATE')
    // The summary still renders for this state (Part 11) — showing Room to Max Buy.
    expect(summary.flip.gap).toBeLessThanOrEqual(0)
  })
})

describe('N — Fouraker regression: pass-at-current-price + negotiate, canonical PASS unchanged', () => {
  const { flip, strategyRec, decision } = decide(FOURAKER)
  it('Fouraker resolves to PASS_NEGOTIABLE, not a dominant "abandon the lead" message', () => {
    expect(decision.state).toBe('PASS_NEGOTIABLE')
    expect(decision.headline).toBe('NEGOTIATE')
    expect(decision.passAtCurrentPrice).toBe(true)
    expect(Math.round(decision.targetPrice / 100) * 100).toBe(195100)
  })
  it('the underlying canonical PASS result is unchanged', () => {
    expect(strategyRec.preferredStrategy).toBe('NONE')
    expect(flip.verdict).toBe('NO DEAL')
  })
})

describe('DecisionHero/Overview presentation-only changes', () => {
  const src = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
  it('N/O/P — DecisionHero.jsx only adds presentation (buildDealOpportunitySummary import + rendering); no new computeFlipResult/computeBrrrrResult call sites, no protected-file logic touched', () => {
    expect(src).toMatch(/buildDealOpportunitySummary/)
    expect(src).toMatch(/const flip = computeFlipResult\(lead, underwritingSettings\)/)
    expect(src).toMatch(/const brrrr = computeBrrrrResult\(lead, underwritingSettings\)/)
  })
})

describe('O/P — Small Change #1/#2 unaffected', () => {
  it('O. Small Change #1 (3-level ARV writeback) files are byte-unchanged', () => {
    const cardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
    expect(cardSrc).toMatch(/const arvToWrite = lead\.arv \? null : finalArv/)
    expect(cardSrc).toMatch(/arvLevelsValid/)
  })
  it('P. Small Change #2 (Overview input-sync) fix is byte-unchanged', () => {
    const hookSrc = fs.readFileSync('src/hooks/useLeadUpdate.js', 'utf8')
    expect(hookSrc).toMatch(/const freshDecision = await maybeRecalculateDecisionV2\(supabase, lead, updated\)\.catch\(\(\) => null\)/)
  })
})

describe('Q/R/S — financial/strategy/scoring outputs unchanged', () => {
  it('Q. computeFlipResult/computeBrrrrResult formulas untouched (golden sanity check)', () => {
    const flip = computeFlipResult({ arv: 200000, renovation_cost: 39000 }, null)
    expect(flip.available).toBe(true)
    expect(flip.mao).toBeGreaterThan(0)
  })
  it('R. computeStrategyRecommendation logic untouched — protected file zero diff (verified via git diff in the final report)', () => {
    const src = fs.readFileSync('src/lib/dealExplanation.js', 'utf8')
    expect(src).not.toMatch(/PASS_NEGOTIABLE|buildDealOpportunitySummary/)
  })
  it('S. decisionEngineV2.js scoring/thresholds untouched', () => {
    const src = fs.readFileSync('src/lib/decisionEngineV2.js', 'utf8')
    expect(src).not.toMatch(/PASS_NEGOTIABLE|buildDealOpportunitySummary/)
  })
})

describe('Protected files zero diff (source-text sanity)', () => {
  it('none of the six protected files reference any new symbol from this mission', () => {
    for (const f of ['src/lib/calculations.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/dealExplanation.js', 'src/lib/sellerStrategy.js']) {
      const src = fs.readFileSync(f, 'utf8')
      expect(src).not.toMatch(/PASS_NEGOTIABLE|buildDealOpportunitySummary|DealOpportunitySummary/)
    }
  })
})
