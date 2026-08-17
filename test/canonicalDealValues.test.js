// test/canonicalDealValues.test.js
// Product Decision — Canonical Deal Values (see RELEASE-READINESS.md,
// Defects D1/D2). Proves ONE canonical source of truth for live deal
// economics: computeFlipResult(lead)/computeBrrrrResult(lead) — never
// lead.deal_analysis.profit, never legacy lead.mao — and that the three
// distinct offer concepts (actual/submitted, recommended, Max Buy) never
// get confused with each other. Covers mission Part 8 (Scenarios 1-7) and
// Part 9 (the stale-AI-data invariant) end to end.
import { describe, it, expect } from 'vitest'
import { computeFlipResult, computeBrrrrResult } from '../src/lib/dealExplanation.js'
import { classifyLeadV2 } from '../src/pages/ActionCenterPage.jsx'
import { calculateFlipMAO } from '../src/lib/calculations.js'
import { getGoldenLead } from './fixtures/goldenLeads.js'

function decisionV2(overrides) {
  return {
    recommendation: 'ACT_NOW', next_best_action: 'SEND_OFFER',
    opportunity: { score: 50, reasons: [] },
    confidence: { score: 80, missing: [], reasons: [] },
    urgency: { level: 'LOW', reasons: [] },
    fit: { status: 'FIT', missing: [], reasons: [], conflicts: [] },
    why: [], calculated_at: new Date().toISOString(), version: '2.0-shadow',
    ...overrides,
  }
}

describe('Scenario 1 — normal profitable Flip: engine and Action Center agree', () => {
  it('computeFlipResult and classifyLeadV2 report the SAME profit and Max Buy for the same lead', () => {
    const lead = getGoldenLead('G01_STRONG_FLIP')
    lead.decision_v2 = decisionV2()
    const canonical = computeFlipResult(lead)
    const classified = classifyLeadV2(lead)
    expect(classified.expectedProfit).toBe(canonical.projectedProfit)
    expect(classified.maxOffer).toBe(canonical.mao)
    expect(canonical.verdict).toBe('STRONG')
  })
})

describe('Scenario 2 — asking above Max Buy: bad current economics, valid Max Buy preserved everywhere', () => {
  it('engine and Action Center both show NO DEAL at the current price while both still expose a real Max Buy', () => {
    const lead = getGoldenLead('G04_NO_DEAL') // offer_price=150000, Max Buy ≈ 118,395
    lead.decision_v2 = decisionV2()
    const canonical = computeFlipResult(lead)
    const classified = classifyLeadV2(lead)
    expect(canonical.verdict).toBe('NO DEAL')
    expect(canonical.mao).toBeGreaterThan(0) // negotiation opportunity survives
    expect(classified.expectedProfit).toBe(canonical.projectedProfit)
    expect(classified.expectedProfit).toBeLessThan(0) // bad economics, visible, not hidden
    expect(classified.maxOffer).toBe(canonical.mao)
    expect(classified.maxOffer).toBeGreaterThan(0)
  })
})

describe('Scenario 3/4/9 — stale deal_analysis.profit and legacy lead.mao NEVER override a live ARV/rehab change (the critical regression)', () => {
  it('Action Center follows a live ARV change even though deal_analysis.profit and lead.mao still reflect the OLD numbers', () => {
    // Seed a lead exactly like Part 9's example: stale AI said $55,000
    // profit / $150,000 Max Buy, but current ARV/reno/price computes much
    // lower under the canonical engine.
    const lead = {
      status: 'new_lead',
      asking_price: 126000, arv: 220000, renovation_cost: 25000, // canonical: profit=$38,230 (PASS), Max Buy≈$133,677
      deal_analysis: { profit: 55000, inputs: { arv: 300000, renovation_cost: 25000 } }, // stale, from a since-changed ARV
      mao: 150000, // stale legacy figure, never updated to match current ARV
      decision_v2: decisionV2(),
    }
    const beforeArvChange = classifyLeadV2(lead)
    const canonicalBefore = computeFlipResult(lead)
    expect(beforeArvChange.expectedProfit).toBe(canonicalBefore.projectedProfit)
    expect(beforeArvChange.expectedProfit).not.toBe(55000)
    expect(beforeArvChange.maxOffer).not.toBe(150000)

    // Now the user lowers ARV further (a live edit) — deal_analysis/mao
    // are NOT touched (exactly as a real edit wouldn't rewrite stale AI
    // fields). Action Center's numbers must move with the live ARV.
    lead.arv = 180000
    const afterArvChange = classifyLeadV2(lead)
    const canonicalAfter = computeFlipResult(lead)
    expect(afterArvChange.expectedProfit).toBe(canonicalAfter.projectedProfit)
    expect(afterArvChange.expectedProfit).toBeLessThan(beforeArvChange.expectedProfit)
    expect(afterArvChange.maxOffer).toBeLessThan(beforeArvChange.maxOffer)
    // the stale fields are still sitting there, untouched, proving they
    // were never the source in the first place
    expect(lead.deal_analysis.profit).toBe(55000)
    expect(lead.mao).toBe(150000)
  })

  it('the same invariant holds for a rehab-cost change (Part 4 requirement)', () => {
    const lead = {
      status: 'new_lead',
      asking_price: 126000, arv: 220000, renovation_cost: 25000,
      deal_analysis: { profit: 60000 }, // stale
      mao: 999999, // stale
      decision_v2: decisionV2(),
    }
    const before = classifyLeadV2(lead)
    lead.renovation_cost = 60000 // rehab shot up
    const after = classifyLeadV2(lead)
    expect(after.expectedProfit).toBeLessThan(before.expectedProfit)
    expect(after.maxOffer).toBeLessThan(before.maxOffer)
    expect(after.expectedProfit).not.toBe(60000)
    expect(after.maxOffer).not.toBe(999999)
  })
})

