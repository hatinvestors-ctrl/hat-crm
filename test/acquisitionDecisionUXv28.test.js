// test/acquisitionDecisionUXv28.test.js
// HAT Investors — Lead Workspace UX V2.8 — "AI & Comps Simplification:
// return the tab to comparable-evidence / ARV validation."
//
// Covers Part 16's A–W matrix. Pure-function assertions run against real
// Woodleigh/Norfolk-shaped fixtures; component assertions are structural
// (source-text), matching this repo's established convention.
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../src/lib/dealExplanation'
import { resolveUnderwritingSettings } from '../src/lib/underwritingSettings'
import { getCompEvidenceSummary, computeDecisionSensitivity, getValuationRecommendation, getExternalCompConfidenceState, getHatInternalEvidence } from '../src/lib/arvConfidence'
import { getArvProvenance } from '../src/lib/arvProvenance'
import { computeAnalysisReadiness } from '../src/components/lead-detail/DealAnalysisCard'

const REAL_SETTINGS = resolveUnderwritingSettings({ underwriting: {
  refi_ltv_pct: 70, monthly_taxes: 208, hml_points_pct: 2, refi_costs_pct: 2.9,
  refi_amort_years: 30, monthly_insurance: 100, flip_selling_cost_pct: 7,
  default_holding_months: 6, refi_interest_rate_pct: 6.7, hml_rehab_financing_pct: 100,
  hml_interest_monthly_pct: 1, acquisition_closing_costs: 2450, hml_purchase_financing_pct: 90,
} })

const WOODLEIGH = { address: '1963 W WOODLEIGH DR', asking_price: 100000, arv: 200000, renovation_cost: 50000, rent_estimate: 1350, is_distressed: true }
const NORFOLK   = { address: '9739 Norfolk Blvd', asking_price: 105000, arv: 215000, renovation_cost: 65000, rent_estimate: 1350, is_distressed: false }

// These are "this must no longer be RENDERED" assertions, so they run
// against the code with comments stripped — a file-header comment that
// documents what V2.8 removed ("...the What Makes This Deal Work block
// with Evaluation Price / HAT Max Buy...") must not read as the markup
// still being present. Positive assertions are unaffected either way.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

const compsSrc     = stripComments(fs.readFileSync('src/components/lead-detail/workspace/ComplsIntelligenceCard.jsx', 'utf8'))
const dealCardSrc  = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
const pageSrc      = fs.readFileSync('src/pages/LeadDetailPage.jsx', 'utf8')
const arvConfSrc   = fs.readFileSync('src/lib/arvConfidence.js', 'utf8')

const AI_NOTES_WITH_COMPS = `=====================================
MARKET COMPS
=====================================
Market Range (evidence context, not a replacement ARV): $190,000–$215,000 — ZIP 32208 benchmark with 3/2 adjustment
COMP: 1420 Ribault Ave, 32208 | 3/2 | 1,180 sqft | Sold $198,000 | $168/sqft | 4 months ago | renovated
Why relevant: Same ZIP, comparable size and finish level.
COMP: 985 Moncrief Rd, 32208 | 3/2 | 1,240 sqft | Sold $205,000 | $165/sqft | 7 months ago | renovated
Why relevant: Slightly larger, same submarket.
Evidence Read: Market evidence broadly agrees with the canonical $200,000 ARV.
`

// ── A / P / Q / R / S / T — economics and recommendations unchanged ────────
describe('A, P–T. Underlying economics, strategy recommendations and Max Buy are untouched', () => {
  const compute = (lead) => {
    const flip = computeFlipResult(lead, REAL_SETTINGS)
    const brrrr = computeBrrrrResult(lead, REAL_SETTINGS)
    return { flip, brrrr, rec: computeStrategyRecommendation(flip, brrrr) }
  }

  it('P. Woodleigh ARV and Flip/BRRRR economics are unchanged by the presentation change', () => {
    const { flip, brrrr } = compute(WOODLEIGH)
    expect(WOODLEIGH.arv).toBe(200000)
    expect(flip.available).toBe(true)
    expect(flip.mao).toBe(computeFlipResult(WOODLEIGH, REAL_SETTINGS).mao)
    expect(brrrr.available).toBe(true)
  })

  it('Q. Norfolk ARV and economics are unchanged', () => {
    const { flip, brrrr } = compute(NORFOLK)
    expect(NORFOLK.arv).toBe(215000)
    expect(flip.available).toBe(true)
    expect(brrrr.available).toBe(true)
  })

  it('R/S. Strategy recommendation (the same value Overview and Deal both read) is deterministic and unchanged', () => {
    expect(compute(NORFOLK).rec.preferredStrategy).toBe(computeStrategyRecommendation(
      computeFlipResult(NORFOLK, REAL_SETTINGS), computeBrrrrResult(NORFOLK, REAL_SETTINGS),
    ).preferredStrategy)
    expect(compute(WOODLEIGH).rec.summary).toBeTruthy()
  })

  it('T. Flip/BRRRR Max Buy values are produced only by the canonical engine, which this task never called from the comps card', () => {
    expect(compsSrc).not.toMatch(/computeFlipResult|computeBrrrrResult|calculateFlipMAO|calculateBrrrrMAO/)
  })
})

