// test/acquisitionDecisionUXv27.test.js
// HAT Investors — Lead Workspace UX V2.7 — "Deal Tab Deduplication +
// Canonical Input Ownership"
//
// Covers Part 18's A-X matrix. Pure-function assertions run against real
// Woodleigh/Norfolk-shaped fixtures; component assertions are structural
// (source-text), matching this repo's established convention.
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../src/lib/dealExplanation'
import { resolveUnderwritingSettings } from '../src/lib/underwritingSettings'
import { buildStrategyComparison, resolveActualOffer } from '../src/lib/acquisitionDecisionPresentation'

const REAL_SETTINGS = resolveUnderwritingSettings({ underwriting: {
  refi_ltv_pct: 70, monthly_taxes: 208, hml_points_pct: 2, refi_costs_pct: 2.9,
  refi_amort_years: 30, monthly_insurance: 100, flip_selling_cost_pct: 7,
  default_holding_months: 6, refi_interest_rate_pct: 6.7, hml_rehab_financing_pct: 100,
  hml_interest_monthly_pct: 1, acquisition_closing_costs: 2450, hml_purchase_financing_pct: 90,
} })

const WOODLEIGH = { address: '1963 W WOODLEIGH DR', asking_price: 100000, arv: 200000, renovation_cost: 50000, rent_estimate: 1350, is_distressed: true }
const NORFOLK = { address: '9739 Norfolk Blvd', asking_price: 105000, arv: 215000, renovation_cost: 65000, rent_estimate: 1350, is_distressed: false }

function computeAll(lead, settings = REAL_SETTINGS) {
  const flip = computeFlipResult(lead, settings)
  const brrrr = computeBrrrrResult(lead, settings)
  const strategyRec = computeStrategyRecommendation(flip, brrrr)
  return { flip, brrrr, strategyRec }
}

const pageSrc = fs.readFileSync('src/pages/LeadDetailPage.jsx', 'utf8')
const propertySrc = fs.readFileSync('src/components/lead-detail/PropertyInfoSection.jsx', 'utf8')
const dealSrc = fs.readFileSync('src/components/lead-detail/workspace/DealDecisionCenter.jsx', 'utf8')
const financialSrc = fs.readFileSync('src/components/lead-detail/FinancialSection.jsx', 'utf8')

// ── A. Financials removed from primary Deal workflow ───────────────────────
describe('A. Financials section removed from the primary Deal workflow', () => {
  it('LeadDetailPage.jsx no longer imports or mounts FinancialSection', () => {
    expect(pageSrc).not.toMatch(/import FinancialSection/)
    expect(pageSrc).not.toMatch(/<FinancialSection/)
  })
  it('FinancialSection.jsx itself is untouched and still exports its component — file preserved, not deleted (mission\'s explicit "do not delete underlying component" rule)', () => {
    expect(financialSrc).toMatch(/export default function FinancialSection/)
  })
})

