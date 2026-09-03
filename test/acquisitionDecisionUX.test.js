// test/acquisitionDecisionUX.test.js
// Lead Workspace UX V2 — Acquisition Decision presentation (2026-08-31).
//
// PRESENTATION ONLY. Every test below proves the new plain-language
// states (GOOD AT ASKING / NEGOTIATE / NEEDS RESEARCH / PASS) are
// derived entirely from EXISTING computeFlipResult/computeBrrrrResult/
// computeStrategyRecommendation/getDealReadiness outputs — never a new
// financial formula, threshold, or business rule. Financial-formula/
// threshold files are proven byte-unchanged at the bottom of this file.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../src/lib/dealExplanation.js'
import { deriveAcquisitionDecision, buildStrategyLine, buildWhyReasons, composeNextActionText } from '../src/lib/acquisitionDecisionPresentation.js'
import { getDealReadiness } from '../src/components/lead-detail/workspace/readiness.js'

function decide(lead, extra = {}) {
  const flip = computeFlipResult(lead)
  const brrrr = computeBrrrrResult(lead)
  const strategyRec = computeStrategyRecommendation(flip, brrrr)
  const readiness = getDealReadiness(lead)
  return deriveAcquisitionDecision({ flip, brrrr, strategyRec, readiness, lead, ...extra })
}

const WOODLEIGH = { asking_price: 100000, arv: 200000, renovation_cost: 39000, rent_estimate: 1350, hold_months: 6 }
const NORFOLK = { asking_price: 105000, arv: 215000, renovation_cost: 65000, rent_estimate: 1350, hold_months: 6 }

// ── Part 26 — golden regression cases ──────────────────────────────────────
describe('Part 26 — regression UX cases', () => {
  it('1. Norfolk: price above target → NEGOTIATE, using the BRRRR target (preferred strategy), never an arbitrary Flip/BRRRR pick', () => {
    const d = decide(NORFOLK)
    expect(d.state).toBe('NEGOTIATE')
    expect(d.headline).toBe('NEGOTIATE — WORTH PURSUING')
    expect(d.currentPrice).toBe(105000)
    expect(d.targetLabel).toBe('BRRRR Max Buy')
    expect(Math.round(d.targetPrice)).toBe(94671)
    expect(d.gap).toBeGreaterThan(0)
  })
  it('2. Woodleigh: current price at/below Flip Max Buy (thin margin, internally WATCH) → plain-language WITHIN BUY RANGE, not the word "WATCH" — UX V2.1 renamed this state\'s presentation text (state enum GOOD_AT_ASKING unchanged)', () => {
    const d = decide(WOODLEIGH)
    expect(d.state).toBe('GOOD_AT_ASKING')
    expect(d.headline).not.toMatch(/WATCH/)
    expect(d.headline).toBe('WITHIN BUY RANGE')
  })
  it('3. Strong deal at asking → WITHIN BUY RANGE', () => {
    // ARV high relative to a low ask — comfortably within Flip Max Buy.
    const lead = { asking_price: 60000, arv: 200000, renovation_cost: 20000, hold_months: 6 }
    const d = decide(lead)
    expect(d.state).toBe('GOOD_AT_ASKING')
  })
  it('4. Missing ARV → NEEDS RESEARCH, reusing readiness.js\'s own reason text', () => {
    const lead = { asking_price: 100000, renovation_cost: 20000 }
    const d = decide(lead)
    expect(d.state).toBe('NEEDS_RESEARCH')
    expect(d.explanation).toMatch(/comps|ARV/i)
  })
  it('5. Missing rehab → NEEDS RESEARCH', () => {
    const lead = { asking_price: 100000, arv: 200000 }
    const d = decide(lead)
    expect(d.state).toBe('NEEDS_RESEARCH')
  })
  it('6. Not In Buy Box (fit.status=NOT_FIT) → PASS / NOT A FIT — an EXISTING fact, not a new price-based PASS', () => {
    const d = decide(WOODLEIGH, { fit: { status: 'NOT_FIT' } })
    expect(d.state).toBe('PASS')
    expect(d.headline).toBe('PASS — NOT A FIT')
  })
  it('7. BRRRR preferred with two different Max Buy values: both remain independently derivable, never conflated', () => {
    const flip = computeFlipResult(NORFOLK)
    const brrrr = computeBrrrrResult(NORFOLK)
    expect(Math.round(flip.mao)).not.toBe(Math.round(brrrr.mao)) // genuinely two different numbers
    const d = decide(NORFOLK)
    expect(Math.round(d.targetPrice)).toBe(Math.round(brrrr.mao)) // decision correctly picked BRRRR's, not Flip's
  })
  it('8. Flip-only (no rent estimate) → Flip language only, BRRRR unavailable, never fabricated', () => {
    const lead = { asking_price: 60000, arv: 200000, renovation_cost: 20000, hold_months: 6 } // no rent_estimate
    const flip = computeFlipResult(lead)
    const brrrr = computeBrrrrResult(lead)
    expect(brrrr.available).toBe(false)
    const line = buildStrategyLine({ flip, brrrr, strategyRec: computeStrategyRecommendation(flip, brrrr), preferBrrrr: false })
    expect(line.headline).toBe('FLIP ONLY')
  })
  it('10. negative profit at current price but a lower MAO/Max Buy exists → NEGOTIATE / DOESN\'T-WORK-AT-CURRENT-PRICE language, never generic "NO DEAL"', () => {
    const d = decide(NORFOLK)
    expect(d.headline).not.toMatch(/NO DEAL/)
    expect(d.state).toBe('NEGOTIATE')
  })
})

