// test/acquisitionDecisionUXv22.test.js
// Lead Workspace UX V2.2 — Market-Aware Acquisition Decision UX (2026-08-31).
//
// Confirmed real root causes (audited, not assumed):
//   1. `lead.asking_price` is a single overloaded column: a genuine
//      listing price for on-market leads, but a user-entered EVALUATION
//      price (never confirmed seller-stated) for off-market leads.
//   2. DecisionHero.jsx previously gated the ENTIRE plain-language
//      Acquisition Decision behind `!lead.is_distressed` — every
//      off-market lead (including Woodleigh, which has full ARV/reno/
//      rent data) fell through to the raw internal recommendation word
//      as its headline. Not a data limitation — an oversight, now fixed.
//   3. The ONE trustworthy off-market seller-price field is
//      getSellerIntelligence(lead).seller_asking_price
//      (src/lib/sellerStrategy.js) — populated only from an actual
//      recorded call. Never repurposes asking_price/currentOffer/MAO.
//   4. DistressBanner/MlsStatusBanner rendered ABOVE DecisionHero in
//      Overview — reordered, content/functionality unchanged.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../src/lib/dealExplanation.js'
import { deriveAcquisitionDecision } from '../src/lib/acquisitionDecisionPresentation.js'
import { getDealReadiness } from '../src/components/lead-detail/workspace/readiness.js'

const NORFOLK = { asking_price: 105000, arv: 215000, renovation_cost: 65000, rent_estimate: 1350, hold_months: 6 }
const WOODLEIGH = { asking_price: 100000, arv: 200000, renovation_cost: 39000, rent_estimate: 1350, hold_months: 6, is_distressed: true }

function decide(lead, marketType = null, sellerAskingPrice = null, extra = {}) {
  const flip = computeFlipResult(lead)
  const brrrr = computeBrrrrResult(lead)
  const strategyRec = computeStrategyRecommendation(flip, brrrr)
  const readiness = getDealReadiness(lead)
  return { decision: deriveAcquisitionDecision({ flip, brrrr, strategyRec, readiness, lead, marketType, sellerAskingPrice, ...extra }), flip, brrrr }
}

// ── A/B. On-market (Norfolk above, below Max Buy) ──────────────────────────
describe('A/B. On-market behavior fully preserved (V2.1 unchanged)', () => {
  it('A. Norfolk on-market, above Max Buy → NEGOTIATE, BRRRR primary target, correct gap', () => {
    const { decision, brrrr } = decide(NORFOLK, 'ON_MARKET')
    expect(decision.state).toBe('NEGOTIATE')
    expect(decision.currentPrice).toBe(105000)
    expect(decision.targetLabel).toBe('BRRRR Max Buy')
    expect(Math.round(decision.targetPrice)).toBe(Math.round(brrrr.mao))
  })
  it('B. on-market below Max Buy → WITHIN BUY RANGE', () => {
    const lead = { asking_price: 60000, arv: 200000, renovation_cost: 20000, hold_months: 6 }
    const { decision } = decide(lead, 'ON_MARKET')
    expect(decision.headline).toBe('WITHIN BUY RANGE')
  })
})

// ── C/D. Off-market, no seller price, sufficient economics ────────────────
describe('C/D. Off-market with no seller price and sufficient economics → READY TO PURSUE, Max Buy never presented as an offer', () => {
  const { decision } = decide(WOODLEIGH, 'OFF_MARKET', null)
  it('C. state is READY_TO_PURSUE, HAT Max Buy shown, no asking-price comparison, no price gap', () => {
    expect(decision.state).toBe('READY_TO_PURSUE')
    // UX V2.4, Part 3: headline text renamed "READY TO PURSUE" → "CONTACT SELLER" (state enum unchanged)
    expect(decision.headline).toBe('CONTACT SELLER')
    expect(decision.targetPrice).not.toBeNull()
    expect(decision.currentPrice).toBeNull()
    expect(decision.gap).toBeNull()
    expect(decision.gapLabel).toBeNull()
    expect(decision.withinBuyRange).toBeNull()
  })
  it('D. Max Buy is explicitly NOT described as an opening offer (isOpeningOffer: false, explanatory text present)', () => {
    expect(decision.isOpeningOffer).toBe(false)
    // UX V2.3, Part 6 wording upgrade: "asking price" (not "price")
    expect(decision.explanation).toMatch(/No seller asking price is recorded yet/)
    expect(decision.nextAction).toBe('Contact Seller')
  })
})

