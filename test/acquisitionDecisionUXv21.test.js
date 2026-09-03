// test/acquisitionDecisionUXv21.test.js
// Lead Workspace UX V2.1 — ONE decision, ONE price target, no
// contradictory messaging (2026-08-31).
//
// Confirmed real defect: the primary hero correctly recommended
// negotiating toward BRRRR's target, but two other surfaces on the SAME
// Overview independently recomputed a Flip-only gap/verdict — Deal
// Safety literally said "NO DEAL" and Next Best Action said "Seller is
// $15,959 above Flip Max Buy" — directly contradicting the primary
// "negotiate toward ~$95K" recommendation. Fixed by making every
// consumer resolve its price target through the SAME strategy-aware
// helpers (resolveTargetPrice/resolvePrimaryPriceGap,
// acquisitionDecisionPresentation.js) instead of each independently
// defaulting to Flip.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../src/lib/dealExplanation.js'
import { deriveAcquisitionDecision, resolvePrimaryPriceGap, buildStrategyLine } from '../src/lib/acquisitionDecisionPresentation.js'
import { getDealReadiness } from '../src/components/lead-detail/workspace/readiness.js'

const NORFOLK = { asking_price: 105000, arv: 215000, renovation_cost: 65000, rent_estimate: 1350, hold_months: 6 }
const WOODLEIGH = { asking_price: 100000, arv: 200000, renovation_cost: 39000, rent_estimate: 1350, hold_months: 6 }

function decide(lead, extra = {}) {
  const flip = computeFlipResult(lead)
  const brrrr = computeBrrrrResult(lead)
  const strategyRec = computeStrategyRecommendation(flip, brrrr)
  const readiness = getDealReadiness(lead)
  return { decision: deriveAcquisitionDecision({ flip, brrrr, strategyRec, readiness, lead, ...extra }), flip, brrrr, strategyRec }
}

// ── A. Norfolk — primary contradiction proof ───────────────────────────────
describe('A. Norfolk — primary = NEGOTIATE, target = BRRRR Max Buy, no Flip contradiction', () => {
  const { decision, flip, brrrr } = decide(NORFOLK)
  it('primary state is NEGOTIATE', () => { expect(decision.state).toBe('NEGOTIATE') })
  it('preferred strategy is BRRRR', () => { expect(decision.targetStrategy).toBe('BRRRR') })
  it('primary target is BRRRR Max Buy (~$94,671), not Flip Max Buy (~$89,041)', () => {
    expect(decision.targetLabel).toBe('BRRRR Max Buy')
    expect(Math.round(decision.targetPrice)).toBe(Math.round(brrrr.mao))
    expect(Math.round(decision.targetPrice)).not.toBe(Math.round(flip.mao))
  })
  it('gap is based on BRRRR Max Buy (~$10,329), not the old Flip-based ~$15,959', () => {
    const expectedGap = Math.abs(Math.round(105000 - brrrr.mao))
    expect(decision.gap).toBe(expectedGap)
    expect(decision.gap).not.toBe(Math.abs(Math.round(105000 - flip.mao)))
  })
  it('Next Best Action (ActionZone.smartHint via resolvePrimaryPriceGap) uses the SAME BRRRR target as the primary hero', () => {
    const strategyRec = computeStrategyRecommendation(flip, brrrr)
    const gap = resolvePrimaryPriceGap({ flip, brrrr, strategyRec })
    expect(gap.targetLabel).toBe('BRRRR Max Buy')
    expect(gap.gap).toBe(decision.gap)
  })
  it('Flip Max Buy remains available but presented as secondary, factual detail — never a competing "NO DEAL" headline', () => {
    expect(decision.secondaryStrategy).not.toBeNull()
    expect(decision.secondaryStrategy.strategy).toBe('FLIP')
    expect(decision.secondaryStrategy.detail).toMatch(/Flip requires approximately/)
    expect(decision.secondaryStrategy.headline).not.toMatch(/^NO DEAL$/)
  })
  it('no primary "NO DEAL" contradiction: the primary decision headline is never the raw internal verdict word', () => {
    expect(decision.headline).not.toMatch(/NO DEAL/)
    expect(decision.headline).toBe('NEGOTIATE — WORTH PURSUING')
  })
})

