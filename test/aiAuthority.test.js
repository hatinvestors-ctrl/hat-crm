// test/aiAuthority.test.js
// Pre-demo consistency & AI-authority fix (Part 8-11). These are static
// assertions that the authority contract instructions exist in the prompt
// sent to the AI — the AI's own free-text compliance on a live call can't
// be verified without hitting the model (same limitation documented for
// generate-core-analysis.mjs's seller-narrative guardrail in
// test/decisionConsistency.test.js). What IS verified: the template no
// longer has a slot for a second point-estimate ARV or a second
// acquisition ceiling, and the internal-evidence labeling changes.
import { describe, it, expect } from 'vitest'
import { SYSTEM_PROMPT } from '../netlify/functions/generate-comps.mjs'

describe('generate-comps.mjs SYSTEM_PROMPT — canonical authority contract (CASE E/F)', () => {
  it('CASE F — explicitly forbids recalculating or restating a different ARV or Max Buy', () => {
    expect(SYSTEM_PROMPT).toMatch(/do not calculate, restate, or imply a different arv/i)
    expect(SYSTEM_PROMPT).toMatch(/do not calculate, restate, or imply a different max buy/i)
  })

  it('CASE E — instructs the model to flag conflicting evidence rather than replace the canonical ARV', () => {
    expect(SYSTEM_PROMPT).toMatch(/review flag/i)
    expect(SYSTEM_PROMPT).toMatch(/never as a replacement number/i)
  })

  // Small Change #1 (Sep 4 baseline) — the exact Paschal Street defect was
  // an AI-proposed ARV competing with an EXISTING canonical ARV. That
  // specific failure mode is what this test guards, and it still cannot
  // happen: the MARKET COMPS section (and everywhere ARV is already
  // provided) still has no such slot, and the new VALUATION section is
  // explicitly gated to fire ONLY when "ARV: Unknown" — i.e. exactly the
  // case where no canonical ARV exists yet to contradict. Verified below
  // instead of banning the words outright.
  it('the MARKET COMPS section itself still has no "Realistic ARV: $X" slot — the 3-level ARV lives only in the new, separately-gated VALUATION section', () => {
    const marketCompsSection = SYSTEM_PROMPT.slice(SYSTEM_PROMPT.indexOf('MARKET COMPS\n====='), SYSTEM_PROMPT.indexOf('RENTAL COMPS\n====='))
    expect(marketCompsSection).not.toMatch(/Realistic ARV:/i)
    expect(marketCompsSection).not.toMatch(/Optimistic ARV:/i)
    expect(marketCompsSection).not.toMatch(/Conservative ARV:/i)
  })
  it('the new VALUATION section is explicitly gated to ONLY when no canonical ARV exists yet, and is omitted the moment one is provided', () => {
    expect(SYSTEM_PROMPT).toMatch(/Include VALUATION only when CANONICAL FINANCIALS below shows "ARV: Unknown" — omit entirely when a canonical ARV is already provided\./)
    expect(SYSTEM_PROMPT).toMatch(/EXCEPTION — no canonical ARV exists yet/)
    expect(SYSTEM_PROMPT).toMatch(/never restate a different ARV once one exists/)
  })

  it('the CRM COMPS USED template no longer invites a "Confidence Impact" line that raises ARV confidence to a dollar figure or recommends an alternate MAO', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/Confidence Impact:/i)
    expect(SYSTEM_PROMPT).toMatch(/never recommend an alternate acquisition ceiling\/MAO/i)
  })

  it('CASE G — a prior HAT lead\'s own ARV is labeled "Prior HAT ARV Estimate", never "Our ARV" or "comp" (prevents circular evidence)', () => {
    expect(SYSTEM_PROMPT).toMatch(/Prior HAT ARV Estimate/)
    expect(SYSTEM_PROMPT).not.toMatch(/Our ARV \$\[X\]/)
  })
})
