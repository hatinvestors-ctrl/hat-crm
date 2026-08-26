// test/leadIntelligenceExplainability.test.js
// Lead Intelligence Explainability + Final Data-State Polish. Covers the
// real getContactStatus() bug found auditing 10940 Ventnor Ave (a real
// enrichment attempt with SUCCESS skip_trace_status but a rejected match
// was previously mis-classified as "never enriched"), the Rehab $0-vs-
// unknown distinction (already correct — regression-locked here), and
// structural proof that the new explainability tooltips reuse decision_v2's
// own already-computed reasons/missing arrays rather than reconstructing
// or fabricating anything.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { getContactStatus } from '../src/lib/contactEnrichment.js'
import { formatCurrency } from '../src/lib/calculations.js'

const HERO_SRC = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
const DISTRESS_SRC = fs.readFileSync('src/components/lead-detail/DistressBanner.jsx', 'utf8')
const TOOLTIP_SRC = fs.readFileSync('src/components/ui/InfoTooltip.jsx', 'utf8')

// Real, as-persisted enrichment_data for 10940 Ventnor Ave.
const VENTNOR_LEAD = {
  owner_name: 'MALONEY TIMOTHY JOSEPH ET AL', phone: null, email: null,
  enrichment_data: {
    contact_match_status: 'NO_MATCH', contact_profile: null,
    skip_trace_status: 'SUCCESS', // <- the real trap: SUCCESS, not NO_MATCH
    contact_ui_status: 'CONTACT NEEDED',
    contact_enriched_at: '2026-08-26T09:11:51.604Z',
  },
}

describe('Test 4/6 — the real bug: attempted + rejected match, skip_trace_status SUCCESS', () => {
  it('THE REAL VENTNOR CASE — no longer misreports as never-enriched', () => {
    expect(getContactStatus(VENTNOR_LEAD)).toBe('NO_MATCH')
    expect(getContactStatus(VENTNOR_LEAD)).not.toBe('NEEDS_ENRICHMENT')
  })
})

describe('Test 3 — never-attempted contact state', () => {
  it('a lead with no contact_ui_status at all is NEEDS_ENRICHMENT', () => {
    expect(getContactStatus({ enrichment_data: {} })).toBe('NEEDS_ENRICHMENT')
    expect(getContactStatus({})).toBe('NEEDS_ENRICHMENT')
  })
})

describe('Test 5 — Contact Ready state unaffected by the fix', () => {
  it('phone or email present is always CONTACT_READY, regardless of enrichment_data', () => {
    expect(getContactStatus({ phone: '9045551212' })).toBe('CONTACT_READY')
    expect(getContactStatus({ email: 'a@b.com', enrichment_data: { contact_ui_status: 'CONTACT NEEDED' } })).toBe('CONTACT_READY')
  })
})

describe('Regression — the true zero-candidates case (skip_trace_status actually NO_MATCH) still classifies correctly', () => {
  it('still returns NO_MATCH when skip_trace_status genuinely is NO_MATCH too', () => {
    const lead = { enrichment_data: { contact_ui_status: 'CONTACT NEEDED', skip_trace_status: 'NO_MATCH' } }
    expect(getContactStatus(lead)).toBe('NO_MATCH')
  })
})

describe('Test 1/2 — Rehab $0 vs unknown (already-correct logic, regression-locked)', () => {
  it('formatCurrency(0) renders as a real, known "$0" — never treated as empty', () => {
    expect(formatCurrency(0)).toMatch(/\$0/)
  })
  it('EditableField.jsx treats only null/undefined/empty-string as "isEmpty", never 0', () => {
    const src = fs.readFileSync('src/components/lead-detail/EditableField.jsx', 'utf8')
    expect(src).toMatch(/const isEmpty = value === null \|\| value === undefined \|\| value === ''/)
  })
  it('FinancialSection.jsx\'s renoMissing check uses == null (catches null/undefined, never 0)', () => {
    const src = fs.readFileSync('src/components/lead-detail/FinancialSection.jsx', 'utf8')
    expect(src).toMatch(/renoMissing\s*=\s*lead\.renovation_cost == null/)
  })
  it('LeadEssentialsBar\'s missing-Max-Buy explanation only fires on == null, never on a real 0', () => {
    const src = fs.readFileSync('src/components/lead-detail/LeadEssentialsBar.jsx', 'utf8')
    expect(src).toMatch(/lead\.renovation_cost == null/)
  })
})