// ── B. Woodleigh ────────────────────────────────────────────────────────────
describe('B. Woodleigh — primary display = WITHIN BUY RANGE, Flip Max Buy canonical, thin margin available as secondary', () => {
  const { decision } = decide(WOODLEIGH)
  it('primary display is WITHIN BUY RANGE, not GOOD AT ASKING or WATCH', () => {
    expect(decision.headline).toBe('WITHIN BUY RANGE')
    expect(decision.headline).not.toMatch(/GOOD AT ASKING|WATCH/)
  })
  it('BRRRR Max Buy is the canonical target — UX V2.5, Part 2 fix: at these default settings, computeStrategyRecommendation genuinely ranks BRRRR ahead of Flip in a "BOTH WORK" tie (fr/br comparison), but the exposure bug being fixed in V2.5 (preferredStrategy collapsing to the literal string \'BOTH\' with the real winner only in `summary` text) previously caused every consumer to silently default back to Flip regardless. This assertion was itself wrong before that fix — see dealExplanation.js\'s resolveEffectiveStrategy.', () => {
    expect(decision.targetLabel).toBe('BRRRR Max Buy')
  })
  it('the underlying WATCH verdict tier is untouched at the engine level (flip.verdict), only its Overview exposure changed', () => {
    const flip = computeFlipResult(WOODLEIGH)
    expect(flip.verdict).toBe('WATCH')
  })
})

// ── C/D. Flip-preferred vs BRRRR-preferred negotiate cases ─────────────────
describe('C/D. Primary target always follows preferred strategy, in both directions', () => {
  it('C. Flip-preferred negotiate case: primary target uses Flip Max Buy', () => {
    // High ask relative to ARV so Flip fails at ask but BRRRR is unavailable (no rent) → Flip is the only/preferred strategy.
    const lead = { asking_price: 160000, arv: 220000, renovation_cost: 20000, hold_months: 6 } // no rent_estimate
    const { decision } = decide(lead)
    if (decision.state === 'NEGOTIATE') {
      expect(decision.targetLabel).toBe('Flip Max Buy')
    }
  })
  it('D. BRRRR-preferred negotiate case (Norfolk): primary target uses BRRRR Max Buy', () => {
    const { decision } = decide(NORFOLK)
    expect(decision.state).toBe('NEGOTIATE')
    expect(decision.targetLabel).toBe('BRRRR Max Buy')
  })
})

// ── E/F/G. PASS / NEEDS RESEARCH regressions ───────────────────────────────
describe('E/F/G. PASS and NEEDS RESEARCH regressions unaffected by the V2.1 changes', () => {
  it('E. true PASS (NOT_FIT) remains PASS', () => {
    const { decision } = decide(NORFOLK, { fit: { status: 'NOT_FIT' } })
    expect(decision.state).toBe('PASS')
  })
  it('F. missing ARV → NEEDS RESEARCH', () => {
    const { decision } = decide({ asking_price: 100000, renovation_cost: 20000 })
    expect(decision.state).toBe('NEEDS_RESEARCH')
  })
  it('G. missing rehab → NEEDS RESEARCH', () => {
    const { decision } = decide({ asking_price: 100000, arv: 200000 })
    expect(decision.state).toBe('NEEDS_RESEARCH')
  })
})

// ── H. Off-market incomplete economics ─────────────────────────────────────
describe('H. Off-market seller opportunity with incomplete economics never becomes a fake deal approval', () => {
  it('a lead with no ARV/asking (off-market, pre-underwriting) resolves NEEDS_RESEARCH, not PASS/NEGOTIATE/WITHIN BUY RANGE', () => {
    const lead = { is_distressed: true }
    const flip = computeFlipResult(lead)
    const brrrr = computeBrrrrResult(lead)
    const strategyRec = computeStrategyRecommendation(flip, brrrr)
    const readiness = getDealReadiness(lead)
    const decision = deriveAcquisitionDecision({ flip, brrrr, strategyRec, readiness, lead })
    expect(decision.state).toBe('NEEDS_RESEARCH')
    expect(decision.state).not.toBe('PASS')
  })
})

