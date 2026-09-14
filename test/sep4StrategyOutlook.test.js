// test/sep4StrategyOutlook.test.js
// HAT INVESTORS — SMALL CHANGE #10: Strategy Strength / Close-Call
// Outlook. Presentation-only. No protected file touched, no new
// financial threshold, computeStrategyRecommendation (dealExplanation.js)
// never modified or overridden.
//
// resolveStrategyOutlook (acquisitionDecisionPresentation.js) classifies
// whether the SAME canonical decision.targetStrategy pick should be
// PRESENTED as a strong/clear recommendation or a genuine close call,
// via two deterministic gates over already-canonical fields only:
//   1. Price closeness: |flip.mao - brrrr.mao| <= max($5,000, 5% of the
//      lower Max Buy).
//   2. Quality dominance override: the winning strategy's OWN canonical
//      verdict (flip.verdict/brrrr.verdict, computed entirely inside
//      dealExplanation.js) must not be STRONG — reusing that qualitative
//      tier rather than duplicating dealExplanation.js's un-exported
//      internal BRRRR STRONG thresholds.
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../src/lib/dealExplanation.js'
import { deriveAcquisitionDecision, resolveStrategyOutlook, buildCloseCallInsights } from '../src/lib/acquisitionDecisionPresentation.js'
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

describe('CASE A — Lazeau: close call, no clear winner, financials unchanged', () => {
  const { flip, brrrr, strategyRec, decision } = decide(LAZEAU)
  const outlook = resolveStrategyOutlook({ flip, brrrr, decision })

  it('decision remains NEGOTIATE, canonical preferredStrategy still BRRRR-leaning, financial numbers unchanged', () => {
    expect(decision.state).toBe('NEGOTIATE')
    expect(decision.targetStrategy).toBe('BRRRR')
    expect(Math.round(flip.mao)).toBe(120104)
    expect(Math.round(brrrr.mao)).toBe(118710)
    expect(brrrr.currentOffer).toBe(118100)
    expect(brrrr.monthlyCashFlow).toBe(85)
    expect(brrrr.cashLeftIn).toBe(29346)
  })
  it('is classified BOTH_VIABLE_CLOSE_CALL with a slight BRRRR lean', () => {
    expect(outlook).toBeTruthy()
    expect(outlook.kind).toBe('BOTH_VIABLE_CLOSE_CALL')
    expect(outlook.lean).toBe('BRRRR')
  })
  it('close-call insights show similar acquisition range, BRRRR cash flow, Flip viability, and capital trade-off', () => {
    const insights = buildCloseCallInsights({ flip, brrrr })
    expect(insights.title).toBe('WHY THIS IS A CLOSE CALL')
    expect(insights.items.length).toBeGreaterThanOrEqual(3)
    expect(insights.items.length).toBeLessThanOrEqual(4)
    const range = insights.items.find(i => i.label === 'Similar acquisition range')
    expect(range.detail).toMatch(/\$120,104/)
    expect(range.detail).toMatch(/\$118,710/)
    const income = insights.items.find(i => i.label === 'BRRRR produces recurring income')
    expect(income.detail).toMatch(/\+\$85\/mo/)
    expect(income.detail).toMatch(/\$29,346/)
    const flipViable = insights.items.find(i => i.label === 'Flip is equally viable near this price')
    expect(flipViable.detail).toMatch(/\$30,000/)
    // Never overstate +$85/mo as "strong" cash flow, and never a
    // fabricated rental-area/1%-rule/low-risk claim anywhere.
    for (const item of insights.items) {
      expect(item.detail).not.toMatch(/strong rental|great neighborhood|1% rule|low risk|strong cash flow/i)
    }
  })
})

describe('CASE B — clear BRRRR winner via quality dominance (close Max Buy prices, but BRRRR verdict STRONG)', () => {
  it('dominance overrides price-closeness — presented as a clear BRRRR recommendation, not Both Viable', () => {
    const lead = { id: 'case-b', asking_price: 115000, arv: 220000, renovation_cost: 35000, rent_estimate: 2400, hold_months: 6 }
    const { flip, brrrr, decision } = decide(lead)
    expect(flip.verdict).toBe('PASS')
    expect(brrrr.verdict).toBe('STRONG')
    expect(decision.targetStrategy).toBe('BRRRR')
    // Confirms the fixture genuinely has close Max Buy prices, so this
    // case is testing the QUALITY gate, not just the price gate.
    const gap = Math.abs(flip.mao - brrrr.mao)
    expect(gap).toBeLessThanOrEqual(Math.max(5000, Math.min(flip.mao, brrrr.mao) * 0.05))
    const outlook = resolveStrategyOutlook({ flip, brrrr, decision })
    expect(outlook.kind).toBe('CLEAR_BRRRR')
  })
})

describe('CASE C — clear FLIP winner via quality dominance (close Max Buy prices, but Flip verdict STRONG)', () => {
  it('dominance overrides price-closeness — presented as a clear FLIP recommendation, not Both Viable', () => {
    const lead = { id: 'case-c', asking_price: 100000, arv: 250000, renovation_cost: 40000, rent_estimate: 1500, hold_months: 6 }
    const { flip, brrrr, decision } = decide(lead)
    expect(flip.verdict).toBe('STRONG')
    expect(brrrr.verdict).toBe('PASS')
    expect(decision.targetStrategy).toBe('FLIP')
    const gap = Math.abs(flip.mao - brrrr.mao)
    expect(gap).toBeLessThanOrEqual(Math.max(5000, Math.min(flip.mao, brrrr.mao) * 0.05))
    const outlook = resolveStrategyOutlook({ flip, brrrr, decision })
    expect(outlook.kind).toBe('CLEAR_FLIP')
  })
})

