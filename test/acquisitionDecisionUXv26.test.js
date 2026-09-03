// test/acquisitionDecisionUXv26.test.js
// HAT Investors — Lead Workspace UX V2.6 — "Canonical Strategy Comparison
// + Deal Tab Simplification"
//
// Covers Part 21's 30-item test matrix. Pure-function assertions run
// against real Woodleigh/Norfolk-shaped fixtures; DealDecisionCenter.jsx/
// DecisionHero.jsx assertions are structural (source-text), matching this
// repo's established convention (no component-mount harness exists here).
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation, resolveEffectiveStrategy } from '../src/lib/dealExplanation'
import { resolveUnderwritingSettings } from '../src/lib/underwritingSettings'
import { buildStrategyComparison, statusForResult, resolveActualOffer } from '../src/lib/acquisitionDecisionPresentation'

// Real production settings (workspace d854b1e3-…, updated 2026-08-30) —
// per this mission's own Woodleigh numbers (Rehab $50K here, not $39K —
// the mission's own example values), producing Flip BELOW TARGET / BRRRR
// WORKS at the mission's stated approximate figures.
const REAL_SETTINGS = resolveUnderwritingSettings({ underwriting: {
  refi_ltv_pct: 70, monthly_taxes: 208, hml_points_pct: 2, refi_costs_pct: 2.9,
  refi_amort_years: 30, monthly_insurance: 100, flip_selling_cost_pct: 7,
  default_holding_months: 6, refi_interest_rate_pct: 6.7, hml_rehab_financing_pct: 100,
  hml_interest_monthly_pct: 1, acquisition_closing_costs: 2450, hml_purchase_financing_pct: 90,
} })

const WOODLEIGH_MISSION = {
  address: '1963 W WOODLEIGH DR', asking_price: 100000, arv: 200000,
  renovation_cost: 50000, rent_estimate: 1350, is_distressed: true,
}
// V2.5's audited real Woodleigh fixture (Rehab $39K) — kept for continuity
// with prior regression locks; both fixtures produce a real BRRRR
// recommendation, just via different paths (tie-break vs. clean win).
const WOODLEIGH_V25 = { ...WOODLEIGH_MISSION, renovation_cost: 39000 }
const NORFOLK = { address: '9739 Norfolk Blvd', asking_price: 105000, arv: 215000, renovation_cost: 65000, rent_estimate: 1350, is_distressed: false }

function computeAll(lead, settings = REAL_SETTINGS) {
  const flip = computeFlipResult(lead, settings)
  const brrrr = computeBrrrrResult(lead, settings)
  const strategyRec = computeStrategyRecommendation(flip, brrrr)
  return { flip, brrrr, strategyRec }
}

const dealSrc = fs.readFileSync('src/components/lead-detail/workspace/DealDecisionCenter.jsx', 'utf8')
const heroSrc = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')

// ── 1–4: One canonical recommendation, comparison, default selection ───────
describe('1-4. Canonical recommendation, compact comparison, default selection', () => {
  it('1. Deal tab renders exactly ONE canonical Recommended Strategy line', () => {
    expect(dealSrc).toMatch(/Recommended Strategy<\/div>/)
    // V2.9 note (post-V2.6 legitimate fix, not a regression): buildStrategyComparison
    // now takes an additive `hasPrice` option (see acquisitionDecisionUXv25.test.js).
    expect(dealSrc).toMatch(/const comparison = buildStrategyComparison\(\{ flip, brrrr, strategyRec, hasPrice: priceKnown \}\)/)
  })
  it('2. both strategies are visible in the compact comparison (StrategyCard x2, BRRRR and FLIP)', () => {
    expect(dealSrc).toMatch(/<StrategyCard name="BRRRR"/)
    expect(dealSrc).toMatch(/<StrategyCard name="FLIP"/)
  })
  it('3. the recommended strategy is visually distinguished (isRecommended prop drives border/label)', () => {
    expect(dealSrc).toMatch(/isRecommended=\{effective === 'BRRRR'\}/)
    expect(dealSrc).toMatch(/isRecommended=\{effective === 'FLIP'\}/)
    // V2.9 note: the "— Recommended" suffix now has a "— Best Option"
    // variant for the no-price state (statusLine present) — same
    // isRecommended-driven visual distinction, honest wording for the
    // case where nothing has actually been evaluated against a price yet.
    expect(dealSrc).toMatch(/isRecommended && <span[^>]*> — \{statusLine \? 'Best Option' : 'Recommended'\}<\/span>/)
  })
  it('4. selected strategy defaults to resolveEffectiveStrategy(strategyRec) via buildStrategyComparison\'s .recommended', () => {
    expect(dealSrc).toMatch(/const active = selectedStrategy \|\| effective \|\|/)
  })
})

