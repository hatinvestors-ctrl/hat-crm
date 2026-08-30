// test/marketTypeIntegrity.test.js
// P1 Market Type Integrity Audit & Fix (2026-08-31).
//
// Real, confirmed production defect (live read-only Supabase audit, not
// guessed): 19 leads in this workspace have a fully-evidenced distress
// signal (a marker-verified "⚠ DISTRESSED OPPORTUNITY" notes block
// and/or enrichment_data.distress_category), correctly caught as
// distressed by the EXISTING isDistressedLead() helper (which Action
// Center's OFF-MARKET section has always used) — but `lead.is_distressed`
// itself was never set to true on those rows. The Action Center
// market-type BADGE and decisionV2Persistence.js's scoring-routing check
// both used only that bare, under-populated boolean — producing the
// exact "OFF-MARKET section, ON-MARKET badge" contradiction, AND
// silently scoring genuine distressed opportunities through
// decisionEngineV2's ON_MARKET branch (Opportunity 7-15, PASS) instead
// of the off-market rules they actually warrant.
//
// Fix: ONE canonical resolver (distressInfo.js's resolveMarketType,
// built on the existing isDistressedLead() — no new heuristic, no new
// field, no migration), now shared by the badge, the section, AND
// decisionV2Persistence.js. No bulk/retroactive data change — this only
// affects new leads and any lead whose normal recalculation trigger
// fires from this point forward.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { resolveMarketType, isDistressedLead } from '../src/lib/distressInfo.js'

const actionCenterSrc = fs.readFileSync('src/pages/ActionCenterPage.jsx', 'utf8')
const persistenceSrc = fs.readFileSync('src/lib/decisionV2Persistence.js', 'utf8')
const distressInfoSrc = fs.readFileSync('src/lib/distressInfo.js', 'utf8')
const engineSrc = fs.readFileSync('src/lib/decisionEngineV2.js', 'utf8')

// Real production notes shape (verified live: notes start with the exact
// marker parseNotesBlock requires), is_distressed left unset — the exact
// confirmed defect shape.
const LEDBURY_SHAPED_LEAD = {
  id: 'ledbury', address: '3603 E Ledbury Dr', is_distressed: false, distress_data: null,
  notes: '⚠ DISTRESSED OPPORTUNITY — Lis Pendens\nFiled: 2026-08-06\nCase/Instrument: 2026183240\nSource Party: SABEN KENNETH N\nOwner Match: MATCH\nAbsentee Owner: false',
}
const MLS_LEAD = { id: 'mls-lead', address: '1012 Beckner Ave', is_distressed: false, distress_data: null, notes: 'Standard MLS listing, move-in ready.' }
const AMBIGUOUS_LEAD = { id: 'ambiguous', address: '123 Unknown St', is_distressed: null, distress_data: null, notes: null }