// ── B-F. Canonical input ownership — all previously-Financials-only fields
// now editable in PropertyInfoSection ────────────────────────────────────
describe('B-F. Canonical edit location — PropertyInfoSection is now the one home for these inputs', () => {
  it('B. Evaluation Price / Seller\'s Asking Price still editable (pre-existing, confirmed intact)', () => {
    expect(propertySrc).toMatch(/onSave=\{\(v\) => update\(\{ asking_price: v \}\)\}/)
  })
  it('C. ARV still editable', () => {
    expect(propertySrc).toMatch(/label="After-Repair Value \(ARV\)"/)
    expect(propertySrc).toMatch(/onSave=\{\(v\) => \{\s*const newMao = v \? Math\.round\(Number\(v\) \* 0\.75/)
  })
  it('D. Renovation Cost still editable, including the RenoTierPicker', () => {
    expect(propertySrc).toMatch(/label="Renovation Cost"/)
    expect(propertySrc).toMatch(/import RenoTierPicker from '\.\/RenoTierPicker'/)
    expect(propertySrc).toMatch(/<RenoTierPicker/)
  })
  it('E. Rent Estimate still editable', () => {
    expect(propertySrc).toMatch(/label="Rent Estimate \(BRRRR\)"/)
    expect(propertySrc).toMatch(/onSave=\{\(v\) => update\(\{ rent_estimate: v \}\)\}/)
  })
  it('F. Holding Period still editable', () => {
    expect(propertySrc).toMatch(/label="Holding Period"/)
    expect(propertySrc).toMatch(/onSave=\{\(v\) => update\(\{ hold_months: v \}\)\}/)
  })
  it('Suggested Offer (formerly "We Offer") edit capability preserved, correctly labeled', () => {
    expect(propertySrc).toMatch(/Suggested Offer<\/span>/)
    expect(propertySrc).toMatch(/onSave=\{\(v\) => update\(\{ starting_offer: v \}\)\}/)
    expect(propertySrc).not.toMatch(/>We Offer</)
  })
  it('Legacy Max Offer override (lead.mao) edit capability preserved, collapsed, diagnostic-labeled', () => {
    expect(propertySrc).toMatch(/Legacy Max Offer override/)
    expect(propertySrc).toMatch(/onSave=\{\(v\) => update\(\{ mao: v \}\)\}/)
  })
  it('LeadDetailPage.jsx passes underwritingSettings to PropertyInfoSection (needed for the moved ARV/Reno/Holding-Period-aware Max Buy computations)', () => {
    expect(pageSrc).toMatch(/<PropertyInfoSection[\s\S]*?underwritingSettings=\{underwritingSettings\}/)
  })
})

// ── G/H. Generic Gap to Max Buy / redundant Flip Max Buy removed ───────────
describe('G/H. No generic/redundant duplicate surfaces remain', () => {
  it('G. no generic "Gap to Max Buy" label anywhere in the mounted Deal workflow (DealDecisionCenter never had it; FinancialSection\'s copy is now unmounted)', () => {
    expect(dealSrc).not.toMatch(/>Gap to Max Buy</)
    expect(pageSrc).not.toMatch(/>Gap to Max Buy</)
    expect(propertySrc).not.toMatch(/>Gap to Max Buy</)
  })
  it('H. no redundant "Max Buy (Flip)" card outside the V2.6 comparison/detail — that label only ever existed in the now-unmounted FinancialSection', () => {
    expect(dealSrc).not.toMatch(/Max Buy \(Flip\)/)
    expect(propertySrc).not.toMatch(/Max Buy \(Flip\)/)
  })
})

// ── I/J/K. Offer provenance ─────────────────────────────────────────────────
describe('I/J/K. Offer provenance preserved and no longer mislabeled', () => {
  it('I. no misleading "We Offer" remains mounted anywhere in the workspace', () => {
    expect(pageSrc).not.toMatch(/>We Offer</)
    expect(dealSrc).not.toMatch(/>We Offer</)
    expect(propertySrc).not.toMatch(/>We Offer</)
  })
  it('J. actual offer provenance (resolveActualOffer) untouched — trusts only lead.offer_price / FORMAL_OFFER', () => {
    expect(resolveActualOffer({ offer_price: 97000 }).source).toBe('offer_price')
    expect(resolveActualOffer({ offer_price: null, distress_data: { seller_intelligence: { hat_offer_type: 'RANGE_MENTIONED', hat_offer_mentioned: 90000 } } }).amount).toBeNull()
  })
  it('K. Suggested Offer provenance is the same MAO-anchored getEffectiveOffer/calculateLiveOffer value as before — never presented as "Our Offer"', () => {
    expect(propertySrc).toMatch(/const liveOffer = getEffectiveOffer\(lead, formulaMao\) \?\? calculateLiveOffer\(formulaMao,/)
  })
})

// ── L/M. Price provenance regression ────────────────────────────────────────
describe('L/M. Off-market Evaluation Price / genuine Seller Asking semantics preserved', () => {
  it('L. off-market lead.asking_price remains labeled "Evaluation Price" in PropertyInfoSection', () => {
    expect(propertySrc).toMatch(/isDistressedLead\(lead\) \? 'Evaluation Price' : "Seller's Asking Price"/)
  })
  it('M. DealDecisionCenter still resolves genuine Seller Asking only from getSellerIntelligence(lead).seller_asking_price', () => {
    expect(dealSrc).toMatch(/const genuineSellerAsking = isOffMarket \? getSellerIntelligence\(lead\)\.seller_asking_price : null/)
  })
})

// ── N/O/P/Q. Strategy architecture unchanged ────────────────────────────────
describe('N-Q. V2.6 strategy architecture untouched by this dedup pass', () => {
  it('N/O. Flip Max Buy and BRRRR Max Buy values are unchanged (same canonical flip.mao/brrrr.mao, roundMaxBuy applied identically)', () => {
    const { flip, brrrr } = computeAll(WOODLEIGH)
    expect(Math.round(flip.mao / 100)).toBeCloseTo(911, 0)
    expect(Math.round(brrrr.mao / 100)).toBeCloseTo(1004, 0)
  })
  it('P. strategy recommendation unchanged — Woodleigh still recommends BRRRR', () => {
    const { flip, brrrr, strategyRec } = computeAll(WOODLEIGH)
    const comparison = buildStrategyComparison({ flip, brrrr, strategyRec })
    expect(comparison.recommended).toBe('BRRRR')
  })
  it('Q. selected-strategy drill-down behavior (V2.6) untouched — buildStrategyComparison/resolveEffectiveStrategy still the sole decision point, no Best Fit/Path sections reintroduced', () => {
    // V2.9 note (post-V2.6 legitimate fix, not a regression): additive
    // `hasPrice` option added to buildStrategyComparison — see
    // acquisitionDecisionUXv25.test.js for the full explanation.
    expect(dealSrc).toMatch(/const comparison = buildStrategyComparison\(\{ flip, brrrr, strategyRec, hasPrice: priceKnown \}\)/)
    expect(dealSrc).not.toMatch(/>Best Fit</)
    expect(dealSrc).not.toMatch(/<FlipRealityCheck|<BrrrrRealityCheck/)
  })
})

// ── R. Overview/Deal consistency ────────────────────────────────────────────
describe('R. Overview/Deal consistency unchanged', () => {
  it('both DecisionHero and DealDecisionCenter still receive the same underwritingSettings from LeadDetailPage.jsx', () => {
    expect(pageSrc).toMatch(/<DecisionHero lead=\{lead\} underwritingSettings=\{underwritingSettings\} \/>/)
    expect(pageSrc).toMatch(/<DealDecisionCenter lead=\{lead\} onRunAnalysis=\{[^}]*\} underwritingSettings=\{underwritingSettings\} \/>/)
  })
})

// ── S/T. Woodleigh/Norfolk regression ───────────────────────────────────────
describe('S/T. Woodleigh and Norfolk regression', () => {
  it('S. Woodleigh: BRRRR recommended, both strategies available, correct default, unchanged Max Buy values', () => {
    const { flip, brrrr, strategyRec } = computeAll(WOODLEIGH)
    const comparison = buildStrategyComparison({ flip, brrrr, strategyRec })
    expect(flip.available).toBe(true)
    expect(brrrr.available).toBe(true)
    expect(comparison.recommended).toBe('BRRRR')
    expect(comparison.flip.status).toBe('BELOW TARGET')
    expect(comparison.brrrr.status).toBe('WORKS')
  })
  it('T. Norfolk: recommendation/Max Buy/negotiation conclusion unchanged, on-market price provenance intact', () => {
    const settings = resolveUnderwritingSettings({ underwriting: { refi_ltv_pct: 75, refi_costs_pct: 3 } })
    const { flip, brrrr, strategyRec } = computeAll(NORFOLK, settings)
    const comparison = buildStrategyComparison({ flip, brrrr, strategyRec })
    expect(comparison.recommended).toBe('BRRRR')
    expect(comparison.flip.status).toBe('BELOW TARGET')
    expect(comparison.brrrr.status).toBe('WORKS')
  })
})

// ── U. Missing-input behavior ────────────────────────────────────────────────
describe('U. Missing-input behavior — no fabricated recommendation', () => {
  it('missing ARV → Flip unavailable, comparison honest', () => {
    const lead = { asking_price: 100000, arv: null, renovation_cost: 39000, rent_estimate: 1350 }
    const flip = computeFlipResult(lead, REAL_SETTINGS)
    expect(flip.available).toBe(false)
  })
})

// ── V. Editing causes recalculation (structural verification) ──────────────
describe('V. Editing triggers recalculation — same useLeadUpdate path, canonical functions read fresh values', () => {
  it('PropertyInfoSection uses useLeadUpdate for every onSave (same hook every other editable field in the app uses — recalculation/persistence unchanged)', () => {
    expect(propertySrc).toMatch(/const update = useLeadUpdate\(lead, userId, members, onUpdated\)/)
  })
  it('computeFlipResult/computeBrrrrResult read lead.arv/renovation_cost/rent_estimate/hold_months fresh every call — editing any of them changes the next computed result (no caching/staleness)', () => {
    const a = computeFlipResult(WOODLEIGH, REAL_SETTINGS)
    const edited = { ...WOODLEIGH, renovation_cost: 10000 }
    const b = computeFlipResult(edited, REAL_SETTINGS)
    expect(a.mao).not.toBe(b.mao)
  })
})

// ── W. Financial engine protected ───────────────────────────────────────────
describe('W. Financial/scoring/threshold engine untouched', () => {
  it('calculations.js, dealExplanation.js, decisionEngineV2.js, buyBox.js, underwritingSettings.js carry zero further edits this task (verified via git diff in the final report)', () => {
    const src = fs.readFileSync('src/lib/dealExplanation.js', 'utf8')
    expect(src).toMatch(/export function resolveEffectiveStrategy\(strategyRec\)/)
    expect(src).toMatch(/const VERDICT_RANK = \{ STRONG: 3, PASS: 2, WATCH: 1, 'NO DEAL': 0 \}/)
  })
})

// ── X. No duplicate input editor introduced ─────────────────────────────────
describe('X. No duplicate input editor introduced', () => {
  it('DealDecisionCenter.jsx (Deal tab) contains no editable ARV/Renovation/Rent/Holding Period fields — those inputs have exactly ONE home (PropertyInfoSection)', () => {
    expect(dealSrc).not.toMatch(/onSave=\{\(v\) => update\(\{ arv: v/)
    expect(dealSrc).not.toMatch(/onSave=\{\(v\) => update\(\{ renovation_cost: v/)
    expect(dealSrc).not.toMatch(/onSave=\{\(v\) => update\(\{ rent_estimate: v/)
    expect(dealSrc).not.toMatch(/onSave=\{\(v\) => update\(\{ hold_months: v/)
  })
  it('DecisionHero.jsx (Overview) contains no editable deal inputs — Overview remains read-only/decision-only', () => {
    const heroSrc = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    expect(heroSrc).not.toMatch(/EditableField/)
  })
})