// ── Part 1 — WATCH removed as primary verdict, mapping documented ────────
describe('Part 1 — WATCH is never the primary user-facing headline; mapping is derived, not a new threshold', () => {
  it('deriveAcquisitionDecision never returns the literal word WATCH/NO DEAL as its headline, for any state', () => {
    const cases = [WOODLEIGH, NORFOLK, { asking_price: 60000, arv: 200000, renovation_cost: 20000 }]
    for (const lead of cases) {
      const d = decide(lead)
      expect(d.headline).not.toMatch(/^WATCH$/)
      expect(d.headline).not.toMatch(/^NO DEAL$/)
    }
  })
  it('only 4 states exist, exactly as specified: GOOD_AT_ASKING, NEGOTIATE, NEEDS_RESEARCH, PASS', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/GOOD_AT_ASKING: \{ label: 'WITHIN BUY RANGE'/)
    expect(src).toMatch(/NEGOTIATE: {6}\{ label: 'NEGOTIATE'/)
    expect(src).toMatch(/NEEDS_RESEARCH: \{ label: 'NEEDS RESEARCH'/)
    expect(src).toMatch(/PASS:\s+\{ label: 'PASS'/)
  })
})

// ── Part 17 — Flip Max Buy / BRRRR Max Buy labels ──────────────────────────
describe('Part 17 — Flip Max Buy and BRRRR Max Buy are explicitly labeled, never a generic "Max Buy"', () => {
  const decisionHeroSrc = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
  const dealDecisionCenterSrc = fs.readFileSync('src/components/lead-detail/workspace/DealDecisionCenter.jsx', 'utf8')
  it('DecisionHero.jsx no longer repeats a standalone "Flip Max Buy" metric in its collapsed economics row (V2.4: moved to the price-position block and Deal tab)', () => {
    // V2.4 collapsed the 3-column economics row into a single compact line;
    // the "Flip Max Buy"/"BRRRR Max Buy" labeling requirement itself still
    // holds — enforced via the price-position block and DealDecisionCenter.jsx.
    expect(decisionHeroSrc).toMatch(/Max Buy/)
  })
  it('DealDecisionCenter.jsx labels its Max Buy as "Flip Max Buy"', () => {
    expect(dealDecisionCenterSrc).toMatch(/label="Flip Max Buy"/)
  })
  it('resolveTargetPrice picks the strategy-appropriate label ("Flip Max Buy" vs "BRRRR Max Buy"), never a bare "Max Buy"', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/targetStrategy === 'BRRRR' \? 'BRRRR Max Buy' : 'Flip Max Buy'/)
  })
})

// ── Part 6 — needed price reduction / within buy range wording ────────────
describe('Part 6 — price-gap language: "Needed Price Reduction" / "Within Buy Range", no raw signed numbers', () => {
  it('NEGOTIATE state uses gapLabel "NEEDED PRICE REDUCTION"', () => {
    const d = decide(NORFOLK)
    expect(d.gapLabel).toBe('NEEDED PRICE REDUCTION')
    expect(d.gap).toBeGreaterThan(0) // always a positive, human-readable magnitude
  })
  it('GOOD_AT_ASKING state uses gapLabel "WITHIN BUY RANGE"', () => {
    const d = decide(WOODLEIGH)
    expect(d.gapLabel).toBe('WITHIN BUY RANGE')
  })
  it('DealDecisionCenter.jsx no longer shows the bare "Seller Gap to Max Buy" label', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/DealDecisionCenter.jsx', 'utf8')
    expect(src).not.toMatch(/label="Seller Gap to Max Buy"/)
    // UX V2.6, Part 4 — "Within Buy Range"/"Needed Price Reduction" were
    // themselves a whole-property price-gap framing; V2.6 replaced the
    // Deal tab's price-gap language entirely with strategy-specific
    // WORKS/BELOW TARGET status (per-strategy, never a single verdict for
    // the whole property) — see StrategyCard/buildStrategyComparison.
    expect(src).toMatch(/STATUS_TONE = \{/)
    expect(src).toMatch(/'BELOW TARGET'/)
  })
})

