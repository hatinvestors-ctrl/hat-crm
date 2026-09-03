// test/demoStabilization.test.js
// Demo Stabilization — Deal Page UX/Consistency audit + safe presentation
// fixes only. Golden Test Lead: 1963 W WOODLEIGH DR (asking $100,000, ARV
// $200,000, reno $39,000, hold 6mo, rent missing). Locks in the EXACT
// canonical financial outputs so any future accidental formula change is
// caught — this file never recomputes or reimplements those formulas,
// only calls the same canonical functions every other surface already uses.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../src/lib/dealExplanation.js'
import { roundMaxBuy } from '../src/lib/calculations.js'
import { statusForResult } from '../src/lib/acquisitionDecisionPresentation.js'

const GOLDEN_LEAD = { asking_price: 100000, arv: 200000, renovation_cost: 39000, hold_months: 6, rent_estimate: null }

const dealAnalysisCardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
const dealDecisionCenterSrc = fs.readFileSync('src/components/lead-detail/workspace/DealDecisionCenter.jsx', 'utf8')
const financialSectionSrc = fs.readFileSync('src/components/lead-detail/FinancialSection.jsx', 'utf8')
const propertyInfoSrc = fs.readFileSync('src/components/lead-detail/PropertyInfoSection.jsx', 'utf8')
const dealExplanationSrc = fs.readFileSync('src/lib/dealExplanation.js', 'utf8')
const calculationsSrc = fs.readFileSync('src/lib/calculations.js', 'utf8')

// ── Golden Lead financial outputs — UNCHANGED, canonical engine only ────
describe('Golden Lead (1963 W Woodleigh Dr) — canonical financial outputs are exactly preserved', () => {
  const flip = computeFlipResult(GOLDEN_LEAD)

  it('Max Buy (Flip), rounded — $102,200', () => {
    expect(roundMaxBuy(flip.mao)).toBe(102200)
  })
  it('Max Buy raw is ~$102,222.01 — the exact source of the "$2,222" figure', () => {
    expect(flip.mao).toBeCloseTo(102222.01, 1)
  })
  it('Projected Profit — $32,382', () => {
    expect(flip.projectedProfit).toBe(32382)
  })
  it('All-In Cost — $153,618', () => {
    expect(flip.breakdown.allIn).toBe(153618)
  })
  it('Verdict — WATCH (thin margin of safety), unchanged threshold behavior', () => {
    expect(flip.verdict).toBe('WATCH')
  })
  it('current offer / evaluation price — both $100,000 (asking price, raw, unrounded)', () => {
    expect(flip.currentOffer).toBe(100000)
    expect(flip.evaluationPrice).toBe(100000)
  })
  it('price cushion (Max Buy − current price) — raw $2,222.01, matching the canonical marginOfSafety.priceCushion untouched', () => {
    expect(flip.marginOfSafety.priceCushion).toBeCloseTo(2222.01, 1)
  })
  it('profit cushion (Projected Profit − $30K target) — $2,382, a DIFFERENT number from price cushion by design (purchase price also moves financing/holding costs)', () => {
    expect(flip.marginOfSafety.profitCushion).toBe(2382)
    expect(Math.round(flip.marginOfSafety.profitCushion)).not.toBe(Math.round(flip.marginOfSafety.priceCushion))
  })
  it('BRRRR is genuinely unavailable (missing rent), not evaluated — never silently defaulted', () => {
    const brrrr = computeBrrrrResult(GOLDEN_LEAD)
    expect(brrrr.available).toBe(false)
    expect(brrrr.reason).toMatch(/rent estimate is missing/i)
  })
  it('strategy recommendation is FLIP-preferred because BRRRR was never evaluated — computeStrategyRecommendation itself is untouched and cannot distinguish "lost" from "never evaluated"', () => {
    const flip2 = computeFlipResult(GOLDEN_LEAD)
    const brrrr = computeBrrrrResult(GOLDEN_LEAD)
    const rec = computeStrategyRecommendation(flip2, brrrr)
    expect(rec.preferredStrategy).toBe('FLIP')
    expect(rec.summary).toBe('BEST EXIT: FLIP')
  })
})