describe('CASE D — Flip only (BRRRR unavailable, no rent): no close call, no fabricated BRRRR comparison', () => {
  it('resolves FLIP_ONLY', () => {
    const lead = { id: 'case-d', asking_price: 80000, arv: 200000, renovation_cost: 30000, hold_months: 6 }
    const { flip, brrrr, decision } = decide(lead)
    expect(decision.targetStrategy).toBe('FLIP')
    const outlook = resolveStrategyOutlook({ flip, brrrr, decision })
    expect(outlook.kind).toBe('FLIP_ONLY')
  })
})

describe('CASE E — BRRRR only (Flip Max Buy infeasible): no close call', () => {
  it('resolves BRRRR_ONLY', () => {
    const lead = { id: 'case-e', asking_price: 30000, arv: 150000, renovation_cost: 100000, rent_estimate: 2500, hold_months: 6 }
    const { flip, brrrr, decision } = decide(lead)
    expect(flip.maoFeasible).toBe(false)
    expect(brrrr.mao).not.toBeNull()
    expect(decision.targetStrategy).toBe('BRRRR')
    const outlook = resolveStrategyOutlook({ flip, brrrr, decision })
    expect(outlook.kind).toBe('BRRRR_ONLY')
  })
})

describe('CASE F — hard Buy Box PASS (Evergreen-shaped): no strategy outlook override', () => {
  it('resolveStrategyOutlook returns null; PASS — NOT IN BUY BOX remains dominant', () => {
    const lead = { id: 'evergreen', asking_price: 175000, arv: 210000, renovation_cost: 40000, hold_months: 6 }
    const { flip, brrrr, decision } = decide(lead, { fit: { status: 'NOT_FIT', reasons: ['Blocked ZIP 32206'] } })
    expect(decision.state).toBe('PASS')
    expect(decision.headline).toBe('PASS — NOT IN BUY BOX')
    expect(decision.buyBoxNotFit).toBe(true)
    const outlook = resolveStrategyOutlook({ flip, brrrr, decision })
    expect(outlook).toBeNull()
  })
})

describe('CASE G — SC7 missing-rent fixture: NEGOTIATE/PASS_NEGOTIABLE, Flip only, no fabricated BRRRR comparison', () => {
  it('resolves FLIP_ONLY and Flip Max Buy remains ≈$91,140', () => {
    const lead = { id: 'audit-test', asking_price: 100000, arv: 200000, renovation_cost: 50000, hold_months: 6 }
    const { flip, brrrr, decision } = decide(lead, { decisionV2Recommendation: 'PASS' })
    expect(Math.round(flip.mao)).toBe(91140)
    expect(decision.state).toBe('PASS_NEGOTIABLE')
    expect(decision.headline).toBe('NEGOTIATE')
    const outlook = resolveStrategyOutlook({ flip, brrrr, decision })
    expect(outlook.kind).toBe('FLIP_ONLY')
  })
})

describe('CASE H — GOOD_AT_ASKING: existing behavior remains valid, close-call presentation allowed only when genuinely close', () => {
  it('a within-range lead with only Flip viable stays a clear FLIP recommendation (not Both Viable)', () => {
    const lead = { id: 'withinrange', asking_price: 70000, arv: 185000, renovation_cost: 45000, hold_months: 6 }
    const { flip, brrrr, decision } = decide(lead)
    expect(decision.state).toBe('GOOD_AT_ASKING')
    const outlook = resolveStrategyOutlook({ flip, brrrr, decision })
    expect(outlook.kind).toBe('FLIP_ONLY')
  })
})

describe('Part — the redundant "Recommended Strategy" line is suppressed exactly for a close call', () => {
  it('DecisionHero.jsx branches on isCloseCall, and suppresses the Alternative Strategy line only in that branch', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    expect(src).toMatch(/resolveStrategyOutlook/)
    expect(src).toMatch(/BOTH VIABLE — NO CLEAR WINNER/)
    expect(src).toMatch(/Slight lean:/)
    expect(src).toMatch(/decision\?\.targetStrategy && !decision\.priceUnknown && !isCloseCall/)
    expect(src).toMatch(/decision\?\.targetStrategy && decision\.secondaryStrategy && !isCloseCall/)
  })
})

describe('SC1-SC9 preserved', () => {
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
  })
  it('SC9 — buildStrategyInsights and the redundant-footer suppression untouched', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/export function buildStrategyInsights/)
    const heroSrc = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    expect(heroSrc).toMatch(/flip\.available && !decision\?\.priceUnknown && !opportunitySummary && \(/)
  })
})

describe('Protected files / no scope creep', () => {
  it('no protected file references any new symbol from this fix', () => {
    for (const f of ['src/lib/calculations.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/dealExplanation.js', 'src/lib/sellerStrategy.js']) {
      const src = fs.readFileSync(f, 'utf8')
      expect(src).not.toMatch(/resolveStrategyOutlook|buildCloseCallInsights|BOTH_VIABLE_CLOSE_CALL/)
    }
  })
  it('computeStrategyRecommendation itself is byte-unchanged in structure (still the 4-branch flipOk/brrrrOk shape)', () => {
    const src = fs.readFileSync('src/lib/dealExplanation.js', 'utf8')
    expect(src).toMatch(/export function computeStrategyRecommendation\(flip, brrrr\) \{/)
    expect(src).toMatch(/const VERDICT_RANK = \{ STRONG: 3, PASS: 2, WATCH: 1, 'NO DEAL': 0 \}/)
  })
})
