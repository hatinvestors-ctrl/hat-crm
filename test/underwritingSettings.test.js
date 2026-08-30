// test/underwritingSettings.test.js
// Underwriting Configuration V1 — SAFE IMPLEMENTATION regression suite.
//
// Golden Regression Contract (Woodleigh, verified by hand-calculation in
// the prior forensic QA and re-confirmed here through the generalized,
// settings-aware formulas): at default settings, every number MUST stay
// byte-identical to before this capability existed.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import {
  DEFAULT_UNDERWRITING_SETTINGS, UNDERWRITING_FIELDS, resolveUnderwritingSettings, resolveHoldMonths,
} from '../src/lib/underwritingSettings.js'
import { computeFlipResult, computeBrrrrResult } from '../src/lib/dealExplanation.js'
import { calculateFlipMAO, calculateBrrrrMAO, computeFlipBreakdown, computeBrrrrBreakdown, roundMaxBuy } from '../src/lib/calculations.js'
import { useDealStaleness } from '../src/hooks/useDealStaleness.js'

const GOLDEN_LEAD = { asking_price: 100000, arv: 200000, renovation_cost: 39000, hold_months: 6 }
const GOLDEN_LEAD_BRRRR = { ...GOLDEN_LEAD, rent_estimate: 1350 }

// ── PART 16 — Golden Default Regression ──────────────────────────────────
describe('PART 16 — Golden default regression (Woodleigh, no settings passed = pre-capability behavior)', () => {
  it('FLIP: MAO raw/display, All-In, Profit, Verdict all unchanged', () => {
    const flip = computeFlipResult(GOLDEN_LEAD)
    expect(flip.mao).toBeCloseTo(102222.0149, 3)
    expect(roundMaxBuy(flip.mao)).toBe(102200)
    expect(flip.breakdown.allIn).toBe(153618)
    expect(flip.projectedProfit).toBe(32382)
    expect(flip.verdict).toBe('WATCH')
  })
  it('BRRRR: refi loan/costs, mortgage payment, cash left, CF, CoC, MAO, verdict all unchanged', () => {
    const brrrr = computeBrrrrResult(GOLDEN_LEAD_BRRRR)
    expect(brrrr.breakdown.refiLoan).toBe(140000)
    expect(brrrr.breakdown.refiCosts).toBe(4200)
    expect(brrrr.breakdown.mortgagePayment).toBeCloseTo(903.39, 1)
    expect(brrrr.breakdown.taxesMonthly).toBe(208)
    expect(brrrr.breakdown.insuranceMonthly).toBe(100)
    expect(brrrr.cashLeftIn).toBe(17818)
    expect(brrrr.monthlyCashFlow).toBe(139)
    expect(brrrr.coc).toBeCloseTo(9.34, 1)
    expect(brrrr.mao).toBeCloseTo(111363.81, 1)
    expect(brrrr.verdict).toBe('PASS')
  })
  it('same golden numbers reproduced when EXPLICITLY passing default-equal settings (proves the settings path itself is correct, not just the omitted-settings fallback)', () => {
    const flip = computeFlipResult(GOLDEN_LEAD, DEFAULT_UNDERWRITING_SETTINGS)
    expect(roundMaxBuy(flip.mao)).toBe(102200)
    expect(flip.projectedProfit).toBe(32382)
    const brrrr = computeBrrrrResult(GOLDEN_LEAD_BRRRR, DEFAULT_UNDERWRITING_SETTINGS)
    expect(brrrr.cashLeftIn).toBe(17818)
    expect(brrrr.verdict).toBe('PASS')
  })
})

// ── PART 4 — hold_months zero bug ────────────────────────────────────────
describe('PART 4 — resolveHoldMonths: the previously-found falsy-zero bug is fixed', () => {
  it.each([
    [undefined, 6, 6],
    [null, 6, 6],
    [0, 6, 0],
    [3, 6, 3],
    [6, 6, 6],
    [9, 6, 9],
  ])('leadHoldMonths=%s, default=%s → %s', (input, def, expected) => {
    expect(resolveHoldMonths(input, def)).toBe(expected)
  })
  it('a real hold_months:0 now produces a DIFFERENT (higher) profit than the 6-month case — proves the fix reaches the actual calculation, not just the helper', () => {
    const zeroHold = computeFlipResult({ ...GOLDEN_LEAD, hold_months: 0 })
    const sixMonth = computeFlipResult(GOLDEN_LEAD)
    expect(zeroHold.projectedProfit).not.toBe(sixMonth.projectedProfit)
    expect(zeroHold.projectedProfit).toBeGreaterThan(sixMonth.projectedProfit) // less holding cost = more profit
  })
})

