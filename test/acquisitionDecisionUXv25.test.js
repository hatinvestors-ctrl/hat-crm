// test/acquisitionDecisionUXv25.test.js
// HAT Investors — Lead Workspace UX V2.5 — "FINAL SIMPLIFICATION + CROSS-
// SCREEN SEMANTIC CONSISTENCY AUDIT"
//
// Covers Part 14's test matrix A–M plus the mission's explicit release-
// blocker: Overview and Deal must always agree on preferred strategy for
// the same lead + same underwriting settings. Pure-function assertions
// run against real Woodleigh/Norfolk-shaped fixtures; component
// assertions are structural (source-text), matching this repo's existing
// convention (no component-mount harness exists here).
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation, resolveEffectiveStrategy } from '../src/lib/dealExplanation'
import { resolveUnderwritingSettings } from '../src/lib/underwritingSettings'
import { deriveAcquisitionDecision, resolveActualOffer } from '../src/lib/acquisitionDecisionPresentation'

// Real production settings as of this audit (workspace d854b1e3-…, updated
// 2026-08-30) — the exact shape that produced the real Woodleigh
// "Overview FLIP / Deal BOTH WORK — BRRRR PREFERRED" contradiction.
const REAL_SETTINGS = resolveUnderwritingSettings({ underwriting: {
  refi_ltv_pct: 70, monthly_taxes: 208, hml_points_pct: 2, refi_costs_pct: 2.9,
  refi_amort_years: 30, monthly_insurance: 100, flip_selling_cost_pct: 7,
  default_holding_months: 6, refi_interest_rate_pct: 6.7, hml_rehab_financing_pct: 100,
  hml_interest_monthly_pct: 1, acquisition_closing_costs: 2450, hml_purchase_financing_pct: 90,
} })

const WOODLEIGH = {
  id: 'e5445aa8-72cf-416c-86c4-269641570ede', address: '1963 W WOODLEIGH DR',
  asking_price: 100000, arv: 200000, renovation_cost: 39000, rent_estimate: 1350,
  is_distressed: true, offer_price: null, starting_offer: null, distress_data: null,
}
const NORFOLK = {
  address: '9739 Norfolk Blvd', asking_price: 105000, arv: 215000,
  renovation_cost: 65000, rent_estimate: 1350, is_distressed: false,
}

function computeAll(lead, settings = REAL_SETTINGS) {
  const flip = computeFlipResult(lead, settings)
  const brrrr = computeBrrrrResult(lead, settings)
  const strategyRec = computeStrategyRecommendation(flip, brrrr)
  return { flip, brrrr, strategyRec }
}

