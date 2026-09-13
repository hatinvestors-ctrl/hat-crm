// test/sep4BuyBoxPassExplanation.test.js
// HAT INVESTORS — SMALL CHANGE #5: Buy-Box PASS Explanation.
// Presentation-only — no financial/decision/scoring/Buy-Box logic
// changed. Fixes the audit-confirmed gap where a hard Buy Box PASS
// (property-fit) appeared alongside economics widgets in a way that
// looked like a competing BRRRR/Flip recommendation.
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../src/lib/dealExplanation.js'
import { deriveAcquisitionDecision } from '../src/lib/acquisitionDecisionPresentation.js'
import { getDealReadiness } from '../src/components/lead-detail/workspace/readiness.js'
import { qualifyBuyBoxCanonical } from '../src/lib/buyBox.js'
import { getPropertyDecisionData } from '../src/lib/propertyDecisionData.js'
import { computeDecisionV2 } from '../src/lib/decisionEngineV2.js'

function decide(lead, marketType = 'ON_MARKET') {
  const flip = computeFlipResult(lead, null)
  const brrrr = computeBrrrrResult(lead, null)
  const strategyRec = flip.available || brrrr.available ? computeStrategyRecommendation(flip, brrrr) : null
  const readiness = getDealReadiness(lead)
  const pdd = getPropertyDecisionData(lead)
  const fit = qualifyBuyBoxCanonical(pdd)
  const decision = deriveAcquisitionDecision({ flip, brrrr, strategyRec, readiness, fit, lead, marketType })
  return { flip, brrrr, strategyRec, fit, decision }
}

const EVERGREEN = {
  id: 'evergreen-test', address: '1937 Evergreen Ave', zip_code: '32206', property_type: 'single_family',
  asking_price: 139900, arv: 185000, renovation_cost: 55000, rent_estimate: 1500,
  bedrooms: 3, bathrooms: 1, hold_months: 6,
}

describe('CASE A — hard Buy Box failure (1937 Evergreen Ave, ZIP 32206)', () => {
  const { fit, decision } = decide(EVERGREEN)
  it('Buy Box correctly returns NOT_FIT with the real reason', () => {
    expect(fit.status).toBe('NOT_FIT')
    expect(fit.reasons).toContain('Blocked ZIP 32206')
  })
  it('headline reads PASS — NOT IN BUY BOX, never NEGOTIATE', () => {
    expect(decision.state).toBe('PASS')
    expect(decision.headline).toBe('PASS — NOT IN BUY BOX')
    expect(decision.headline).not.toMatch(/NEGOTIATE/)
  })
  it('the ACTUAL canonical reason is surfaced (not hardcoded, not invented)', () => {
    expect(decision.buyBoxReason).toBe('Blocked ZIP 32206')
    expect(decision.explanation).toMatch(/Blocked ZIP 32206/)
  })
  it('Recommended Action clearly says PASS — no negotiation implied', () => {
    expect(decision.nextAction).toMatch(/Pass on this property/i)
    expect(decision.nextAction).not.toMatch(/negotiate/i)
  })
  it('buyBoxNotFit flag distinguishes this from a price-based PASS', () => {
    expect(decision.buyBoxNotFit).toBe(true)
  })
  it('economics cannot be mistaken for a recommendation — DecisionHero suppresses Margin of Safety and labels the reference strip', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    expect(src).toMatch(/decision\?\.targetStrategy !== 'BRRRR' && !decision\?\.buyBoxNotFit/)
    expect(src).toMatch(/Economics — Reference Only \(does not override the Buy Box decision\)/)
  })
  it('no NEGOTIATE recommendation of any kind — PASS_NEGOTIABLE never fires for a Buy Box NOT_FIT lead', () => {
    expect(decision.state).not.toBe('PASS_NEGOTIABLE')
    expect(decision.passAtCurrentPrice).toBeUndefined()
  })
})

describe('CASE B — 1463 Spring Street price-negotiation opportunity unaffected', () => {
  const lead = { id: 'spring', asking_price: 110000, arv: 185000, renovation_cost: 45000, hold_months: 6 }
  const { flip, decision } = decide(lead)
  it('remains NEGOTIATE with Pass at current price', () => {
    expect(decision.state).toBe('PASS_NEGOTIABLE')
    expect(decision.headline).toBe('NEGOTIATE')
    expect(decision.passAtCurrentPrice).toBe(true)
  })
  it('Flip Max Buy and gap unchanged', () => {
    expect(Math.round(flip.mao / 100) * 100).toBe(83200)
    expect(decision.gap).toBe(26836)
  })
})

describe('CASE C — Fouraker regression unchanged', () => {
  const lead = { id: 'fouraker', asking_price: 200000, arv: 285000, renovation_cost: 20000, hold_months: 6 }
  const { decision } = decide(lead)
  it('remains Small Change #3 PASS_NEGOTIABLE behavior', () => {
    expect(decision.state).toBe('PASS_NEGOTIABLE')
    expect(decision.headline).toBe('NEGOTIATE')
  })
})

