// test/leadEssentials.test.js
// Lead Workspace Essentials & Quick Edit Layer V1. This repo's convention
// for React components (no component-mount test harness anywhere in this
// suite) is structural/source verification for wiring correctness, plus
// direct calls to the underlying pure canonical functions the component
// reuses — never re-testing calculations.js/dealExplanation.js's own
// logic here (already covered by their own extensive test files).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../src/lib/dealExplanation.js'

const SRC = fs.readFileSync('src/components/lead-detail/LeadEssentialsBar.jsx', 'utf8')

describe('Canonical field sourcing (Part 1/13 Tests 1-4) — no parallel values', () => {
  it('reads Ask from lead.asking_price directly, no renamed/duplicate field', () => {
    expect(SRC).toMatch(/lead\.asking_price/)
  })
  it('reads ARV from lead.arv directly', () => {
    expect(SRC).toMatch(/lead\.arv/)
  })
  it('reads Rehab from lead.renovation_cost directly', () => {
    expect(SRC).toMatch(/lead\.renovation_cost/)
  })
  it('reads Rent from lead.rent_estimate directly', () => {
    expect(SRC).toMatch(/lead\.rent_estimate/)
  })
  it('Test 8 — never declares a second/parallel deal field name (no "_essentials" or "_quick" suffix anywhere)', () => {
    expect(SRC).not.toMatch(/asking_price_|arv_quick|renovation_cost_quick|rent_estimate_quick/)
  })
})

describe('Quick edit save path (Part 4, Test 6/7) — reuses the existing hook, no duplicate calculation', () => {
  it('uses the existing useLeadUpdate hook, not a new save function', () => {
    expect(SRC).toMatch(/import \{ useLeadUpdate \} from '\.\.\/\.\.\/hooks\/useLeadUpdate'/)
    expect(SRC).toMatch(/useLeadUpdate\(lead, userId, members, onUpdated\)/)
  })
  it('every quick-edit field calls update() with the real canonical key, not a derived one', () => {
    expect(SRC).toMatch(/update\(\{ asking_price: v \}\)/)
    expect(SRC).toMatch(/update\(\{ arv: v \}\)/)
    expect(SRC).toMatch(/update\(\{ renovation_cost: v \}\)/)
    expect(SRC).toMatch(/update\(\{ rent_estimate: v \}\)/)
  })
  it('uses the existing EditableField component, not a new inline-edit implementation', () => {
    expect(SRC).toMatch(/import EditableField from '\.\/EditableField'/)
  })
  it('Test 5 — missing values are passed through as-is (null), never coerced to a fake 0 (EditableField\'s own placeholder handles the "Not set" display)', () => {
    expect(SRC).not.toMatch(/asking_price \|\| 0|arv \|\| 0|renovation_cost \|\| 0|rent_estimate \|\| 0/)
  })
})

describe('Deal output — Part 2, no duplicate calculation engine', () => {
  it('computes output via the canonical dealExplanation.js functions only — zero local arithmetic on ARV/reno/rate', () => {
    // UX V2.5, Part 2 — also imports resolveEffectiveStrategy (still a
    // canonical dealExplanation.js export, not local arithmetic) so the
    // "BOTH WORK — X PREFERRED" tie-break winner is never dropped here.
    expect(SRC).toMatch(/import \{ computeFlipResult, computeBrrrrResult, computeStrategyRecommendation, resolveEffectiveStrategy \} from '\.\.\/\.\.\/lib\/dealExplanation'/)
    // No re-implemented MAO/profit formula (e.g. "* 0.7", "0.75 *") anywhere in this file.
    expect(SRC).not.toMatch(/0\.7\d?\s*\*|\*\s*0\.7\d?/)
  })
  it('Test 7 — the same canonical engine other screens use produces this component\'s displayed Max Buy/Profit for a real deal shape', () => {
    const lead = { asking_price: 150000, arv: 220000, renovation_cost: 45000, hold_months: 6 }
    const flip = computeFlipResult(lead)
    const brrrr = computeBrrrrResult(lead)
    const strategy = computeStrategyRecommendation(flip, brrrr)
    expect(flip.available).toBe(true)
    expect(typeof flip.mao).toBe('number')
    expect(['FLIP', 'BRRRR', 'NONE']).toContain(strategy.preferredStrategy)
  })
  it('a lead missing ARV never produces a fabricated Max Buy — computeFlipResult already returns available:false, this component must not override that', () => {
    const flip = computeFlipResult({ renovation_cost: 10000 })
    expect(flip.available).toBe(false)
    expect(SRC).not.toMatch(/maxBuy = .*\?\?.*0\b/) // never a "?? 0" fallback masking unavailability
  })
})