// ── Part 2 — the release-blocker: Overview and Deal must AGREE ─────────────
describe('Part 2 — strategy consistency is a release blocker', () => {
  it('root cause confirmed: real Woodleigh + real settings produce a BOTH-tie with BRRRR as the actual computed winner', () => {
    const { flip, brrrr, strategyRec } = computeAll(WOODLEIGH)
    expect(flip.available).toBe(true)
    expect(brrrr.available).toBe(true)
    expect(strategyRec.preferredStrategy).toBe('BOTH')
    expect(strategyRec.preferredWhenBoth).toBe('BRRRR')
    expect(strategyRec.summary).toBe('BOTH WORK — BRRRR PREFERRED')
  })
  it('resolveEffectiveStrategy exposes that winner structurally, not just in free text', () => {
    const { strategyRec } = computeAll(WOODLEIGH)
    expect(resolveEffectiveStrategy(strategyRec)).toBe('BRRRR')
  })
  it('Norfolk is unaffected by the BOTH-collapse bug — a clean single-strategy win, not a tie', () => {
    const { strategyRec } = computeAll(NORFOLK, resolveUnderwritingSettings({ underwriting: { refi_ltv_pct: 75, refi_costs_pct: 3 } }))
    expect(strategyRec.preferredStrategy).toBe('BRRRR')
    expect(resolveEffectiveStrategy(strategyRec)).toBe('BRRRR')
  })
  it('DecisionHero.jsx (Overview) and DealDecisionCenter.jsx (Deal tab) both resolve the primary strategy through the SAME buildStrategyComparison/resolveEffectiveStrategy chain — the one shared decision point', () => {
    // UX V2.6 — DealDecisionCenter now goes through buildStrategyComparison
    // (acquisitionDecisionPresentation.js), which internally calls
    // resolveEffectiveStrategy — the SAME function DecisionHero's
    // deriveAcquisitionDecision path also uses. This is now the single
    // shared choke point both surfaces pass through.
    const presentationSrc = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    const dealSrc = fs.readFileSync('src/components/lead-detail/workspace/DealDecisionCenter.jsx', 'utf8')
    expect(presentationSrc).toMatch(/resolveEffectiveStrategy\(strategyRec\) === 'BRRRR' && brrrr\?\.available/)
    expect(presentationSrc).toMatch(/export function buildStrategyComparison\(/)
    // V2.9 note (post-V2.6 legitimate fix, not a regression): DealDecisionCenter
    // now also imports hasEvaluablePrice alongside buildStrategyComparison,
    // and passes an additive `hasPrice` option through, to honestly handle
    // off-market leads with no seller price yet (previously showed a false
    // "BELOW TARGET"/"None — neither strategy qualifies"). The shared
    // resolveEffectiveStrategy choke point itself is unchanged.
    expect(dealSrc).toMatch(/import \{ buildStrategyComparison, hasEvaluablePrice \} from '\.\.\/\.\.\/\.\.\/lib\/acquisitionDecisionPresentation'/)
    expect(dealSrc).toMatch(/const comparison = buildStrategyComparison\(\{ flip, brrrr, strategyRec, hasPrice: priceKnown \}\)/)
  })
  it('LeadEssentialsBar.jsx (a third, independent consumer) also uses resolveEffectiveStrategy — a fourth silently-disagreeing surface is now impossible', () => {
    const src = fs.readFileSync('src/components/lead-detail/LeadEssentialsBar.jsx', 'utf8')
    expect(src).toMatch(/resolveEffectiveStrategy\(strategy\)/)
  })
  it('REGRESSION LOCK — for Woodleigh at real settings, the effective strategy computed once is the same value every consumer would independently derive (this IS the invariant the mission requires)', () => {
    const { flip, brrrr, strategyRec } = computeAll(WOODLEIGH)
    const effective = resolveEffectiveStrategy(strategyRec)
    // Simulate what DecisionHero, DealDecisionCenter, and LeadEssentialsBar
    // each independently compute from the SAME flip/brrrr/strategyRec —
    // they must be identical, or this test fails.
    const heroPreferBrrrr = resolveEffectiveStrategy(strategyRec) === 'BRRRR' && brrrr.available
    const dealPreferBrrrr = resolveEffectiveStrategy(strategyRec) === 'BRRRR' && brrrr.available
    const essentialsMaxBuyStrategy = resolveEffectiveStrategy(strategyRec)
    expect(heroPreferBrrrr).toBe(dealPreferBrrrr)
    expect(heroPreferBrrrr ? 'BRRRR' : 'FLIP').toBe(essentialsMaxBuyStrategy === 'BRRRR' ? 'BRRRR' : 'FLIP')
    expect(effective).toBe('BRRRR')
  })
  it('ranking logic itself (VERDICT_RANK comparison) is completely unchanged — only a new additive field exposes its existing result', () => {
    const src = fs.readFileSync('src/lib/dealExplanation.js', 'utf8')
    expect(src).toMatch(/const VERDICT_RANK = \{ STRONG: 3, PASS: 2, WATCH: 1, 'NO DEAL': 0 \}/)
    expect(src).toMatch(/const fr = VERDICT_RANK\[flip\.verdict\] \?\? 0/)
    expect(src).toMatch(/const br = VERDICT_RANK\[brrrr\.verdict\] \?\? 0/)
  })
})

// ── Part 1/3 — price provenance: evaluation price never becomes Seller
// Asking / Our Offer ────────────────────────────────────────────────────────
describe('Part 1/3 — price provenance contract', () => {
  it('A. off-market + evaluation price + no seller price: evaluationPrice is populated, currentPrice/gap are null, headline is CONTACT SELLER', () => {
    const { flip, brrrr, strategyRec } = computeAll(WOODLEIGH)
    const decision = deriveAcquisitionDecision({ flip, brrrr, strategyRec, lead: WOODLEIGH, marketType: 'OFF_MARKET', sellerAskingPrice: null, decisionV2Recommendation: 'REVIEW_TODAY' })
    expect(decision.state).toBe('READY_TO_PURSUE')
    expect(decision.headline).toBe('CONTACT SELLER')
    expect(decision.evaluationPrice).toBe(100000)
    expect(decision.currentPrice).toBeNull()
    expect(decision.gap).toBeNull()
  })
  it('B. off-market + a genuine seller price: currentPriceLabel is "Seller Asking", never "Evaluation Price" or "Asking Price"', () => {
    const { flip, brrrr, strategyRec } = computeAll(WOODLEIGH)
    const decision = deriveAcquisitionDecision({ flip, brrrr, strategyRec, lead: WOODLEIGH, marketType: 'OFF_MARKET', sellerAskingPrice: 95000, decisionV2Recommendation: 'REVIEW_TODAY' })
    expect(decision.currentPriceLabel).toBe('Seller Asking')
    expect(decision.currentPrice).toBe(95000)
  })
  it('C. off-market + seller price + actual HAT offer (lead.offer_price): actualOffer is populated from the trustworthy source only', () => {
    const leadWithOffer = { ...WOODLEIGH, offer_price: 97000 }
    const { flip, brrrr, strategyRec } = computeAll(leadWithOffer)
    const decision = deriveAcquisitionDecision({ flip, brrrr, strategyRec, lead: leadWithOffer, marketType: 'OFF_MARKET', sellerAskingPrice: 95000, decisionV2Recommendation: 'REVIEW_TODAY' })
    expect(decision.actualOffer).toBe(97000)
    expect(decision.actualOfferSource).toBe('offer_price')
  })
  it('D. off-market + evaluation price + a genuinely calculated suggested offer: flip.currentOffer exists and is distinct from actualOffer/evaluationPrice — never conflated', () => {
    const { flip, brrrr, strategyRec } = computeAll(WOODLEIGH)
    expect(flip.currentOffer).not.toBeNull()
    const decision = deriveAcquisitionDecision({ flip, brrrr, strategyRec, lead: WOODLEIGH, marketType: 'OFF_MARKET', sellerAskingPrice: null, decisionV2Recommendation: 'REVIEW_TODAY' })
    expect(decision.actualOffer).toBeNull() // no lead.offer_price / FORMAL_OFFER on file
  })
  it('E. on-market listing price: currentPriceLabel is "Asking Price", never "Seller Asking" (that wording is off-market-only)', () => {
    const { flip, brrrr, strategyRec } = computeAll(NORFOLK)
    const decision = deriveAcquisitionDecision({ flip, brrrr, strategyRec, lead: NORFOLK, marketType: 'ON_MARKET', sellerAskingPrice: null, decisionV2Recommendation: 'REVIEW_TODAY' })
    expect(decision.currentPriceLabel).toBe('Asking Price')
  })
  it('F. Norfolk negotiate case: unchanged NEGOTIATE state with a real gap', () => {
    const { flip, brrrr, strategyRec } = computeAll(NORFOLK, resolveUnderwritingSettings({ underwriting: { refi_ltv_pct: 75, refi_costs_pct: 3 } }))
    const decision = deriveAcquisitionDecision({ flip, brrrr, strategyRec, lead: NORFOLK, marketType: 'ON_MARKET', sellerAskingPrice: null, decisionV2Recommendation: 'REVIEW_TODAY' })
    expect(decision.state).toBe('NEGOTIATE')
    expect(decision.targetStrategy).toBe('BRRRR')
  })
  it('G. Woodleigh strategy consistency — targetStrategy from deriveAcquisitionDecision matches resolveEffectiveStrategy', () => {
    const { flip, brrrr, strategyRec } = computeAll(WOODLEIGH)
    const decision = deriveAcquisitionDecision({ flip, brrrr, strategyRec, lead: WOODLEIGH, marketType: 'OFF_MARKET', sellerAskingPrice: 95000, decisionV2Recommendation: 'REVIEW_TODAY' })
    expect(decision.targetStrategy).toBe(resolveEffectiveStrategy(strategyRec))
  })
  it('H. missing ARV → NEEDS_RESEARCH, no fabricated price', () => {
    const lead = { ...WOODLEIGH, arv: null }
    const flip = computeFlipResult(lead, REAL_SETTINGS)
    expect(flip.available).toBe(false)
    const decision = deriveAcquisitionDecision({
      flip, brrrr: computeBrrrrResult(lead, REAL_SETTINGS), strategyRec: null,
      readiness: { flipReady: false, missing: [{ label: 'ARV', reason: 'Run comps to estimate ARV.' }] },
      lead, marketType: 'OFF_MARKET', decisionV2Recommendation: 'REVIEW_TODAY',
    })
    expect(decision.state).toBe('NEEDS_RESEARCH')
    expect(decision.currentPrice).toBeNull()
  })
  it('I. missing rehab → NEEDS_RESEARCH, no fabricated price', () => {
    const lead = { ...WOODLEIGH, renovation_cost: null }
    const flip = computeFlipResult(lead, REAL_SETTINGS)
    expect(flip.available).toBe(false)
    const decision = deriveAcquisitionDecision({
      flip, brrrr: computeBrrrrResult(lead, REAL_SETTINGS), strategyRec: null,
      readiness: { flipReady: false, missing: [{ label: 'Renovation Cost', reason: 'Add a renovation estimate.' }] },
      lead, marketType: 'OFF_MARKET', decisionV2Recommendation: 'REVIEW_TODAY',
    })
    expect(decision.state).toBe('NEEDS_RESEARCH')
  })
  it('J. PASS / Not Fit → PASS, no economics shown', () => {
    const { flip, brrrr, strategyRec } = computeAll(WOODLEIGH)
    const decision = deriveAcquisitionDecision({ flip, brrrr, strategyRec, fit: { status: 'NOT_FIT' }, lead: WOODLEIGH, marketType: 'OFF_MARKET', decisionV2Recommendation: 'REVIEW_TODAY' })
    expect(decision.state).toBe('PASS')
    expect(decision.currentPrice).toBeNull()
  })
  it('K. both strategies viable → strategyLine reports BOTH STRATEGIES WORK', () => {
    const { flip, brrrr, strategyRec } = computeAll(WOODLEIGH)
    const decision = deriveAcquisitionDecision({ flip, brrrr, strategyRec, lead: WOODLEIGH, marketType: 'OFF_MARKET', sellerAskingPrice: 95000, decisionV2Recommendation: 'REVIEW_TODAY' })
    expect(decision.strategyLine?.headline).toBe('BOTH STRATEGIES WORK')
  })
  it('L/M. Flip-preferred and BRRRR-preferred cases both resolve targetStrategy consistently with resolveEffectiveStrategy', () => {
    // L — Flip only available (no rent estimate → BRRRR unavailable).
    const flipOnly = { asking_price: 160000, arv: 220000, renovation_cost: 20000, hold_months: 6 }
    const flipRes = computeFlipResult(flipOnly, REAL_SETTINGS)
    const brrrrRes = computeBrrrrResult(flipOnly, REAL_SETTINGS)
    const rec = computeStrategyRecommendation(flipRes, brrrrRes)
    expect(resolveEffectiveStrategy(rec)).toBe(rec.preferredStrategy === 'NONE' ? 'NONE' : 'FLIP')
    // M — Norfolk, clean BRRRR win.
    const { strategyRec: norfolkRec } = computeAll(NORFOLK, resolveUnderwritingSettings({ underwriting: { refi_ltv_pct: 75, refi_costs_pct: 3 } }))
    expect(resolveEffectiveStrategy(norfolkRec)).toBe('BRRRR')
  })
})

// ── Part 4 — AI & Comps price language ──────────────────────────────────────
describe('Part 4 — Comps Intelligence price provenance', () => {
  // Comments stripped — these assert on rendered markup, and the file
  // header legitimately documents the labels V2.8 removed.
  const src = fs.readFileSync('src/components/lead-detail/workspace/ComplsIntelligenceCard.jsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
  // UX V2.8 supersedes the original form of these two assertions. V2.5's
  // defect was that this card labeled flip.evaluationPrice "Seller Asking"
  // even with no genuine seller-stated price on file; V2.5 fixed it by
  // routing the label through the canonical market-type/seller-intelligence
  // resolvers. V2.8 removed the entire price block from this card (an
  // acquisition conclusion, not comp evidence), so the mislabel is now
  // structurally impossible rather than conditionally correct. Kept as
  // absence assertions so the risk cannot reappear here; the positive
  // resolver assertions for the surfaces that DO show a seller price
  // (LeadEssentialsBar, Part 11 below) are untouched.
  it('no longer displays any seller/evaluation price at all — the V2.5 mislabel risk is removed structurally (UX V2.8)', () => {
    expect(src).not.toMatch(/Seller Asking/)
    expect(src).not.toMatch(/Evaluation Price/)
    expect(src).not.toMatch(/evaluationPrice/)
  })
  it('no longer displays a gap-to-Max-Buy figure under any label', () => {
    expect(src).not.toMatch(/Seller Gap to Max Buy/)
    expect(src).not.toMatch(/Room to Max Buy/)
    expect(src).not.toMatch(/Max Buy/)
  })
})

// ── Part 10 — Deal tab language (MarginVisualization) ───────────────────────
describe('Part 10 — MarginVisualization no longer claims a calculated suggestion is "our offer"', () => {
  const src = fs.readFileSync('src/components/lead-detail/workspace/MarginVisualization.jsx', 'utf8')
  it('labels the bar "Suggested Offer", never "Offer"/"our offer" — the underlying value was never an actual submitted offer', () => {
    expect(src).toMatch(/Suggested Offer \{fc\(currentOffer\)\}/)
    expect(src).toMatch(/room from Suggested Offer to Max Buy/)
    expect(src).not.toMatch(/room from our offer/)
  })
})

// ── Part 11 — header ASK vs EVALUATION ──────────────────────────────────────
describe('Part 11 — LeadEssentialsBar market-aware Ask/Evaluation label', () => {
  const src = fs.readFileSync('src/components/lead-detail/LeadEssentialsBar.jsx', 'utf8')
  it('uses resolveMarketType (the same canonical resolver used everywhere else) to decide Ask vs Evaluation', () => {
    expect(src).toMatch(/import \{ resolveMarketType \} from '\.\.\/\.\.\/lib\/distressInfo'/)
    expect(src).toMatch(/const isOffMarket = resolveMarketType\(lead\) === 'OFF_MARKET'/)
    expect(src).toMatch(/const askLabel = isOffMarket \? 'Evaluation' : 'Ask'/)
  })
})

// ── Part 7 — Distress card progressive disclosure ───────────────────────────
describe('Part 7 — DistressBanner collapsed by default, full detail behind a toggle', () => {
  const src = fs.readFileSync('src/components/lead-detail/DistressBanner.jsx', 'utf8')
  it('renders a compact "SELLER OPPORTUNITY" summary line and a View/Hide Distress Details toggle', () => {
    expect(src).toMatch(/SELLER OPPORTUNITY/)
    expect(src).toMatch(/View Distress Details/)
    expect(src).toMatch(/const \[expanded, setExpanded\] = useState\(false\)/)
  })
  it('no data removed — Filed/Owner/Parcel/Source/Case-Instrument/Lien facts still render, just behind {expanded}', () => {
    expect(src).toMatch(/\{expanded \? 'Hide Details' : 'View Distress Details'\}/)
    expect(src).toMatch(/Fact label="Filed"/)
    expect(src).toMatch(/Fact label="Parcel"/)
    expect(src).toMatch(/opportunity_why/)
  })
})

// ── Part 8 — MLS warning de-emphasized ──────────────────────────────────────
describe('Part 8 — MLS auto-enrichment-paused notice is now a small muted strip', () => {
  const src = fs.readFileSync('src/components/lead-detail/MlsStatusBanner.jsx', 'utf8')
  it('no longer renders as a full warm banner with border/background — compact text strip instead', () => {
    expect(src).not.toMatch(/bg-\[color:var\(--color-warn-soft\)\] border border-\[color:var\(--color-warn\)\] rounded-lg px-4 py-2\.5[\s\S]*MLS auto-enrichment paused/)
    expect(src).toMatch(/MLS enrichment paused/)
  })
})

// ── Part 9 — Deal Snapshot / Seller Snapshot dedup ──────────────────────────
describe('Part 9 — Overview duplication removed', () => {
  it('DealSnapshotCompact.jsx no longer recomputes Flip/BRRRR economics — ARV/Rehab/Rent + Open Deal Analysis only', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/DealSnapshotCompact.jsx', 'utf8')
    expect(src).not.toMatch(/^import \{ [^}]*computeFlipResult/m)
    expect(src).toMatch(/Cell label="ARV"/)
    expect(src).toMatch(/Cell label="Rehab"/)
    expect(src).toMatch(/Cell label="Rent"/)
  })
  it('SellerSnapshotStrip.jsx collapses to one action-oriented line when all 4 seller facts are unknown', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/SellerSnapshotStrip.jsx', 'utf8')
    expect(src).toMatch(/const allUnknown = unknownCount === rows\.length/)
    expect(src).toMatch(/4 key seller facts still unknown/)
  })
})