// ── 5–8: Strategy drill-down ─────────────────────────────────────────────
describe('5-8. Strategy drill-down — only the selected strategy\'s detail renders', () => {
  it('5/6. selecting Flip or BRRRR shows that strategy\'s detail panel (active === \'FLIP\' branch, priced case)', () => {
    // V2.9 note (post-V2.6 legitimate fix, not a regression): the ternary
    // gained a third, no-price branch ahead of it (`!priceKnown ? (...) :
    // active === 'FLIP' ? (...) : (...)`) so a lead with no evaluable
    // price yet shows an honest "Buy at $X or less" panel instead of a
    // row of "—". The priced-case FLIP/BRRRR split this test protects is
    // unchanged — still exactly one strategy's detail at a time.
    expect(dealSrc).toMatch(/\) : active === 'FLIP' \? \(/)
  })
  it('7. Flip detail (Flip Max Buy CalculationDetails, All-In Cost) is inside the active===FLIP branch only', () => {
    // V2.9 note: the second indexOf must now start searching AFTER the
    // FLIP-branch start — the new leading !priceKnown ternary branch
    // introduced an earlier ") : (" in the file that would otherwise make
    // this slice empty/negative.
    const start = dealSrc.indexOf("active === 'FLIP' ? (")
    const flipBranch = dealSrc.slice(start, dealSrc.indexOf(') : (', start))
    expect(flipBranch).toMatch(/label="Flip Max Buy"/)
    expect(flipBranch).toMatch(/label="All-In Cost"/)
  })
  it('8. BRRRR detail (BRRRR Cash Left In, Monthly Cash Flow) is inside the active!==FLIP (BRRRR) branch only', () => {
    const brrrrBranch = dealSrc.slice(dealSrc.indexOf(') : ('), dealSrc.lastIndexOf(')}\n    </div>\n  )\n}'))
    expect(brrrrBranch).toMatch(/label="BRRRR Cash Left In"/)
    expect(brrrrBranch).toMatch(/label="Monthly Cash Flow"/)
  })
})

