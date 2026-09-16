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
  // Small Change #20 narrowed this guard: the model is now explicitly
  // authorized to state its own independent ARV opinion inside the
  // VALUATION content (that is the entire point of SC20), so the blanket
  // "do not... imply a different ARV" no longer applies there. The Max
  // Buy/MAO prohibition is untouched and absolute everywhere — that is
  // the actual Paschal Street failure mode (a competing acquisition
  // ceiling), and it still has no slot anywhere in the prompt.
  it('CASE F — explicitly forbids recalculating or restating a different Max Buy anywhere (absolute, untouched by SC20)', () => {
    expect(SYSTEM_PROMPT).toMatch(/do not calculate, restate, or imply a different max buy/i)
  })

  it('CASE E — instructs the model to flag conflicting evidence as a review flag, not a correction, outside its own VALUATION opinion', () => {
    expect(SYSTEM_PROMPT).toMatch(/review flag/i)
    expect(SYSTEM_PROMPT).toMatch(/never as a replacement ARV/i)
  })

  // Small Change #1 (Sep 4 baseline) — the exact Paschal Street defect was
  // an AI-proposed ARV competing with an EXISTING canonical ARV, framed as
  // a REPLACEMENT for it. That specific failure mode is what this test
  // guards. Small Change #20 deliberately authorizes the model to always
  // state its own independent Conservative/Realistic/Optimistic ARV
  // opinion (previously gated to fire ONLY when "ARV: Unknown") — the
  // guard that remains is that this VALUATION content is explicitly
  // labeled as informational/non-authoritative, never a replacement, and
  // canonical Max Buy/MAO still has no competing slot anywhere.
  it('the MARKET COMPS section now DOES carry the always-on VALUATION opinion (Small Change #20), explicitly labeled non-authoritative — never a replacement of the canonical ARV', () => {
    const marketCompsSection = SYSTEM_PROMPT.slice(SYSTEM_PROMPT.indexOf('MARKET COMPS\n====='), SYSTEM_PROMPT.indexOf('RENTAL COMPS\n====='))
    expect(marketCompsSection).toMatch(/Conservative ARV:/i)
    expect(marketCompsSection).toMatch(/Realistic ARV:/i)
    expect(marketCompsSection).toMatch(/Optimistic ARV:/i)
    expect(marketCompsSection).toMatch(/ARV Conclusion:/i)
    expect(marketCompsSection).toMatch(/informational context for review/i)
    expect(marketCompsSection).toMatch(/canonical financials above remain authoritative for underwriting/i)
    // the competing-MAO failure mode is still impossible — no Max Buy/MAO slot anywhere in MARKET COMPS
    expect(marketCompsSection).not.toMatch(/Max Buy:|MAO:/i)
  })
  it('the VALUATION opinion is now ALWAYS produced (no longer gated to "ARV: Unknown"), but is explicitly evidence-only — never anchored to the canonical ARV, asking price, or Max Buy', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/Include VALUATION only when CANONICAL FINANCIALS below shows "ARV: Unknown"/)
    expect(SYSTEM_PROMPT).not.toMatch(/EXCEPTION — no canonical ARV exists yet/)
    expect(SYSTEM_PROMPT).toMatch(/never derived from the canonical ARV above, from asking price, or from Max Buy/i)
    expect(SYSTEM_PROMPT).toMatch(/canonical financials (above |)remain authoritative for underwriting regardless of what (this|your VALUATION) says/i)
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
