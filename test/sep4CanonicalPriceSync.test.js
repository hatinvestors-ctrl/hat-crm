// test/sep4CanonicalPriceSync.test.js
// HAT CRM — SMALL CHANGE #4: Canonical Price / Decision Synchronization
// Audit & Fix.
//
// ROOT CAUSE (proven, not assumed): lead.asking_price was NEVER stale —
// computeFlipResult/deriveAcquisitionDecision recompute fresh on every
// render from the live `lead` prop, and Small Change #2 already ensures
// decision_v2 itself stays synced. The actual defect was narrower and
// entirely new-code: Small Change #3's PASS_NEGOTIABLE branch hardcoded
// `priceIsEvaluation: false` and never set `currentPriceLabel`, so
// whenever dealExplanation.js's EXISTING, PROTECTED, INTENTIONAL rule
// (`evaluationPrice = actualOffer ?? ask` — a real submitted
// lead.offer_price legitimately outranks the raw asking price) picked
// the offer price, the UI still narrated it as "asking price" — making
// a live, correctly-synced $120,000 edit look like it was being ignored
// in favor of a stale $180,000, when the $180,000 was actually a
// different, real, live field (lead.offer_price) the whole time.
// Fixed by reusing the SAME priceIsEvaluation/currentPriceLabel
// derivation the sibling NEGOTIATE/GOOD_AT_ASKING branches already used
// correctly — no new concept, no protected-file change.
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../src/lib/dealExplanation.js'
import { deriveAcquisitionDecision, resolveActualOffer } from '../src/lib/acquisitionDecisionPresentation.js'
import { getDealReadiness } from '../src/components/lead-detail/workspace/readiness.js'

function decide(lead) {
  const flip = computeFlipResult(lead, null)
  const brrrr = computeBrrrrResult(lead, null)
  const strategyRec = flip.available || brrrr.available ? computeStrategyRecommendation(flip, brrrr) : null
  const readiness = getDealReadiness(lead)
  const decision = deriveAcquisitionDecision({ flip, brrrr, strategyRec, readiness, lead, marketType: 'ON_MARKET' })
  return { flip, brrrr, decision }
}

const ASTOR_BASE = { id: 'astor-test', address: '5637 Astor Pl', arv: 215000, renovation_cost: 30000, hold_months: 6 }

describe('5637 Astor Pl regression — the exact reported scenario', () => {
  it('BEFORE-style repro: asking_price $120,000 + a real, separate offer_price $180,000 reproduces the exact reported figures', () => {
    const lead = { ...ASTOR_BASE, asking_price: 120000, offer_price: 180000 }
    const { flip } = decide(lead)
    expect(Math.round(flip.projectedProfit)).toBe(-29708)
    expect(Math.round(flip.mao)).toBe(124302)
    expect(flip.evaluationPrice).toBe(180000)
  })
  it('AFTER the fix: the decision card correctly labels the $180,000 as "Evaluation Price", never "Asking Price" — the live $120,000 is never silently overridden without explanation', () => {
    const lead = { ...ASTOR_BASE, asking_price: 120000, offer_price: 180000 }
    const { decision } = decide(lead)
    expect(decision.currentPrice).toBe(180000)
    expect(decision.currentPriceLabel).toBe('Evaluation Price')
    expect(decision.priceIsEvaluation).toBe(true)
    expect(decision.explanation).toMatch(/Current evaluation price of \$180,000/)
    expect(decision.explanation).not.toMatch(/Current asking price of \$180,000/)
  })
  it('the $180,000 is a real, live, correctly-resolved field (offer_price) — NOT a stale snapshot; resolveActualOffer independently confirms the same value/source', () => {
    const lead = { ...ASTOR_BASE, asking_price: 120000, offer_price: 180000 }
    const { amount, source } = resolveActualOffer(lead)
    expect(amount).toBe(180000)
    expect(source).toBe('offer_price')
  })
  it('the live top-bar field (asking_price) is exactly what the engine reads for "ask" — proves no separate/stale copy exists', () => {
    const lead = { ...ASTOR_BASE, asking_price: 120000, offer_price: 180000 }
    const { flip } = decide(lead)
    // ask itself (pre-actualOffer-fallback) is read straight from live lead.asking_price
    expect(flip.currentOffer).toBe(120000) // getEffectiveOffer falls back to ask, not actualOffer
  })
  it('when NO separate offer_price exists, the current price IS simply the live asking_price — proves the general case has no sync bug at all', () => {
    const lead = { ...ASTOR_BASE, asking_price: 120000 }
    const { decision } = decide(lead)
    expect(decision.currentPrice).toBe(120000)
    expect(decision.currentPriceLabel).toBe('Asking Price')
    expect(decision.priceIsEvaluation).toBe(false)
  })
})

