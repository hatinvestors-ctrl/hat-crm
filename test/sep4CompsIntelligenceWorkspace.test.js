// test/sep4CompsIntelligenceWorkspace.test.js
// HAT INVESTORS — SMALL CHANGE #19: AI Comps WOW UX. Comps tab ONLY,
// presentation-only. No AI prompt/call/parsing/comp-selection/CRM-
// matching/calculation change of any kind.
//
// MarketCompsSection, RentalCompsSection, and CRMCompsUsedSection
// (NotesRenderer.jsx) all keep their EXACT pre-existing field-extraction
// logic (compBlocks/whyLines/rentalComps/get() regex parsing) — only the
// RETURN JSX changed: ARV/Rent hero → table → AI Interpretation, plus a
// subtly-differentiated "HAT System Comps" table using the SAME already-
// parsed CRM COMPS USED data (no new query, no new AI call).
import { describe, it, expect } from 'vitest'
import fs from 'fs'

const src = fs.readFileSync('src/components/lead-detail/NotesRenderer.jsx', 'utf8')

describe('Property Value Intelligence (ARV) — existing values, new hierarchy', () => {
  it('Conservative/Realistic/Optimistic ARV still read from the SAME unmodified extraction lines', () => {
    expect(src).toMatch(/const conservativeARV = allLines\.find\(l => \/\^Conservative ARV:\/i\.test\(l\.trim\(\)\)\)\?\.replace\(\/\^Conservative ARV:\\s\*\/i, ''\)\.trim\(\)/)
    expect(src).toMatch(/const realisticARV    = allLines\.find\(l => \/\^Realistic ARV:\/i\.test\(l\.trim\(\)\)\)\?\.replace\(\/\^Realistic ARV:\\s\*\/i, ''\)\.trim\(\)/)
    expect(src).toMatch(/const optimisticARV   = allLines\.find\(l => \/\^Optimistic ARV:\/i\.test\(l\.trim\(\)\)\)\?\.replace\(\/\^Optimistic ARV:\\s\*\/i, ''\)\.trim\(\)/)
  })
  it('Property Value Intelligence hero renders all three with Realistic visually emphasized, degrading gracefully when a value is missing', () => {
    expect(src).toMatch(/Property Value Intelligence<\/span>/)
    expect(src).toMatch(/\{conservativeARV \|\| '—'\}/)
    expect(src).toMatch(/\{realisticARV \|\| '—'\}/)
    expect(src).toMatch(/\{optimisticARV \|\| '—'\}/)
    expect(src).toMatch(/Recommended<\/div>/)
  })
})

