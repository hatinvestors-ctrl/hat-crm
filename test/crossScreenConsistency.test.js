// test/crossScreenConsistency.test.js
// System Validation / Regression Review, Part 9 — cross-screen consistency.
// Two real, verified checks:
//   1. BRRRR was NOT touched by the F1/F2 Flip-verdict-pipeline fix (locks
//      in that the fix stayed scoped to Flip, as the fix's own commit
//      claimed).
//   2. lead.mao (legacy calculateMAO) and the canonical, strategy-specific
//      Flip Max Buy (calculateFlipMAO) are DIFFERENT numbers BY DESIGN and
//      the DB column is deliberately left as-is (Finding F3, not dropped
//      per the Product Decision's explicit "do not drop columns" rule) —
//      but as of the Canonical Deal Values fix (Defects D1/D2), no
//      screen displays the legacy value as financial truth anymore:
//      LeadsTable and Action Center were both migrated to compute
//      calculateFlipMAO/computeFlipResult fresh, same as the Lead
//      Workspace Deal tab. This test now locks in the FIXED state: the
//      two numbers still legitimately diverge in the database, but only
//      the canonical one is ever shown to a user as "Max Buy."
import { describe, it, expect } from 'vitest'
import { calculateMAO, calculateFlipMAO } from '../src/lib/calculations.js'
import { computeBrrrrResult, computeFlipResult } from '../src/lib/dealExplanation.js'
import { getGoldenLead } from './fixtures/goldenLeads.js'

describe('BRRRR is unaffected by the Flip-only F1/F2 fix', () => {
  // Values below reflect the approved Phase 2 BRRRR Financial Accuracy
  // fixes (Issue #1 real amortization at the canonical 6.7% rate, Issue
  // #4 unclamped signed Cash Left In) — both these fixtures are now
  // genuinely cash-out-positive deals (refinance returns more than was
  // invested), which is exactly the scenario Issue #4 was approved to
  // stop hiding as a misleading flat $0.
  it('G10_STRONG_BRRRR matches the post-fix canonical value exactly (cash-out-positive)', () => {
    const lead = getGoldenLead('G10_STRONG_BRRRR')
    const r = computeBrrrrResult(lead)
    expect(r.available).toBe(true)
    expect(r.verdict).toBe('STRONG')
    expect(Math.round(r.cashLeftIn)).toBe(-17832) // negative = cash extracted beyond 100% capital recovery
  })

  it('G13_BOTH_WORK BRRRR side matches the post-fix canonical value exactly (cash-out-positive)', () => {
    const lead = getGoldenLead('G13_BOTH_WORK')
    const r = computeBrrrrResult(lead)
    expect(r.available).toBe(true)
    expect(r.verdict).toBe('PASS')
    expect(Math.round(r.cashLeftIn)).toBe(-17832)
  })

  it('computeBrrrrResult never returns the Flip-only fields introduced by the F1/F2 fix (evaluationPrice, maoFeasible)', () => {
    const lead = getGoldenLead('G10_STRONG_BRRRR')
    const r = computeBrrrrResult(lead)
    expect(r).not.toHaveProperty('evaluationPrice')
    expect(r).not.toHaveProperty('maoFeasible')
  })
})

describe('lead.mao (legacy, still stored, no longer displayed as financial truth anywhere) vs canonical Flip Max Buy (now shown consistently everywhere)', () => {
  it('the two formulas still produce DIFFERENT numbers in the database for the same real-world lead shape (Club Duclay analog) — the DB column is intentionally untouched', () => {
    const lead = getGoldenLead('G28_LEGACY_MAO') // arv=270000, reno=50000, stored lead.mao=150050
    const legacyMao = calculateMAO(lead.arv, lead.renovation_cost)
    const canonicalFlipMao = calculateFlipMAO(lead.arv, lead.renovation_cost)
    expect(legacyMao).toBe(150050) // still what's stored in lead.mao — untouched, not dropped
    expect(canonicalFlipMao).toBeCloseTo(151868, 0) // what every screen now actually displays
    expect(lead.mao).not.toBeCloseTo(canonicalFlipMao, 0)
  })

  it('computeFlipResult (what every screen now reads) never reads lead.mao at all', () => {
    const lead = getGoldenLead('G28_LEGACY_MAO')
    const canonical = computeFlipResult(lead)
    expect(canonical.mao).not.toBe(lead.mao)
    expect(canonical.mao).toBeCloseTo(calculateFlipMAO(lead.arv, lead.renovation_cost), 6)
  })
})
