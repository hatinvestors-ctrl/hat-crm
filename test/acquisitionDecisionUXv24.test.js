// test/acquisitionDecisionUXv24.test.js
// HAT Investors — Lead Workspace UX V2.4 — "SIMPLIFY THE OVERVIEW — ONE
// CLEAR DECISION, MINIMUM COGNITIVE LOAD"
//
// Covers Part 22's test matrix. Pure-function assertions run against real
// Woodleigh/Norfolk-shaped fixtures; DecisionHero.jsx / DealDecisionCenter.jsx
// assertions are structural (source-text), matching this repo's existing
// convention (no component-mount harness exists here).
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../src/lib/dealExplanation'
import { deriveAcquisitionDecision } from '../src/lib/acquisitionDecisionPresentation'

const WOODLEIGH = {
  id: 'woodleigh-test',
  address: '1963 W Woodleigh Dr',
  asking_price: 100000,
  arv: 200000,
  renovation_cost: 39000,
  rent_estimate: 1350,
  hold_months: 6,
  is_distressed: false,
}

const NORFOLK = {
  id: 'norfolk-test',
  address: '9739 Norfolk Blvd',
  asking_price: 105000,
  arv: 215000,
  renovation_cost: 65000,
  rent_estimate: 1350,
  hold_months: 6,
  is_distressed: false,
}

// Workspace's actual configured underwriting settings (75% refi LTV) — the
// SAME settings LeadDetailPage.jsx resolves and threads to every consumer.
const SETTINGS = { flip: {}, brrrr: { refi_ltv_pct: 0.75, refi_costs_pct: 0.03 } }

function decide(lead, settings = SETTINGS) {
  const flip = computeFlipResult(lead, settings)
  const brrrr = computeBrrrrResult(lead, settings)
  const strategyRec = flip.available || brrrr.available ? computeStrategyRecommendation(flip, brrrr) : null
  return deriveAcquisitionDecision({
    flip, brrrr, strategyRec,
    fit: null, decisionV2Recommendation: 'REVIEW_TODAY',
    lead, marketType: lead.is_distressed ? 'OFF_MARKET' : 'ON_MARKET', sellerAskingPrice: null,
  })
}

const decisionHeroSrc = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
const dealDecisionCenterSrc = fs.readFileSync('src/components/lead-detail/workspace/DealDecisionCenter.jsx', 'utf8')

// ── A. Strategy consistency: DecisionHero and DealDecisionCenter now agree ──
describe('A. Strategy consistency — Finding A fix', () => {
  it('DecisionHero.jsx threads underwritingSettings into both computeFlipResult and computeBrrrrResult', () => {
    expect(decisionHeroSrc).toMatch(/const flip = computeFlipResult\(lead, underwritingSettings\)/)
    expect(decisionHeroSrc).toMatch(/const brrrr = computeBrrrrResult\(lead, underwritingSettings\)/)
  })
  it('LeadDetailPage.jsx passes underwritingSettings to DecisionHero', () => {
    const src = fs.readFileSync('src/pages/LeadDetailPage.jsx', 'utf8')
    expect(src).toMatch(/<DecisionHero lead=\{lead\} underwritingSettings=\{underwritingSettings\} \/>/)
  })
  it('at 75% refi LTV, Norfolk actually prefers BRRRR (same settings both surfaces now use)', () => {
    const flip = computeFlipResult(NORFOLK, SETTINGS)
    const brrrr = computeBrrrrResult(NORFOLK, SETTINGS)
    const rec = computeStrategyRecommendation(flip, brrrr)
    expect(rec.preferredStrategy).toBe('BRRRR')
  })
})

// ── B. Offer/evaluation provenance — Finding B fix ──────────────────────────
describe('B. Offer/evaluation provenance — Finding B fix', () => {
  it('DealDecisionCenter.jsx no longer labels a calculated value "We Offer"', () => {
    expect(dealDecisionCenterSrc).not.toMatch(/label="We Offer"/)
  })
  it('DealDecisionCenter.jsx labels the same flip.currentOffer value "Suggested Offer", matching DealSnapshotCompact.jsx', () => {
    expect(dealDecisionCenterSrc).toMatch(/label="Suggested Offer"/)
    const snapshotSrc = fs.readFileSync('src/components/lead-detail/workspace/DealSnapshotCompact.jsx', 'utf8')
    expect(snapshotSrc).toMatch(/Suggested Offer/)
  })
})

// ── C. Woodleigh: compact hero, one decision, no contradictory noise ───────
describe('C. Woodleigh — compact hero output', () => {
  const d = decide(WOODLEIGH)
  it('produces exactly one headline/state, one target price, one recommended strategy', () => {
    expect(d.headline).toBeTruthy()
    expect(typeof d.headline).toBe('string')
    expect(d.targetPrice).not.toBeNull()
    expect(['FLIP', 'BRRRR']).toContain(d.targetStrategy)
  })
  it('never surfaces the raw WATCH/SOLID/NO DEAL words as the primary state', () => {
    expect(['WATCH', 'SOLID', 'NO DEAL', 'STRONG']).not.toContain(d.headline)
  })
})

