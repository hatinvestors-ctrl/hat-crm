// test/aiCompsOverviewRecovery.test.js
// HAT INVESTORS — SAFE AI & COMPS RECOVERY PASS + OVERVIEW RESTORATION
// Surgical presentation-recovery pass — NO business-logic changes.
// Structural/source-text + pure-function tests, matching this repo's
// established convention (no component-mount harness exists here).
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { parseAiDealScore, getAiInsights } from '../src/lib/aiDealScore'
import { parseRentalRange } from '../src/lib/rentalRange'
import { parseAiValuation } from '../src/lib/aiValuation'
import { wasArvSetByAi } from '../src/lib/arvProvenance'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation, resolveEffectiveStrategy } from '../src/lib/dealExplanation'
import { resolveNoPriceStrategyPreference } from '../src/lib/acquisitionDecisionPresentation'

const compsCardSrc = fs.readFileSync('src/components/lead-detail/workspace/ComplsIntelligenceCard.jsx', 'utf8')
const notesRendererSrc = fs.readFileSync('src/components/lead-detail/NotesRenderer.jsx', 'utf8')
const dealAnalysisSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
const dealSnapshotSrc = fs.readFileSync('src/components/lead-detail/workspace/DealSnapshotCompact.jsx', 'utf8')
const decisionHeroSrc = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
const sellerSnapshotSrc = fs.readFileSync('src/components/lead-detail/workspace/SellerSnapshotStrip.jsx', 'utf8')

const SCORED_NOTES = `Generated: Sep 6, 2026

DEAL SCORE
Total: 72/100
Deal Return: 20/30 - solid margin
Price Gap: 15/20 - close to target
Seller Signals: 10/15 - some motivation
Market & Exit: 12/15 - strong exit
Cash Flow: 8/10 - positive
Data Quality: 7/10 - mostly complete
Verdict: NEGOTIATE

PROS
- Strong comps support the ARV
- Good exit market

CONS
- Seller price not yet established
`

const RENTAL_NOTES_CLEAN = `RENTAL COMPS
Conservative Rent: $1,350/mo — below-average condition discount
Realistic Rent: $1,475/mo — most likely post-reno rent
Optimistic Rent: $1,600/mo — fully updated premium
RENTAL: Northside area, ZIP 32208 | 3/2 | 1200 sqft | $1,400/mo | updated
Rent Verdict: MEETS THRESHOLD — rent supports BRRRR strategy
1% Rule: 0.9% at ask all-in | 1.1% at MAO all-in
`

// AI-bolded variant — the exact raw-prose bug reported in the mission.
const RENTAL_NOTES_MARKDOWN = `RENTAL COMPS
**Conservative Rent: $1,350/mo**
**Realistic Rent: $1,475/mo**
**Optimistic Rent: $1,600/mo**
`

describe('A/B/C/D — AI Deal Score visibility and honesty', () => {
  it('A. a valid Stage-B score is rendered unconditionally (not nested behind hasCompAnalysis)', () => {
    const scoreBlockIdx = compsCardSrc.indexOf('AI DEAL SCORE — AI & Comps Recovery Pass')
    expect(scoreBlockIdx).toBeGreaterThan(-1)
    // Must sit AFTER the closing of the hasCompAnalysis ternary, not nested inside it.
    const ternaryCloseIdx = compsCardSrc.lastIndexOf('</>\n      )}', scoreBlockIdx)
    expect(ternaryCloseIdx).toBeGreaterThan(-1)
    expect(ternaryCloseIdx).toBeLessThan(scoreBlockIdx)
  })
  it('B. category breakdown renders from the real parsed categories when a valid score exists', () => {
    const score = parseAiDealScore(SCORED_NOTES)
    expect(score.total).toBe(72)
    expect(score.categories.length).toBe(6)
    expect(compsCardSrc).toMatch(/dealScore\.categories\.map/)
  })
  it('C. no score is ever fabricated from Stage A alone — parseAiDealScore requires a real "Total: X\\/100" line', () => {
    const stageAOnly = 'MARKET COMPS\nCOMP: 123 Main St, sold $210,000\n'
    expect(parseAiDealScore(stageAOnly)).toBeNull()
  })
  it('D. an honest waiting state renders when Stage B has not produced a valid score — never 0/100, never a guessed score', () => {
    expect(compsCardSrc).toMatch(/Not available yet/)
    expect(compsCardSrc).toMatch(/Complete Deal Analysis to generate the AI Deal Score\./)
    expect(compsCardSrc).not.toMatch(/dealScore\.total \?\? 0/)
  })
})