// ── I. Price-label integrity ────────────────────────────────────────────────
describe('I. No bare "Max Buy" on primary surfaces where the strategy is known', () => {
  it('LeadEssentialsBar.jsx labels the header Max Buy by effective preferred strategy (UX V2.5, Part 2: resolveEffectiveStrategy, not a bare preferredStrategy check)', () => {
    const src = fs.readFileSync('src/components/lead-detail/LeadEssentialsBar.jsx', 'utf8')
    expect(src).toMatch(/effectiveStrategy === 'BRRRR' \? 'BRRRR Max Buy' : 'Flip Max Buy'/)
    expect(src).not.toMatch(/label="Max Buy"/)
  })
  it('DealSnapshotCompact.jsx no longer duplicates Max Buy/Suggested Offer — UX V2.5, Part 9/10: collapsed to ARV/Rehab/Rent, full economics live only on the Deal tab now (avoids a FOURTH independent Max Buy/strategy computation site)', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/DealSnapshotCompact.jsx', 'utf8')
    expect(src).not.toMatch(/^import \{ [^}]*computeFlipResult/m)
    expect(src).toMatch(/Open Deal Analysis/)
  })
})

// ── J/K/L. Financial/scoring/threshold isolation ───────────────────────────
describe('J/K/L. Financial engine, Decision V2 scoring, and thresholds are completely unchanged', () => {
  it('J. canonical Flip/BRRRR outputs for Norfolk/Woodleigh are identical to their known golden values', () => {
    const nFlip = computeFlipResult(NORFOLK)
    const nBrrrr = computeBrrrrResult(NORFOLK)
    expect(Math.round(nFlip.mao)).toBe(89041)
    expect(Math.round(nBrrrr.mao)).toBe(94671)
    const wFlip = computeFlipResult(WOODLEIGH)
    expect(Math.round(wFlip.mao)).toBe(102222)
    expect(wFlip.projectedProfit).toBe(32382)
  })
  it('K. decisionEngineV2.js carries no edit markers from this task', () => {
    const src = fs.readFileSync('src/lib/decisionEngineV2.js', 'utf8')
    expect(src).not.toMatch(/UX V2\.1/)
  })
  it('L. dealExplanation.js/calculations.js verdict thresholds unchanged', () => {
    const dealExpSrc = fs.readFileSync('src/lib/dealExplanation.js', 'utf8')
    expect(dealExpSrc).toMatch(/if \(profitAtEvaluationPrice >= FLIP_STRONG_PROFIT\) verdict = 'STRONG'/)
    const calcSrc = fs.readFileSync('src/lib/calculations.js', 'utf8')
    expect(calcSrc).toMatch(/export const FLIP_MIN_PROFIT_TARGET = 30000/)
    expect(calcSrc).not.toMatch(/UX V2\.1/)
  })
})

// ── Part 6 — strategy comparison hierarchy ─────────────────────────────────
describe('Strategy comparison: preferred visually dominant, alternative secondary', () => {
  it('DecisionHero.jsx renders a one-line strategy summary, with a secondary "Alternative" line only when both strategies were genuinely evaluated (V2.4: simplified from an equal-weight comparison box to one primary + one small optional line)', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    expect(src).toMatch(/Recommended Strategy/)
    expect(src).toMatch(/decision\?\.strategyLine\?\.headline === 'BOTH STRATEGIES WORK' && flip\.available && brrrr\.available/)
    expect(src).toMatch(/Alternative:/)
  })
  it('buildStrategyLine still reports BOTH/FLIP-ONLY/BRRRR-ONLY exactly as before (untouched by V2.1)', () => {
    const flip = computeFlipResult(NORFOLK)
    const brrrr = computeBrrrrResult(NORFOLK)
    const line = buildStrategyLine({ flip, brrrr, strategyRec: computeStrategyRecommendation(flip, brrrr), preferBrrrr: true })
    expect(line.headline).toBe('BOTH STRATEGIES WORK')
  })
})

// ── Deal Safety no longer exposes raw verdict when it's the secondary strategy
describe('Deal Safety presentation: raw internal verdict never shown when that strategy is secondary', () => {
  it('DecisionHero.jsx only shows the raw Flip verdict badge when Flip is the primary/preferred strategy', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    // V2.9 note (post-V2.6 legitimate fix, not a regression): also gated
    // behind `!decision?.priceUnknown` now — Margin of Safety is a
    // question about a specific PRICE, so it's honestly hidden when there
    // is no price yet to have a margin against (e.g. off-market with no
    // seller price recorded). The Flip-vs-BRRRR gating this test protects
    // is unchanged.
    expect(src).toMatch(/flip\.available && !decision\?\.priceUnknown && decision\?\.targetStrategy !== 'BRRRR'/)
    expect(src).toMatch(/decision\?\.targetStrategy === 'BRRRR' && decision\.secondaryStrategy/)
  })
})