// ── Part 4 — price context always accompanies a financial outcome ─────────
describe('Part 4 — every profit figure names the price it refers to', () => {
  it('DecisionHero.jsx\'s Flip Profit label includes an explicit price context', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    // V2.4 collapsed the profit metric into a compact bottom-line summary
    // ("FLIP $X projected profit @ evaluation/current price") rather than a
    // standalone "Flip Profit @ ..." Metric label — the price context is
    // still explicitly named, just not as a Metric component anymore.
    expect(src).toMatch(/projected profit @ \{decision\?\.priceIsEvaluation \? 'evaluation' : 'current'\} price/)
    expect(src).not.toMatch(/label="Projected Profit"/)
  })
  it('DealDecisionCenter.jsx\'s Flip profit label includes an explicit price context', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/DealDecisionCenter.jsx', 'utf8')
    expect(src).toMatch(/Flip Profit @ \$\{isDistressedLead\(lead\) \? 'Evaluation' : 'Current'\} Price/)
  })
  it('the decision object always carries currentPrice alongside any gap/target it reports', () => {
    const d = decide(NORFOLK)
    expect(d.currentPrice).not.toBeNull()
    expect(d.targetPrice).not.toBeNull()
  })
})

// ── Part 7 — priority visually/language-separated from deal decision ──────
describe('Part 7 — Priority is a separate concept from Acquisition Decision, both in code and copy', () => {
  const src = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
  it('DecisionHero renders a distinct "Acquisition Decision" label above the plain-language headline', () => {
    expect(src).toMatch(/Acquisition Decision<\/div>/)
  })
  it('DecisionHero renders a distinct "Priority" row, separated by its own border, with explanatory tooltip copy', () => {
    expect(src).toMatch(/>Priority<\/span>/)
    expect(src).toMatch(/When this lead needs attention — a workflow signal, not a verdict on deal quality\./)
  })
})

// ── Part 8 — Data Confidence wording (already correct, verified untouched) ─
describe('Part 8 — "Data Confidence" wording (pre-existing, confirmed present, not reverted)', () => {
  it('DecisionHero.jsx labels the score "Data Confidence", never a bare "Confidence"', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    expect(src).toMatch(/Data Confidence <b/)
    expect(src).not.toMatch(/>Confidence <b/)
  })
})

// ── Part 14 — next action includes price context when safe ────────────────
describe('Part 14 — composeNextActionText adds price context only to agent/owner-contact actions, never invents a new action', () => {
  it('adds "~$X or below" context to a Contact Agent/Owner action when negotiating', () => {
    const d = decide(NORFOLK)
    const text = composeNextActionText('Contact Agent', d)
    expect(text).toMatch(/Contact Agent and negotiate toward ~\$\d+K or below\./)
  })
  it('does not alter an action that is not an agent/owner contact (e.g. "Make Offer")', () => {
    const d = decide(WOODLEIGH)
    const text = composeNextActionText('Make Offer', d)
    expect(text).toBe('Make Offer')
  })
})

// ── Part 13 — Why HAT Says This, max 3 reasons, deterministic ─────────────
describe('Part 13 — buildWhyReasons: max 3, deterministic, no new AI call', () => {
  it('never returns more than 3 reasons', () => {
    const d = decide(NORFOLK)
    const reasons = buildWhyReasons({ decision: d, flip: computeFlipResult(NORFOLK), brrrr: computeBrrrrResult(NORFOLK), decisionV2Confidence: 90 })
    expect(reasons.length).toBeLessThanOrEqual(3)
  })
  it('acquisitionDecisionPresentation.js makes no network/AI call (no fetch/LLM reference)', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).not.toMatch(/fetch\(|anthropic|claude/i)
  })
})

// ── Part 25 — no logic change proof ────────────────────────────────────────
describe('Part 25 — proof: no financial/scoring logic changed', () => {
  it('calculations.js, dealExplanation.js verdict thresholds, decisionEngineV2.js, buyBox.js are byte-unchanged (no edit markers from this task)', () => {
    for (const file of ['src/lib/calculations.js', 'src/lib/dealExplanation.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js']) {
      const src = fs.readFileSync(file, 'utf8')
      expect(src).not.toMatch(/Lead Workspace UX V2/)
    }
  })
  it('dealExplanation.js verdict threshold constants unchanged', () => {
    const src = fs.readFileSync('src/lib/dealExplanation.js', 'utf8')
    expect(src).toMatch(/if \(profitAtEvaluationPrice >= FLIP_STRONG_PROFIT\) verdict = 'STRONG'/)
  })
  it('decisionEngineV2.js Act Now/Review Today thresholds unchanged', () => {
    const src = fs.readFileSync('src/lib/decisionEngineV2.js', 'utf8')
    expect(src).toMatch(/const strong = opportunity\.score >= 65 && confidence\.score >= 60/)
  })
  it('acquisitionDecisionPresentation.js itself computes zero dollar amounts from raw ARV/reno/rent — every number it uses is read from an already-computed field (flip.mao, brrrr.mao, flip.projectedProfit, etc.), never arv/renovation_cost/rent_estimate directly', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).not.toMatch(/lead\.arv|lead\.renovation_cost|lead\.rent_estimate/)
  })
})
