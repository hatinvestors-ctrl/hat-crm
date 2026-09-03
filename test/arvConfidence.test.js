// test/arvConfidence.test.js
// Comps Intelligence / ARV Confidence Engine — SCOPED V1 + pre-demo
// consistency fix. Every scenario below is fed through the REAL canonical
// computeFlipResult/computeBrrrrResult (dealExplanation.js) — this suite
// never asserts a number this module invented independently of that
// engine.
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import {
  computeDecisionSensitivity, getHatInternalEvidence, getExternalCompConfidenceState, getValuationRecommendation,
  STRESS_CLASSIFICATION,
} from '../src/lib/arvConfidence.js'
import { computeFlipResult } from '../src/lib/dealExplanation.js'

function robustLead(overrides = {}) {
  // ARV high relative to reno/ask — should still clear HAT's $30K target
  // even at -5% ARV.
  return { arv: 300000, renovation_cost: 30000, asking_price: 180000, hold_months: 6, ...overrides }
}

function thinLead(overrides = {}) {
  // Deal barely clears the $30K target at base ARV (WATCH, profit ~$31.3K);
  // a -5% ARV haircut should push it under.
  return { arv: 200000, renovation_cost: 40000, asking_price: 100000, hold_months: 6, ...overrides }
}

// The exact real 8054 Paschal Street fixture from the mission brief —
// verified independently against the canonical engine before writing any
// assertion (see the final report's "Paschal Financial Verification").
function paschalLead(overrides = {}) {
  return { arv: 220000, renovation_cost: 45000, asking_price: 145000, starting_offer: 116000, hold_months: 6, ...overrides }
}

describe('8054 Paschal Street — real-world regression fixture (Part 20)', () => {
  const lead = paschalLead()
  const flip = computeFlipResult(lead)

  it('financial values reproduce exactly from the canonical engine', () => {
    expect(flip.available).toBe(true)
    expect(flip.evaluationPrice).toBe(145000)
    expect(Math.round(flip.projectedProfit)).toBe(-3738)
    expect(Math.round(flip.mao)).toBe(113528) // exact canonical Max Buy
    expect(Math.round(flip.mao / 100) * 100).toBe(113500) // display-rounded
    expect(Math.round(flip.marginOfSafety.priceCushion)).toBe(-31472) // Seller Gap to Max Buy (raw)
    expect(Math.round(flip.targetProfit - flip.projectedProfit)).toBe(33738) // Profit Shortfall — a DIFFERENT number than Seller Gap
    expect(flip.verdict).toBe('NO DEAL')
  })

  it('stress test: Conservative/Base/Upside are all NO DEAL', () => {
    const s = computeDecisionSensitivity(lead)
    expect(s.available).toBe(true)
    expect(s.conservative.arv).toBe(209000)
    expect(s.conservative.flip.verdict).toBe('NO DEAL')
    expect(s.base.arv).toBe(220000)
    expect(s.base.flip.verdict).toBe('NO DEAL')
    expect(s.upside.arv).toBe(231000)
    expect(s.upside.flip.verdict).toBe('NO DEAL')
    expect(Math.round(s.upside.flip.projectedProfit)).toBe(6492) // still short of the $30K target
  })

  it('classification is NO_DEAL_ACROSS_RANGE, never a "sensitivity" label implying ARV uncertainty is the cause', () => {
    const s = computeDecisionSensitivity(lead)
    expect(s.sensitivity).toBe(STRESS_CLASSIFICATION.NO_DEAL_ACROSS_RANGE)
    expect(s.sensitivityLabel).toBe('NO DEAL ACROSS RANGE')
    expect(s.sensitivity).not.toBe(STRESS_CLASSIFICATION.ARV_SENSITIVE)
    expect(s.sensitivityReason).toMatch(/acquisition price/i)
  })

  it('the recommendation for Paschal points at price, not comp quality (Part 5)', () => {
    const s = computeDecisionSensitivity(lead)
    const rec = getValuationRecommendation(s.sensitivity)
    expect(rec).toMatch(/purchase price/i)
    expect(rec).not.toMatch(/comp/i)
  })
})

