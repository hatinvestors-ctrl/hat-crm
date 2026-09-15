// test/sep4SummaryAcquisitionCopilot.test.js
// HAT INVESTORS — SMALL CHANGE #17: AI Summary "WOW" UX. Summary tab
// ONLY, presentation/information-architecture only.
//
// RecommendedActionSection (src/components/lead-detail/NotesRenderer.jsx)
// is the Summary tab's primary content (the "RECOMMENDED ACTION" AI
// section, always shown first per TABS' sort order). This mission
// reorganizes its RETURN JSX into ACTION HERO -> YOUR NEGOTIATION PLAN ->
// DEAL CONTEXT -> (Max Reno Budget / Agent Brief, unchanged) -> WHY HAT
// AI -> KEVIN'S TAKE -> Next Steps -> Optional Add-ons. Every derivation
// above the return (verdict, vm, computedScore, priceCards, gapAmt,
// sellerOdds, dealMathLabel, kevinsRead, nextSteps, canonicalFlipMao via
// calculateFlipMAO — dealExplanation.js/calculations.js UNCHANGED) is
// byte-identical; only WHERE each already-computed value renders moved.
import { describe, it, expect } from 'vitest'
import fs from 'fs'

const src = fs.readFileSync('src/components/lead-detail/NotesRenderer.jsx', 'utf8')