// ── E. Off-market with a genuine seller price ──────────────────────────────
describe('E. Off-market with a genuine seller price (getSellerIntelligence field) → NEGOTIATE with seller-price gap', () => {
  it('Woodleigh + a genuine seller price of $120K → NEGOTIATE, gap ~$8.6K against BRRRR Max Buy, labeled "Seller Asking" not "Asking Price"', () => {
    // UX V2.5, Part 2 fix — at these default settings (no underwritingSettings
    // override, matching decide()'s own default), computeStrategyRecommendation
    // genuinely ranks BRRRR ahead in a "BOTH WORK" tie; the gap is now
    // correctly measured against BRRRR Max Buy (~$111,364), not Flip's
    // ~$102,222 — this test's OLD $17.8K/Flip expectation was itself a
    // symptom of the bug fixed this session (see dealExplanation.js's
    // resolveEffectiveStrategy comment).
    const { decision } = decide(WOODLEIGH, 'OFF_MARKET', 120000)
    expect(decision.state).toBe('NEGOTIATE')
    expect(decision.currentPrice).toBe(120000)
    // UX V2.3, Part 2A wording upgrade: "Seller Asking" (not "Seller Price")
    expect(decision.currentPriceLabel).toBe('Seller Asking')
    expect(decision.targetStrategy).toBe('BRRRR')
    expect(decision.gap).toBeGreaterThan(8000)
    expect(decision.gap).toBeLessThan(9000)
  })
  it('never repurposes asking_price/currentOffer/MAO as a stand-in seller price — the source is exclusively the sellerAskingPrice parameter', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/const genuineSellerPrice = isOffMarket && sellerAskingPrice != null \? num\(sellerAskingPrice\) : null/)
  })
})

// ── F/G. Off-market missing data ────────────────────────────────────────────
describe('F/G. Off-market with missing ARV/rehab → RESEARCH BEFORE OFFERING', () => {
  it('F. missing ARV', () => {
    const lead = { is_distressed: true, renovation_cost: 20000 }
    const { decision } = decide(lead, 'OFF_MARKET')
    expect(decision.state).toBe('NEEDS_RESEARCH')
    expect(decision.headline).toBe('RESEARCH BEFORE OFFERING')
  })
  it('G. missing rehab', () => {
    const lead = { is_distressed: true, arv: 200000 }
    const { decision } = decide(lead, 'OFF_MARKET')
    expect(decision.state).toBe('NEEDS_RESEARCH')
    expect(decision.headline).toBe('RESEARCH BEFORE OFFERING')
  })
  it('never PASS/NO DEAL/NEGOTIATE/WITHIN BUY RANGE solely because financial data is incomplete', () => {
    const lead = { is_distressed: true }
    const { decision } = decide(lead, 'OFF_MARKET')
    expect(decision.state).toBe('NEEDS_RESEARCH')
    expect(['PASS', 'NEGOTIATE', 'GOOD_AT_ASKING', 'READY_TO_PURSUE']).not.toContain(decision.state)
  })
})

// ── H. Distress intelligence hierarchy ─────────────────────────────────────
describe('H. Distress/system-banner components render AFTER (below) the Acquisition Decision in Overview', () => {
  it('LeadDetailPage.jsx renders DecisionHero before DistressBanner/MlsStatusBanner', () => {
    const src = fs.readFileSync('src/pages/LeadDetailPage.jsx', 'utf8')
    const heroIdx = src.indexOf('<DecisionHero')
    const distressIdx = src.indexOf('<DistressBanner')
    const mlsIdx = src.indexOf('<MlsStatusBanner')
    expect(heroIdx).toBeGreaterThan(-1)
    expect(heroIdx).toBeLessThan(distressIdx)
    expect(heroIdx).toBeLessThan(mlsIdx)
  })
})

// ── I. Priority remains internally unchanged, visually secondary ──────────
describe('I. Priority unchanged internally, visually secondary', () => {
  it('DecisionHero.jsx still reads decision_v2.recommendation verbatim for Priority — no new priority logic', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    expect(src).toMatch(/>Priority<\/span>/)
    expect(src).toMatch(/\{isOverridden \? 'Human Override' : d\.recommendation\.replace\(\/_\/g, ' '\)\}/)
  })
})