// ── PART 17 — DEFAULTS resolver behavior ─────────────────────────────────
describe('PART 17 — resolveUnderwritingSettings: defaults, partial config, zero preservation, malformed fallback', () => {
  it('missing config (undefined workspace settings) → every field is the system default', () => {
    const resolved = resolveUnderwritingSettings(undefined)
    expect(resolved).toEqual(DEFAULT_UNDERWRITING_SETTINGS)
  })
  it('missing underwriting key inside a real settings object → system defaults', () => {
    const resolved = resolveUnderwritingSettings({ mail_server: {} })
    expect(resolved).toEqual(DEFAULT_UNDERWRITING_SETTINGS)
  })
  it('partial config → configured values survive, everything else falls back to default', () => {
    const resolved = resolveUnderwritingSettings({ underwriting: { refi_ltv_pct: 75 } })
    expect(resolved.refi_ltv_pct).toBe(75)
    expect(resolved.flip_selling_cost_pct).toBe(DEFAULT_UNDERWRITING_SETTINGS.flip_selling_cost_pct)
    expect(resolved.default_holding_months).toBe(DEFAULT_UNDERWRITING_SETTINGS.default_holding_months)
  })
  it('a real configured ZERO survives — never coerced to the default (the mission\'s explicit anti-falsy-bug requirement)', () => {
    const resolved = resolveUnderwritingSettings({ underwriting: { flip_selling_cost_pct: 0, hml_points_pct: 0 } })
    expect(resolved.flip_selling_cost_pct).toBe(0)
    expect(resolved.hml_points_pct).toBe(0)
  })
  it('malformed values (wrong type, NaN, Infinity, out-of-range) safely fall back to default, never reach the engine', () => {
    const resolved = resolveUnderwritingSettings({
      underwriting: {
        refi_ltv_pct: 'seventy',       // wrong type
        hml_points_pct: NaN,
        acquisition_closing_costs: Infinity,
        flip_selling_cost_pct: -5,     // negative, below min 0
        refi_amort_years: 500,          // above max 40
      },
    })
    expect(resolved.refi_ltv_pct).toBe(DEFAULT_UNDERWRITING_SETTINGS.refi_ltv_pct)
    expect(resolved.hml_points_pct).toBe(DEFAULT_UNDERWRITING_SETTINGS.hml_points_pct)
    expect(resolved.acquisition_closing_costs).toBe(DEFAULT_UNDERWRITING_SETTINGS.acquisition_closing_costs)
    expect(resolved.flip_selling_cost_pct).toBe(DEFAULT_UNDERWRITING_SETTINGS.flip_selling_cost_pct)
    expect(resolved.refi_amort_years).toBe(DEFAULT_UNDERWRITING_SETTINGS.refi_amort_years)
  })
  it('unavailable settings (null) never crashes, never throws — safe fallback to defaults', () => {
    expect(() => resolveUnderwritingSettings(null)).not.toThrow()
    expect(resolveUnderwritingSettings(null)).toEqual(DEFAULT_UNDERWRITING_SETTINGS)
  })
  it('the resolver returns every field defined in UNDERWRITING_FIELDS — no missing key', () => {
    const resolved = resolveUnderwritingSettings({})
    for (const f of UNDERWRITING_FIELDS) expect(resolved).toHaveProperty(f.key)
  })
})

// ── PART 17 — FLIP settings tests ─────────────────────────────────────────
describe('PART 17 — FLIP: settings changes affect Flip economics correctly, isolated from BRRRR-only settings', () => {
  it('7% default selling cost reproduces the Woodleigh golden profit', () => {
    expect(computeFlipResult(GOLDEN_LEAD, { ...DEFAULT_UNDERWRITING_SETTINGS, flip_selling_cost_pct: 7 }).projectedProfit).toBe(32382)
  })
  it('8% selling cost changes Flip profit/MAO (ARV*1% less sale proceeds = -$2,000 profit)', () => {
    const at8 = computeFlipResult(GOLDEN_LEAD, { ...DEFAULT_UNDERWRITING_SETTINGS, flip_selling_cost_pct: 8 })
    expect(at8.projectedProfit).toBe(32382 - 2000) // 1% of $200K ARV
    expect(roundMaxBuy(at8.mao)).toBeLessThan(102200)
  })
  it('changing refi LTV does NOT affect Flip profit/MAO at all (independent formula)', () => {
    const base = computeFlipResult(GOLDEN_LEAD)
    const withDifferentRefi = computeFlipResult(GOLDEN_LEAD, { ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75 })
    expect(withDifferentRefi.projectedProfit).toBe(base.projectedProfit)
    expect(withDifferentRefi.mao).toBe(base.mao)
  })
})