describe('computeDecisionSensitivity — CASE A-D classification (Part 2/21)', () => {
  it('CASE D — NO_DEAL_ACROSS_RANGE: fails at conservative, base, AND upside', () => {
    const result = computeDecisionSensitivity(paschalLead())
    expect(result.sensitivity).toBe(STRESS_CLASSIFICATION.NO_DEAL_ACROSS_RANGE)
  })

  it('CASE A — ROBUST_DEAL: meets target even at the conservative ARV', () => {
    const result = computeDecisionSensitivity(robustLead())
    expect(result.conservative.flip.verdict).not.toBe('NO DEAL')
    expect(result.sensitivity).toBe(STRESS_CLASSIFICATION.ROBUST_DEAL)
  })

  it('CASE B — ARV_SENSITIVE: base works, conservative fails, and upside also works (not upside-only)', () => {
    const result = computeDecisionSensitivity(thinLead())
    expect(result.base.flip.verdict).not.toBe('NO DEAL')
    expect(result.conservative.flip.verdict).toBe('NO DEAL')
    expect(result.upside.flip.verdict).not.toBe('NO DEAL')
    expect(result.sensitivity).toBe(STRESS_CLASSIFICATION.ARV_SENSITIVE)
  })

  it('CASE C — UPSIDE_DEPENDENT: base fails, only upside meets target', () => {
    // Tuned so base (0% delta, ARV $205K) is NO DEAL but +5% upside
    // ($215.25K) clears HAT's target.
    const lead = { arv: 205000, renovation_cost: 40000, asking_price: 110000, hold_months: 6 }
    const result = computeDecisionSensitivity(lead)
    expect(result.base.flip.verdict).toBe('NO DEAL')
    expect(result.upside.flip.verdict).not.toBe('NO DEAL')
    expect(result.sensitivity).toBe(STRESS_CLASSIFICATION.UPSIDE_DEPENDENT)
  })

  it('missing ARV → not available, with a real reason (never a fabricated classification)', () => {
    const result = computeDecisionSensitivity({ renovation_cost: 30000 })
    expect(result.available).toBe(false)
    expect(result.reason).toMatch(/ARV/i)
  })

  it('missing renovation cost → not available', () => {
    const result = computeDecisionSensitivity({ arv: 300000 })
    expect(result.available).toBe(false)
    expect(result.reason).toMatch(/[Rr]enovation/)
  })

  it('every scenario dollar figure comes from computeFlipResult, not a locally reimplemented formula (spot check against MAO monotonicity)', () => {
    const result = computeDecisionSensitivity(robustLead())
    expect(result.upside.flip.mao).toBeGreaterThan(result.conservative.flip.mao)
  })

  it('does not mutate the original lead object (arv override is scenario-local only)', () => {
    const lead = robustLead()
    const originalArv = lead.arv
    computeDecisionSensitivity(lead)
    expect(lead.arv).toBe(originalArv)
  })
})

describe('Part 3 — ARV Confidence and ARV Stress/Decision Sensitivity are independent concepts', () => {
  it('a ROBUST_DEAL classification never implies or returns an ARV confidence value', () => {
    const result = computeDecisionSensitivity(robustLead())
    expect(result.sensitivity).toBe(STRESS_CLASSIFICATION.ROBUST_DEAL)
    expect(result).not.toHaveProperty('arvConfidence')
    expect(result).not.toHaveProperty('confidence')
  })
  it('NO_DEAL_ACROSS_RANGE never implies LOW ARV confidence either — the recommendation text names the real cause (price), not comp quality', () => {
    const result = computeDecisionSensitivity(paschalLead())
    const rec = getValuationRecommendation(result.sensitivity)
    expect(rec).not.toMatch(/confidence/i)
  })
})

describe('getHatInternalEvidence — CASE G/H (real CRM data, capped/labeled, never a fabricated match)', () => {
  const subject = { id: 'subject', sqft: 1500 }

  it('CASE H (no evidence) → available:false, never a fake match', () => {
    const result = getHatInternalEvidence(subject, [])
    expect(result.available).toBe(false)
    expect(result.matches).toHaveLength(0)
  })

  it('CASE H (actual sale) — a genuinely completed sale is labeled ACTUAL_SALE, never conflated with a plain ARV estimate', () => {
    const candidates = [
      { id: 'a', address: '1012 Example Ave', sqft: 1510, status: 'flip_sold', arv: 235000, deal_financials: { actual_sale_price: 240000, sold_date: '2026-06-01' } },
    ]
    const result = getHatInternalEvidence(subject, candidates)
    expect(result.available).toBe(true)
    expect(result.matches[0].evidenceType).toBe('ACTUAL_SALE')
    expect(result.matches[0].actualSalePrice).toBe(240000)
  })

  it('CASE G — a lead with only an internal ARV (no completed sale) is labeled PRIOR_ARV_ESTIMATE (market history/context), never ACTUAL_SALE', () => {
    const candidates = [
      { id: 'b', address: '9129 Example Rd', sqft: 1430, status: 'active', arv: 247000 },
    ]
    const result = getHatInternalEvidence(subject, candidates)
    expect(result.matches[0].evidenceType).toBe('PRIOR_ARV_ESTIMATE')
    expect(result.matches[0].actualSalePrice).toBeNull()
  })

  it('a "sold" status WITHOUT a real actual_sale_price never gets promoted to ACTUAL_SALE (no fabricated evidence)', () => {
    const candidates = [
      { id: 'c', address: '55 No Data Ln', sqft: 1500, status: 'flip_sold', arv: 200000, deal_financials: null },
    ]
    const result = getHatInternalEvidence(subject, candidates)
    expect(result.matches[0].evidenceType).toBe('PRIOR_ARV_ESTIMATE')
  })

  it('the subject itself is excluded from its own evidence set', () => {
    const candidates = [{ id: 'subject', address: 'Self', sqft: 1500, arv: 200000 }]
    expect(getHatInternalEvidence(subject, candidates).available).toBe(false)
  })

  it('caps results at 5, closest-by-size first', () => {
    const candidates = Array.from({ length: 8 }, (_, i) => ({
      id: `c${i}`, address: `${i} Test St`, sqft: 1500 + i * 100, arv: 200000,
    }))
    const result = getHatInternalEvidence(subject, candidates)
    expect(result.matches).toHaveLength(5)
    expect(result.matches[0].id).toBe('c0') // exact sqft match (0 diff)
  })
})