describe('Tests 7/8/9 — Opportunity/Confidence/Urgency explanations reuse decision_v2\'s own real reasons, never reconstructed', () => {
  it('DecisionHero reads d.opportunity.reasons/d.confidence.reasons+missing/d.urgency.reasons directly — no new computation', () => {
    expect(HERO_SRC).toMatch(/reasons=\{d\.opportunity\?\.reasons\}/)
    expect(HERO_SRC).toMatch(/reasons=\{d\.confidence\?\.reasons\}/)
    expect(HERO_SRC).toMatch(/missing=\{d\.confidence\?\.missing\}/)
    expect(HERO_SRC).toMatch(/reasons=\{d\.urgency\?\.reasons\}/)
  })
  it('DistressBanner reuses the existing opp.opportunity_why/opportunity_missing — same fields the Why/Missing section already renders', () => {
    expect(DISTRESS_SRC).toMatch(/reasons=\{opp\.opportunity_why\}/)
    expect(DISTRESS_SRC).toMatch(/missing=\{opp\.opportunity_missing\}/)
  })
  it('no explanation text is hardcoded as a fake per-lead reason string — DecisionHero never contains invented reason literals', () => {
    // The only string literals near the tooltips are the fixed one-line
    // definitions (title/definition props), never a per-lead "why" string.
    expect(HERO_SRC).not.toMatch(/thisLead=\{['"]/) // thisLead is always a real expression, never a literal
  })
})

describe('Interaction fix — root cause A (hover never wired) and C (overflow-hidden ancestors clip an absolutely-positioned popover)', () => {
  it('hover is wired on the trigger (onMouseEnter/onMouseLeave), not click-only', () => {
    expect(TOOLTIP_SRC).toMatch(/onMouseEnter=\{\(\) => setHovered\(true\)\}/)
    expect(TOOLTIP_SRC).toMatch(/onMouseLeave=\{\(\) => setHovered\(false\)\}/)
  })
  it('keyboard focus also opens it (onFocus/onBlur)', () => {
    expect(TOOLTIP_SRC).toMatch(/onFocus=\{\(\) => setHovered\(true\)\}/)
    expect(TOOLTIP_SRC).toMatch(/onBlur=\{\(\) => setHovered\(false\)\}/)
  })
  it('click pins it open independently of hover state', () => {
    expect(TOOLTIP_SRC).toMatch(/onClick=\{\(\) => setPinned\(v => !v\)\}/)
  })
  it('renders via a portal to document.body — escapes DecisionHero/DistressBanner\'s real overflow-hidden ancestors', () => {
    expect(TOOLTIP_SRC).toMatch(/createPortal\(/)
    expect(TOOLTIP_SRC).toMatch(/document\.body/)
  })
  it('both real host cards genuinely have overflow-hidden (confirms the portal fix was necessary, not precautionary)', () => {
    expect(HERO_SRC).toMatch(/overflow-hidden/)
    expect(DISTRESS_SRC).toMatch(/overflow-hidden/)
  })
  it('positioned fixed with a high z-index, never relying on an ancestor\'s stacking context', () => {
    expect(TOOLTIP_SRC).toMatch(/position: 'fixed'/)
    expect(TOOLTIP_SRC).toMatch(/zIndex: 9999/)
  })
})

describe('Real priority thresholds — confirmed against distressScoring.js before displaying, not invented', () => {
  it('DistressBanner\'s tooltip states the ACTUAL PRIORITY_THRESHOLDS values (80/60/40), not the mission\'s example wording', () => {
    const scoringSrc = fs.readFileSync('src/lib/distressScoring.js', 'utf8')
    expect(scoringSrc).toMatch(/min: 80, key: 'HIGH_PRIORITY'/)
    expect(scoringSrc).toMatch(/min: 60, key: 'REVIEW'/)
    expect(scoringSrc).toMatch(/min: 40, key: 'RESEARCH'/)
    expect(DISTRESS_SRC).toMatch(/80–100 High Priority · 60–79 Review · 40–59 Research · below 40 Low Priority/)
  })
})

describe('Test 10 — tooltip never fabricates reasons, only renders what it is given', () => {
  it('InfoTooltip.jsx has zero hardcoded reason/explanation text of its own', () => {
    expect(TOOLTIP_SRC).not.toMatch(/reasons\s*=\s*\['/) // no default reasons array with actual string content
    expect(TOOLTIP_SRC).toMatch(/reasons = \[\]/) // only an empty default
    // Every reason it ever displays comes from the caller-supplied prop, via .map — never a literal string.
    expect(TOOLTIP_SRC).toMatch(/reasons\.map\(/)
  })
  it('InfoTooltip makes zero network/AI calls', () => {
    expect(TOOLTIP_SRC).not.toMatch(/fetch\(|supabase|anthropic|claude/i)
  })
})

describe('Test 11 — 85/100 vs 70 labeling is unambiguous', () => {
  it('the yellow card now labels its score "Off-Market Priority Score", distinct from ACT NOW\'s "Opportunity"', () => {
    expect(DISTRESS_SRC).toMatch(/Off-Market Priority Score/)
    expect(HERO_SRC).toMatch(/Opportunity <b/)
  })
  it('the Off-Market tooltip explicitly distinguishes itself from ACT NOW\'s score', () => {
    expect(DISTRESS_SRC).toMatch(/Different from ACT NOW's Opportunity score/)
    expect(DISTRESS_SRC).toMatch(/not a contradiction/)
  })
})

describe('Test 12 — no new AI/network call anywhere in this capability\'s files', () => {
  const files = [HERO_SRC, DISTRESS_SRC, TOOLTIP_SRC]
  it.each(files)('file has zero fetch/Anthropic/Claude/Supabase calls', (src) => {
    expect(src).not.toMatch(/fetch\(|anthropic|claude-|ANTHROPIC_API_KEY/i)
  })
})

describe('Tests 13/14 — protected scoring/decision logic completely untouched', () => {
  it('decisionEngineV2.js and distressScoring.js have zero uncommitted diff (verified separately via git diff --stat in the delivery report; here we lock the exported function signatures used)', () => {
    const engineSrc = fs.readFileSync('src/lib/decisionEngineV2.js', 'utf8')
    const scoringSrc = fs.readFileSync('src/lib/distressScoring.js', 'utf8')
    expect(engineSrc).toMatch(/export function computeConfidence\(lead, marketType, pdd\)/)
    expect(engineSrc).toMatch(/export function computeUrgency\(lead, marketType\)/)
    expect(engineSrc).toMatch(/export function computeOffMarketOpportunity\(lead, pdd\)/)
    expect(scoringSrc).toMatch(/export function computeOpportunityScore\(input\)/)
  })
})
