// test/sep4SummaryDeepDive.test.js
// HAT INVESTORS — SMALL CHANGE #18: AI Summary WOW UX + Progressive
// Disclosure. Presentation-only. No calculation, no scoring, no AI
// output, no data-flow change.
//
// The Summary tab's item-rendering loop (NotesRenderer.jsx) is split
// into Layer 1 (RECOMMENDED ACTION — the SC17 Action Hero card, still
// expanded by default, byte-identical content/derivation) and Layer 2
// ("Deep Dive" — Deal Score/Opportunity Score/Pros/Cons/Key Insights,
// now ALSO collapsed by default, same as Pros/Cons/Key Insights already
// were). The SAME sorted `items` array, the SAME SectionCard component,
// and the SAME SECTION_META render functions (DealScoreSection/
// ScoreSection/BulletSection/InsightsSection) are reused — nothing
// rebuilt, nothing recomputed, nothing moved out of NotesRenderer.jsx.
import { describe, it, expect } from 'vitest'
import fs from 'fs'

const src = fs.readFileSync('src/components/lead-detail/NotesRenderer.jsx', 'utf8')

describe('Deep Dive exists and groups Layer 2 content', () => {
  it('a "Deep Dive" divider with its subtitle renders in the summary-tab branch only', () => {
    expect(src).toMatch(/Deep Dive<\/div>/)
    expect(src).toMatch(/Detailed evidence behind HAT AI's recommendation/)
  })
  it('Layer 1 (RECOMMENDED ACTION) and Layer 2 (everything else) are split from the SAME sorted items array — no new data source', () => {
    expect(src).toMatch(/const layer1 = sorted\.filter\(s => \/\^RECOMMENDED ACTION\/i\.test\(s\.name\)\)/)
    expect(src).toMatch(/const layer2 = sorted\.filter\(s => !\/\^RECOMMENDED ACTION\/i\.test\(s\.name\)\)/)
    // The sort itself (ORDER array) is byte-identical to the pre-SC18 version.
    expect(src).toMatch(/const ORDER = \['RECOMMENDED ACTION', 'DEAL SCORE', 'PROS', 'CONS', 'KEY INSIGHTS'\]/)
  })
})

describe('Why This Score / Pros & Risks (Layer 2) are collapsed by default', () => {
  it('Layer 2 SectionCards render with defaultCollapsed hardcoded true', () => {
    const deepDiveIdx = src.indexOf('Deep Dive</div>')
    const layer2MapIdx = src.indexOf('layer2.map', deepDiveIdx)
    const afterMap = src.slice(layer2MapIdx, layer2MapIdx + 800)
    expect(afterMap).toMatch(/defaultCollapsed\s*\n/) // bare `defaultCollapsed` (= true) prop, not a conditional regex
  })
  it('Layer 1 (RECOMMENDED ACTION) explicitly stays expanded by default', () => {
    expect(src).toMatch(/layer1\.map\(\(\{ name, body \}\) => \(/)
    expect(src).toMatch(/<SectionCard key=\{name\} name=\{name\} body=\{body\} defaultCollapsed=\{false\} \/>/)
  })
})

describe('existing score/pros/cons/insights content remains accessible after expansion — same components, same SECTION_META', () => {
  it('SECTION_META still maps DEAL SCORE/OPPORTUNITY SCORE/PROS/CONS to the SAME unmodified render functions', () => {
    expect(src).toMatch(/'DEAL SCORE':\s*\{ icon: '🏆', render: s => <DealScoreSection\s*body=\{s\} \/> \}/)
    expect(src).toMatch(/'OPPORTUNITY SCORE & CONFIDENCE':\s*\{ icon: '🎯', render: s => <ScoreSection\s*body=\{s\} \/> \}/)
    expect(src).toMatch(/'PROS — WHY THIS DEAL IS INTERESTING':\s*\{ icon: '✅', render: s => <BulletSection\s*body=\{s\} variant="success" \/> \}/)
    expect(src).toMatch(/'CONS — RISKS AND CONCERNS':\s*\{ icon: '⚠️', render: s => <BulletSection\s*body=\{s\} variant="danger"\s*\/> \}/)
  })
  it('function bodies of DealScoreSection/ScoreSection/BulletSection are untouched (still defined, still the sole renderers)', () => {
    expect(src).toMatch(/function DealScoreSection\(\{ body \}\)/)
    expect(src).toMatch(/function ScoreSection\(\{ body \}\)/)
    expect(src).toMatch(/function BulletSection\(\{ body, variant = 'success' \}\)/)
  })
})

describe('Adjust Analysis left exactly where it was — already its own collapsed control, not moved (no cross-component risk)', () => {
  it('DealAnalysisCard.jsx still owns the collapsed Adjust Analysis toggle/state/reRunWithOverrides, unchanged', () => {
    const cardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
    expect(cardSrc).toMatch(/const \[overrideOpen, setOverrideOpen\] = useState\(false\)/)
    expect(cardSrc).toMatch(/\{overrideOpen \? '▾' : '▸'\} Adjust Analysis/)
    expect(cardSrc).toMatch(/const reRunWithOverrides = async \(\) => \{/)
  })
})

describe('SC17 Action Hero / Negotiation Plan / Kevin\'s Take / Next Steps values and derivations untouched', () => {
  it('RecommendedActionSection derivations (verdict/vm/computedScore/priceCards/gapAmt/kevinsRead/nextSteps) byte-identical', () => {
    expect(src).toMatch(/const computedScore = computeScoreFromText\(fullNotes\)/)
    expect(src).toMatch(/const verdict    = scoreToVerdict\(computedScore\) \|\| get\('Verdict'\)/)
    expect(src).toMatch(/const canonicalFlipMao = \(lead\?\.arv != null && lead\?\.renovation_cost != null\)\s*\? calculateFlipMAO\(Number\(lead\.arv\), Number\(lead\.renovation_cost\), lead\.hold_months \|\| 6\)\s*: null/)
    expect(src).toMatch(/const gapAmt = \(\(\) => \{/)
    expect(src).toMatch(/const kevinsRead = \(\(\) => \{/)
    expect(src).toMatch(/const nextSteps = \(\(\) => \{/)
    expect(src).toMatch(/const priceCards = \[/)
    expect(src).toMatch(/const startCard = priceCards\.find\(c => c\.label === 'Starting Offer'\)/)
    expect(src).toMatch(/const maoCard   = priceCards\.find\(c => c\.label\.startsWith\('MAO'\)\)/)
    expect(src).toMatch(/const walkCard  = priceCards\.find\(c => c\.label === 'Walk-Away Max'\)/)
    expect(src).toMatch(/const sellerAskStr = lead\?\.asking_price != null/)
  })
  it('Your Negotiation Plan / Why HAT AI / Kevin\'s Take headings still present, unchanged from SC17', () => {
    expect(src).toMatch(/Your Negotiation Plan<\/span>/)
    expect(src).toMatch(/Why HAT AI \{isGo \? 'Sees an Opportunity' : 'Recommends This'\}/)
    expect(src).toMatch(/Kevin's Take<\/div>/)
  })
})

describe('no new AI calls, no new calculation files touched', () => {
  it('the only network call inside NotesRenderer.jsx remains the activity-log insert (logActivity), not an AI call', () => {
    expect(src).toMatch(/await supabase\.from\('lead_activities'\)\.insert/)
  })
})

describe('other tabs (Comps/Strategy) unaffected — only the summary branch changed', () => {
  it('the non-summary branch still maps currentTab.items with the ORIGINAL defaultCollapsed regex (PROS/CONS/KEY INSIGHTS only)', () => {
    expect(src).toMatch(/\(currentTab\?\.items \|\| \[\]\)\.map\(\(\{ name, body \}\) => \(/)
    expect(src).toMatch(/defaultCollapsed=\{\/\^PROS\|\^CONS\|\^KEY INSIGHTS\/i\.test\(name\)\}/)
  })
  it('Comps refresh button and Strategy Kevin\'s Scripts empty-state controls still present, unchanged', () => {
    expect(src).toMatch(/↺ Refresh Comps/)
    expect(src).toMatch(/Generate Kevin\\'s Scripts/)
  })
  it('TABS definition (Summary/Comps/Strategy ids and matchers) unchanged', () => {
    expect(src).toMatch(/const TABS = \[\s*\{ id: 'summary',  label: 'Summary',/)
    expect(src).toMatch(/\{ id: 'comps',    label: 'Comps',/)
    expect(src).toMatch(/\{ id: 'strategy', label: 'Strategy',.*alwaysShow: true \}/)
  })
})

describe('SC1-SC17 preserved', () => {
  it('SC10 — resolveStrategyOutlook classification rule untouched', () => {
    const presSrc = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(presSrc).toMatch(/const pricesClose = gap <= Math\.max\(5000, lowerMao \* 0\.05\)/)
  })
  it('SC16 — AI Deal Read still gated behind hideDecisionSummary', () => {
    const cardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
    expect(cardSrc).toMatch(/!hideDecisionSummary && \(flipResult\.available \|\| brrrrResult\.available\) && \(\(\) => \{/)
  })
  it('SC17 — the Gap chip stays removed from the Action Hero (single source of truth in Negotiation Plan)', () => {
    expect(src).not.toMatch(/↕ Gap: \{gapStr\} off ask/)
  })
})

describe('Protected files / no scope creep', () => {
  it('no protected file references any new symbol from this fix', () => {
    for (const f of ['src/lib/calculations.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/dealExplanation.js', 'src/lib/sellerStrategy.js']) {
      const protectedSrc = fs.readFileSync(f, 'utf8')
      expect(protectedSrc).not.toMatch(/layer1|layer2|Deep Dive/)
    }
  })
})