describe('CASE D — true hard economic PASS (property inside Buy Box, no viable price) remains PASS, not misread as Buy Box failure', () => {
  const lead = { id: 'hardpass', zip_code: '32210', property_type: 'single_family', asking_price: 150000, arv: 120000, renovation_cost: 90000, hold_months: 6 }
  const { fit, decision } = decide(lead)
  it('Buy Box correctly says FIT (32210 is not blocked)', () => {
    expect(fit.status).not.toBe('NOT_FIT')
  })
  it('decision is true PASS, buyBoxNotFit is NOT set', () => {
    expect(decision.state).toBe('PASS')
    expect(decision.headline).toBe('PASS')
    expect(decision.buyBoxNotFit).toBeUndefined()
  })
})

describe('CASE E — good deal (inside Buy Box, economics work) unchanged', () => {
  const lead = { id: 'gooddeal', zip_code: '32210', property_type: 'single_family', asking_price: 70000, arv: 185000, renovation_cost: 45000, hold_months: 6 }
  const { fit, decision } = decide(lead)
  it('Buy Box FIT, decision GOOD_AT_ASKING, no buyBoxNotFit annotation', () => {
    expect(fit.status).not.toBe('NOT_FIT')
    expect(decision.state).toBe('GOOD_AT_ASKING')
    expect(decision.buyBoxNotFit).toBeUndefined()
  })
})

describe('CASE F — incomplete lead (NEEDS_RESEARCH) unaffected', () => {
  it('missing ARV still resolves NEEDS_RESEARCH regardless of Buy Box', () => {
    const lead = { id: 'incomplete', zip_code: '32206', asking_price: 100000, renovation_cost: 20000, hold_months: 6 }
    const { decision } = decide(lead)
    expect(decision.state).toBe('NEEDS_RESEARCH')
  })
})

// Small Change #6 audit finding (superseding this SC5 test's own label
// choice) — traced the actual source further: brrrr.monthlyCashFlow is
// computed at brrrr.currentOffer, a system-computed negotiation anchor
// (calculateLiveOffer, calculations.js), NOT literally "the current
// price". "At current price" was itself imprecise; "at suggested offer"
// is the truthful label, matching the SAME term Small Change #3 already
// uses for flip.currentOffer. Underlying value unchanged.
describe('CASE G — BRRRR cash-flow label truthfully identifies the scenario', () => {
  it('DecisionHero labels the bottom-strip BRRRR figure "at suggested offer" — the same value/source as before, wording only', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    expect(src).toMatch(/mo cash flow at suggested offer/)
    // the underlying value is still brrrr.monthlyCashFlow — never recalculated
    expect(src).toMatch(/\{brrrr\.monthlyCashFlow >= 0 \? '\+' : ''\}\{fc\(brrrr\.monthlyCashFlow\)\}\/mo cash flow at suggested offer/)
  })
})

describe('Real Decision V2 wiring produces the same NOT_FIT for Evergreen (not just the presentation-layer fixture)', () => {
  it('computeDecisionV2 itself (decisionEngineV2.js, untouched) returns fit.status NOT_FIT for ZIP 32206', () => {
    const d2 = computeDecisionV2(EVERGREEN, 'on_market', { trigger: 'MANUAL_RECALCULATION' })
    expect(d2.fit.status).toBe('NOT_FIT')
    expect(d2.recommendation).toBe('PASS')
  })
})

describe('Small Changes #1/#2/#3/#4 preserved', () => {
  it('SC1 — 3-level ARV writeback untouched', () => {
    const cardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
    expect(cardSrc).toMatch(/const arvToWrite = lead\.arv \? null : finalArv/)
  })
  it('SC2 — Overview input-sync untouched', () => {
    const hookSrc = fs.readFileSync('src/hooks/useLeadUpdate.js', 'utf8')
    expect(hookSrc).toMatch(/updated\.decision_v2 = freshDecision/)
  })
  it('SC3 — PASS_NEGOTIABLE / NEGOTIATE logic untouched in substance (still gated on viable Max Buy)', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/state: 'PASS_NEGOTIABLE', \.\.\.STATE_META\.PASS_NEGOTIABLE/)
  })
  it('SC4 — evaluation-price labeling untouched', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/priceIsEvaluationForPass/)
    expect(src).toMatch(/currentPriceLabelForPass/)
  })
})

describe('Protected files / no scope creep', () => {
  it('no protected file references any new symbol from this fix', () => {
    for (const f of ['src/lib/calculations.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/dealExplanation.js', 'src/lib/sellerStrategy.js']) {
      const src = fs.readFileSync(f, 'utf8')
      expect(src).not.toMatch(/buyBoxNotFit|buyBoxReason/)
    }
  })
  it('the fix is confined to acquisitionDecisionPresentation.js and DecisionHero.jsx', () => {
    const presSrc = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    const heroSrc = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    expect(presSrc).toMatch(/buyBoxNotFit/)
    expect(heroSrc).toMatch(/buyBoxNotFit/)
  })
  it('LeadEssentialsBar.jsx (top Deal Output) left untouched per the mission\'s explicit low-risk preference', () => {
    const src = fs.readFileSync('src/components/lead-detail/LeadEssentialsBar.jsx', 'utf8')
    expect(src).not.toMatch(/buyBoxNotFit/)
  })
})
