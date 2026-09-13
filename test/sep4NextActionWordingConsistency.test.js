// test/sep4NextActionWordingConsistency.test.js
// HAT INVESTORS — SMALL CHANGE #8: Acquisition Decision / Next Action
// Wording Consistency. Presentation-only. No protected file touched, no
// financial/decision/Buy-Box/Action-Center-engine logic changed.
//
// Issue #1 — ActionZone.jsx's smartHint/smartActions ("Next Best Action")
// had zero Buy Box awareness and could recommend negotiation ("Seller is
// $X above Max Buy... Start Negotiating") even for a lead the SAME page's
// primary Acquisition Decision card already hard-excludes via
// lead.decision_v2.fit.status === 'NOT_FIT' (decisionEngineV2.js/
// buyBox.js, UNCHANGED). Fixed by reusing that EXISTING stored field —
// never recomputing Buy Box, never touching buyBox.js.
//
// Issue #2 — buildStrategyExplanation (acquisitionDecisionPresentation.js)
// claimed "BRRRR meets HAT's target at the current price" whenever
// brrrr.verdict !== 'NO DEAL', but brrrr.verdict is always computed at
// brrrr.currentOffer (a system-generated negotiation ANCHOR,
// calculations.js, UNCHANGED) — not necessarily the real current price
// (flip.evaluationPrice: actual offer, else asking price). Proven false
// for 7726 Lazeau Dr (ask $160,000 vs. BRRRR Max Buy ~$118,900). Fixed by
// only using "at the current price" wording when the real current price
// is at or below the strategy's own Max Buy; otherwise stating honestly
// that the strategy qualifies near its own target acquisition range.
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../src/lib/dealExplanation.js'
import { deriveAcquisitionDecision, buildStrategyExplanation } from '../src/lib/acquisitionDecisionPresentation.js'
import { getDealReadiness } from '../src/components/lead-detail/workspace/readiness.js'
import { smartHint } from '../src/components/lead-detail/ActionZone.jsx'

function decide(lead, extra = {}) {
  const flip = computeFlipResult(lead, null)
  const brrrr = computeBrrrrResult(lead, null)
  const strategyRec = flip.available || brrrr.available ? computeStrategyRecommendation(flip, brrrr) : null
  const readiness = getDealReadiness(lead)
  const decision = deriveAcquisitionDecision({ flip, brrrr, strategyRec, readiness, lead, marketType: 'ON_MARKET', ...extra })
  return { flip, brrrr, strategyRec, decision }
}

const LAZEAU = { id: 'lazeau', asking_price: 160000, arv: 245000, renovation_cost: 60000, rent_estimate: 1500, hold_months: 6 }
const EVERGREEN = { id: 'evergreen', status: 'new_lead', asking_price: 175000, arv: 210000, renovation_cost: 40000, hold_months: 6, deal_analysis: { verdict: 'NO DEAL' } }