// ── Part 2 — $2,200 vs $2,222 fix (DealAnalysisCard sentence only) ─────
describe('Part 2 — the DealAnalysisCard "you are currently $X below Max Buy" sentence now matches the rounded headline above it', () => {
  it('uses roundMaxBuy(flipMao), the SAME rounding the headline uses, not the raw value', () => {
    expect(dealAnalysisCardSrc).toMatch(/fc\(roundMaxBuy\(flipMao\) - currentPP\)/)
    expect(dealAnalysisCardSrc).toMatch(/fc\(currentPP - roundMaxBuy\(flipMao\)\)/)
  })
  it('roundMaxBuy is imported from calculations.js, not reimplemented locally', () => {
    expect(dealAnalysisCardSrc).toMatch(/describeCashLeftIn, roundMaxBuy,\s*\n\} from '\.\.\/\.\.\/lib\/calculations'/)
  })
  it('computed value matches the golden lead: roundMaxBuy(flip.mao) - currentOffer === 2200, not 2222', () => {
    const flip = computeFlipResult(GOLDEN_LEAD)
    expect(roundMaxBuy(flip.mao) - flip.evaluationPrice).toBe(2200)
  })
})

// ── Part 3 — profit cushion vs price cushion (already correctly labeled) ──
describe('Part 3 — profit cushion and price cushion are already correctly distinguished (no change needed, verified)', () => {
  it('FlipMarginOfSafety shows an explicit "Profit cushion vs. price cushion" explainer when the two differ', () => {
    expect(dealAnalysisCardSrc).toMatch(/Profit cushion vs\. price cushion/)
    expect(dealAnalysisCardSrc).toMatch(/not always the same as the price cushion shown above, since purchase price also moves financing\/holding costs/)
  })
  // UX V2.8 supersedes the original form of this assertion. The guarantee
  // it protected was "a price gap and a profit shortfall must never be
  // blurred into one ambiguous 'gap' number in Comps Intelligence." V2.8
  // removed BOTH numbers from that card entirely (they are acquisition
  // conclusions owned by Overview/Deal, not comparable-market evidence),
  // which satisfies the guarantee in the strongest possible way — there is
  // no gap label left to be ambiguous. Asserted as an absence so the
  // duplication cannot silently return. The equivalent positive assertion
  // for the surface that DOES own these two numbers (FlipMarginOfSafety's
  // "Profit cushion vs. price cushion" explainer) is unchanged above.
  it('ComplsIntelligenceCard no longer shows any price-gap or profit-shortfall number — those acquisition conclusions live in Overview/Deal (UX V2.8)', () => {
    // Comments stripped: the file header documents what V2.8 removed, and
    // that documentation must not read as the markup still being there.
    const src = fs.readFileSync('src/components/lead-detail/workspace/ComplsIntelligenceCard.jsx', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
    expect(src).not.toMatch(/Seller Gap to Max Buy/)
    expect(src).not.toMatch(/Room to Max Buy/)
    expect(src).not.toMatch(/Profit Shortfall to Target/)
  })
})

// ── Part 4 — no unsupported "Best Fit Flip" when BRRRR was never evaluated ──
describe('Part 4 — "Best Fit" never implies BRRRR was compared and lost when it was never evaluated', () => {
  it('UX V2.6 — the standalone "Best Fit" line was removed entirely (Part 10: redundant with the canonical Recommended Strategy line); the underlying honesty guarantee this test protects (never implying BRRRR was compared and lost when it was never evaluated) is now enforced by buildStrategyComparison\'s UNAVAILABLE status + explanation text instead', () => {
    expect(dealDecisionCenterSrc).not.toMatch(/text-\[color:var\(--color-accent-text\)\]">Best Fit</)
    expect(dealDecisionCenterSrc).not.toMatch(/uppercase tracking-wider[^>]*>Best Fit</)
    const presentationSrc = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(presentationSrc).toMatch(/return 'UNAVAILABLE'/)
  })
  it('an unevaluated strategy shows status UNAVAILABLE, never a false "compared and lost" implication', () => {
    expect(statusForResult({ available: false })).toBe('UNAVAILABLE')
  })
  it('computeStrategyRecommendation itself is untouched — the fix is presentation-only', () => {
    expect(dealExplanationSrc).toMatch(/if \(flipOk && !brrrrOk\) \{\s*return \{ preferredStrategy: 'FLIP', summary: 'BEST EXIT: FLIP', reason: null \}/)
  })
  it('for the Golden Lead specifically, only FLIP is evaluated, so the new branch fires, not "Best Fit"', () => {
    const flip = computeFlipResult(GOLDEN_LEAD)
    const brrrr = computeBrrrrResult(GOLDEN_LEAD)
    expect(flip.available).toBe(true)
    expect(brrrr.available).toBe(false)
  })
})

// ── Part 5 — off-market price terminology, presentation-only ────────────
describe('Part 5 — off-market/distressed leads never claim a verified seller asking price', () => {
  it('FinancialSection labels the price cell "Evaluation Price" for distressed leads, "Asking" for on-market — same field, same save path', () => {
    expect(financialSectionSrc).toMatch(/isDistressedLead\(lead\) \? 'Evaluation Price' : 'Asking'/)
    expect(financialSectionSrc).toMatch(/onSave=\{\(v\) => update\(\{ asking_price: v \}\)\}/)
  })
  it('PropertyInfoSection labels the warning box "Evaluation Price" for distressed leads, "Seller\'s Asking Price" for on-market', () => {
    expect(propertyInfoSrc).toMatch(/isDistressedLead\(lead\) \? 'Evaluation Price' : "Seller's Asking Price"/)
  })
  it('DealDecisionCenter secondary line uses market-aware price provenance — UX V2.6 replaced "Evaluating at"/"Seller asks" with the more precise Evaluation Price/Seller Asking/Asking Price labels already established in V2.3–V2.5 (resolveMarketType + getSellerIntelligence, not a new resolver)', () => {
    expect(dealDecisionCenterSrc).toMatch(/const priceLabel = isOffMarket \? \(genuineSellerAsking != null \? 'Seller Asking' : 'Evaluation Price'\) : 'Asking Price'/)
    expect(dealDecisionCenterSrc).toMatch(/import \{ isDistressedLead, resolveMarketType \} from '\.\.\/\.\.\/\.\.\/lib\/distressInfo'/)
  })
  it('the NO_ASKING_PRICE error message is also distressed-aware', () => {
    expect(dealAnalysisCardSrc).toMatch(/Please fill in the Evaluation Price before generating AI analysis\./)
  })
  it('lead.asking_price itself is never renamed/migrated — same field, same column, same onSave everywhere', () => {
    expect(financialSectionSrc).toMatch(/value=\{lead\.asking_price\}/)
    expect(propertyInfoSrc).toMatch(/value=\{lead\.asking_price\}/)
  })
})

// ── Part 6 — "Legacy data" label, presentation-only ──────────────────────
describe('Part 6 — "Legacy data" toggle only labels itself that way when a legacy value genuinely exists', () => {
  it('when storedMao is null (nothing stored), the toggle says "Advanced" instead of "Legacy data"', () => {
    expect(financialSectionSrc).toMatch(/storedMao != null \? 'Legacy data' : 'Advanced'/)
  })
  it('the toggle remains collapsed by default (showLegacyMao starts false) — unchanged behavior', () => {
    expect(financialSectionSrc).toMatch(/const \[showLegacyMao, setShowLegacyMao\] = useState\(false\)/)
  })
  it('lead.mao is confirmed, by the file\'s own existing comment, to never feed profit/verdict/Margin of Safety/offer generation', () => {
    expect(financialSectionSrc).toMatch(/never read lead\.mao at/)
    expect(financialSectionSrc).toMatch(/they all call calculateFlipMAO fresh/)
  })
})

// ── Part 7 — WATCH / Margin of Safety wording unchanged ─────────────────
describe('Part 7 — WATCH verdict and its explanation are untouched, correspond to the real result', () => {
  it('the Golden Lead genuinely produces WATCH with the documented thin-margin explanation', () => {
    const flip = computeFlipResult(GOLDEN_LEAD)
    expect(flip.verdict).toBe('WATCH')
    expect(flip.marginOfSafety.title).toBe('Thin margin of safety')
  })
})

// ── Part 10 — diff safety audit: protected files/thresholds untouched ───
describe('Part 10 — protected financial logic confirmed untouched', () => {
  it('dealExplanation.js still exports computeFlipResult/computeBrrrrResult/computeStrategyRecommendation with unchanged core branches', () => {
    expect(dealExplanationSrc).toMatch(/export function computeFlipResult/)
    expect(dealExplanationSrc).toMatch(/export function computeBrrrrResult/)
    expect(dealExplanationSrc).toMatch(/export function computeStrategyRecommendation/)
  })
  it('calculations.js still exports the same FLIP_MIN_PROFIT_TARGET/FLIP_STRONG_PROFIT/BRRRR_MAX_CASH_LEFT_IN constants (values unchanged, spot-checked via the golden lead $30K target)', () => {
    expect(calculationsSrc).toMatch(/export const FLIP_MIN_PROFIT_TARGET/)
    expect(calculationsSrc).toMatch(/export const FLIP_STRONG_PROFIT/)
    expect(calculationsSrc).toMatch(/export const BRRRR_MAX_CASH_LEFT_IN/)
  })
  it('roundMaxBuy — the one calculations.js helper newly reused in DealAnalysisCard.jsx — is unchanged math (round to nearest $100), not a new formula', () => {
    expect(calculationsSrc).toMatch(/export function roundMaxBuy\(value\) \{\s*if \(value == null \|\| Number\.isNaN\(Number\(value\)\)\) return null\s*return Math\.round\(Number\(value\) \/ 100\) \* 100\s*\}/)
  })
})