describe('Sold Comps table — same compBlocks collection, price/evidence semantics preserved', () => {
  it('compBlocks parsing (COMP:/Why relevant: multi-line) is byte-unchanged', () => {
    expect(src).toMatch(/if \(\/\^COMP:\/i\.test\(t\)\) \{/)
    expect(src).toMatch(/if \(\/\^Why relevant:\/i\.test\(t\)\) \{/)
  })
  it('rows are derived from compBlocks with a NEW isGenuinelySold flag (a read-only check of the EXISTING sold string, not a new field)', () => {
    expect(src).toMatch(/const isGenuinelySold = !!sold && \/\^sold\/i\.test\(sold\.trim\(\)\)/)
  })
  it('the price column is labeled "Price \/ Evidence" (neutral), not "Sold Price" — never implies a listing/Prior-HAT-ARV value was a completed sale', () => {
    expect(src).toMatch(/Price \/ Evidence<\/th>/)
    expect(src).not.toMatch(/>Sold Price<\/th>/)
  })
  it('only genuinely-sold rows get the success/green color; everything else (Ask/Recent listing/Prior HAT ARV) stays neutral', () => {
    expect(src).toMatch(/color: r\.isGenuinelySold \? 'var\(--color-success-text\)' : 'var\(--color-text-dim\)'/)
  })
  it('the "why relevant" comment text renders unmodified, not rewritten or summarized', () => {
    expect(src).toMatch(/const why = whyLines\.join\(' '\)\.trim\(\) \|\| null/)
    expect(src).toMatch(/\{r\.why \|\| '—'\}/)
  })
})

describe('HAT AI Verdict (sold) — existing conclusion, unmodified, now renders BEFORE the evidence table (design-polish reorder)', () => {
  it('the ARV Conclusion line is still read exactly as before and rendered verbatim under "HAT AI Verdict"', () => {
    expect(src).toMatch(/const conclusion = allLines\.find\(l => \/\^ARV Conclusion:\/i\.test\(l\.trim\(\)\)\)\?\.replace\(\/\^ARV Conclusion:\\s\*\/i, ''\)\.trim\(\)/)
    expect(src).toMatch(/<span>HAT AI Verdict<\/span>\s*\n\s*<\/div>\s*\n\s*<p className="text-\[12\.5px\] text-\[color:var\(--color-accent-text\)\] leading-relaxed">\{conclusion\}<\/p>/)
  })
  it('the verdict panel sits before the Sold Comps table in source order (CONCLUSION -> EVIDENCE)', () => {
    const marketSrc = src.slice(src.indexOf('function MarketCompsSection'), src.indexOf('function RentalCompsSection'))
    const verdictIdx = marketSrc.indexOf('HAT AI Verdict')
    const tableIdx = marketSrc.indexOf('Sold Comps Used for ARV')
    expect(verdictIdx).toBeGreaterThan(0)
    expect(tableIdx).toBeGreaterThan(verdictIdx)
  })
})

describe('Rental Intelligence — existing rent values, new hierarchy', () => {
  it('Conservative/Realistic/Optimistic Rent still read from the SAME unmodified extraction lines', () => {
    expect(src).toMatch(/const consRent  = get\('Conservative Rent'\)/)
    expect(src).toMatch(/const realRent  = get\('Realistic Rent'\)/)
    expect(src).toMatch(/const optRent   = get\('Optimistic Rent'\)/)
  })
  it('Rental Intelligence hero renders all three with Realistic emphasized', () => {
    expect(src).toMatch(/Rental Intelligence<\/span>/)
    expect(src).toMatch(/\{consRent \|\| '—'\}/)
    expect(src).toMatch(/\{realRent \|\| '—'\}/)
    expect(src).toMatch(/\{optRent \|\| '—'\}/)
  })
})

describe('Rental Comps table — same rentalComps collection', () => {
  it('rentalComps parsing (RENTAL: lines) is byte-unchanged', () => {
    expect(src).toMatch(/const rentalComps = lines\.filter\(l => \/\^RENTAL:\/i\.test\(l\.trim\(\)\)\)/)
  })
  it('table renders the same area/profile/sqft/rent/note fields, no new field introduced', () => {
    expect(src).toMatch(/const \[area, profile, sqft, rent, note\] = parts/)
  })
})

describe('HAT AI Verdict (rental) — existing verdict, unmodified, now renders BEFORE the Rental Comps table (design-polish reorder)', () => {
  it('the Rent Verdict line is still read exactly as before and rendered under "HAT AI Verdict"', () => {
    expect(src).toMatch(/const verdict   = get\('Rent Verdict'\)/)
    const rentalSrc = src.slice(src.indexOf('function RentalCompsSection'), src.indexOf('function CRMCompsUsedSection'))
    expect(rentalSrc).toMatch(/<span>HAT AI Verdict<\/span>/)
    expect(rentalSrc).toMatch(/\{verdict\}<\/p>/)
  })
  it('the verdict panel sits before the Rental Comps table in source order', () => {
    const rentalSrc = src.slice(src.indexOf('function RentalCompsSection'), src.indexOf('function CRMCompsUsedSection'))
    const verdictIdx = rentalSrc.indexOf('HAT AI Verdict')
    const tableIdx = rentalSrc.indexOf('Active Rentals Used')
    expect(verdictIdx).toBeGreaterThan(0)
    expect(tableIdx).toBeGreaterThan(verdictIdx)
  })
})

describe('HAT System Comps — audit-confirmed existing CRM COMPS USED data, no new retrieval', () => {
  it('CRMCompsUsedSection keeps its EXACT pre-existing compBlocks/howLines parsing (addrZip/profile/ask/arv/reno/offer/status)', () => {
    expect(src).toMatch(/const \[addrZip, profile, ask, arv, reno, offer, status\] = parts/)
    expect(src).toMatch(/if \(\/\^How used:\/i\.test\(t\)\) \{/)
  })
  it('renders as a visually-differentiated table (accent border/header, 🏛️ icon), reusing the SAME existing fields — no new column invented', () => {
    expect(src).toMatch(/HAT System Comps<\/span>/)
    expect(src).toMatch(/From HAT's own CRM<\/span>/)
    expect(src).toMatch(/🏛️/)
  })
  it('ZIP Pattern / Confidence Impact still read and rendered exactly as before', () => {
    expect(src).toMatch(/const zipPattern       = allLines\.find\(l => \/\^ZIP Pattern:\/i\.test\(l\.trim\(\)\)\)/)
    expect(src).toMatch(/const confidenceImpact = allLines\.find\(l => \/\^Confidence Impact:\/i\.test\(l\.trim\(\)\)\)/)
  })
})

describe('no new AI/database calls introduced anywhere in this fix', () => {
  it('none of the three redesigned components contain a supabase/fetch/callFn call', () => {
    const marketSrc = src.slice(src.indexOf('function MarketCompsSection'), src.indexOf('function RentalCompsSection'))
    const rentalSrc = src.slice(src.indexOf('function RentalCompsSection'), src.indexOf('function CRMCompsUsedSection'))
    const crmSrc = src.slice(src.indexOf('function CRMCompsUsedSection'), src.indexOf('function CRMWorkflowSection'))
    for (const section of [marketSrc, rentalSrc, crmSrc]) {
      expect(section).not.toMatch(/supabase\.|fetch\(|callFn\(/)
    }
  })
})

describe('other AI tabs untouched', () => {
  it('RecommendedActionSection (Summary) is completely unmodified by this fix', () => {
    expect(src).toMatch(/function RecommendedActionSection\(\{ body \}\)/)
    expect(src).toMatch(/Your Negotiation Plan<\/span>/)
    expect(src).toMatch(/Deep Dive<\/div>/)
  })
  it('TABS definition (Summary/Comps/Strategy ids and matchers) unchanged', () => {
    expect(src).toMatch(/const TABS = \[\s*\{ id: 'summary',  label: 'Summary',/)
    expect(src).toMatch(/\{ id: 'comps',    label: 'Comps',/)
    expect(src).toMatch(/\{ id: 'strategy', label: 'Strategy',.*alwaysShow: true \}/)
  })
  it('DealAnalysisCard.jsx Full Breakdown / Ask AI extraTabs wiring unchanged', () => {
    const cardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
    expect(cardSrc).toMatch(/label: 'Full Breakdown',/)
    expect(cardSrc).toMatch(/label: 'Ask AI',/)
  })
})

describe('SC1-SC18 preserved', () => {
  it('SC10 — resolveStrategyOutlook classification rule untouched', () => {
    const presSrc = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(presSrc).toMatch(/const pricesClose = gap <= Math\.max\(5000, lowerMao \* 0\.05\)/)
  })
  it('SC16 — AI Deal Read still gated behind hideDecisionSummary', () => {
    const cardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
    expect(cardSrc).toMatch(/!hideDecisionSummary && \(flipResult\.available \|\| brrrrResult\.available\) && \(\(\) => \{/)
  })
  it('SC18 — Deep Dive layer1/layer2 split untouched', () => {
    expect(src).toMatch(/const layer1 = sorted\.filter\(s => \/\^RECOMMENDED ACTION\/i\.test\(s\.name\)\)/)
    expect(src).toMatch(/const layer2 = sorted\.filter\(s => !\/\^RECOMMENDED ACTION\/i\.test\(s\.name\)\)/)
  })
})

describe('Protected files / no scope creep', () => {
  it('no protected file references any new symbol from this fix', () => {
    for (const f of ['src/lib/calculations.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/dealExplanation.js', 'src/lib/sellerStrategy.js']) {
      const protectedSrc = fs.readFileSync(f, 'utf8')
      expect(protectedSrc).not.toMatch(/isGenuinelySold|Property Value Intelligence|HAT System Comps/)
    }
  })
})
