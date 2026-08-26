// test/triageDecisionBar.test.js
// Compact Triage Decision Bar V1 — presentation/placement refinement only.
// Structural/source-inspection tests (no component-mount harness in this
// repo — established convention, see callReviewAbort.test.js etc.).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

const triageSrc = fs.readFileSync('src/components/lead-detail/TriageDecisionBar.jsx', 'utf8')
const actionZoneSrc = fs.readFileSync('src/components/lead-detail/ActionZone.jsx', 'utf8')
const pageSrc = fs.readFileSync('src/pages/LeadDetailPage.jsx', 'utf8')

describe('TriageDecisionBar reuses ActionZone.PLAYBOOKS.triage verbatim — no new business logic', () => {
  it('imports PLAYBOOKS from ActionZone rather than redefining the triage playbook', () => {
    expect(triageSrc).toMatch(/import \{ PLAYBOOKS \} from '\.\/ActionZone'/)
    expect(triageSrc).not.toMatch(/patch:\s*\{\s*status:/) // no inline status patches of its own
  })
  it('uses the same useLeadUpdate hook (same activity logging / notifications / decision_v2 recalc path)', () => {
    expect(triageSrc).toMatch(/useLeadUpdate\(lead, userId, members, onUpdated\)/)
  })
  it('does not touch supabase directly (all writes go through the shared hook)', () => {
    expect(triageSrc).not.toMatch(/supabase/)
  })
})

describe('Visibility — only while lead.status === "triage" and canEdit', () => {
  it('bar returns null unless status is exactly "triage"', () => {
    expect(triageSrc).toMatch(/lead\.status !== 'triage'\) return null/)
  })
  it('bar respects the same canEdit gate as every other lead-workspace action surface', () => {
    expect(triageSrc).toMatch(/if \(!canEdit \|\| lead\.status !== 'triage'\) return null/)
  })
})

describe('No duplicate triage control — ActionZone skips rendering its own copy for triage', () => {
  it('ActionZone explicitly bails out for status === "triage"', () => {
    expect(actionZoneSrc).toMatch(/if \(lead\.status === 'triage'\) return null/)
  })
  it('every non-triage playbook in ActionZone is completely untouched (spot check a few)', () => {
    expect(actionZoneSrc).toMatch(/new_lead:\s*\{/)
    expect(actionZoneSrc).toMatch(/mao_calculated:\s*\{/)
    expect(actionZoneSrc).toMatch(/offer_accepted:\s*\{/)
    expect(actionZoneSrc).toMatch(/sold:\s*\{/)
  })
})

describe('No duplicate Next Best Action / coaching concept introduced', () => {
  it('TriageDecisionBar never labels itself "Next Best Action" in rendered JSX text — distinct concept from ActionZone (the header comment references it only to explain the boundary)', () => {
    const jsxReturnIdx = triageSrc.indexOf('return (')
    const jsxSlice = triageSrc.slice(jsxReturnIdx)
    expect(jsxSlice).not.toMatch(/Next Best Action/i)
  })
  it('TriageDecisionBar renders the "Triage Decision" label, not a reused ActionZone heading', () => {
    expect(triageSrc).toMatch(/Triage Decision/)
  })
})

describe('Placement — LeadDetailPage renders the compact bar between Lead Essentials and the tabs', () => {
  it('TriageDecisionBar is imported and rendered', () => {
    expect(pageSrc).toMatch(/import TriageDecisionBar from '\.\.\/components\/lead-detail\/TriageDecisionBar'/)
    expect(pageSrc).toMatch(/<TriageDecisionBar/)
  })
  it('TriageDecisionBar appears after LeadEssentialsBar and before LeadWorkspaceTabs in source order', () => {
    const essentialsIdx = pageSrc.indexOf('<LeadEssentialsBar')
    const triageIdx = pageSrc.indexOf('<TriageDecisionBar')
    const tabsIdx = pageSrc.indexOf('<LeadWorkspaceTabs')
    expect(essentialsIdx).toBeGreaterThan(-1)
    expect(triageIdx).toBeGreaterThan(essentialsIdx)
    expect(tabsIdx).toBeGreaterThan(triageIdx)
  })
  it('ActionZone is still rendered in Overview for every other status (unchanged placement)', () => {
    expect(pageSrc).toMatch(/<ActionZone/)
  })
})

describe('Button hierarchy — Promote primary, Not In Buy Box secondary, Dismiss quiet/destructive', () => {
  it('Promote to New Lead maps to the primary variant', () => {
    expect(triageSrc).toMatch(/action\.label === 'Promote to New Lead' \? 'primary'/)
  })
  it('Dismiss maps to a quiet (ghost) variant with a destructive text color, not the loud "danger" fill', () => {
    expect(triageSrc).toMatch(/action\.label === 'Dismiss' \? 'ghost'/)
    expect(triageSrc).toMatch(/color-danger/)
  })
  it('all three actions remain one click away — no "More" menu wrapper', () => {
    expect(triageSrc).not.toMatch(/More/)
    expect(triageSrc).toMatch(/actions\.map/)
  })
})

describe('No business-logic change — zero references to scoring/Buy Box/opportunity computation', () => {
  it('TriageDecisionBar does not import or reference distressScoring/decisionEngineV2', () => {
    expect(triageSrc).not.toMatch(/distressScoring|decisionEngineV2/)
  })
})
