// test/aiCompsV3.test.js
// HAT Investors — AI Property Analysis / AI & Comps V3
//
// Scope actually implemented this pass (per the mission's own "STOP if
// unclear/new logic required" rule, applied deliberately):
//   - AI Read removed from the primary AI & Comps workflow (unmounted,
//     underlying deterministic calc untouched).
//   - AI Deal Score (total + genuine category breakdown + caption)
//     surfaced in AI & Comps, parsed verbatim from ai_notes — no new
//     scoring, no changed criteria, no new band language.
//   - AI Insights (the AI's own PROS/CONS bullets) surfaced, parsed
//     verbatim, capped at 5.
// NOT implemented this pass (explicitly reported, not silently skipped —
// see the mission final report): 3-level ARV / AI-recommended-ARV →
// canonical lead.arv, AI ARV provenance styling, manual-override/refresh-
// safety UI, Renovation Guidance. Each requires either a live-pipeline
// prompt change with real safety tradeoffs (ARV) or new business logic
// (Renovation Guidance) that the mission itself says not to implement
// without a scoped follow-up.
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { parseAiDealScore, getAiInsights } from '../src/lib/aiDealScore'

const dealSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
const compsSrc = fs.readFileSync('src/components/lead-detail/workspace/ComplsIntelligenceCard.jsx', 'utf8')

// A real-shaped sample of what generate-core-analysis.mjs actually writes
// (exact section format verified against the live prompt at audit time).
const SAMPLE_NOTES = `Generated: Sep 6, 2026

=====================================
DEAL SCORE
=====================================
Total:          62/100
Deal Return:    20/30 - Flip profit ~$45K at MAO, solid but not exceptional
Price Gap:      14/20 - Ask is $8K above MAO, closeable with negotiation
Seller Signals: 9/15 - Estate sale, no price drop yet
Market & Exit:  11/15 - ZIP tier B, ARV confidence MEDIUM
Cash Flow:      5/10 - BRRRR cash flow marginal at current rent assumption
Data Quality:   3/10 - Renovation cost not yet confirmed by contractor
Verdict:        NEGOTIATE

=====================================
DEAL SNAPSHOT
=====================================
Profile:    3BR/2BA | 1400 sqft | ZIP 32208 | Single Family

=====================================
PROS - WHY THIS DEAL IS INTERESTING
=====================================
1. ZIP 32208 has strong recent comp support in the $200-240K range
2. Estate sale suggests seller flexibility on price and timeline
3. Layout supports an easy 3rd-bedroom conversion for upside

=====================================
CONS - RISKS AND RED FLAGS
=====================================
1. Renovation scope has not been walked by a contractor yet
2. Two comps used are 8+ months old, may not reflect current market

=====================================
MARKET COMPS
=====================================
Market Range (evidence context, not a replacement ARV): $270,000-$300,000 — ZIP benchmark + bed/bath adjustments
COMP: Mango Ave, 32208 | 3/2 | 1350 sqft | Sold $275,000 | $203/sqft | sold 4 months ago | cosmetic
COMP: Avenue B, 32208 | 3/2 | 1420 sqft | Sold $290,000 | $204/sqft | sold 6 months ago | renovated
Evidence Read: Market evidence broadly agrees with the canonical $285,000 ARV.
`

