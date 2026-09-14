// test/sep4CloseCallUXPolish.test.js
// HAT INVESTORS — SMALL CHANGE #11: Close-Call Strategy UX Polish.
// Presentation-only. resolveStrategyOutlook (SC10) is byte-unchanged —
// this only changes HOW a BOTH_VIABLE_CLOSE_CALL state is rendered:
//   1. Badge wording: "Recommended"/"Alternative" → "Slight Lean"/"Viable"
//      for a close call ONLY; clear winners keep Recommended/Alternative.
//   2. buildCloseCallComparison() replaces the dense 4-sentence bullet
//      list with a compact 4-row Flip-vs-BRRRR table + a dynamic
//      price-closeness callout — every value read from already-canonical
//      flip/brrrr fields, no new calculation, no fabricated value.
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../src/lib/dealExplanation.js'
import { deriveAcquisitionDecision, resolveStrategyOutlook, buildCloseCallComparison, buildCloseCallInsights } from '../src/lib/acquisitionDecisionPresentation.js'
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

describe('CASE A — Lazeau close call: comparison table, price-diff callout, bottom line, financials unchanged', () => {
  const { flip, brrrr, strategyRec, decision } = decide(LAZEAU)
  const outlook = resolveStrategyOutlook({ flip, brrrr, decision })
  const comparison = buildCloseCallComparison({ flip, brrrr })

  it('decision/outlook unchanged from SC10: NEGOTIATE, BOTH_VIABLE_CLOSE_CALL, canonical lean BRRRR', () => {
    expect(decision.state).toBe('NEGOTIATE')
    expect(decision.targetStrategy).toBe('BRRRR')
    expect(outlook.kind).toBe('BOTH_VIABLE_CLOSE_CALL')
    expect(outlook.lean).toBe('BRRRR')
  })
  it('financial numbers unchanged', () => {
    expect(Math.round(flip.mao)).toBe(120104)
    expect(Math.round(brrrr.mao)).toBe(118710)
    expect(brrrr.monthlyCashFlow).toBe(85)
    expect(brrrr.cashLeftIn).toBe(29346)
  })
  it('comparison table has exactly 4 rows: Max Buy, Return, Capital, Exit', () => {
    expect(comparison.rows.map(r => r.label)).toEqual(['Max Buy', 'Return', 'Capital', 'Exit'])
  })
  it('Max Buy row is dynamic, derived from flip.mao/brrrr.mao', () => {
    const row = comparison.rows.find(r => r.label === 'Max Buy')
    expect(row.flip).toMatch(/\$120\.1K/)
    expect(row.brrrr).toMatch(/\$118\.7K/)
  })
  it('Return row distinguishes profit (Flip) from monthly cash flow (BRRRR) — never implies same return type', () => {
    const row = comparison.rows.find(r => r.label === 'Return')
    expect(row.flip).toMatch(/profit/)
    expect(row.brrrr).toMatch(/\+\$85\/mo cash flow/)
  })
  it('Capital row uses the real BRRRR cash-left-in, never a fabricated $0', () => {
    const row = comparison.rows.find(r => r.label === 'Capital')
    expect(row.brrrr).toMatch(/\$29\.3K/)
    expect(row.flip).toMatch(/recycled/i)
  })
  it('Exit row is explanatory labeling only, no new calculation', () => {
    const row = comparison.rows.find(r => r.label === 'Exit')
    expect(row.flip).toMatch(/Sell/i)
    expect(row.brrrr).toMatch(/Hold/i)
  })
  it('the price-diff callout is dynamic, computed from |flip.mao - brrrr.mao|, not hardcoded', () => {
    const expectedDiff = Math.abs(flip.mao - brrrr.mao)
    expect(comparison.priceDiff).toBeCloseTo(expectedDiff, 0)
    expect(comparison.priceDiffLabel).toMatch(/\$1\.4K/)
  })
  it('no fabricated rental-area/1%-rule/low-risk claim anywhere in the comparison', () => {
    for (const row of comparison.rows) {
      expect(`${row.flip} ${row.brrrr}`).not.toMatch(/strong rental|great neighborhood|1% rule|low risk|strong cash flow/i)
    }
  })
  it('SC10\'s buildCloseCallInsights is untouched and still produces its original 4-item output (not removed, just no longer rendered)', () => {
    const insights = buildCloseCallInsights({ flip, brrrr })
    expect(insights.title).toBe('WHY THIS IS A CLOSE CALL')
    expect(insights.items.length).toBeGreaterThanOrEqual(3)
  })
})

describe('CASE B — clear BRRRR winner: RECOMMENDED/ALTERNATIVE badges preserved, no close-call comparison', () => {
  it('badges remain Recommended/Alternative; buildCloseCallComparison is not invoked (outlook is CLEAR_BRRRR)', () => {
    const lead = { id: 'case-b', asking_price: 115000, arv: 220000, renovation_cost: 35000, rent_estimate: 2400, hold_months: 6 }
    const { flip, brrrr, decision } = decide(lead)
    expect(decision.targetStrategy).toBe('BRRRR')
    const outlook = resolveStrategyOutlook({ flip, brrrr, decision })
    expect(outlook.kind).toBe('CLEAR_BRRRR')
    expect(outlook.kind).not.toBe('BOTH_VIABLE_CLOSE_CALL')
  })
})