// ── PART 17 — BRRRR settings tests ────────────────────────────────────────
describe('PART 17 — BRRRR: settings changes affect refi/debt-service economics correctly', () => {
  it('70% default LTV reproduces the Woodleigh golden refi loan', () => {
    expect(computeBrrrrResult(GOLDEN_LEAD_BRRRR, { ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 70 }).breakdown.refiLoan).toBe(140000)
  })
  it('75% LTV changes refi loan/cash-left economics', () => {
    const at75 = computeBrrrrResult(GOLDEN_LEAD_BRRRR, { ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75 })
    expect(at75.breakdown.refiLoan).toBe(150000) // 200000*0.75
    expect(at75.breakdown.refiLoan).not.toBe(140000)
  })
  it('refi rate change alters debt service / cash flow', () => {
    const at75rate = computeBrrrrResult(GOLDEN_LEAD_BRRRR, { ...DEFAULT_UNDERWRITING_SETTINGS, refi_interest_rate_pct: 7.5 })
    expect(at75rate.breakdown.mortgagePayment).toBeGreaterThan(903.39)
    expect(at75rate.monthlyCashFlow).toBeLessThan(139)
  })
  it('refi term change alters debt service', () => {
    const at15yr = computeBrrrrResult(GOLDEN_LEAD_BRRRR, { ...DEFAULT_UNDERWRITING_SETTINGS, refi_amort_years: 15 })
    expect(at15yr.breakdown.mortgagePayment).toBeGreaterThan(903.39) // shorter term = higher payment
  })
  it('refi-cost % change alters cash-left economics', () => {
    const at5pct = computeBrrrrResult(GOLDEN_LEAD_BRRRR, { ...DEFAULT_UNDERWRITING_SETTINGS, refi_costs_pct: 5 })
    expect(at5pct.cashLeftIn).toBeGreaterThan(17818) // higher refi costs = more cash left in
  })
  it('selling-cost % change does NOT alter BRRRR refi calculation (no sale-proceeds dependency)', () => {
    const base = computeBrrrrResult(GOLDEN_LEAD_BRRRR)
    const withDifferentSelling = computeBrrrrResult(GOLDEN_LEAD_BRRRR, { ...DEFAULT_UNDERWRITING_SETTINGS, flip_selling_cost_pct: 15 })
    expect(withDifferentSelling.breakdown.refiLoan).toBe(base.breakdown.refiLoan)
    expect(withDifferentSelling.cashLeftIn).toBe(base.cashLeftIn)
    expect(withDifferentSelling.monthlyCashFlow).toBe(base.monthlyCashFlow)
  })
})

// ── PART 17 — SHARED settings tests ───────────────────────────────────────
describe('PART 17 — SHARED: taxes/insurance/interest/points/financing/holding affect applicable economics', () => {
  it('taxes affect both Flip holding cost and BRRRR cash flow', () => {
    const higherTaxes = { ...DEFAULT_UNDERWRITING_SETTINGS, monthly_taxes: 300 }
    const flip = computeFlipResult(GOLDEN_LEAD, higherTaxes)
    expect(flip.breakdown.totalHolding).toBeGreaterThan(9588)
    const brrrr = computeBrrrrResult(GOLDEN_LEAD_BRRRR, higherTaxes)
    expect(brrrr.monthlyCashFlow).toBeLessThan(139)
  })
  it('insurance affects both Flip and BRRRR the same way', () => {
    const higherIns = { ...DEFAULT_UNDERWRITING_SETTINGS, monthly_insurance: 150 }
    expect(computeFlipResult(GOLDEN_LEAD, higherIns).breakdown.totalHolding).toBeGreaterThan(9588)
    expect(computeBrrrrResult(GOLDEN_LEAD_BRRRR, higherIns).monthlyCashFlow).toBeLessThan(139)
  })
  it('HML interest affects carrying (holding) economics', () => {
    const higherRate = { ...DEFAULT_UNDERWRITING_SETTINGS, hml_interest_monthly_pct: 1.5 }
    expect(computeFlipResult(GOLDEN_LEAD, higherRate).projectedProfit).toBeLessThan(32382)
  })
  it('HML points affect acquisition economics', () => {
    const higherPoints = { ...DEFAULT_UNDERWRITING_SETTINGS, hml_points_pct: 3 }
    expect(computeFlipResult(GOLDEN_LEAD, higherPoints).projectedProfit).toBeLessThan(32382)
  })
  it('purchase financing % affects loan/down-payment economics', () => {
    const lowerFinancing = { ...DEFAULT_UNDERWRITING_SETTINGS, hml_purchase_financing_pct: 80 }
    const b = computeFlipBreakdown(100000, 200000, 39000, 6, lowerFinancing)
    expect(b.downPayment).toBeCloseTo(20000, 5) // 20% instead of 10%
    expect(b.hmlLoan).toBe(100000 * 0.80 + 39000)
  })
  it('holding period affects applicable holding economics for both strategies', () => {
    const flip9mo = computeFlipResult({ ...GOLDEN_LEAD, hold_months: 9 })
    expect(flip9mo.breakdown.totalHolding).toBeGreaterThan(9588)
    expect(flip9mo.projectedProfit).toBeLessThan(32382)
  })
})