describe('Contact summary (Part 5/13 Tests 9-13) — reuses canonical contact functions, no second model', () => {
  it('reuses getContactStatus, not a new contact-readiness check', () => {
    expect(SRC).toMatch(/import \{ getContactStatus \} from '\.\.\/\.\.\/lib\/contactEnrichment'/)
  })
  it('reuses getLastAttemptSummary for the no-match state, not a new explanation', () => {
    expect(SRC).toMatch(/import \{ getLastAttemptSummary \} from '\.\.\/\.\.\/lib\/enrichmentResult'/)
  })
  it('Test 13 — CONTACT_READY and a failed/no-match attempt render through different branches, never the same label', () => {
    expect(SRC).toMatch(/contactStatus === 'CONTACT_READY'/)
    expect(SRC).toMatch(/lastAttempt \?/)
  })
  it('Test 10/11/12 — phone/email/associated-person counts are derived from contact_profile arrays, never hardcoded', () => {
    expect(SRC).toMatch(/profile\?\.phones\?\.length/)
    expect(SRC).toMatch(/profile\?\.emails\?\.length/)
    expect(SRC).toMatch(/profile\?\.associated_people\?\.length/)
  })
})

describe('Rich Contact Intelligence access (Part 6) — reuses the existing card, no duplicate presentation', () => {
  it('reuses ContactIntelligenceCard rather than re-rendering the profile itself', () => {
    expect(SRC).toMatch(/import ContactIntelligenceCard from '\.\/ContactIntelligenceCard'/)
    expect(SRC).toMatch(/<ContactIntelligenceCard lead=\{lead\} defaultExpanded/)
  })
})

describe('Test 15/16 — no relationship/decision-maker inference introduced by this capability', () => {
  it('LeadEssentialsBar never writes to seller_intelligence or decision_makers', () => {
    expect(SRC).not.toMatch(/decision_makers|seller_intelligence/)
  })
  it('LeadEssentialsBar never renders the literal word "spouse"', () => {
    expect(SRC.toLowerCase()).not.toMatch(/spouse/)
  })
})

describe('Test 17 — old leads without a rich contact_profile still render safely', () => {
  it('ContactIntelligenceCard.jsx itself already returns null gracefully when no profile exists (regression, unchanged)', () => {
    const card = fs.readFileSync('src/components/lead-detail/ContactIntelligenceCard.jsx', 'utf8')
    expect(card).toMatch(/if \(!profile\) return null/)
  })
  it('LeadEssentialsBar falls back to lead.phone/lead.email display when no rich profile exists', () => {
    expect(SRC).toMatch(/lead\.phone \|\| \(primaryPhone/)
  })
})

describe('Terminology consistency (Part 11)', () => {
  it('uses the short canonical labels ARV/Rehab/Rent, consistently, and a market-aware Ask/Evaluation label (UX V2.5, Part 11)', () => {
    for (const label of ['ARV', 'Rehab', 'Rent']) {
      expect(SRC).toContain(`label="${label}"`)
    }
    // "Ask" implies a real MLS listing price; for an off-market/distressed
    // lead the same lead.asking_price column is an internal evaluation
    // price (see acquisitionDecisionPresentation.js's provenance note) —
    // the label now switches via the same canonical resolveMarketType
    // used everywhere else on the page.
    expect(SRC).toMatch(/const askLabel = isOffMarket \? 'Evaluation' : 'Ask'/)
    expect(SRC).toMatch(/label=\{askLabel\}/)
  })
  it('Max Buy label is now strategy-specific ("BRRRR Max Buy"/"Flip Max Buy") — Lead Workspace UX V2.1, Part 11: never a bare "Max Buy" when two strategies can have different values', () => {
    // UX V2.5, Part 2 — uses effectiveStrategy (resolveEffectiveStrategy's
    // output), not the raw strategyRec.preferredStrategy string, so a
    // genuine "BOTH WORK — BRRRR PREFERRED" tie is labeled correctly too.
    expect(SRC).toMatch(/effectiveStrategy === 'BRRRR' \? 'BRRRR Max Buy' : 'Flip Max Buy'/)
    expect(SRC).not.toMatch(/label="Max Buy"/)
  })
})

describe('Data safety — Part 12, no protected file touched', () => {
  it('LeadEssentialsBar.jsx never imports/reimplements buy-box, distress, or scoring logic', () => {
    expect(SRC).not.toMatch(/buyBox|distressScoring|classifyPersonMatch|batchDataPreflight/)
  })
})