describe('CASE C — clear FLIP winner: RECOMMENDED/ALTERNATIVE badges preserved, no close-call comparison', () => {
  it('outlook is CLEAR_FLIP, not a close call', () => {
    const lead = { id: 'case-c', asking_price: 100000, arv: 250000, renovation_cost: 40000, rent_estimate: 1500, hold_months: 6 }
    const { flip, brrrr, decision } = decide(lead)
    expect(decision.targetStrategy).toBe('FLIP')
    const outlook = resolveStrategyOutlook({ flip, brrrr, decision })
    expect(outlook.kind).toBe('CLEAR_FLIP')
  })
})

describe('CASE D — Flip only: no BRRRR comparison, buildCloseCallComparison returns null', () => {
  it('BRRRR unavailable → comparison table not built', () => {
    const lead = { id: 'case-d', asking_price: 80000, arv: 200000, renovation_cost: 30000, hold_months: 6 }
    const { flip, brrrr } = decide(lead)
    expect(buildCloseCallComparison({ flip, brrrr })).toBeNull()
  })
})

describe('CASE E — BRRRR only: no fake Flip comparison', () => {
  it('Flip Max Buy infeasible → comparison table not built', () => {
    const lead = { id: 'case-e', asking_price: 30000, arv: 150000, renovation_cost: 100000, rent_estimate: 2500, hold_months: 6 }
    const { flip, brrrr } = decide(lead)
    expect(flip.maoFeasible).toBe(false)
    expect(buildCloseCallComparison({ flip, brrrr })).toBeNull()
  })
})

describe('CASE F — Evergreen hard Buy Box PASS: unchanged, no strategy comparison', () => {
  it('PASS — NOT IN BUY BOX remains dominant; resolveStrategyOutlook still returns null', () => {
    const lead = { id: 'evergreen', asking_price: 175000, arv: 210000, renovation_cost: 40000, hold_months: 6 }
    const { flip, brrrr, decision } = decide(lead, { fit: { status: 'NOT_FIT', reasons: ['Blocked ZIP 32206'] } })
    expect(decision.state).toBe('PASS')
    expect(decision.headline).toBe('PASS — NOT IN BUY BOX')
    expect(resolveStrategyOutlook({ flip, brrrr, decision })).toBeNull()
  })
})

describe('CASE G — SC7 missing-rent fixture: unchanged, no close-call UI', () => {
  it('NEGOTIATE/PASS_NEGOTIABLE remains, Flip Max Buy ≈$91,140, no BRRRR comparison built', () => {
    const lead = { id: 'audit-test', asking_price: 100000, arv: 200000, renovation_cost: 50000, hold_months: 6 }
    const { flip, brrrr, decision } = decide(lead, { decisionV2Recommendation: 'PASS' })
    expect(Math.round(flip.mao)).toBe(91140)
    expect(decision.state).toBe('PASS_NEGOTIABLE')
    expect(buildCloseCallComparison({ flip, brrrr })).toBeNull()
  })
})

describe('CASE H — exact price difference is calculated, never hardcoded', () => {
  it('a synthetic close-call-shaped pair produces the exact computed gap, not a fixed literal', () => {
    // Construct flip/brrrr result objects directly (pure-function unit
    // test) to prove the label tracks whatever mao values are given —
    // not a hardcoded Lazeau-specific string.
    const flip = { available: true, maoFeasible: true, mao: 200000, targetProfit: 30000 }
    const brrrr = { available: true, mao: 197000, monthlyCashFlow: 120, cashLeftIn: 18000 }
    const comparison = buildCloseCallComparison({ flip, brrrr })
    expect(comparison.priceDiff).toBe(3000)
    expect(comparison.priceDiffLabel).toBe('$3.0K')
    expect(comparison.rows.find(r => r.label === 'Max Buy').flip).toBe('$200.0K')
    expect(comparison.rows.find(r => r.label === 'Max Buy').brrrr).toBe('$197.0K')
  })
})

describe('Part — badge wording and comparison table render in DecisionHero.jsx', () => {
  it('DealOpportunitySummary swaps badge text based on isCloseCall, without removing Recommended/Alternative for clear winners', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    expect(src).toMatch(/recommendedBadge = isCloseCall \? 'Slight Lean' : 'Recommended'/)
    expect(src).toMatch(/alternativeBadge = isCloseCall \? 'Viable' : 'Alternative'/)
    expect(src).toMatch(/buildCloseCallComparison/)
    expect(src).toMatch(/Only ~\{closeCallComparison\.priceDiffLabel\} apart in buy price/)
    expect(src).toMatch(/Bottom Line/)
  })
})

describe('SC1-SC10 preserved', () => {
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
  it('SC9 — buildStrategyInsights untouched', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/export function buildStrategyInsights/)
  })
  it('SC10 — resolveStrategyOutlook classification rule untouched (exact price-closeness/dominance logic)', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/export function resolveStrategyOutlook/)
    expect(src).toMatch(/const pricesClose = gap <= Math\.max\(5000, lowerMao \* 0\.05\)/)
    expect(src).toMatch(/const dominant = winnerVerdict === 'STRONG'/)
    expect(src).toMatch(/export function buildCloseCallInsights/)
  })
})

describe('Protected files / no scope creep', () => {
  it('no protected file references any new symbol from this fix', () => {
    for (const f of ['src/lib/calculations.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/dealExplanation.js', 'src/lib/sellerStrategy.js']) {
      const src = fs.readFileSync(f, 'utf8')
      expect(src).not.toMatch(/buildCloseCallComparison|recommendedBadge|alternativeBadge/)
    }
  })
})