// ── 9–14: Removed redundant sections ────────────────────────────────────
describe('9-14. Redundant/competing verdict surfaces removed from the primary Deal workflow', () => {
  it('9. no standalone "Path to a Flip Deal" section (FlipRealityCheck no longer imported/rendered)', () => {
    expect(dealSrc).not.toMatch(/import \{[^}]*FlipRealityCheck/)
    expect(dealSrc).not.toMatch(/<FlipRealityCheck/)
  })
  it('10. no standalone "Path to a BRRRR Deal" section (BrrrrRealityCheck no longer imported/rendered)', () => {
    expect(dealSrc).not.toMatch(/import \{[^}]*BrrrrRealityCheck/)
    expect(dealSrc).not.toMatch(/<BrrrrRealityCheck/)
  })
  it('11. no standalone Margin of Safety decision card (FlipMarginOfSafety no longer imported/rendered) — only a compact secondary "Margin: Thin" note inside the selected strategy detail', () => {
    expect(dealSrc).not.toMatch(/import \{[^}]*FlipMarginOfSafety/)
    expect(dealSrc).not.toMatch(/<FlipMarginOfSafety/)
    expect(dealSrc).toMatch(/Margin: Thin/)
  })
  it('12. "Test downside" is not part of the primary Deal workflow (that control lived only inside the removed FlipMarginOfSafety) — no setTestDownside/toggle button present', () => {
    expect(dealSrc).not.toMatch(/setTestDownside/)
    expect(dealSrc).not.toMatch(/>Test downside</)
  })
  it('13. "Profit cushion vs. price cushion" is not part of the primary Deal workflow (same removed component) — no toggle button present', () => {
    expect(dealSrc).not.toMatch(/setWhyOpen/)
    expect(dealSrc).not.toMatch(/Profit cushion vs\. price cushion<\/button>/)
  })
  it('14. no redundant "Best Fit" conclusion line — the one-sentence explanation now lives directly under Recommended Strategy', () => {
    expect(dealSrc).not.toMatch(/uppercase tracking-wider[^>]*>Best Fit</)
    expect(dealSrc).toMatch(/\{comparison\.explanation\}/)
  })
  it('underlying functionality preserved, not deleted — FlipMarginOfSafety/FlipRealityCheck/BrrrrRealityCheck remain fully exported from DealAnalysisCard.jsx for a future Advanced Analysis area', () => {
    const dealAnalysisCardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
    expect(dealAnalysisCardSrc).toMatch(/export function FlipMarginOfSafety/)
    expect(dealAnalysisCardSrc).toMatch(/export function FlipRealityCheck/)
    expect(dealAnalysisCardSrc).toMatch(/export function BrrrrRealityCheck/)
    expect(dealAnalysisCardSrc).toMatch(/Test downside/)
    expect(dealAnalysisCardSrc).toMatch(/Profit cushion vs\. price cushion/)
  })
})

// ── 15: strategy-specific status, never a whole-property NO DEAL ───────────
describe('15. No whole-property "NO DEAL" when one strategy qualifies', () => {
  it('statusForResult never returns a property-wide verdict word — only WORKS/BELOW TARGET/UNAVAILABLE', () => {
    expect(statusForResult({ available: true, verdict: 'STRONG' })).toBe('WORKS')
    expect(statusForResult({ available: true, verdict: 'PASS' })).toBe('WORKS')
    expect(statusForResult({ available: true, verdict: 'WATCH' })).toBe('WORKS')
    expect(statusForResult({ available: true, verdict: 'NO DEAL' })).toBe('BELOW TARGET')
    expect(statusForResult({ available: false })).toBe('UNAVAILABLE')
  })
  it('DealDecisionCenter.jsx never renders the literal string "NO DEAL" as a status', () => {
    expect(dealSrc).not.toMatch(/'NO DEAL'/)
  })
})

// ── 16–19: Overview/Deal invariants ─────────────────────────────────────
describe('16-19. Overview/Deal consistency invariants', () => {
  it('16. Overview (DecisionHero via acquisitionDecisionPresentation) and Deal (DealDecisionCenter) both resolve strategy through resolveEffectiveStrategy', () => {
    const presentationSrc = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(presentationSrc).toMatch(/resolveEffectiveStrategy\(strategyRec\)/)
    expect(dealSrc).toMatch(/buildStrategyComparison\(\{ flip, brrrr, strategyRec, hasPrice: priceKnown \}\)/)
  })
  it('17/18. Flip Max Buy and BRRRR Max Buy come from the SAME flip.mao/brrrr.mao canonical values on both surfaces (roundMaxBuy applied identically)', () => {
    expect(dealSrc).toMatch(/const displayMao = roundMaxBuy\(flip\.mao\)/)
    expect(dealSrc).toMatch(/const brrrrDisplayMao = brrrr\.available && brrrr\.mao != null \? roundMaxBuy\(brrrr\.mao\) : null/)
  })
  it('19. both DecisionHero and DealDecisionCenter receive underwritingSettings from the same LeadDetailPage.jsx resolution', () => {
    const pageSrc = fs.readFileSync('src/pages/LeadDetailPage.jsx', 'utf8')
    expect(pageSrc).toMatch(/<DecisionHero lead=\{lead\} underwritingSettings=\{underwritingSettings\} \/>/)
    expect(pageSrc).toMatch(/<DealDecisionCenter lead=\{lead\} onRunAnalysis=\{[^}]*\} underwritingSettings=\{underwritingSettings\} \/>/)
  })
  it('REGRESSION LOCK — for the mission\'s own Woodleigh numbers (Rehab $50K), buildStrategyComparison recommends the SAME strategy resolveEffectiveStrategy alone would produce', () => {
    const { flip, brrrr, strategyRec } = computeAll(WOODLEIGH_MISSION)
    const comparison = buildStrategyComparison({ flip, brrrr, strategyRec })
    expect(comparison.recommended).toBe(resolveEffectiveStrategy(strategyRec) === 'NONE' ? null : resolveEffectiveStrategy(strategyRec))
  })
})

