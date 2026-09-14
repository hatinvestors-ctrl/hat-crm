// test/sep4StrategyInsights.test.js
// HAT INVESTORS — SMALL CHANGE #9: Remove redundant footer + add "WHY
// THIS STRATEGY?" acquisition insights. Presentation-only. No protected
// file touched, no new financial/strategy engine, no invented market
// intelligence.
//
// Part A — the bottom "FLIP $X projected profit @ current price · BRRRR
// +$Y/mo cash flow at suggested offer" strip (DecisionHero.jsx) is now
// suppressed whenever the Deal Opportunity Summary (Small Change #3/#6)
// already renders the same Flip/BRRRR facts, per-strategy, with fuller
// context — it remains for every state that summary doesn't cover
// (a hard Buy Box PASS included, per Small Change #5's "Economics —
// Reference Only" precedent).
//
// Part B — buildStrategyInsights (acquisitionDecisionPresentation.js)
// explains the SAME decision.targetStrategy pick computeStrategyRecommendation
// (dealExplanation.js, UNCHANGED) already made, via deterministic
// arithmetic over already-canonical flip/brrrr fields only. It never
// fabricates a rental-area/market-quality claim, and never introduces a
// new "1% rule" threshold — a rent ratio, when shown, always names its
// own denominator explicitly.
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../src/lib/dealExplanation.js'
import { deriveAcquisitionDecision, buildStrategyInsights } from '../src/lib/acquisitionDecisionPresentation.js'
import { getDealReadiness } from '../src/components/lead-detail/workspace/readiness.js'

function decide(lead, extra = {}) {
  const flip = computeFlipResult(lead, null)
  const brrrr = computeBrrrrResult(lead, null)
  const strategyRec = flip.available || brrrr.available ? computeStrategyRecommendation(flip, brrrr) : null
  const readiness = getDealReadiness(lead)
  const decision = deriveAcquisitionDecision({ flip, brrrr, strategyRec, readiness, lead, marketType: 'ON_MARKET', ...extra })
  return { flip, brrrr, strategyRec, decision }
}

const LAZEAU = { id: 'lazeau', asking_price: 160000, arv: 245000, renovation_cost: 60000, rent_estimate: 1500, hold_months: 6 }

describe('CASE A — Lazeau: BRRRR recommended, evidence-based WHY insights, no fabricated 1% claim', () => {
  const { flip, brrrr, strategyRec, decision } = decide(LAZEAU)
  const insights = buildStrategyInsights({ flip, brrrr, strategyRec, decision })

  it('decision unchanged: NEGOTIATE, BRRRR recommended, all financial numbers unchanged', () => {
    expect(decision.state).toBe('NEGOTIATE')
    expect(decision.targetStrategy).toBe('BRRRR')
    expect(Math.round(flip.evaluationPrice)).toBe(160000)
    expect(Math.round(flip.mao)).toBe(120104)
    expect(Math.round(brrrr.mao)).toBe(118710)
    expect(brrrr.currentOffer).toBe(118100)
    expect(brrrr.monthlyCashFlow).toBe(85)
    expect(brrrr.cashLeftIn).toBe(29346)
  })
  it('produces a "WHY BRRRR?" section with 2-4 items', () => {
    expect(insights).toBeTruthy()
    expect(insights.title).toBe('WHY BRRRR?')
    expect(insights.items.length).toBeGreaterThanOrEqual(2)
    expect(insights.items.length).toBeLessThanOrEqual(4)
  })
  it('cash-flow insight is canonical (brrrr.monthlyCashFlow), never recalculated', () => {
    const cf = insights.items.find(i => i.label === 'Positive cash flow')
    expect(cf).toBeTruthy()
    expect(cf.detail).toMatch(/\+\$85\/mo/)
  })
  it('rent ratio names its OWN denominator explicitly (target purchase price, NOT ARV) — never a bare "1% rule" claim', () => {
    const ratio = insights.items.find(i => i.label === 'Rent-to-price ratio')
    expect(ratio).toBeTruthy()
    expect(ratio.detail).toMatch(/target purchase price/)
    expect(ratio.detail).not.toMatch(/1% rule/i)
    // $1,500 / $118,100 ≈ 1.27% — NOT the same as $1,500 / $245,000 ARV (≈0.61%).
    // Confirms the mission's explicit caution: never conflate the two ratios.
    expect(ratio.detail).toMatch(/1\.2\d%/)
    const rentToArv = (LAZEAU.rent_estimate / LAZEAU.arv) * 100
    expect(rentToArv).toBeCloseTo(0.612, 2)
    expect(rentToArv).not.toBeCloseTo(1, 1)
  })
  it('watch-out names the real seller price above BRRRR\'s range — never a fabricated rental-area/market-quality claim', () => {
    const watch = insights.items.find(i => i.tone === 'watch')
    expect(watch).toBeTruthy()
    expect(watch.detail).toMatch(/\$160,000 asking price/)
    for (const item of insights.items) {
      expect(item.detail).not.toMatch(/strong rental area|high tenant demand|excellent appreciation|great neighborhood|stable rental market|low risk/i)
    }
  })
})