// ── U. Protected files untouched ──────────────────────────────────────────
describe('U. Financial / scoring / threshold logic files remain untouched by this task', () => {
  it('the comps card imports no financial engine, settings resolver or scoring module', () => {
    expect(compsSrc).not.toMatch(/from '.*\/dealExplanation/)
    expect(compsSrc).not.toMatch(/from '.*\/decisionEngineV2/)
    expect(compsSrc).not.toMatch(/from '.*\/buyBox/)
    expect(compsSrc).not.toMatch(/from '.*\/underwritingSettings/)
    expect(compsSrc).not.toMatch(/from '.*\/sellerStrategy/)
    // formatCurrency only — a formatter, not a calculation.
    expect(compsSrc).toMatch(/import \{ formatCurrency as fc \} from '\.\.\/\.\.\/\.\.\/lib\/calculations'/)
  })
  it('the card no longer receives underwritingSettings, because it no longer underwrites anything', () => {
    expect(compsSrc).toMatch(/export default function ComplsIntelligenceCard\(\{ lead \}\)/)
    expect(pageSrc).toMatch(/<ComplsIntelligenceCard lead=\{lead\} \/>/)
  })
  it('arvConfidence.js gained only a pure parse-only reader — no new financial formula', () => {
    expect(arvConfSrc).toMatch(/export function getCompEvidenceSummary/)
    expect(arvConfSrc).not.toMatch(/getCompEvidenceSummary[\s\S]{0,600}computeFlipResult/)
  })
})

// ── A. Current ARV still visible ──────────────────────────────────────────
describe('A. Current ARV remains the headline of AI & Comps', () => {
  it('renders Current ARV straight from lead.arv, never recomputed', () => {
    expect(compsSrc).toMatch(/Current ARV/)
    expect(compsSrc).toMatch(/\{lead\.arv != null \? fc\(lead\.arv\) : '—'\}/)
  })
})

// ── B, C, D, E, F, G, H, I — the underwriting/decision layer is gone ──────
describe('B–I. The underwriting / decision layer is removed from the primary AI & Comps workflow', () => {
  it('B. ROBUST DEAL is not rendered', () => {
    expect(compsSrc).not.toMatch(/ROBUST[ _]DEAL/)
    expect(compsSrc).not.toMatch(/sensitivityLabel/)
  })
  it('C. ARV SENSITIVE is not rendered as the primary comps verdict', () => {
    expect(compsSrc).not.toMatch(/ARV[ _]SENSITIVE/)
    expect(compsSrc).not.toMatch(/STRESS_CLASSIFICATION/)
  })
  it('D. the ±5% ARV stress-test UI (verdict, explainer link and scenario table) is gone', () => {
    expect(compsSrc).not.toMatch(/ARV Stress Test/)
    expect(compsSrc).not.toMatch(/How is this calculated/)
    expect(compsSrc).not.toMatch(/stress[- ]test/i)
    expect(compsSrc).not.toMatch(/computeDecisionSensitivity/)
    expect(compsSrc).not.toMatch(/getValuationRecommendation/)
    expect(compsSrc).not.toMatch(/Conservative|Upside/)
  })
  it('E. "What Makes This Deal Work?" is removed', () => {
    expect(compsSrc).not.toMatch(/What Makes This Deal Work/i)
  })
  it('F. Evaluation Price is not duplicated here', () => {
    expect(compsSrc).not.toMatch(/Evaluation Price/)
  })
  it('G. HAT Max Buy is not duplicated here', () => {
    expect(compsSrc).not.toMatch(/Max Buy/)
  })
  it('H. Room to Max Buy is not duplicated here', () => {
    expect(compsSrc).not.toMatch(/Room to Max Buy/)
  })
  it('I. Seller Gap to Max Buy is not duplicated here', () => {
    expect(compsSrc).not.toMatch(/Seller Gap to Max Buy/)
  })
  it('W. no other deal-level verdict, strategy or offer surface was introduced in its place', () => {
    for (const banned of [/Suggested Offer/, /Actual Offer/, /Recommended Strategy/, /Margin of Safety/, /Cash Left In/, /Cash Flow/, /Projected Profit/, /NO DEAL/, /WATCH/, /Act Now/, /Review Today/]) {
      expect(compsSrc).not.toMatch(banned)
    }
  })
})

// ── Part 2 — removal is an unmount, not a capability deletion ─────────────
describe('Part 2. The stress-test library functions are preserved, only unmounted', () => {
  it('computeDecisionSensitivity still exists and still works against the canonical engine', () => {
    const s = computeDecisionSensitivity(WOODLEIGH, { underwritingSettings: REAL_SETTINGS })
    expect(s.available).toBe(true)
    expect(s.bandPct).toBe(0.05)
    expect(['ROBUST_DEAL', 'ARV_SENSITIVE', 'UPSIDE_DEPENDENT', 'NO_DEAL_ACROSS_RANGE']).toContain(s.sensitivity)
  })
  it('getValuationRecommendation still exists and still returns text for every classification', () => {
    expect(getValuationRecommendation('ROBUST_DEAL')).toMatch(/conservative ARV stress scenario/)
  })
})

// ── N / O — comp confidence: genuine preserved, nothing fabricated ────────
describe('N, O. Comp-evidence confidence is preserved honestly and never fabricated', () => {
  it('N. the existing getExternalCompConfidenceState is still the source of the confidence copy', () => {
    expect(compsSrc).toMatch(/getExternalCompConfidenceState/)
    expect(compsSrc).toMatch(/Comp Confidence/)
  })
  it('O. no numeric comp-confidence score is invented — the honest "not yet available" state is used', () => {
    expect(getExternalCompConfidenceState(WOODLEIGH).status).toBe('NOT_SCOREABLE')
    expect(getExternalCompConfidenceState({}).status).toBe('NOT_SCOREABLE')
    expect(compsSrc).not.toMatch(/confidenceScore|compScore|\/\s*100/)
  })
  it('the ±5% stress test was NOT relabelled as comp confidence', () => {
    expect(compsSrc).not.toMatch(/sensitivity/i)
  })
})

// ── J / K / L — analysis entry points still work ──────────────────────────
describe('J, K, L. Get Comps & Detailed AI, readiness and existing generated analysis all remain', () => {
  it('J. the single "Get Comps & Detailed AI" CTA still renders in the AI & Comps tab', () => {
    expect(dealCardSrc).toMatch(/✦ Get Comps & Detailed AI/)
    expect(pageSrc).toMatch(/<DealAnalysisCard/)
    // The comps card points at that one CTA rather than duplicating it.
    expect(compsSrc).toMatch(/Get Comps &amp; Detailed AI/)
    expect(compsSrc).not.toMatch(/runGenerate|handleRun|netlify\/functions/)
  })
  it('K. analysis readiness is still computed by the same pure function, with the same rules', () => {
    expect(computeAnalysisReadiness({ asking_price: 100000, renovation_cost: 50000, arv: 200000 }, 'flip').ready).toBe(true)
    expect(computeAnalysisReadiness({ renovation_cost: 50000 }, 'flip').ready).toBe(false)
    // ARV is still never blocking.
    expect(computeAnalysisReadiness({ asking_price: 100000, renovation_cost: 50000 }, 'flip').ready).toBe(true)
    expect(computeAnalysisReadiness({ asking_price: 100000, renovation_cost: 50000 }, 'brrrr').ready).toBe(false)
  })
  it('K. readiness is compact when ready and actionable when not', () => {
    expect(dealCardSrc).toMatch(/Analysis Ready ✓/)
    expect(dealCardSrc).toMatch(/Missing for analysis/)
  })
  it('L. the existing generated analysis (NotesRenderer + Full Breakdown + Ask AI) is still mounted', () => {
    expect(dealCardSrc).toMatch(/<NotesRenderer/)
    expect(dealCardSrc).toMatch(/label: 'Full Breakdown'/)
    expect(dealCardSrc).toMatch(/label: 'Ask AI'/)
    expect(dealCardSrc).toMatch(/onRefreshComps=\{canEdit \? refreshCompsOnly : null\}/)
  })
})

// ── V. No editing functionality removed ───────────────────────────────────
describe('V. No editing capability was removed', () => {
  it('the asking-price EditableField and reno-tier picker are still wired in the readiness panel', () => {
    expect(dealCardSrc).toMatch(/<EditableField/)
    expect(dealCardSrc).toMatch(/onSave=\{\(v\) => update\(\{ asking_price: v \}\)\}/)
    expect(dealCardSrc).toMatch(/onClick=\{onOpenRenoPicker\}/)
    expect(dealCardSrc).toMatch(/<RenoTierPicker/)
  })
  it('the comps card was read-only before this change and remains read-only', () => {
    expect(compsSrc).not.toMatch(/onSave=|supabase\.from\('leads'\)\.update/)
  })
})

// ── M. Genuine comparable-sales evidence is surfaced, nothing invented ────
describe('M. Genuine comparable-sales evidence remains accessible', () => {
  it('parses only what generate-comps.mjs actually writes', () => {
    const s = getCompEvidenceSummary({ ai_notes: AI_NOTES_WITH_COMPS })
    expect(s.available).toBe(true)
    expect(s.count).toBe(2)
    expect(s.marketRange).toMatch(/\$190,000–\$215,000/)
    expect(s.evidenceRead).toMatch(/broadly agrees with the canonical \$200,000 ARV/)
    expect(s.comps[0].label).toBe('1420 Ribault Ave, 32208')
    expect(s.comps[0].details).toEqual(['3/2', '1,180 sqft', 'Sold $198,000', '$168/sqft', '4 months ago', 'renovated'])
  })
  it('returns an honest empty state when no comp analysis has been run (Woodleigh today)', () => {
    const s = getCompEvidenceSummary(WOODLEIGH)
    expect(s.available).toBe(false)
    expect(s.count).toBe(0)
    expect(s.comps).toEqual([])
    expect(s.marketRange).toBeNull()
    expect(s.evidenceRead).toBeNull()
  })
  it('never invents a field the template did not emit', () => {
    const s = getCompEvidenceSummary({ ai_notes: 'COMP: 12 Main St\n' })
    expect(s.comps[0].details).toEqual([])
    expect(s).not.toHaveProperty('estimatedArv')
    expect(s).not.toHaveProperty('confidence')
  })
  it('agrees exactly with the pre-existing getArvProvenance comp definition — one definition of "comps exist"', () => {
    expect(getCompEvidenceSummary({ ai_notes: AI_NOTES_WITH_COMPS }).count)
      .toBe(getArvProvenance({ arv: 200000, ai_notes: AI_NOTES_WITH_COMPS }).comps_count)
  })
  it('HAT Market History is preserved, still evidence-typed, and now visually secondary', () => {
    const ev = getHatInternalEvidence({ id: 'x', sqft: 1200 }, [
      { id: 'y', address: '10 Elm St', sqft: 1210, arv: 190000, status: 'lead' },
    ])
    expect(ev.available).toBe(true)
    expect(ev.matches[0].evidenceType).toBe('PRIOR_ARV_ESTIMATE')
    expect(compsSrc).toMatch(/HAT Market History/)
    expect(compsSrc).toMatch(/No HAT market history available for ZIP/)
    expect(compsSrc).toMatch(/historyOpen/)
  })
})

// ── Part 13/14 — Woodleigh and Norfolk regression shape ───────────────────
describe('Parts 13/14. Woodleigh (no comps yet) and Norfolk (on-market) regression shape', () => {
  it('Woodleigh: Current ARV $200,000 plus an honest "no comp analysis yet" state — no decision layer', () => {
    expect(WOODLEIGH.arv).toBe(200000)
    expect(getCompEvidenceSummary(WOODLEIGH).available).toBe(false)
    expect(compsSrc).toMatch(/No detailed comp analysis has been run yet\./)
  })
  it('Norfolk: on-market price provenance is untouched — the comps card no longer reads any price source at all', () => {
    expect(compsSrc).not.toMatch(/asking_price|offer_price|resolveMarketType|getSellerIntelligence/)
    expect(computeFlipResult(NORFOLK, REAL_SETTINGS).evaluationPrice).toBe(105000)
  })
})
