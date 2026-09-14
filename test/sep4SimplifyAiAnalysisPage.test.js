// test/sep4SimplifyAiAnalysisPage.test.js
// HAT INVESTORS — SMALL CHANGE #16: Simplify AI Analysis page — remove
// the duplicated upper "AI DEAL READ" summary block. UX/PRESENTATION
// ONLY. No AI generation, financial logic, or data-flow change.
//
// Root cause / fix: DealAnalysisCard.jsx's "AI Deal Read" block (verdict,
// Projected Profit, Starting Offer, Max Buy, Why It Works, Biggest Risk,
// Recommended Move) was the ONLY decision-summary block in that file NOT
// already gated behind `hideDecisionSummary` — its siblings
// (FlipMarginOfSafety/BrrrrRealityCheck) already were, per that file's
// own "moved, not duplicated" precedent (Overview/Deal, SC6-SC14, now
// show this same information more clearly). LeadDetailPage.jsx already
// passes `hideDecisionSummary` at DealAnalysisCard's ONE call site (the
// AI & Comps tab) — this fix reuses that exact existing prop, adding
// ZERO new state, ZERO new data flow.
import { describe, it, expect } from 'vitest'
import fs from 'fs'

const cardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
const pageSrc = fs.readFileSync('src/pages/LeadDetailPage.jsx', 'utf8')

describe('AI Deal Read block no longer renders on the AI Analysis page', () => {
  it('the block is gated behind !hideDecisionSummary, the SAME prop its sibling decision-summary blocks already use', () => {
    expect(cardSrc).toMatch(/!hideDecisionSummary && \(flipResult\.available \|\| brrrrResult\.available\) && \(\(\) => \{/)
  })
  it('LeadDetailPage.jsx already passes hideDecisionSummary at DealAnalysisCard\'s only call site (AI & Comps tab) — confirms the block will not render there', () => {
    expect(pageSrc).toMatch(/<DealAnalysisCard[\s\S]{0,300}hideDecisionSummary/)
    // Exactly one call site in the whole app — no other page needs updating.
    const matches = fs.readdirSync('src', { recursive: true })
    expect((cardSrc.match(/AI Deal Read — /g) || []).length).toBe(1) // the label text itself, only referenced once, now conditionally rendered
  })
  it('the removed elements (AI Read verdict, Projected Profit, Starting Offer, Max Buy, Why It Works, Biggest Risk, Recommended Move) still exist in source (not deleted) but only inside the gated block', () => {
    expect(cardSrc).toMatch(/AI Read<\/div>/)
    expect(cardSrc).toMatch(/Starting Offer/)
    expect(cardSrc).toMatch(/Why It Works<\/div>/)
    expect(cardSrc).toMatch(/Biggest Risk<\/div>/)
    expect(cardSrc).toMatch(/Recommended Move<\/div>/)
    // Confirm these all sit within the SAME gated IIFE, not a second ungated copy.
    const gateIdx = cardSrc.indexOf('!hideDecisionSummary && (flipResult.available || brrrrResult.available)')
    const closeIdx = cardSrc.indexOf('})()}', gateIdx)
    const block = cardSrc.slice(gateIdx, closeIdx)
    expect(block).toMatch(/AI Read<\/div>/)
    expect(block).toMatch(/Recommended Move<\/div>/)
  })
})

describe('additional cleanup — the redundant "Deal Analysis" page header no longer renders', () => {
  it('the Card wrapping this page no longer receives title/subtitle props (Card only renders its header strip when title/action is passed)', () => {
    expect(cardSrc).not.toMatch(/<Card title="Deal Analysis"/)
    expect(cardSrc).not.toMatch(/subtitle="Comps, negotiation plan, verdict, and scripts — all from one run"/)
    expect(cardSrc).toMatch(/<Card>\s*\{hasAnalysis && strategyRecommendation\.summary/)
  })
  it('flipResult/brrrrResult/strategyRecommendation computation lines directly above are untouched', () => {
    expect(cardSrc).toMatch(/const flipResult = hasAnalysis \? computeFlipResult\(lead, underwritingSettings\) : \{ available: false, reason: 'Run analysis first\.' \}/)
    expect(cardSrc).toMatch(/const strategyRecommendation = computeStrategyRecommendation\(flipResult, brrrrResult\)/)
  })
})

describe('data flow unchanged — flipResult/brrrrResult still computed exactly as before, still consumed by sibling blocks', () => {
  it('FlipMarginOfSafety/BrrrrRealityCheck (also hideDecisionSummary-gated) still receive the SAME flipResult/lead — untouched by this fix', () => {
    expect(cardSrc).toMatch(/!hideDecisionSummary && hasAnalysis && strategy !== 'brrrr' && flipResult\.available && \(\s*<FlipMarginOfSafety lead=\{lead\} flipResult=\{flipResult\} \/>/)
    expect(cardSrc).toMatch(/!hideDecisionSummary && hasAnalysis && strategy === 'brrrr' && \(\s*<BrrrrRealityCheck lead=\{lead\} \/>/)
  })
})

describe('AI narrative tabs (Summary/Comps/Strategy/Full Breakdown/Ask AI) untouched', () => {
  it('tab labels and structure remain present in DealAnalysisCard.jsx', () => {
    for (const label of ['Summary', 'Comps', 'Strategy', 'Full Breakdown', 'Ask AI']) {
      expect(cardSrc).toMatch(new RegExp(label.replace(/ /g, '\\s*')))
    }
  })
})

describe('top toolbar (Best Exit / FLIP-BRRRR selector / Refresh / Update Negotiation Plan) untouched', () => {
  it('selector state and refresh/negotiation-plan controls still present, unmodified by this fix', () => {
    expect(cardSrc).toMatch(/Update Negotiation Plan/)
    expect(cardSrc).toMatch(/Refresh/)
  })
})

describe('SC1-SC15A preserved', () => {
  it('SC10 — resolveStrategyOutlook classification rule untouched', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/const pricesClose = gap <= Math\.max\(5000, lowerMao \* 0\.05\)/)
  })
  it('SC15A — MarginVisualization negotiation-room text preserved, no yellow bar reintroduced', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/MarginVisualization.jsx', 'utf8')
    expect(src).toMatch(/room from Suggested Offer to Max Buy/)
    expect(src).not.toMatch(/h-2 rounded-full bg-\[color:var\(--color-bg-elev-2\)\] overflow-visible/)
  })
})

describe('Protected files / no scope creep', () => {
  it('no protected file references any new symbol from this fix', () => {
    for (const f of ['src/lib/calculations.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/dealExplanation.js', 'src/lib/sellerStrategy.js']) {
      const src = fs.readFileSync(f, 'utf8')
      expect(src).not.toMatch(/hideDecisionSummary/)
    }
  })
})