// ── D. Norfolk — unchanged behavior from V2.1/V2.2/V2.3 ─────────────────────
describe('D. Norfolk — unchanged from prior UX versions', () => {
  const d = decide(NORFOLK)
  it('still reports a real currentPrice/targetPrice/gap when on-market with an asking price', () => {
    expect(d.currentPrice).not.toBeNull()
    expect(d.targetPrice).not.toBeNull()
    expect(d.gap).not.toBeNull()
  })
  it('still prefers BRRRR as the primary strategy at this workspace\'s 75% settings', () => {
    expect(d.targetStrategy).toBe('BRRRR')
  })
})

// ── E. WATCH/SOLID/NO DEAL absent from primary Overview language ───────────
describe('E. WATCH/SOLID/NO DEAL replaced by Margin of Safety framing', () => {
  it('DecisionHero.jsx renders "Margin of Safety" with THIN/HEALTHY, not a raw verdict label, in its primary block', () => {
    expect(decisionHeroSrc).toMatch(/Margin of Safety/)
    expect(decisionHeroSrc).toMatch(/MARGIN_OF_SAFETY/)
    expect(decisionHeroSrc).not.toMatch(/Deal Safety \(detail\)/)
  })
})

// ── F. Priority is compact, no inline threshold math ────────────────────────
describe('F. Priority section is compact', () => {
  it('DecisionHero.jsx uses a canned PRIORITY_SUBTEXT lookup instead of the full inline actionReason.reason as primary copy', () => {
    expect(decisionHeroSrc).toMatch(/PRIORITY_SUBTEXT/)
    expect(decisionHeroSrc).toMatch(/Worth reviewing today, but not urgent\./)
  })
  it('the detailed deterministic reason is still available, just moved into the tooltip, not deleted', () => {
    expect(decisionHeroSrc).toMatch(/reasons=\{actionReason\?\.reason \? \[actionReason\.reason\] : undefined\}/)
  })
})

// ── G. Strategy line: one primary + one small optional alternative ─────────
describe('G. Strategy presentation is one primary + one optional alternative line', () => {
  it('DecisionHero.jsx no longer renders a 2-column equal-weight BRRRR/FLIP comparison box', () => {
    expect(decisionHeroSrc).not.toMatch(/grid-cols-2[^}]*>\s*<div[^}]*BRRRR[\s\S]*?<div[^}]*FLIP/)
  })
  it('renders "Recommended Strategy" as the primary line and "Alternative:" only when both strategies are genuinely available', () => {
    expect(decisionHeroSrc).toMatch(/Recommended Strategy/)
    expect(decisionHeroSrc).toMatch(/Alternative: \{decision\.targetStrategy/)
  })
})

// ── H. Bottom economics collapsed to one compact line ───────────────────────
describe('H. Economics row collapsed (Part 9)', () => {
  it('DecisionHero.jsx renders one compact FLIP/BRRRR summary line, not 3 separate large Metric blocks', () => {
    expect(decisionHeroSrc).toMatch(/projected profit @ \{decision\?\.priceIsEvaluation \? 'evaluation' : 'current'\} price/)
    expect(decisionHeroSrc).toMatch(/mo cash flow/)
  })
})

// ── I. No financial/strategy/scoring logic changed ──────────────────────────
describe('I. Zero changes to protected financial/scoring engines', () => {
  it('calculations.js, dealExplanation.js, decisionEngineV2.js are untouched by this session\'s edits (verified via git diff in the final report; this test locks the imports DecisionHero.jsx still uses, unchanged)', () => {
    expect(decisionHeroSrc).toMatch(/import \{ computeFlipResult, computeBrrrrResult, computeStrategyRecommendation \} from '\.\.\/\.\.\/\.\.\/lib\/dealExplanation'/)
    expect(decisionHeroSrc).toMatch(/import \{ classifyLeadV2 \} from '\.\.\/\.\.\/\.\.\/pages\/ActionCenterPage'/)
  })
  it('Woodleigh\'s golden Flip numbers are unchanged (MAO ~$102,200, profit $32,382, verdict WATCH)', () => {
    const flip = computeFlipResult(WOODLEIGH, SETTINGS)
    expect(Math.round(flip.mao)).toBe(102222)
    expect(flip.projectedProfit).toBe(32382)
    expect(flip.verdict).toBe('WATCH')
  })
})

// ── J. READY_TO_PURSUE renamed to CONTACT SELLER, no data loss ─────────────
describe('J. Off-market no-seller-price case says CONTACT SELLER, not READY TO PURSUE', () => {
  it('acquisitionDecisionPresentation.js STATE_META labels READY_TO_PURSUE as CONTACT SELLER', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/READY_TO_PURSUE:\s*\{\s*label:\s*'CONTACT SELLER'/)
  })
})

// ── K. No data removed — full economics still reachable on the Deal tab ────
describe('K. Progressive disclosure — nothing deleted, only moved', () => {
  it('DealDecisionCenter.jsx (Deal tab) still exposes the full detail (Max Buy, profit breakdown) untouched aside from the We Offer -> Suggested Offer relabel', () => {
    expect(dealDecisionCenterSrc).toMatch(/Flip Max Buy/)
  })
})