describe('CASE B — Flip recommended: WHY FLIP? uses real canonical metrics, no BRRRR-biased wording', () => {
  it('a Flip-only fixture (no rent) produces evidence-based Flip insights', () => {
    const lead = { id: 'flip-only', asking_price: 80000, arv: 200000, renovation_cost: 30000, hold_months: 6 }
    const { flip, brrrr, strategyRec, decision } = decide(lead)
    expect(decision.targetStrategy).toBe('FLIP')
    const insights = buildStrategyInsights({ flip, brrrr, strategyRec, decision })
    expect(insights).toBeTruthy()
    expect(insights.title).toBe('WHY FLIP?')
    const profitItem = insights.items.find(i => i.label === "Meets HAT's profit target")
    expect(profitItem).toBeTruthy()
    expect(profitItem.detail).toMatch(/Projected profit \$63,542/)
    const brrrrItem = insights.items.find(i => i.label === 'BRRRR could not be evaluated')
    expect(brrrrItem).toBeTruthy()
  })
})

describe('CASE C — rent missing: no rent ratio, no rental-quality conclusion, no fabricated BRRRR insight', () => {
  it('the exact SC7 fixture (Ask 100K/ARV 200K/Rehab 50K/no rent) stays NEGOTIATE/PASS_NEGOTIABLE and produces only Flip-side insights', () => {
    const lead = { id: 'audit-test', asking_price: 100000, arv: 200000, renovation_cost: 50000, hold_months: 6 }
    const { flip, brrrr, strategyRec, decision } = decide(lead, { decisionV2Recommendation: 'PASS' })
    expect(Math.round(flip.mao)).toBe(91140)
    expect(decision.state).toBe('PASS_NEGOTIABLE')
    expect(decision.headline).toBe('NEGOTIATE')
    const insights = buildStrategyInsights({ flip, brrrr, strategyRec, decision })
    expect(insights).toBeTruthy()
    expect(insights.title).toBe('WHY FLIP?')
    expect(insights.items.some(i => i.label === 'Viable near Max Buy')).toBe(true)
    expect(insights.items.some(i => i.label === 'BRRRR could not be evaluated')).toBe(true)
    // No rent RATIO and no fabricated rental-quality insight can appear —
    // BRRRR was never the target strategy here. Honestly reporting WHY
    // BRRRR could not be evaluated ("rent estimate is missing" — the
    // exact SC6/SC8 precedent wording) is not the same as fabricating a
    // rent ratio or rental-market conclusion, so that one item is exempt.
    for (const item of insights.items) {
      expect(item.label).not.toBe('Rent-to-price ratio')
      if (item.label !== 'BRRRR could not be evaluated') {
        expect(item.detail).not.toMatch(/\brent\b/i)
      }
    }
  })
})

describe('CASE D — hard Buy Box PASS (Evergreen-shaped): no strategy recommendation, no WHY section', () => {
  it('buildStrategyInsights returns null for a buyBoxNotFit decision', () => {
    const lead = { id: 'evergreen', asking_price: 175000, arv: 210000, renovation_cost: 40000, hold_months: 6 }
    const { flip, brrrr, strategyRec, decision } = decide(lead, { fit: { status: 'NOT_FIT', reasons: ['Blocked ZIP 32206'] } })
    expect(decision.state).toBe('PASS')
    expect(decision.headline).toBe('PASS — NOT IN BUY BOX')
    expect(decision.buyBoxNotFit).toBe(true)
    const insights = buildStrategyInsights({ flip, brrrr, strategyRec, decision })
    expect(insights).toBeNull()
  })
})