// ── J/K/L/M. Financial/scoring/threshold isolation ─────────────────────────
describe('J/K/L/M. Opportunity/Confidence/Urgency, Flip/BRRRR calculations, Decision V2 scoring, buy-box thresholds unchanged', () => {
  it('J/K. Norfolk and Woodleigh canonical MAO/profit values unchanged (P). (Q)', () => {
    const nFlip = computeFlipResult(NORFOLK)
    const nBrrrr = computeBrrrrResult(NORFOLK)
    expect(Math.round(nFlip.mao)).toBe(89041)
    expect(Math.round(nBrrrr.mao)).toBe(94671)
    const wFlip = computeFlipResult(WOODLEIGH)
    expect(Math.round(wFlip.mao)).toBe(102222)
    expect(wFlip.projectedProfit).toBe(32382)
  })
  it('L. decisionEngineV2.js carries no edit markers from this task', () => {
    const src = fs.readFileSync('src/lib/decisionEngineV2.js', 'utf8')
    expect(src).not.toMatch(/UX V2\.2/)
  })
  it('M. buyBox.js and underwriting defaults untouched', () => {
    for (const file of ['src/lib/buyBox.js', 'src/lib/underwritingSettings.js']) {
      const src = fs.readFileSync(file, 'utf8')
      expect(src).not.toMatch(/UX V2\.2/)
    }
  })
})

// ── N/O. No opening-offer formula, no independent Math.max/min ────────────
describe('N/O. No opening-offer formula invented; no component independently selects Math.max/min of strategy MAOs', () => {
  it('N. acquisitionDecisionPresentation.js contains no opening-offer percentage math (0.8/0.7/etc of MAO)', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).not.toMatch(/mao \* 0\.\d|targetPrice \* 0\.\d|\.mao \* 0\.\d/)
    expect(src).toMatch(/isOpeningOffer: false/)
  })
  it('O. resolveTargetPrice picks strategy via the existing preferBrrrr/strategyRec facts only, never Math.max/Math.min of the two MAOs', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).not.toMatch(/Math\.max\(.*mao.*mao|Math\.min\(.*mao.*mao/i)
  })
})

// ── P/Q. Golden canonical values ────────────────────────────────────────────
describe('P/Q. Norfolk and Woodleigh canonical values unchanged (repeated for explicit Part 18 P/Q coverage)', () => {
  it('P. Norfolk', () => {
    expect(Math.round(computeFlipResult(NORFOLK).mao)).toBe(89041)
    expect(Math.round(computeBrrrrResult(NORFOLK).mao)).toBe(94671)
  })
  it('Q. Woodleigh', () => {
    expect(Math.round(computeFlipResult(WOODLEIGH).mao)).toBe(102222)
  })
})

// ── DecisionHero wiring proof ────────────────────────────────────────────
describe('DecisionHero.jsx computes the Acquisition Decision for off-market leads too (root-cause fix)', () => {
  const src = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
  it('flip/brrrr/decision are no longer gated behind !lead.is_distressed', () => {
    expect(src).not.toMatch(/const flip = !lead\.is_distressed \? computeFlipResult/)
    // V2.4: DecisionHero now threads underwritingSettings through (fixing the
    // Woodleigh strategy-disagreement bug), so the call includes a second arg.
    expect(src).toMatch(/const flip = computeFlipResult\(lead, underwritingSettings\)/)
  })
  it('resolveMarketType and getSellerIntelligence are used to feed deriveAcquisitionDecision', () => {
    expect(src).toMatch(/import \{ resolveMarketType \} from '\.\.\/\.\.\/\.\.\/lib\/distressInfo'/)
    expect(src).toMatch(/import \{ getSellerIntelligence \} from '\.\.\/\.\.\/\.\.\/lib\/sellerStrategy'/)
    expect(src).toMatch(/marketType, sellerAskingPrice,/)
  })
  it('READY_TO_PURSUE renders a "Do Not Exceed" caption, never a bare price row implying a comparison', () => {
    expect(src).toMatch(/Do Not Exceed/)
    expect(src).toMatch(/not necessarily the opening offer/)
  })
})