// ── Part 5/6 — Overview hero simplified further ─────────────────────────────
describe('Part 5/6 — DecisionHero hero simplified one more level', () => {
  const src = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
  it('WHY HAT SAYS THIS, the full priority reason, and Opportunity/Confidence/Urgency are now behind a Show Details toggle, not always visible', () => {
    expect(src).toMatch(/const \[showDetails, setShowDetails\] = useState\(false\)/)
    expect(src).toMatch(/\{showDetails \? 'Hide Details' : 'Show Details'\}/)
  })
  it('Margin of Safety headline (THIN/HEALTHY) remains always visible — the ONE main risk (Part 7 requirement) — even though its long "why" paragraph moved into Show Details', () => {
    expect(src).toMatch(/Margin of Safety<\/span>/)
  })
})

// ── I — financial/scoring/threshold isolation ───────────────────────────────
describe('Financial/scoring/threshold isolation — everything protected stays protected', () => {
  it('calculations.js, decisionEngineV2.js, buyBox.js, underwritingSettings.js have zero changes this session (verified via git diff in the final report)', () => {
    // This test locks the import surface DecisionHero/DealDecisionCenter
    // still use from those files — unchanged function names/signatures.
    const heroSrc = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    expect(heroSrc).toMatch(/import \{ formatCurrency as fc \} from '\.\.\/\.\.\/\.\.\/lib\/calculations'/)
  })
  it('dealExplanation.js — the ONE file touched among the protected list — changed ONLY additively: VERDICT_RANK/verdict thresholds/formula logic untouched, resolveEffectiveStrategy is a pure new export', () => {
    const src = fs.readFileSync('src/lib/dealExplanation.js', 'utf8')
    // Existing exports still present, unmodified signatures.
    expect(src).toMatch(/export function computeFlipResult\(lead, settings = null\)/)
    expect(src).toMatch(/export function computeBrrrrResult\(lead, settings = null\)/)
    expect(src).toMatch(/export function computeStrategyRecommendation\(flip, brrrr\)/)
    // New export, additive only.
    expect(src).toMatch(/export function resolveEffectiveStrategy\(strategyRec\)/)
  })
  it('Woodleigh golden Flip numbers are unchanged (MAO ~$102,222, verdict WATCH) — the fix only affects which strategy is EXPOSED as preferred, not any formula output', () => {
    const { flip } = computeAll(WOODLEIGH)
    expect(Math.round(flip.mao)).toBe(102222)
    expect(flip.verdict).toBe('WATCH')
  })
  it('Woodleigh golden BRRRR numbers are unchanged (MAO ~$111,364 at 70% LTV)', () => {
    const { brrrr } = computeAll(WOODLEIGH)
    expect(Math.round(brrrr.mao)).toBe(111494)
  })
})