describe('CASE A — hard Buy Box NOT_FIT (Evergreen-shaped): Next Best Action no longer contradicts PASS — NOT IN BUY BOX', () => {
  it('smartHint returns a Buy-Box-consistent message, never a "$X above Max Buy, negotiate" framing', () => {
    const lead = { ...EVERGREEN, decision_v2: { fit: { status: 'NOT_FIT', reasons: ['Blocked ZIP 32206'] } } }
    const hint = smartHint(lead, 'static hint')
    expect(hint).toMatch(/outside HAT's current Buy Box/)
    expect(hint).not.toMatch(/above .* Max Buy/)
    expect(hint).not.toMatch(/Decide: negotiate/)
  })
  it('the primary Acquisition Decision card itself is unaffected (still PASS — NOT IN BUY BOX)', () => {
    const { decision } = decide(EVERGREEN, { fit: { status: 'NOT_FIT', reasons: ['Blocked ZIP 32206'] } })
    expect(decision.state).toBe('PASS')
    expect(decision.headline).toBe('PASS — NOT IN BUY BOX')
    expect(decision.buyBoxNotFit).toBe(true)
  })
})

describe('CASE B — normal negotiable lead (NOT hard-excluded): negotiation Next Best Action remains available', () => {
  it('smartHint still surfaces the Max-Buy negotiation framing when fit is not NOT_FIT — negotiation is NOT globally suppressed', () => {
    const lead = { ...LAZEAU, status: 'new_lead', deal_analysis: { verdict: 'NEGOTIATE' }, decision_v2: { fit: { status: 'FIT' } } }
    const hint = smartHint(lead, 'static hint')
    expect(hint).toMatch(/above .* Max Buy/)
    expect(hint).toMatch(/Decide: negotiate/)
  })
  it('a lead with no decision_v2 at all (fit undefined) also still gets the normal negotiation hint — the guard only fires on an explicit NOT_FIT', () => {
    const lead = { ...LAZEAU, status: 'new_lead', deal_analysis: { verdict: 'NEGOTIATE' } }
    const hint = smartHint(lead, 'static hint')
    expect(hint).toMatch(/above .* Max Buy/)
  })
})

describe('CASE C — Lazeau: NEGOTIATE unchanged, BRRRR remains recommended, strategy explanation no longer claims a false current-price match', () => {
  const { flip, brrrr, strategyRec, decision } = decide(LAZEAU)
  const strategyExplanation = decision?.targetStrategy ? buildStrategyExplanation({ flip, brrrr, strategyRec, sellerAskingPrice: LAZEAU.asking_price }) : null
  it('financial facts are unchanged (real canonical values)', () => {
    expect(Math.round(flip.evaluationPrice)).toBe(160000)
    expect(Math.round(flip.mao)).toBe(120104)
    expect(Math.round(brrrr.mao)).toBe(118710)
    expect(brrrr.currentOffer).toBe(118100)
    expect(brrrr.monthlyCashFlow).toBe(85)
  })
  it('decision state/headline/target strategy unchanged', () => {
    expect(decision.state).toBe('NEGOTIATE')
    expect(decision.targetStrategy).toBe('BRRRR')
  })
  it('strategy explanation never claims BRRRR meets target at the current price when $160,000 exceeds BRRRR\'s ~$118,900 range', () => {
    expect(strategyExplanation).not.toMatch(/BRRRR meets HAT's target at the current price/)
    expect(strategyExplanation).toMatch(/BRRRR is the recommended strategy near HAT's target acquisition range/)
    expect(strategyExplanation).toMatch(/\$160,000 asking price is above HAT's supported range/)
  })
})

describe('CASE D — a strategy that genuinely DOES meet its target at the real current price keeps valid current-price wording', () => {
  it('current-price wording is not globally removed', () => {
    const lead = { id: 'meets-at-current', asking_price: 100000, arv: 245000, renovation_cost: 60000, rent_estimate: 1500, hold_months: 6 }
    const { flip, brrrr, strategyRec, decision } = decide(lead)
    if (decision.targetStrategy) {
      const explanation = buildStrategyExplanation({ flip, brrrr, strategyRec, sellerAskingPrice: lead.asking_price })
      expect(lead.asking_price).toBeLessThanOrEqual(Math.round(brrrr.mao))
      expect(explanation).toMatch(/meets? HAT's target at the current price/)
    }
  })
})

describe('CASE E — hard Buy Box PASS lead: reference economics may remain visible without changing the PASS recommendation', () => {
  it('flip/brrrr breakdowns are still computable and available as reference info, decision remains PASS', () => {
    const { flip, decision } = decide(EVERGREEN, { fit: { status: 'NOT_FIT', reasons: ['Blocked ZIP 32206'] } })
    expect(flip.available).toBe(true)
    expect(decision.state).toBe('PASS')
    expect(decision.buyBoxNotFit).toBe(true)
  })
})

describe('SC7 fixture re-verified: still NEGOTIATE/PASS_NEGOTIABLE, not a dominant PASS', () => {
  it('Ask $100K / ARV $200K / Rehab $50K / no rent → Flip Max Buy ≈ $91,140, decision NOT bare PASS', () => {
    const lead = { id: 'audit-test', asking_price: 100000, arv: 200000, renovation_cost: 50000, hold_months: 6 }
    const { flip, decision } = decide(lead, { decisionV2Recommendation: 'PASS' })
    expect(Math.round(flip.mao)).toBe(91140)
    expect(decision.state).toBe('PASS_NEGOTIABLE')
    expect(decision.headline).toBe('NEGOTIATE')
  })
})

describe('Small Changes #1-#7 preserved', () => {
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
  it('SC6 — Deal Opportunity Summary / Suggested Offer labeling untouched', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/export function buildDealOpportunitySummary/)
    expect(src).toMatch(/suggestedOffer: brrrr\.currentOffer/)
  })
  it('SC7 — Decision V2 PASS precedence fix (viableFlipMao/viableBrrrrMao gating) untouched', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/viableFlipMao == null && viableBrrrrMao == null/)
  })
})

describe('Protected files / no scope creep', () => {
  it('no protected file references any symbol from this fix', () => {
    for (const f of ['src/lib/calculations.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/dealExplanation.js', 'src/lib/sellerStrategy.js']) {
      const src = fs.readFileSync(f, 'utf8')
      expect(src).not.toMatch(/brrrrMeetsAtCurrentPrice|brrrrNearRangeText/)
    }
  })
})