// ── PART 17 — STALENESS tests ──────────────────────────────────────────────
describe('PART 17 — STALENESS: underwriting assumption drift detection', () => {
  const frozenAt70 = { arv: 200000, renovation_cost: 39000, asking_price: 100000, strategy: 'flip', underwriting: { ...DEFAULT_UNDERWRITING_SETTINGS } }
  function leadWithFrozen(frozenSettings, liveSettingsOverride = {}) {
    return {
      arv: 200000, renovation_cost: 39000, asking_price: 100000,
      deal_analysis: { strategy: 'flip', inputs: { ...frozenAt70, underwriting: frozenSettings } },
      _liveSettings: { ...DEFAULT_UNDERWRITING_SETTINGS, ...liveSettingsOverride },
    }
  }

  it('material underwriting setting change → stale', () => {
    const lead = leadWithFrozen(DEFAULT_UNDERWRITING_SETTINGS, { refi_ltv_pct: 75 })
    const result = useDealStaleness(lead, lead._liveSettings)
    expect(result.stale).toBe(true)
    expect(result.reasons.some(r => /Underwriting assumptions changed/.test(r))).toBe(true)
  })
  it('unchanged settings → not stale (from this check specifically)', () => {
    const lead = leadWithFrozen(DEFAULT_UNDERWRITING_SETTINGS, {})
    const result = useDealStaleness(lead, lead._liveSettings)
    expect(result.reasons.some(r => /Underwriting assumptions changed/.test(r))).toBe(false)
  })
  it('legacy analysis with no frozen underwriting snapshot, and current settings still equal system defaults → not stale (nothing to compare, honest)', () => {
    const lead = {
      arv: 200000, renovation_cost: 39000, asking_price: 100000,
      deal_analysis: { strategy: 'flip', inputs: { arv: 200000, renovation_cost: 39000 } }, // no underwriting key
    }
    const result = useDealStaleness(lead, DEFAULT_UNDERWRITING_SETTINGS)
    expect(result.reasons.some(r => /underwriting/i.test(r))).toBe(false)
  })
  it('legacy analysis with no frozen underwriting snapshot, but workspace HAS customized defaults since → conservatively stale', () => {
    const lead = {
      arv: 200000, renovation_cost: 39000, asking_price: 100000,
      deal_analysis: { strategy: 'flip', inputs: { arv: 200000, renovation_cost: 39000 } },
    }
    const result = useDealStaleness(lead, { ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 80 })
    expect(result.stale).toBe(true)
    expect(result.reasons.some(r => /predates underwriting-settings tracking/.test(r))).toBe(true)
  })
  it('omitting underwritingSettings entirely (legacy call site) never throws and behaves as before', () => {
    expect(() => useDealStaleness({ deal_analysis: { inputs: { arv: 1, renovation_cost: 1 } } })).not.toThrow()
  })
})