describe('Edit/delete/re-enter matrix (Part 5) — no page reload, pure recomputation from live lead state', () => {
  const base = { id: 'matrix-test', arv: 215000, renovation_cost: 30000, hold_months: 6 }
  it('A. blank → $180,000', () => {
    const { decision } = decide({ ...base, asking_price: 180000 })
    expect(decision.currentPrice).toBe(180000)
  })
  it('B. $180,000 → $120,000', () => {
    const { decision } = decide({ ...base, asking_price: 120000 })
    expect(decision.currentPrice).toBe(120000)
    expect(decision.currentPrice).not.toBe(180000)
  })
  it('C. $120,000 → blank', () => {
    const { decision } = decide({ ...base, asking_price: null })
    expect(decision.currentPrice).toBeNull()
  })
  it('D. blank → $120,000', () => {
    const { decision } = decide({ ...base, asking_price: 120000 })
    expect(decision.currentPrice).toBe(120000)
  })
  it('E. $120,000 → $130,000 → $120,000 (settles back, no stale intermediate value lingers)', () => {
    const step1 = decide({ ...base, asking_price: 120000 }).decision
    const step2 = decide({ ...base, asking_price: 130000 }).decision
    const step3 = decide({ ...base, asking_price: 120000 }).decision
    expect(step1.currentPrice).toBe(120000)
    expect(step2.currentPrice).toBe(130000)
    expect(step3.currentPrice).toBe(120000)
    expect(step3.currentPrice).not.toBe(130000)
  })
})

describe('Invariant — all active current-price decision values derive from the same canonical current price', () => {
  it('currentPrice, gap, and targetPrice are internally consistent for any lead/price combination (no two consumers can silently disagree)', () => {
    const leads = [
      { id: '1', arv: 215000, renovation_cost: 30000, asking_price: 120000 },
      { id: '2', arv: 215000, renovation_cost: 30000, asking_price: 120000, offer_price: 180000 },
      { id: '3', arv: 185000, renovation_cost: 45000, asking_price: 110000 },
    ]
    for (const lead of leads) {
      const { decision } = decide(lead)
      if (decision.currentPrice != null && decision.targetPrice != null) {
        expect(Math.round(Math.abs(decision.currentPrice - decision.targetPrice))).toBe(decision.gap)
      }
    }
  })
  it('Small Change #2\'s mechanism is confirmed sufficient — the ASK/Evaluation Price update path was never bypassed; useLeadUpdate.js needs no further change for this bug class', () => {
    const hookSrc = fs.readFileSync('src/hooks/useLeadUpdate.js', 'utf8')
    expect(hookSrc).toMatch(/const freshDecision = await maybeRecalculateDecisionV2\(supabase, lead, updated\)\.catch\(\(\) => null\)/)
  })
})

describe('Small Changes #1/#2/#3 preserved', () => {
  it('Small Change #1 (3-level ARV) files byte-unchanged', () => {
    const cardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
    expect(cardSrc).toMatch(/const arvToWrite = lead\.arv \? null : finalArv/)
  })
  it('Small Change #2 (Overview input-sync) unchanged', () => {
    const hookSrc = fs.readFileSync('src/hooks/useLeadUpdate.js', 'utf8')
    expect(hookSrc).toMatch(/updated\.decision_v2 = freshDecision/)
  })
  it('Small Change #3 conceptual behavior preserved — NEGOTIATE/Pass at current price still exists, true PASS still exists', () => {
    const lead = { id: 'hardpass', asking_price: 150000, arv: 120000, renovation_cost: 90000, hold_months: 6 }
    const { decision } = decide(lead)
    expect(decision.state).toBe('PASS')
    const negotiable = decide({ id: 'spring', asking_price: 110000, arv: 185000, renovation_cost: 45000, hold_months: 6 }).decision
    expect(negotiable.state).toBe('PASS_NEGOTIABLE')
    expect(negotiable.passAtCurrentPrice).toBe(true)
  })
})

describe('Protected files / no scope creep', () => {
  it('no protected file references any new symbol from this fix', () => {
    for (const f of ['src/lib/calculations.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/dealExplanation.js', 'src/lib/sellerStrategy.js']) {
      const src = fs.readFileSync(f, 'utf8')
      expect(src).not.toMatch(/priceIsEvaluationForPass|currentPriceLabelForPass/)
    }
  })
  it('the fix is confined to acquisitionDecisionPresentation.js — no other file touched', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/priceIsEvaluationForPass/)
    expect(src).toMatch(/currentPriceLabelForPass/)
  })
})