describe('New Summary hierarchy renders (Action Hero / Negotiation Plan / Deal Context / Why HAT AI / Kevin\'s Take)', () => {
  it('ACTION HERO section present, verdict icon/label/score/what unchanged (SAME vm object, computedScore, vm.what)', () => {
    expect(src).toMatch(/── ACTION HERO ──/)
    expect(src).toMatch(/Recommended Action<\/div>/)
    expect(src).toMatch(/\{vm\.icon\}/)
    expect(src).toMatch(/\{vm\.label\}/)
    expect(src).toMatch(/\{computedScore\}\/100/)
    expect(src).toMatch(/\{vm\.what\}/)
  })
  it('YOUR NEGOTIATION PLAN section present, reusing the SAME startCard/maoCard/walkCard/gapStr — no new calculation', () => {
    expect(src).toMatch(/Your Negotiation Plan<\/span>/)
    expect(src).toMatch(/const startCard = priceCards\.find\(c => c\.label === 'Starting Offer'\)/)
    expect(src).toMatch(/const maoCard   = priceCards\.find\(c => c\.label\.startsWith\('MAO'\)\)/)
    expect(src).toMatch(/const walkCard  = priceCards\.find\(c => c\.label === 'Walk-Away Max'\)/)
    expect(src).toMatch(/\{startCard\.value\}/)
    expect(src).toMatch(/\{maoCard\.value\}/)
    expect(src).toMatch(/\{walkCard\.value\}/)
    expect(src).toMatch(/Gap to Close<\/span>/)
    expect(src).toMatch(/\{gapStr\}/)
  })
  it('Seller Ask is a NEW display of the SAME existing lead.asking_price field, not a new field/calculation', () => {
    expect(src).toMatch(/const sellerAskStr = lead\?\.asking_price != null \? `\$\$\{Math\.round\(Number\(lead\.asking_price\)\)\.toLocaleString\(\)\}` : null/)
    expect(src).toMatch(/Seller Ask<\/span>/)
  })
  it('MAO and Walk-Away Max are kept as two distinct, distinctly-labeled values — never merged into one "ceiling"', () => {
    // Both rows must exist independently in the negotiation-plan markup.
    const planIdx = src.indexOf('Your Negotiation Plan')
    const nextSectionIdx = src.indexOf('DEAL CONTEXT', planIdx)
    const planBlock = src.slice(planIdx, nextSectionIdx)
    expect(planBlock).toMatch(/\{maoCard\.label\}/) // dynamic label ("MAO" or "MAO (zero-reno ceiling)") preserved verbatim
    expect(planBlock).toMatch(/Walk-Away Max<\/div>/)
  })
  it('DEAL CONTEXT (ARV) present, reusing the SAME arvCard.value — no recomputation', () => {
    expect(src).toMatch(/── DEAL CONTEXT ──/)
    expect(src).toMatch(/const arvCard   = priceCards\.find\(c => c\.label\.startsWith\('ARV'\)\)/)
    expect(src).toMatch(/Deal Context<\/span> — \{arvCard\.label\}: \{arvCard\.value\}/)
  })
  it('WHY HAT AI section reuses the SAME strategy/dealMathLabel/sellerOdds chips and vm.action text — no new reasoning generated', () => {
    expect(src).toMatch(/Why HAT AI \{isGo \? 'Sees an Opportunity' : 'Recommends This'\}/)
    expect(src).toMatch(/\{strategy\}<\/span>/)
    expect(src).toMatch(/\{dealMathLabel\}<\/span>/)
    expect(src).toMatch(/\{sellerOdds\.dot\} Seller: \{sellerOdds\.label\}/)
    expect(src).toMatch(/\{vm\.action\}/)
  })
  it('KEVIN\'S TAKE preserved exactly — same kevinsRead derivation, same reno-estimated warning, only heading capitalization changed', () => {
    expect(src).toMatch(/Kevin's Take<\/div>/)
    expect(src).toMatch(/\{kevinsRead\}/)
    expect(src).toMatch(/Reno cost was estimated, not confirmed/)
  })
})

describe('no chip/value shown twice (redundancy removed, not data)', () => {
  it('the Gap chip no longer renders inside the Action Hero (moved to Negotiation Plan, single source of truth)', () => {
    expect(src).not.toMatch(/↕ Gap: \{gapStr\} off ask/)
  })
})

describe('no logic/calculation/derivation changed — every existing variable computation is byte-identical', () => {
  it('verdict/vm/computedScore/priceCards/gapAmt/kevinsRead/nextSteps derivations untouched', () => {
    expect(src).toMatch(/const computedScore = computeScoreFromText\(fullNotes\)/)
    expect(src).toMatch(/const verdict    = scoreToVerdict\(computedScore\) \|\| get\('Verdict'\)/)
    expect(src).toMatch(/const canonicalFlipMao = \(lead\?\.arv != null && lead\?\.renovation_cost != null\)\s*\? calculateFlipMAO\(Number\(lead\.arv\), Number\(lead\.renovation_cost\), lead\.hold_months \|\| 6\)\s*: null/)
    expect(src).toMatch(/const gapAmt = \(\(\) => \{/)
    expect(src).toMatch(/const kevinsRead = \(\(\) => \{/)
    expect(src).toMatch(/const nextSteps = \(\(\) => \{/)
    expect(src).toMatch(/const priceCards = \[/)
  })
  it('no new AI/API call introduced — logActivity is the only network call, unchanged (writes an activity comment, not an AI request)', () => {
    const fnMatches = src.match(/const logActivity = async \(key, text\) => \{[\s\S]{0,200}\}/g) || []
    expect(fnMatches.length).toBeGreaterThanOrEqual(1)
    expect(src).toMatch(/await supabase\.from\('lead_activities'\)\.insert/)
  })
})

describe('other tabs and top toolbar untouched', () => {
  it('TABS definition (Summary/Comps/Strategy) unchanged', () => {
    expect(src).toMatch(/const TABS = \[\s*\{ id: 'summary',  label: 'Summary',/)
    expect(src).toMatch(/\{ id: 'comps',    label: 'Comps',/)
    expect(src).toMatch(/\{ id: 'strategy', label: 'Strategy',.*alwaysShow: true \}/)
  })
  it('Full Breakdown / Ask AI extraTabs wiring in DealAnalysisCard.jsx unchanged', () => {
    const cardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
    expect(cardSrc).toMatch(/label: 'Full Breakdown',/)
    expect(cardSrc).toMatch(/label: 'Ask AI',/)
  })
  it('FLIP/BRRRR selector, Refresh, Update Negotiation Plan controls untouched (DealAnalysisCard.jsx)', () => {
    const cardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
    expect(cardSrc).toMatch(/Update Negotiation Plan/)
    expect(cardSrc).toMatch(/Refresh/)
  })
})

describe('SC1-SC16 preserved', () => {
  it('SC10 — resolveStrategyOutlook classification rule untouched', () => {
    const presSrc = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(presSrc).toMatch(/const pricesClose = gap <= Math\.max\(5000, lowerMao \* 0\.05\)/)
  })
  it('SC16 — AI Deal Read still gated behind hideDecisionSummary', () => {
    const cardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
    expect(cardSrc).toMatch(/!hideDecisionSummary && \(flipResult\.available \|\| brrrrResult\.available\) && \(\(\) => \{/)
  })
})

describe('Protected files / no scope creep', () => {
  it('no protected file references any new symbol from this fix', () => {
    for (const f of ['src/lib/calculations.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/dealExplanation.js', 'src/lib/sellerStrategy.js']) {
      const protectedSrc = fs.readFileSync(f, 'utf8')
      expect(protectedSrc).not.toMatch(/sellerAskStr|arvCard|maoCard|startCard|walkCard/)
    }
  })
})