// ── Part 2 — is_distressed !== OFF_MARKET, but distress IS market type here ──
describe('Part 2/8 — business concepts: distress and market type are currently the SAME concept in this data model (by design), and is_distressed alone is an unreliable proxy for it', () => {
  it('a lead with a fully-evidenced distress notes block, but is_distressed left false, is STILL correctly identified as distressed (and thus off-market) — the real confirmed defect shape', () => {
    expect(isDistressedLead(LEDBURY_SHAPED_LEAD)).toBe(true)
    expect(resolveMarketType(LEDBURY_SHAPED_LEAD)).toBe('OFF_MARKET')
  })
  it('resolveMarketType is documented as reusing isDistressedLead — no second/competing heuristic introduced', () => {
    expect(distressInfoSrc).toMatch(/export function resolveMarketType\(lead\) \{\s*\n\s*return isDistressedLead\(lead\) \? 'OFF_MARKET' : 'ON_MARKET'/)
  })
})

// ── Part 13 — canonical resolver test matrix ───────────────────────────────
describe('Part 13 — canonical resolver test matrix', () => {
  it('1. confirmed MLS/on-market lead → ON_MARKET', () => {
    expect(resolveMarketType(MLS_LEAD)).toBe('ON_MARKET')
  })
  it('2. confirmed off-market distressed lead (is_distressed=true) → OFF_MARKET', () => {
    expect(resolveMarketType({ is_distressed: true })).toBe('OFF_MARKET')
  })
  it('3. off-market lead evidenced only via distress_data (is_distressed unset) → OFF_MARKET', () => {
    expect(resolveMarketType({ is_distressed: false, distress_data: { distress_type: 'lis_pendens' } })).toBe('OFF_MARKET')
  })
  it('4. off-market lead evidenced only via the marker-verified notes block (is_distressed unset, no distress_data) → OFF_MARKET — the real Ledbury/Ish Brant/Crossfield shape', () => {
    expect(resolveMarketType(LEDBURY_SHAPED_LEAD)).toBe('OFF_MARKET')
  })
  it('5. ambiguous lead (no is_distressed, no distress_data, no notes) → defined fallback ON_MARKET, never an invented guess or crash', () => {
    expect(() => resolveMarketType(AMBIGUOUS_LEAD)).not.toThrow()
    expect(resolveMarketType(AMBIGUOUS_LEAD)).toBe('ON_MARKET')
  })
  it('null/undefined lead never throws', () => {
    expect(resolveMarketType(null)).toBe('ON_MARKET')
    expect(resolveMarketType(undefined)).toBe('ON_MARKET')
  })
})

// ── Part 9 — every Action Center market surface uses the ONE resolver ─────
describe('Part 9/13 — badge, section, and scoring routing all use the ONE canonical resolver — no OFF-MARKET-section/ON-MARKET-badge contradiction possible', () => {
  it('6. ActionCenterPage.jsx imports resolveMarketType from distressInfo.js for the badge — no page-local duplicate definition', () => {
    expect(actionCenterSrc).toMatch(/import \{[^}]*resolveMarketType[^}]*\} from '\.\.\/lib\/distressInfo'/)
    expect(actionCenterSrc).not.toMatch(/^function resolveMarketType/m)
  })
  it('7. the V1 OFF_MARKET section predicate is isDistressedLead() — the SAME function resolveMarketType is built on, so section membership and the badge can never disagree', () => {
    expect(actionCenterSrc).toMatch(/const distressed = isDistressedLead\(lead\)/)
    expect(actionCenterSrc).toMatch(/category = 'OFF_MARKET'/)
  })
  it('8. the OFF_MARKET section count and the individual card badges derive from the same underlying classified items array (no separate count query/predicate)', () => {
    // The top-level counts render via items.filter(i => i.category === key).length
    // over the SAME `items` array every card in that section came from.
    expect(actionCenterSrc).toMatch(/items\.filter\(i => i\.category === key\)\.length/)
  })
  it('10. decisionV2Persistence.js\'s scoring-routing marketType now uses isDistressedLead(), the same canonical check — documented as the real decision-integrity fix', () => {
    expect(persistenceSrc).toMatch(/import \{ isDistressedLead \} from '\.\/distressInfo\.js'/)
    expect(persistenceSrc).toMatch(/const marketType = isDistressedLead\(lead\) \? 'off_market' : 'on_market'/)
    expect(persistenceSrc).not.toMatch(/const marketType = lead\.is_distressed \? 'off_market' : 'on_market'/)
  })
  it('11. no OFF-MARKET-section/ON-MARKET-badge contradiction remains possible: for the confirmed real defect shape, resolveMarketType (badge) and isDistressedLead (section) agree', () => {
    expect(resolveMarketType(LEDBURY_SHAPED_LEAD) === 'OFF_MARKET').toBe(isDistressedLead(LEDBURY_SHAPED_LEAD))
  })
})

// ── Part 12/16 — proof: nothing scoring-related changed ───────────────────
describe('Part 12/16 — scoring thresholds and financial formulas byte-unchanged', () => {
  it('12. Act Now / Review Today / Research thresholds unchanged in decisionEngineV2.js', () => {
    expect(engineSrc).toMatch(/const strong = opportunity\.score >= 65 && confidence\.score >= 60/)
    expect(engineSrc).toMatch(/const promising = opportunity\.score >= 45/)
    expect(engineSrc).toMatch(/const weak = opportunity\.score < 30/)
  })
  it('decisionEngineV2.js itself carries no edit markers from this task — only its caller (decisionV2Persistence.js) changed, never the scoring engine', () => {
    expect(engineSrc).not.toMatch(/P1 Market Type Integrity/)
  })
  it('13. canonical Flip/BRRRR formulas (calculations.js) untouched by this task', () => {
    const calcSrc = fs.readFileSync('src/lib/calculations.js', 'utf8')
    expect(calcSrc).not.toMatch(/P1 Market Type Integrity/)
    expect(calcSrc).toMatch(/export const FLIP_MIN_PROFIT_TARGET = 30000/)
    expect(calcSrc).toMatch(/export const BRRRR_MAX_CASH_LEFT_IN = 30000/)
  })
})