describe('getExternalCompConfidenceState — honest, ARV-aware state, product-safe copy, never a fabricated score', () => {
  it('returns NOT_SCOREABLE with customer-facing copy (no implementation language in the label/message)', () => {
    const state = getExternalCompConfidenceState(robustLead())
    expect(state.status).toBe('NOT_SCOREABLE')
    expect(state).not.toHaveProperty('score')
    expect(state.message).not.toMatch(/AI-generated|database|structured per-comp|isn't stored/i)
  })

  // Analysis Readiness + Decision Integrity Fix, Part 1 — the real
  // production bug: this function used to always claim "Current ARV is
  // available" regardless of lead.arv. Now branches honestly.
  it('ARV present — message says ARV is available', () => {
    const state = getExternalCompConfidenceState(robustLead({ arv: 300000 }))
    expect(state.message).toMatch(/Current ARV is available/i)
  })
  it('ARV absent (null) — message NEVER claims ARV is available; mentions AI can estimate it', () => {
    const state = getExternalCompConfidenceState(robustLead({ arv: null }))
    expect(state.message).not.toMatch(/Current ARV is available/i)
    expect(state.message).toMatch(/HAT AI can estimate/i)
  })
  it('no lead at all — treated the same as ARV absent, never throws', () => {
    const state = getExternalCompConfidenceState(undefined)
    expect(state.message).not.toMatch(/Current ARV is available/i)
  })
})

describe('getValuationRecommendation — deterministic text, keyed only by the stress classification', () => {
  it('all four states produce distinct, non-empty guidance', () => {
    const texts = Object.values(STRESS_CLASSIFICATION).map(getValuationRecommendation)
    expect(new Set(texts).size).toBe(4)
    expect(texts.every(t => typeof t === 'string' && t.length > 0)).toBe(true)
  })
  it('an unknown classification value returns null rather than guessing', () => {
    expect(getValuationRecommendation('SOMETHING_ELSE')).toBeNull()
  })
})

describe('Financial engine isolation — arvConfidence.js only calls the canonical engine, never reimplements it', () => {
  it('imports zero raw calculation primitives (MAO/breakdown functions) — only the already-explained dealExplanation.js results', async () => {
    const mod = await import('../src/lib/arvConfidence.js')
    const exportedNames = Object.keys(mod).sort()
    // UX V2.8 added getCompEvidenceSummary — a pure, parse-only reader over
    // the MARKET COMPS text already stored in lead.ai_notes. It is listed
    // here (the allowlist is exhaustive by design) but does not weaken the
    // guarantee this suite protects: it performs no arithmetic, and the
    // module's import surface is still exactly dealExplanation.js, asserted
    // structurally below.
    expect(exportedNames).toEqual([
      'ARV_SCENARIO_BAND_PCT', 'STRESS_CLASSIFICATION', 'computeDecisionSensitivity', 'getCompEvidenceSummary',
      'getExternalCompConfidenceState', 'getHatInternalEvidence', 'getValuationRecommendation',
    ].sort())
  })
  it('still imports ONLY dealExplanation.js — no calculations.js/MAO/breakdown primitives', () => {
    const src = fs.readFileSync('src/lib/arvConfidence.js', 'utf8')
    const imports = src.match(/^import .+$/gm) || []
    expect(imports).toEqual(["import { computeFlipResult, computeBrrrrResult } from './dealExplanation.js'"])
  })
})