// ── 20/21: Woodleigh mission numbers ────────────────────────────────────
describe('20-21. Woodleigh (mission\'s own numbers: ARV $200K, Rehab $50K, Rent $1,350) — BRRRR recommended, Flip below target', () => {
  const { flip, brrrr, strategyRec } = computeAll(WOODLEIGH_MISSION)
  const comparison = buildStrategyComparison({ flip, brrrr, strategyRec })
  it('20. BRRRR is recommended and WORKS, with Max Buy/Cash Left In/Cash Flow in the mission\'s approximate range', () => {
    expect(comparison.recommended).toBe('BRRRR')
    expect(comparison.brrrr.status).toBe('WORKS')
    expect(Math.round(comparison.brrrr.maxBuy / 100)).toBeCloseTo(1004, 0) // ~$100,400
    expect(brrrr.cashLeftIn).toBeLessThan(35000)
    expect(brrrr.cashLeftIn).toBeGreaterThan(20000)
    expect(brrrr.monthlyCashFlow).toBeGreaterThan(0)
  })
  it('21. Flip is BELOW TARGET at the evaluation price, with a real Max Buy the explanation names', () => {
    expect(comparison.flip.status).toBe('BELOW TARGET')
    expect(flip.projectedProfit).toBeLessThan(flip.targetProfit)
    expect(Math.round(comparison.flip.maxBuy / 100)).toBeCloseTo(911, 0) // ~$91,100
    expect(comparison.explanation).toMatch(/BRRRR meets HAT's requirements/)
    expect(comparison.explanation).toMatch(/Flip would require a purchase price of approximately/)
  })
})

// ── 22: Norfolk regression ──────────────────────────────────────────────
describe('22. Norfolk regression — unaffected by V2.6', () => {
  it('still resolves BRRRR as preferred at 75% LTV settings, unchanged from V2.1-V2.5', () => {
    const settings = resolveUnderwritingSettings({ underwriting: { refi_ltv_pct: 75, refi_costs_pct: 3 } })
    const { flip, brrrr, strategyRec } = computeAll(NORFOLK, settings)
    const comparison = buildStrategyComparison({ flip, brrrr, strategyRec })
    expect(comparison.recommended).toBe('BRRRR')
    expect(comparison.flip.status).toBe('BELOW TARGET')
    expect(comparison.brrrr.status).toBe('WORKS')
  })
})

// ── 23-27: price provenance preserved ───────────────────────────────────
describe('23-27. Price provenance preserved from V2.3-V2.5', () => {
  it('23. off-market/no seller price: DealDecisionCenter labels the price "Evaluation Price", never "Seller Asking"', () => {
    expect(dealSrc).toMatch(/const priceLabel = isOffMarket \? \(genuineSellerAsking != null \? 'Seller Asking' : 'Evaluation Price'\) : 'Asking Price'/)
  })
  it('24. real seller-price provenance uses getSellerIntelligence(lead).seller_asking_price only', () => {
    expect(dealSrc).toMatch(/import \{ getSellerIntelligence \} from '\.\.\/\.\.\/\.\.\/lib\/sellerStrategy'/)
    expect(dealSrc).toMatch(/const genuineSellerAsking = isOffMarket \? getSellerIntelligence\(lead\)\.seller_asking_price : null/)
  })
  it('25. actual-offer provenance (resolveActualOffer) is untouched by this task', () => {
    const off = resolveActualOffer({ offer_price: 97000 })
    expect(off.amount).toBe(97000)
    expect(off.source).toBe('offer_price')
  })
  it('26. Suggested Offer never becomes "Our Offer" — DealDecisionCenter labels flip.currentOffer "Suggested Offer"', () => {
    expect(dealSrc).toMatch(/label="Suggested Offer"/)
    expect(dealSrc).not.toMatch(/label="We Offer"/)
    expect(dealSrc).not.toMatch(/label="Our Offer"/)
  })
  it('27. Max Buy is never presented as an opening offer — no 70%/80% MAO-discount formula introduced', () => {
    expect(dealSrc).not.toMatch(/mao \* 0\.[78]/)
    expect(dealSrc).not.toMatch(/displayMao \* 0\.[78]/)
    expect(dealSrc).not.toMatch(/openingOffer/i)
  })
})

// ── 28-30: strategy combinations ────────────────────────────────────────
describe('28-30. Strategy combination handling', () => {
  it('28. missing ARV → no fabricated recommendation (flip unavailable, comparison honest)', () => {
    const lead = { asking_price: 100000, arv: null, renovation_cost: 39000, rent_estimate: 1350 }
    const flip = computeFlipResult(lead, REAL_SETTINGS)
    expect(flip.available).toBe(false)
  })
  it('29. both work → comparison reports WORKS/WORKS with a real preferred strategy, never "BOTH" as a status', () => {
    // Woodleigh at 75% LTV (this workspace's alternate tested setting) has
    // both strategies genuinely clearing target.
    const settings = resolveUnderwritingSettings({ underwriting: { refi_ltv_pct: 75, refi_costs_pct: 3 } })
    const { flip, brrrr, strategyRec } = computeAll(WOODLEIGH_V25, settings)
    if (flip.available && brrrr.available && flip.verdict !== 'NO DEAL' && brrrr.verdict !== 'NO DEAL') {
      const comparison = buildStrategyComparison({ flip, brrrr, strategyRec })
      expect(comparison.flip.status).toBe('WORKS')
      expect(comparison.brrrr.status).toBe('WORKS')
      expect(['FLIP', 'BRRRR']).toContain(comparison.recommended)
    }
  })
  it('30. neither works → both BELOW TARGET/UNAVAILABLE, comparison recommends null with an honest explanation', () => {
    const lead = { asking_price: 250000, arv: 260000, renovation_cost: 40000, rent_estimate: 800 }
    const { flip, brrrr, strategyRec } = computeAll(lead)
    const comparison = buildStrategyComparison({ flip, brrrr, strategyRec })
    expect(comparison.recommended).toBeNull()
    expect(comparison.explanation).toMatch(/Neither strategy currently meets HAT's requirements/)
  })
})

// ── Financial/scoring/threshold isolation ───────────────────────────────
describe('Financial/scoring/threshold isolation', () => {
  it('calculations.js, decisionEngineV2.js, buyBox.js, underwritingSettings.js, dealExplanation.js untouched this task — dealExplanation.js already carried the one V2.5-approved additive change, no further edits', () => {
    const src = fs.readFileSync('src/lib/dealExplanation.js', 'utf8')
    expect(src).toMatch(/export function resolveEffectiveStrategy\(strategyRec\)/)
    expect(src).toMatch(/const VERDICT_RANK = \{ STRONG: 3, PASS: 2, WATCH: 1, 'NO DEAL': 0 \}/)
  })
  it('Woodleigh (mission numbers) golden Flip/BRRRR figures reproduce exactly what the mission itself describes', () => {
    const { flip, brrrr } = computeAll(WOODLEIGH_MISSION)
    expect(Math.round(flip.mao / 100)).toBeCloseTo(911, 0)
    expect(Math.round(brrrr.mao / 100)).toBeCloseTo(1004, 0)
  })
})
