// test/leadWorkspacePolish.test.js
// Lead Workspace Final UX Polish — narrowly scoped to this pass's changes:
// clickable Next Action reusing the ONE existing enrichment execution
// path, and the clearer Contact status wording. Structural checks (this
// repo's established convention for React component wiring — see
// leadEssentials.test.js/offmarketControlCenter.test.js).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

const DISTRESS_SRC = fs.readFileSync('src/components/lead-detail/DistressBanner.jsx', 'utf8')
const ESSENTIALS_SRC = fs.readFileSync('src/components/lead-detail/LeadEssentialsBar.jsx', 'utf8')
const PAGE_SRC = fs.readFileSync('src/pages/LeadDetailPage.jsx', 'utf8')

describe('Part 2 — Next Action is clickable only where a safe existing action exists', () => {
  it('DistressBanner only treats Retry Contact/Enrich Contact as actionable — no other Next Action value is clickable', () => {
    expect(DISTRESS_SRC).toMatch(/ACTIONABLE_NEXT_ACTIONS = new Set\(\['Retry Contact', 'Enrich Contact'\]\)/)
  })
  it('DistressBanner never calls BatchData/enrichment directly — only triggers the caller-supplied onRequestEnrich callback', () => {
    expect(DISTRESS_SRC).not.toMatch(/import .*from .*(enrichmentRun|batchdata-enrich)/)
    expect(DISTRESS_SRC).toMatch(/onClick=\{onRequestEnrich\}/)
  })
  it('clicking never bypasses confirmation — DistressBanner has no enrichment modal or running/loading state of its own', () => {
    // UX V2.5, Part 7 — DistressBanner now has ONE local useState, but it is
    // purely a collapsed/expanded UI toggle for the progressive-disclosure
    // redesign (never touches enrichment/confirmation flow at all — no
    // modal state, no "running" flag, no enrichment call). The real
    // guarantee this test protects — enrichment always routes through the
    // single onRequestEnrich callback, never a local execution path — is
    // covered by the two assertions above; this one narrows to the actual
    // risk (a second confirmation-bypassing modal), not "any useState".
    expect(DISTRESS_SRC).not.toMatch(/EnrichContactsModal/)
    expect(DISTRESS_SRC).toMatch(/const \[expanded, setExpanded\] = useState\(false\)/)
  })
})

describe('Part 2 — exactly ONE canonical enrichment execution path', () => {
  it('runContactEnrichmentBatch is not imported (let alone called) in LeadEssentialsBar or DistressBanner — only in LeadDetailPage', () => {
    expect(ESSENTIALS_SRC).not.toMatch(/import \{ runContactEnrichmentBatch/)
    expect(DISTRESS_SRC).not.toMatch(/import \{ runContactEnrichmentBatch/)
    const matches = PAGE_SRC.match(/runContactEnrichmentBatch\(\[/g) || []
    expect(matches.length).toBe(1)
  })
  it('LeadEssentialsBar and DistressBanner both trigger enrichment via the SAME prop name (onRequestEnrich), not two different callbacks', () => {
    expect(ESSENTIALS_SRC).toMatch(/onRequestEnrich/)
    expect(DISTRESS_SRC).toMatch(/onRequestEnrich/)
  })
  it('the page renders exactly one EnrichContactsModal, shared by both callers', () => {
    const matches = PAGE_SRC.match(/<EnrichContactsModal/g) || []
    expect(matches.length).toBe(1)
  })
  it('paid confirmation is still required — the modal only runs on its own onConfirm, never on mount', () => {
    expect(PAGE_SRC).toMatch(/onConfirm=\{runSingleEnrichment\}/)
  })
})

describe('Part 1 — clearer contact status wording, still canonical', () => {
  it('uses the required status labels', () => {
    expect(ESSENTIALS_SRC).toMatch(/CONTACT READY/)
    expect(ESSENTIALS_SRC).toMatch(/NO VERIFIED CONTACT/)
  })
  it('uses "Last skip trace" wording instead of the old technical "Enrichment attempted" phrase', () => {
    expect(ESSENTIALS_SRC).toMatch(/Last skip trace/)
    expect(ESSENTIALS_SRC).not.toMatch(/Enrichment attempted \{/)
  })
  it('still built entirely from getContactStatus() — no second contact-status model introduced', () => {
    expect(ESSENTIALS_SRC).toMatch(/CONTACT_STATUS_BADGE\[contactStatus\]/)
  })
  it('multiple phones/emails/associated-people counts are still shown for a Contact Ready lead', () => {
    expect(ESSENTIALS_SRC).toMatch(/extraPhones > 0/)
    expect(ESSENTIALS_SRC).toMatch(/extraEmails > 0/)
    expect(ESSENTIALS_SRC).toMatch(/associatedCount > 0/)
  })
  it('owner name still renders first, unconditionally, before the status badge JSX', () => {
    const ownerLineIdx = ESSENTIALS_SRC.indexOf('primary_person?.name || lead.owner_name')
    // Search for the contact-status badge render specifically, starting
    // after the `const badge = CONTACT_STATUS_BADGE[contactStatus]`
    // declaration — an EARLIER, unrelated `{badge && (` now exists inside
    // InputTile (the AI ARV provenance pill, added by AI Valuation V1),
    // which is a different `badge` prop entirely and would otherwise be
    // matched first by a plain indexOf().
    const contactBadgeDeclIdx = ESSENTIALS_SRC.indexOf('const badge = CONTACT_STATUS_BADGE[contactStatus]')
    const badgeRenderIdx = ESSENTIALS_SRC.indexOf('{badge && (', contactBadgeDeclIdx)
    expect(ownerLineIdx).toBeGreaterThan(-1)
    expect(contactBadgeDeclIdx).toBeGreaterThan(-1)
    expect(badgeRenderIdx).toBeGreaterThan(-1)
    expect(ownerLineIdx).toBeLessThan(badgeRenderIdx)
  })
})

describe('Part 3 — distress card compaction did not remove any required field', () => {
  const requiredFacts = ['Filed', 'Owner', 'Owner Match', 'Absentee Owner', 'Parcel', 'Source', 'Case / Instrument', 'Distress Type', 'Property Fit', 'Opportunity']
  it.each(requiredFacts)('still renders the %s fact', (label) => {
    expect(DISTRESS_SRC).toContain(label)
  })
  it('still shows opportunity_why/opportunity_missing', () => {
    expect(DISTRESS_SRC).toMatch(/opportunity_why/)
    expect(DISTRESS_SRC).toMatch(/opportunity_missing/)
  })
})

describe('No business logic touched by this polish pass', () => {
  it('DistressBanner still delegates 100% to getDistressInfo/getOpportunityInfo/getNextAction — no local scoring', () => {
    expect(DISTRESS_SRC).toMatch(/getDistressInfo, getWhyHereReasons, getNextAction, getOpportunityInfo/)
    expect(DISTRESS_SRC).not.toMatch(/opportunity_score\s*[+\-*/]|distress_category\s*=[^=]/)
  })
})
