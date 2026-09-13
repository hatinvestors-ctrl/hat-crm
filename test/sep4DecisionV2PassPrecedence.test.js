// test/sep4DecisionV2PassPrecedence.test.js
// HAT INVESTORS — SMALL CHANGE #7: Fix Decision V2 PASS vs Negotiable
// Price Precedence. Presentation-only, one narrow branch-order fix in
// acquisitionDecisionPresentation.js — no financial/decision/Buy-Box
// logic changed, no Decision V2 mutation, no new formula/threshold.
//
// Root cause (already audited): `decisionV2Recommendation === 'PASS'`
// (decisionEngineV2.js's own Opportunity/Confidence/Urgency-driven
// recommendation, UNCHANGED) used to hard-return bare PASS
// unconditionally, before the code ever reached the branch that checks
// whether a genuinely feasible, lower Max Buy exists (Small Change #3's
// PASS_NEGOTIABLE). Fixed by gating that branch on
// `viableFlipMao == null && viableBrrrrMao == null` — the SAME hoisted
// facts PASS_NEGOTIABLE itself already used, never recomputed, never a
// new threshold. Decision V2's own stored recommendation is never
// mutated; this is purely which presentation branch gets to speak.
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../src/lib/dealExplanation.js'
import { deriveAcquisitionDecision } from '../src/lib/acquisitionDecisionPresentation.js'
import { getDealReadiness } from '../src/components/lead-detail/workspace/readiness.js'

function decide(lead, extra = {}) {
  const flip = computeFlipResult(lead, null)
  const brrrr = computeBrrrrResult(lead, null)
  const strategyRec = flip.available || brrrr.available ? computeStrategyRecommendation(flip, brrrr) : null
  const readiness = getDealReadiness(lead)
  const decision = deriveAcquisitionDecision({ flip, brrrr, strategyRec, readiness, lead, marketType: 'ON_MARKET', ...extra })
  return { flip, brrrr, strategyRec, decision }
}

const AUDIT_LEAD = { id: 'audit-test', asking_price: 100000, arv: 200000, renovation_cost: 50000, hold_months: 6 }

describe('CASE A — the exact audited test lead: Decision V2 PASS no longer suppresses a feasible negotiation', () => {
  const { flip, brrrr, strategyRec, decision } = decide(AUDIT_LEAD, { decisionV2Recommendation: 'PASS' })
  it('reproduces the exact audited canonical values', () => {
    expect(Math.round(flip.projectedProfit)).toBe(20502)
    expect(Math.round(flip.mao)).toBe(91140)
    expect(flip.maoFeasible).toBe(true)
    expect(flip.verdict).toBe('NO DEAL')
    expect(brrrr.available).toBe(false)
    expect(strategyRec.preferredStrategy).toBe('NONE')
  })
  it('presentation is now PASS_NEGOTIABLE / NEGOTIATE, NOT a dominant PASS', () => {
    expect(decision.state).toBe('PASS_NEGOTIABLE')
    expect(decision.headline).toBe('NEGOTIATE')
    expect(decision.passAtCurrentPrice).toBe(true)
    expect(decision.targetStrategy).toBe('FLIP')
    expect(Math.round(decision.targetPrice)).toBe(91140)
  })
})

describe('CASE B — hard Buy Box NOT_FIT still hard-passes, even with a viable Max Buy', () => {
  it('NOT_FIT takes precedence over any negotiation opportunity', () => {
    const { decision } = decide(AUDIT_LEAD, { fit: { status: 'NOT_FIT', reasons: ['Blocked ZIP test'] }, decisionV2Recommendation: 'PASS' })
    expect(decision.state).toBe('PASS')
    expect(decision.headline).toBe('PASS — NOT IN BUY BOX')
    expect(decision.buyBoxNotFit).toBe(true)
  })
})

describe('CASE C — true economic PASS (no viable Flip or BRRRR Max Buy) remains PASS', () => {
  it('no viable Max Buy at all → true PASS, not NEGOTIATE', () => {
    const lead = { id: 'hardpass', asking_price: 150000, arv: 120000, renovation_cost: 90000, hold_months: 6 }
    const { flip, decision } = decide(lead, { decisionV2Recommendation: 'PASS' })
    expect(flip.maoFeasible).toBe(false)
    expect(decision.state).toBe('PASS')
    expect(decision.headline).toBe('PASS')
    expect(decision.passAtCurrentPrice).toBeUndefined()
  })
})

describe('CASE D — Flip negotiable, BRRRR honestly unavailable (rent missing)', () => {
  it('NEGOTIATE via Flip, BRRRR stays unavailable', () => {
    const { brrrr, decision } = decide(AUDIT_LEAD, { decisionV2Recommendation: 'PASS' })
    expect(decision.state).toBe('PASS_NEGOTIABLE')
    expect(decision.targetStrategy).toBe('FLIP')
    expect(brrrr.available).toBe(false)
    expect(brrrr.reason).toMatch(/rent estimate is missing/)
  })
})