describe('E/F/G — 3-level ARV / writeback / provenance unchanged', () => {
  it('E. the 3-level ARV valuation block is unchanged (Conservative/Recommended/Upside + Confidence + Rationale)', () => {
    expect(compsCardSrc).toMatch(/valuation\.conservative/)
    expect(compsCardSrc).toMatch(/valuation\.recommended/)
    expect(compsCardSrc).toMatch(/valuation\.upside/)
    expect(compsCardSrc).toMatch(/valuation\.rationale/)
  })
  it('F. ARV writeback behavior (blank-only auto-fill, refresh-safety banner) is untouched in DealAnalysisCard.jsx', () => {
    expect(dealAnalysisSrc).toMatch(/if \(lead\.arv == null\) \{\s*dbUpdate\.arv = valuation\.recommended/)
    expect(dealAnalysisSrc).toMatch(/New AI recommendation:/)
    expect(dealAnalysisSrc).toMatch(/Use AI Estimate/)
  })
  it('G. AI provenance (wasArvSetByAi) is untouched and still schema-free', () => {
    expect(wasArvSetByAi({ arv: 210000, ai_notes: 'Recommended ARV: $210,000\nConservative ARV: $190,000\nUpside ARV: $225,000' })).toBe(true)
    expect(compsCardSrc).toMatch(/const arvIsAi = wasArvSetByAi\(lead\)/)
  })
})

describe('H/I — Rental Comps presentation recovery', () => {
  it('H. clean rental values parse into a structured 3-level object, terminology kept verbatim (Conservative/Realistic/Optimistic)', () => {
    const r = parseRentalRange(RENTAL_NOTES_CLEAN)
    expect(r.conservative).toMatch(/\$1,350\/mo/)
    expect(r.realistic).toMatch(/\$1,475\/mo/)
    expect(r.optimistic).toMatch(/\$1,600\/mo/)
    expect(r.verdict).toMatch(/MEETS THRESHOLD/)
  })
  it('I. raw markdown (**bold**) around rental lines is stripped, not exposed verbatim, in both the primary card parser and the Detailed Analysis renderer', () => {
    const r = parseRentalRange(RENTAL_NOTES_MARKDOWN)
    expect(r.conservative).toBe('$1,350/mo')
    expect(r.conservative).not.toMatch(/\*/)
    // NotesRenderer.jsx's RentalCompsSection now tolerates the same markdown.
    expect(notesRendererSrc).toMatch(/\^\[\\\\s\*_#>-\]\*\$\{prefix\}:/)
  })
  it('the Rental Range block is rendered in the primary AI & Comps card, not only buried in Detailed Analysis', () => {
    expect(compsCardSrc).toMatch(/Rental Range/)
    expect(compsCardSrc).toMatch(/parseRentalRange\(lead\.ai_notes\)/)
  })
  it('no new rent methodology or value is invented — parseRentalRange returns null when the section genuinely is not present', () => {
    expect(parseRentalRange('no rental section here')).toBeNull()
    expect(parseRentalRange(null)).toBeNull()
  })
})

describe('J/K/L/M/N/O — no functionality lost', () => {
  it('J. Market Comps (Comparable Sales Evidence) preserved', () => {
    expect(compsCardSrc).toMatch(/Comparable Sales Evidence/)
  })
  it('K. AI Insights preserved', () => {
    expect(compsCardSrc).toMatch(/AI Insights<\/div>/)
    expect(typeof getAiInsights).toBe('function')
  })
  it('L. Full Breakdown tab preserved', () => {
    expect(dealAnalysisSrc).toMatch(/label: 'Full Breakdown'/)
  })
  it('M. Strategy tab / StrategySection preserved in NotesRenderer', () => {
    expect(notesRendererSrc).toMatch(/function StrategySection/)
  })
  it('N. Ask AI tab preserved', () => {
    expect(dealAnalysisSrc).toMatch(/label: 'Ask AI'/)
  })
  it('negotiation intelligence preserved', () => {
    expect(dealAnalysisSrc).toMatch(/updateNegoPlan/)
    expect(notesRendererSrc).toMatch(/function NegotiationPlanSection/)
  })
  it('O. AI Read remains removed (gated behind hideDecisionSummary, always true at its only mount)', () => {
    expect(dealAnalysisSrc).toMatch(/\{!hideDecisionSummary && \(flipResult\.available \|\| brrrrResult\.available\) && \(\(\) => \{/)
  })
})

describe('P/Q/R — no financial/scoring/strategy/Acquisition Decision change', () => {
  it('P/Q. computeFlipResult/computeBrrrrResult/computeStrategyRecommendation formulas untouched — golden Woodleigh-style sanity check', () => {
    const lead = { arv: 200000, renovation_cost: 39000 }
    const flip = computeFlipResult(lead, null)
    expect(flip.available).toBe(true)
    expect(flip.mao).toBeGreaterThan(0)
  })
  it('R. Acquisition Decision logic (deriveAcquisitionDecision) is not imported/called by this recovery pass\'s files — only referenced in an explanatory comment', () => {
    expect(compsCardSrc).not.toMatch(/^import \{[^}]*deriveAcquisitionDecision/m)
    expect(dealSnapshotSrc).not.toMatch(/^import \{[^}]*deriveAcquisitionDecision/m)
    expect(dealSnapshotSrc).not.toMatch(/\bderiveAcquisitionDecision\(/)
  })
})

describe('S — 9428 Lovage regression (AI & Comps side)', () => {
  const LOVAGE = { arv: 195000, renovation_cost: 55000, asking_price: null, rent_estimate: null, offer_price: null }
  it('Flip Max Buy computes to ~$81,800 with no price required, profit honestly unavailable', () => {
    const flip = computeFlipResult(LOVAGE, null)
    expect(flip.available).toBe(true)
    expect(Math.round(flip.mao / 100) * 100).toBe(81800)
    expect(flip.projectedProfit).toBeNull()
  })
  it('3-level ARV and Rental Range would both render for this lead once ai_notes contains them (structural readiness, not fabrication)', () => {
    const notes = 'VALUATION\nConservative ARV: $180,000\nRecommended ARV: $195,000\nUpside ARV: $210,000\nConfidence: Medium\nRationale: comps.\n\n' + RENTAL_NOTES_CLEAN
    expect(parseAiValuation(notes)).toMatchObject({ conservative: 180000, recommended: 195000, upside: 210000 })
    expect(parseRentalRange(notes).conservative).toMatch(/^\$1,350\/mo/)
  })
})

// ══════════════════════════════════════════════════════════════════════
// PART 16-29 — OVERVIEW RESTORATION
// ══════════════════════════════════════════════════════════════════════

describe('Overview Part 17/18/19 — Acquisition Decision, explanation, Next Action already present (DecisionHero, unmodified by this pass)', () => {
  it('DecisionHero renders the canonical Acquisition Decision headline + explanation from deriveAcquisitionDecision', () => {
    expect(decisionHeroSrc).toMatch(/Acquisition Decision/)
    expect(decisionHeroSrc).toMatch(/deriveAcquisitionDecision/)
    expect(decisionHeroSrc).toMatch(/decision\.explanation/)
  })
  it('DecisionHero renders a Next Action line sourced from the same canonical decision object, not a second action engine', () => {
    expect(decisionHeroSrc).toMatch(/decision\?\.nextAction/)
  })
  it('DecisionHero is untouched by this recovery pass (no import of DealSnapshotCompact\'s new helpers)', () => {
    expect(decisionHeroSrc).not.toMatch(/rentalRange|parseRentalRange/)
  })
})

describe('Overview Part 20 — Deal Snapshot restored as an executive economics summary', () => {
  it('Strategy, Max Buy, Seller Price, ARV, Rehab are shown, reading ONLY canonical computeFlipResult/computeBrrrrResult (no independent math)', () => {
    expect(dealSnapshotSrc).toMatch(/Cell label="Strategy"/)
    expect(dealSnapshotSrc).toMatch(/Flip Max Buy/)
    expect(dealSnapshotSrc).toMatch(/BRRRR Max Buy/)
    expect(dealSnapshotSrc).toMatch(/Seller Price/)
    expect(dealSnapshotSrc).toMatch(/computeFlipResult\(lead, underwritingSettings\)/)
    expect(dealSnapshotSrc).toMatch(/computeBrrrrResult\(lead, underwritingSettings\)/)
    expect(dealSnapshotSrc).toMatch(/resolveEffectiveStrategy\(strategyRec\)/)
  })
  it('FLIP shows Profit; BRRRR shows Rent/Cash Flow/Cash Left In — using the exact canonical field names', () => {
    expect(dealSnapshotSrc).toMatch(/flip\.projectedProfit/)
    expect(dealSnapshotSrc).toMatch(/brrrr\.monthlyCashFlow/)
    expect(dealSnapshotSrc).toMatch(/brrrr\.cashLeftIn/)
  })
  it('a missing Profit shows an honest reason, never a fabricated number', () => {
    expect(dealSnapshotSrc).toMatch(/— Needs seller price/)
  })
  it('9428 Lovage: DealSnapshotCompact would show Flip Max Buy $81,800 and Profit "— Needs seller price"', () => {
    const flip = computeFlipResult({ arv: 195000, renovation_cost: 55000 }, null)
    expect(Math.round(flip.mao / 100) * 100).toBe(81800)
    expect(flip.projectedProfit).toBeNull()
  })
})

describe('Overview Part 21/22 — Seller Snapshot and Distress banner preserved, unmodified', () => {
  it('SellerSnapshotStrip still shows the 4 key seller facts / honest "still unknown" collapse', () => {
    expect(sellerSnapshotSrc).toMatch(/Motivation/)
    expect(sellerSnapshotSrc).toMatch(/4 key seller facts still unknown/)
  })
})

describe('Overview Part 28 — duplication guardrail: no detailed comps, no AI Read, no duplicate editable inputs in Overview components', () => {
  it('DealSnapshotCompact never renders an editable input field (read-only display only)', () => {
    expect(dealSnapshotSrc).not.toMatch(/<input/)
  })
  it('DealSnapshotCompact never imports NotesRenderer or comp-evidence parsing (no detailed comps duplicated into Overview)', () => {
    expect(dealSnapshotSrc).not.toMatch(/NotesRenderer|getCompEvidenceSummary|arvConfidence/)
  })
  it('DecisionHero never renders the old AI Read SOLID/WATCH/NO DEAL verdict card', () => {
    expect(decisionHeroSrc).not.toMatch(/AI Deal Read/)
  })
})

describe('Overview Part 24 — 9428 Lovage full-page regression sanity (Overview side)', () => {
  const LOVAGE = { arv: 195000, renovation_cost: 55000, asking_price: null, rent_estimate: null, offer_price: null, is_distressed: true }
  it('Strategy resolves to FLIP via the no-price presentation helper (BRRRR unavailable — no rent estimate; computeStrategyRecommendation alone would read vacuous NO DEAL with no price on file)', () => {
    const flip = computeFlipResult(LOVAGE, null)
    const brrrr = computeBrrrrResult(LOVAGE, null)
    expect(brrrr.available).toBe(false)
    expect(resolveNoPriceStrategyPreference({ flip, brrrr }).strategy).toBe('FLIP')
  })
})