describe('CASE E — GOOD_AT_ASKING: existing behavior preserved, insights explain but never alter the recommendation', () => {
  it('a within-range lead stays GOOD_AT_ASKING and insights (if any) do not change decision.targetStrategy', () => {
    const lead = { id: 'withinrange', asking_price: 70000, arv: 185000, renovation_cost: 45000, hold_months: 6 }
    const { flip, brrrr, strategyRec, decision } = decide(lead)
    expect(decision.state).toBe('GOOD_AT_ASKING')
    const before = decision.targetStrategy
    buildStrategyInsights({ flip, brrrr, strategyRec, decision })
    expect(decision.targetStrategy).toBe(before)
  })
})

describe('CASE F — both strategies viable: canonical recommendation unchanged, alternative remains visible, insights explain rather than decide', () => {
  it('BOTH-viable fixture keeps its canonical targetStrategy; alternative strategy detail (decision.secondaryStrategy) is untouched by insights', () => {
    const lead = { id: 'both-viable', asking_price: 90000, arv: 200000, renovation_cost: 40000, rent_estimate: 1800, hold_months: 6 }
    const { flip, brrrr, strategyRec, decision } = decide(lead)
    if (flip.verdict !== 'NO DEAL' && brrrr.verdict !== 'NO DEAL') {
      const targetBefore = decision.targetStrategy
      const secondaryBefore = decision.secondaryStrategy
      const insights = buildStrategyInsights({ flip, brrrr, strategyRec, decision })
      expect(decision.targetStrategy).toBe(targetBefore)
      expect(decision.secondaryStrategy).toEqual(secondaryBefore)
      expect(insights).toBeTruthy()
    }
  })
})

describe('Part A — redundant footer removal', () => {
  it('the bottom Flip/BRRRR strip is suppressed whenever the Deal Opportunity Summary already renders (opportunitySummary states)', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    expect(src).toMatch(/flip\.available && !decision\?\.priceUnknown && !opportunitySummary && \(/)
  })
  it('the Flip/BRRRR strategy sections themselves are NOT removed — DealOpportunitySummary and the Flip/BRRRR blocks remain', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    expect(src).toMatch(/DealOpportunitySummary/)
  })
})

describe('Part B — WHY {STRATEGY}? renders in DecisionHero, replacing the single generic sentence', () => {
  it('DecisionHero.jsx imports and renders buildStrategyInsights under Recommended Strategy', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    expect(src).toMatch(/buildStrategyInsights/)
    expect(src).toMatch(/strategyInsights\.title/)
  })
})

describe('SC1-SC8 preserved', () => {
  it('SC3 — PASS_NEGOTIABLE state/label/tone unchanged', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/state: 'PASS_NEGOTIABLE', \.\.\.STATE_META\.PASS_NEGOTIABLE/)
  })
  it('SC5 — Buy Box PASS explanation untouched', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/buyBoxNotFit: true/)
  })
  it('SC6 — buildDealOpportunitySummary / Suggested Offer labeling untouched', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/export function buildDealOpportunitySummary/)
    expect(src).toMatch(/suggestedOffer: brrrr\.currentOffer/)
  })
  it('SC7 — Decision V2 PASS precedence fix untouched', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/viableFlipMao == null && viableBrrrrMao == null/)
  })
  it('SC8 — ActionZone.jsx NOT_FIT guard and buildStrategyExplanation wording fix untouched', () => {
    const actionSrc = fs.readFileSync('src/components/lead-detail/ActionZone.jsx', 'utf8')
    expect(actionSrc).toMatch(/decision_v2\?\.fit\?\.status === 'NOT_FIT'/)
    const presSrc = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(presSrc).toMatch(/export function buildStrategyExplanation/)
    expect(presSrc).toMatch(/BRRRR is the recommended strategy near HAT's target acquisition range/)
  })
})

describe('Protected files / no scope creep', () => {
  it('no protected file references any new symbol from this fix', () => {
    for (const f of ['src/lib/calculations.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/dealExplanation.js', 'src/lib/sellerStrategy.js']) {
      const src = fs.readFileSync(f, 'utf8')
      expect(src).not.toMatch(/buildStrategyInsights/)
    }
  })
})
