// test/crossScreenConsistency.test.js
// System Validation / Regression Review, Part 9 — cross-screen consistency.
// Two real, verified checks:
//   1. BRRRR was NOT touched by the F1/F2 Flip-verdict-pipeline fix (locks
//      in that the fix stayed scoped to Flip, as the fix's own commit
//      claimed).
//   2. lead.mao (legacy calculateMAO, what LeadsTable.jsx and
//      ActionCenterPage.jsx display) and the canonical, strategy-specific
//      Flip Max Buy (calculateFlipMAO, what the Lead Workspace Deal tab
//      displays after the F1/F2 fix) are DIFFERENT numbers BY DESIGN — see
//      docs/release-readiness/source-of-truth-inventory.md Finding F3 and
//      RELEASE-READINESS.md Defect D1. This test locks in that the two
//      numbers legitimately diverge for the same lead, so a future change
//      that accidentally makes them silently equal (or accidentally
//      re-derives one from the other) gets caught, not celebrated.
import { describe, it, expect } from 'vitest'
import { calculateMAO, calculateFlipMAO } from '../src/lib/calculations.js'
import { computeBrrrrResult } from '../src/lib/dealExplanation.js'
import { getGoldenLead } from './fixtures/goldenLeads.js'

describe('BRRRR is unaffected by the Flip-only F1/F2 fix', () => {
  it('G10_STRONG_BRRRR matches the documented golden-leads.md value exactly', () => {
    const lead = getGoldenLead('G10_STRONG_BRRRR')
    const r = computeBrrrrResult(lead)
    expect(r.available).toBe(true)
    expect(r.verdict).toBe('STRONG')
    expect(Math.round(r.cashLeftIn)).toBe(0)
  })

  it('G13_BOTH_WORK BRRRR side matches the documented golden-leads.md value exactly', () => {
    const lead = getGoldenLead('G13_BOTH_WORK')
    const r = computeBrrrrResult(lead)
    expect(r.available).toBe(true)
    expect(r.verdict).toBe('PASS')
    expect(Math.round(r.cashLeftIn)).toBe(0)
  })

  it('computeBrrrrResult never returns the Flip-only fields introduced by the F1/F2 fix (evaluationPrice, maoFeasible)', () => {
    const lead = getGoldenLead('G10_STRONG_BRRRR')
    const r = computeBrrrrResult(lead)
    expect(r).not.toHaveProperty('evaluationPrice')
    expect(r).not.toHaveProperty('maoFeasible')
  })
})

describe('lead.mao (legacy, shown by LeadsTable/ActionCenterPage) vs canonical Flip Max Buy (shown by Lead Workspace Deal tab) — documented, intentional divergence', () => {
  it('the two formulas produce DIFFERENT numbers for the same real-world lead shape (Club Duclay analog)', () => {
    const lead = getGoldenLead('G28_LEGACY_MAO') // arv=270000, reno=50000, stored lead.mao=150050
    const legacyMao = calculateMAO(lead.arv, lead.renovation_cost)
    const canonicalFlipMao = calculateFlipMAO(lead.arv, lead.renovation_cost)
    expect(legacyMao).toBe(150050) // exactly what LeadsTable/Action Center would show
    expect(canonicalFlipMao).toBeCloseTo(151868, 0) // exactly what the Deal tab shows post-fix
    // The whole point of this test: these must NOT be equal — if they ever
    // become equal by coincidence for one fixture that's fine, but the
    // FORMULAS must remain independently defined (this assertion is on the
    // fixture's stored lead.mao, which is the number a user actually sees
    // in the Leads table today).
    expect(lead.mao).not.toBeCloseTo(canonicalFlipMao, 0)
  })
})