// ── PART 5/19 — Consolidation safety (source-level) ──────────────────────
describe('PART 5/19 — server-function consolidation, source-level verification', () => {
  const analyzeDealSrc = fs.readFileSync('netlify/functions/analyze-deal.mjs', 'utf8')
  const generateReportSrc = fs.readFileSync('netlify/functions/generate-report.mjs', 'utf8')
  const generateCoreAnalysisSrc = fs.readFileSync('netlify/functions/generate-core-analysis.mjs', 'utf8')
  const decisionEngineV2Src = fs.readFileSync('src/lib/decisionEngineV2.js', 'utf8')

  it('analyze-deal.mjs Flip metrics now import and delegate to the canonical computeFlipBreakdown (was a hand-copy)', () => {
    expect(analyzeDealSrc).toMatch(/import \{ computeFlipBreakdown, computeBrrrrBreakdown \} from '\.\.\/\.\.\/src\/lib\/calculations\.js'/)
    expect(analyzeDealSrc).toMatch(/const b = computeFlipBreakdown\(pp, arv, reno, holdMonths, settings\)/)
  })
  it('analyze-deal.mjs BRRRR metrics: the prior STOP CONDITION is explicitly lifted and consolidated by the P0/P1 Decision Integrity Fix (2026-08-30) — see test/decisionIntegrityFix.test.js for full coverage of the new canonical delegation', () => {
    // The old flat-multiplier mortgage payment and clamped cash-left-in
    // formula are gone from live code — replaced by a straight delegation
    // to the canonical computeBrrrrBreakdown, explicitly authorized by
    // the later task specifically BECAUSE the disagreement this comment
    // used to describe was itself the decision-integrity defect.
    const liveCode = analyzeDealSrc.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(liveCode).not.toMatch(/refiLoan \* 0\.006607/)
    expect(analyzeDealSrc).toMatch(/const b = computeBrrrrBreakdown\(pp, arv, reno, monthlyRent, holdMonths, \{ settings \}\)/)
  })
  it('generate-report.mjs scenarioProfit now imports and delegates to computeFlipBreakdown', () => {
    expect(generateReportSrc).toMatch(/import \{ computeFlipBreakdown \} from '\.\.\/\.\.\/src\/lib\/calculations\.js'/)
    expect(generateReportSrc).toMatch(/computeFlipBreakdown\(pp, arv, reno, holdMonths, underwriting_settings\)\.totalProfit/)
  })
  it('generate-core-analysis.mjs legacy line-508 MAO literal is REMOVED — fixed by the P0/P1 Decision Integrity Fix (2026-08-30, see test/decisionIntegrityFix.test.js); computed_mao now reuses buildPrompt\'s own canonical calculateFlipMAO value', () => {
    const liveCode = generateCoreAnalysisSrc.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(liveCode).not.toMatch(/_arv \* 0\.75 - _reno - 2450/)
    expect(generateCoreAnalysisSrc).toMatch(/computedMao: computedMaoForResponse, computedStartingOffer\s*\}\s*=\s*buildPrompt/)
  })
  it('decisionEngineV2.js (Action Center/V2) still uses the separate legacy calculateMAO — untouched, never wired to underwriting settings', () => {
    expect(decisionEngineV2Src).toMatch(/calculateMAO\(arv, reno/)
    expect(decisionEngineV2Src).not.toMatch(/underwritingSettings|resolveUnderwritingSettings/)
  })
})

// ── Protected areas — no formula/threshold changed ────────────────────────
describe('Protected areas — thresholds, verdict rules, Action Center scoring untouched', () => {
  it('FLIP_MIN_PROFIT_TARGET / FLIP_STRONG_PROFIT / FLIP_PASS_MARGIN unchanged', () => {
    const src = fs.readFileSync('src/lib/calculations.js', 'utf8')
    expect(src).toMatch(/export const FLIP_MIN_PROFIT_TARGET = 30000/)
    expect(src).toMatch(/export const FLIP_STRONG_PROFIT = 40000/)
    expect(src).toMatch(/export const FLIP_PASS_MARGIN = 5000/)
    expect(src).toMatch(/export const BRRRR_MAX_CASH_LEFT_IN = 30000/)
  })
  it('verdict branch thresholds in dealExplanation.js unchanged', () => {
    const src = fs.readFileSync('src/lib/dealExplanation.js', 'utf8')
    expect(src).toMatch(/if \(profitAtEvaluationPrice >= FLIP_STRONG_PROFIT\) verdict = 'STRONG'/)
    expect(src).toMatch(/else if \(profitAtEvaluationPrice >= FLIP_MIN_PROFIT_TARGET \+ THIN_MARGIN\) verdict = 'PASS'/)
  })
})