describe('Scenario 5 — economically infeasible: Max Buy stays null/unavailable everywhere, never a stale positive number', () => {
  it('classifyLeadV2 reports maxOffer/expectedProfit as null for an infeasible deal, even with a stale positive deal_analysis/mao on file', () => {
    const lead = getGoldenLead('G29_EXTREME_REHAB') // canonical Max Buy is infeasible (F2)
    lead.deal_analysis = { profit: 40000 } // stale, must not leak through
    lead.mao = 200000 // stale legacy figure, must not leak through
    lead.decision_v2 = decisionV2()
    const canonical = computeFlipResult(lead)
    expect(canonical.maoFeasible).toBe(false)
    expect(canonical.mao).toBeNull()
    const classified = classifyLeadV2(lead)
    expect(classified.maxOffer).toBeNull() // never 200000
    expect(classified.expectedProfit).not.toBe(40000)
  })
})

describe('Scenario 6 — BRRRR is unaffected by the D1/D2 canonical-source migration', () => {
  it('computeBrrrrResult keeps its own independent shape/values, untouched by Action Center or Flip-field changes', () => {
    const lead = getGoldenLead('G10_STRONG_BRRRR')
    const r = computeBrrrrResult(lead)
    expect(r.available).toBe(true)
    expect(r.verdict).toBe('STRONG')
    expect(r).not.toHaveProperty('actualOffer') // Flip-only field, never leaks into BRRRR's shape
  })
})

describe('Scenario 7 — actual offer, recommended offer, and Max Buy are three distinct, never-confused numbers', () => {
  it('matches the mission\'s worked example: actual submitted offer drives the current-deal evaluation, never the recommendation or Max Buy', () => {
    // Constructed so Max Buy lands near $120K: arv=$260,700 gives an
    // approximate target; exact Max Buy isn't the point — the point is
    // that all four numbers stay distinct and evaluationPrice tracks
    // ONLY the actual/submitted offer.
    const lead = {
      asking_price: 150000,
      offer_price: 130000,      // ACTUAL / SUBMITTED offer — a real number HAT put on the table
      starting_offer: 90000,    // RECOMMENDED offer — deliberately far from both ask and actual offer
      arv: 260700, renovation_cost: 20000,
    }
    const r = computeFlipResult(lead)
    expect(r.available).toBe(true)
    // current-deal evaluation uses the ACTUAL offer, not asking price,
    // not the recommendation, not Max Buy
    expect(r.evaluationPrice).toBe(130000)
    expect(r.actualOffer).toBe(130000)
    expect(r.evaluationPrice).not.toBe(lead.asking_price)
    expect(r.evaluationPrice).not.toBe(lead.starting_offer)
    expect(r.evaluationPrice).not.toBe(r.mao)
    // the recommended/negotiated offer is a SEPARATE number, MAO-anchored
    // — confirm it did not inherit the actual offer's value either
    expect(r.currentOffer).not.toBe(r.evaluationPrice)
    expect(r.currentOffer).toBeLessThanOrEqual(r.mao + 1)
  })

  it('falls back to asking price (never the recommended offer) when no actual offer has been submitted', () => {
    const lead = {
      asking_price: 150000,
      starting_offer: 90000, // recommendation present, but no real offer submitted
      arv: 260700, renovation_cost: 20000,
    }
    const r = computeFlipResult(lead)
    expect(r.actualOffer).toBeNull()
    expect(r.evaluationPrice).toBe(150000) // asking price, not the recommendation
  })
})

describe('LeadsTable Max Buy column now matches the canonical Flip Max Buy the Deal tab shows', () => {
  it('calculateFlipMAO (what LeadsTable now computes per row) matches computeFlipResult.mao for the same lead', () => {
    const lead = getGoldenLead('G13_BOTH_WORK')
    const canonical = computeFlipResult(lead)
    const tableValue = calculateFlipMAO(lead.arv, lead.renovation_cost)
    expect(tableValue).toBeCloseTo(canonical.mao, 6)
  })
})