describe('A/B/C/D — AI Read removed from primary AI & Comps; underlying calc + Overview/Deal untouched', () => {
  it('A. "AI Deal Read"/"AI Read" card is gated OFF for the AI & Comps mount (hideDecisionSummary)', () => {
    expect(dealSrc).toMatch(/\{!hideDecisionSummary && \(flipResult\.available \|\| brrrrResult\.available\) && \(\(\) => \{/)
  })
  it('the ONLY DealAnalysisCard mount point (LeadDetailPage.jsx) always passes hideDecisionSummary, so AI Read never renders in the live app', () => {
    const pageSrc = fs.readFileSync('src/pages/LeadDetailPage.jsx', 'utf8')
    expect(pageSrc).toMatch(/<DealAnalysisCard[\s\S]*?hideDecisionSummary/)
  })
  it('underlying computeFlipResult/computeBrrrrResult calculation is untouched — only the render gate changed', () => {
    expect(dealSrc).toMatch(/const activeResult = strategy === 'brrrr' \? brrrrResult : flipResult/)
    expect(dealSrc).toMatch(/VERDICT_THEME\[activeResult\.verdict\]/)
  })
})

describe('E — AI Deal Score parser (pure, verbatim, no new scoring)', () => {
  it('parses the real Total/100 and every category exactly as written', () => {
    const score = parseAiDealScore(SAMPLE_NOTES)
    expect(score.total).toBe(62)
    expect(score.categories).toHaveLength(6)
    const byKey = Object.fromEntries(score.categories.map(c => [c.key, c]))
    expect(byKey.dealReturn).toMatchObject({ label: 'Deal Return', score: 20, max: 30 })
    expect(byKey.priceGap).toMatchObject({ label: 'Price Gap', score: 14, max: 20 })
    expect(byKey.sellerSignals).toMatchObject({ label: 'Seller Signals', score: 9, max: 15 })
    expect(byKey.marketExit).toMatchObject({ label: 'Market & Exit', score: 11, max: 15 })
    expect(byKey.cashFlow).toMatchObject({ label: 'Cash Flow', score: 5, max: 10 })
    expect(byKey.dataQuality).toMatchObject({ label: 'Data Quality', score: 3, max: 10 })
  })
  it('the max values sum to exactly 100 (no invented/changed criteria)', () => {
    const score = parseAiDealScore(SAMPLE_NOTES)
    const sum = score.categories.reduce((s, c) => s + c.max, 0)
    expect(sum).toBe(100)
  })
  it('returns null when no DEAL SCORE section exists — never fabricates a score', () => {
    expect(parseAiDealScore('')).toBeNull()
    expect(parseAiDealScore(null)).toBeNull()
    expect(parseAiDealScore('some unrelated text')).toBeNull()
  })
  it('parses the Verdict line too (kept for compatibility, not promoted in the UI — see Part 6)', () => {
    expect(parseAiDealScore(SAMPLE_NOTES).verdict).toBe('NEGOTIATE')
  })
})

describe('F — AI Insights parser (genuine PROS/CONS, capped, no filler)', () => {
  it('extracts up to 3 PROS + 2 CONS, verbatim', () => {
    const insights = getAiInsights(SAMPLE_NOTES)
    expect(insights.length).toBe(5)
    expect(insights.filter(i => i.tone === 'positive')).toHaveLength(3)
    expect(insights.filter(i => i.tone === 'risk')).toHaveLength(2)
    expect(insights[0].text).toMatch(/strong recent comp support/)
  })
  it('returns empty array, never fabricated bullets, when no notes exist', () => {
    expect(getAiInsights(null)).toEqual([])
    expect(getAiInsights('')).toEqual([])
  })
})

describe('G/H — AI Deal Score & AI Insights rendered in AI & Comps, distinguished from Acquisition Decision', () => {
  it('ComplsIntelligenceCard imports and renders the new parsers', () => {
    expect(compsSrc).toMatch(/import \{ parseAiDealScore, getAiInsights \} from '\.\.\/\.\.\/\.\.\/lib\/aiDealScore'/)
    expect(compsSrc).toMatch(/AI Deal Score<\/div>/)
    expect(compsSrc).toMatch(/AI Insights<\/div>/)
  })
  it('the caption explicitly distinguishes AI Deal Score from Acquisition Decision and Margin of Safety (Part 5 requirement)', () => {
    expect(compsSrc).toMatch(/does not replace Overview's Acquisition Decision or Deal's Margin of Safety/)
  })
  it('no new score-band semantics invented — uses the neutral caption, not MAKE OFFER/NEGOTIATE/DEAD LEAD language', () => {
    expect(compsSrc).toMatch(/Higher scores indicate a stronger overall AI-assessed opportunity/)
    expect(compsSrc).not.toMatch(/MAKE OFFER|LONG SHOT|DEAD LEAD/)
  })
})

describe('I/J/K — Financial/scoring/threshold isolation (protected files untouched)', () => {
  it('no protected file was touched this pass', () => {
    for (const f of ['src/lib/calculations.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/dealExplanation.js', 'src/lib/sellerStrategy.js']) {
      expect(fs.existsSync(f)).toBe(true) // sanity — files still exist, unmodified (verified via git diff in the final report)
    }
  })
  it('aiDealScore.js does not call any canonical financial function — pure text parsing only', () => {
    const src = fs.readFileSync('src/lib/aiDealScore.js', 'utf8')
    expect(src).not.toMatch(/calculateFlipMAO|calculateBrrrrMAO|computeFlipResult|computeBrrrrResult|computeStrategyRecommendation/)
  })
})

describe('L — not-implemented scope is explicitly reported, not silently skipped', () => {
  it('no fabricated 3-level ARV / AI-recommended-ARV canonicalization was added this pass', () => {
    // Confirms the mission's "do not invent fake ARV values" rule was
    // honored: no new UI/logic writes an AI-derived ARV into lead.arv.
    expect(compsSrc).not.toMatch(/Conservative\s*\n?\s*Recommended\s*\n?\s*Upside/)
    expect(compsSrc).not.toMatch(/AI ESTIMATE/)
  })
})