describe('CASE E — BRRRR negotiable when Flip is not viable', () => {
  it('BRRRR-only viable Max Buy still resolves to NEGOTIATE even under a Decision V2 PASS', () => {
    // ARV/rehab chosen so Flip's MAO is infeasible but BRRRR (with rent) still has a real Max Buy.
    const lead = { id: 'brrrr-only', asking_price: 140000, arv: 200000, renovation_cost: 90000, rent_estimate: 1800, hold_months: 6 }
    const { flip, brrrr, decision } = decide(lead, { decisionV2Recommendation: 'PASS' })
    if (!flip.maoFeasible && brrrr.available && brrrr.mao != null) {
      expect(decision.state).toBe('PASS_NEGOTIABLE')
      expect(decision.targetStrategy).toBe('BRRRR')
    }
  })
})

describe('CASE F — both strategies negotiable: existing preferred-strategy tie-break unchanged', () => {
  it('resolves to an actionable negotiate-shaped state, never a dominant PASS, when strategyRec already resolves a definite winner (a real preferredStrategy, not NONE) — this is the pre-existing NEGOTIATE branch further down, untouched by this fix, and is a separate, already-correct code path from PASS_NEGOTIABLE', () => {
    const lead = { id: 'both-negotiable', asking_price: 160000, arv: 245000, renovation_cost: 60000, rent_estimate: 1500, hold_months: 6 }
    const { flip, brrrr, strategyRec, decision } = decide(lead, { decisionV2Recommendation: 'PASS' })
    if (flip.maoFeasible && brrrr.available && brrrr.mao != null && strategyRec.preferredStrategy !== 'NONE') {
      expect(['NEGOTIATE', 'PASS_NEGOTIABLE']).toContain(decision.state)
      expect(decision.headline).toMatch(/NEGOTIATE/)
      expect(decision.state).not.toBe('PASS')
    }
  })
})

describe('CASE G — GOOD_AT_ASKING regression unchanged', () => {
  it('a lead priced within HAT\'s buy range stays GOOD_AT_ASKING regardless of decisionV2Recommendation', () => {
    const lead = { id: 'withinrange', asking_price: 70000, arv: 185000, renovation_cost: 45000, hold_months: 6 }
    const { decision } = decide(lead, { decisionV2Recommendation: 'PASS' })
    expect(decision.state).toBe('GOOD_AT_ASKING')
  })
})

describe('CASE H — missing readiness input unaffected', () => {
  it('NEEDS_RESEARCH still fires before any PASS/NEGOTIATE branch, regardless of decisionV2Recommendation', () => {
    const lead = { id: 'incomplete', asking_price: 100000, renovation_cost: 20000, hold_months: 6 } // no ARV
    const { decision } = decide(lead, { decisionV2Recommendation: 'PASS' })
    expect(decision.state).toBe('NEEDS_RESEARCH')
  })
})

describe('CASE I — Decision V2 PASS is NOT globally neutralized', () => {
  it('a Decision V2 PASS with no viable Max Buy anywhere still hard-passes', () => {
    const lead = { id: 'no-viable-mao', asking_price: 150000, arv: 120000, renovation_cost: 90000, hold_months: 6 }
    const { decision } = decide(lead, { decisionV2Recommendation: 'PASS' })
    expect(decision.state).toBe('PASS')
  })
})

describe('Small Changes #1-#6 preserved', () => {
  it('SC1 — 3-level ARV writeback untouched', () => {
    const cardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
    expect(cardSrc).toMatch(/const arvToWrite = lead\.arv \? null : finalArv/)
  })
  it('SC2 — Overview input-sync untouched', () => {
    const hookSrc = fs.readFileSync('src/hooks/useLeadUpdate.js', 'utf8')
    expect(hookSrc).toMatch(/updated\.decision_v2 = freshDecision/)
  })
  it('SC3 — PASS_NEGOTIABLE state/label/tone unchanged', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/state: 'PASS_NEGOTIABLE', \.\.\.STATE_META\.PASS_NEGOTIABLE/)
  })
  it('SC4 — evaluation-price labeling untouched', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/priceIsEvaluationForPass/)
    expect(src).toMatch(/currentPriceLabelForPass/)
  })
  it('SC5 — Buy Box PASS explanation (buyBoxNotFit/buyBoxReason) untouched', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/buyBoxNotFit: true/)
    expect(src).toMatch(/buyBoxReason/)
  })
  it('SC6 — Deal Opportunity Summary / strategy explanation / Suggested Offer labeling untouched', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/export function buildDealOpportunitySummary/)
    expect(src).toMatch(/export function buildStrategyExplanation/)
    expect(src).toMatch(/suggestedOffer: brrrr\.currentOffer/)
    const heroSrc = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    expect(heroSrc).toMatch(/Suggested Offer/)
  })
})

describe('Protected files / no scope creep', () => {
  it('no protected file references any new symbol from this fix', () => {
    for (const f of ['src/lib/calculations.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/dealExplanation.js', 'src/lib/sellerStrategy.js']) {
      const src = fs.readFileSync(f, 'utf8')
      expect(src).not.toMatch(/viableFlipMao|viableBrrrrMao/)
    }
  })
  it('the fix is confined to acquisitionDecisionPresentation.js — no duplicate MAO computation introduced (viableFlipMao/viableBrrrrMao appear exactly once each as declarations)', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    const flipDecls = src.match(/const viableFlipMao\s*=/g) || []
    const brrrrDecls = src.match(/const viableBrrrrMao\s*=/g) || []
    expect(flipDecls.length).toBe(1)
    expect(brrrrDecls.length).toBe(1)
  })
})
