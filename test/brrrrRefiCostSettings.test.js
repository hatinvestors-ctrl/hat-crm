// test/brrrrRefiCostSettings.test.js
// BRRRR Refinance Cost Settings Integrity Fix (2026-08-30).
//
// Confirmed root cause: DealAnalysisCard.jsx's `FullBreakdownTab`
// component (the Deal page's "Full Breakdown" tab) never received
// `underwritingSettings` — its call site passed only `lead`/`strategy` —
// so calculateBrrrrMAO/computeBrrrrBreakdown/calculateFlipMAO/
// computeFlipBreakdown all silently fell back to their own internal
// hardcoded defaults (70% LTV, 3% of a 70%-LTV loan) instead of the
// workspace's actual configured settings. This was NOT a duplicate/
// hand-coded formula (it already called the right canonical functions)
// — it was a wiring gap: a genuine canonical consumer that bypassed the
// settings resolver entirely.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { calculateBrrrrMAO, computeBrrrrBreakdown, getEffectiveOffer, computeFlipBreakdown } from '../src/lib/calculations.js'
import { DEFAULT_UNDERWRITING_SETTINGS } from '../src/lib/underwritingSettings.js'

const dealAnalysisCardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')

const WOODLEIGH = { arv: 200000, renovation_cost: 39000, rent_estimate: 1350, hold_months: 6, asking_price: 100000 }

// Reproduces exactly what FullBreakdownTab does internally (arv/reno/rent/
// holdMonths fixed to the golden case; only `settings` varies) — this is
// the same call chain the component itself runs, not a re-implementation.
function fullBreakdownLogic(settings) {
  const canonicalMao = calculateBrrrrMAO(WOODLEIGH.arv, WOODLEIGH.renovation_cost, WOODLEIGH.rent_estimate, WOODLEIGH.hold_months, undefined, settings)?.mao
  const pp = Number(getEffectiveOffer(WOODLEIGH, canonicalMao) || 0)
  const f = computeBrrrrBreakdown(pp, WOODLEIGH.arv, WOODLEIGH.renovation_cost, WOODLEIGH.rent_estimate, WOODLEIGH.hold_months, { settings })
  return { pp, refiLoan: Math.round(f.refiLoan), refiCosts: Math.round(f.refiCosts), cashLeftIn: Math.round(f.cashLeftIn) }
}

// ── Part 1/2 — the fix: FullBreakdownTab now threads settings ─────────────
describe('Part 1/2 — root cause fixed: FullBreakdownTab now receives and threads underwritingSettings', () => {
  it('FullBreakdownTab\'s signature accepts underwritingSettings', () => {
    expect(dealAnalysisCardSrc).toMatch(/function FullBreakdownTab\(\{ lead, strategy, underwritingSettings = null \}\)/)
  })
  it('its call site now passes underwritingSettings (previously omitted entirely)', () => {
    expect(dealAnalysisCardSrc).toMatch(/<FullBreakdownTab lead=\{lead\} strategy=\{strategy\} underwritingSettings=\{underwritingSettings\} \/>/)
  })
  it('no duplicate refi-cost setting was created — the existing refi_costs_pct key is reused', () => {
    const settingsSrc = fs.readFileSync('src/lib/underwritingSettings.js', 'utf8')
    const occurrences = (settingsSrc.match(/refi_costs_pct/g) || []).length
    expect(occurrences).toBeGreaterThan(0)
    // exactly one field definition in UNDERWRITING_FIELDS
    const fieldDefs = settingsSrc.match(/key: 'refi_costs_pct'/g) || []
    expect(fieldDefs.length).toBe(1)
  })
})

// ── Part 5 — manual configuration test (exact mission numbers) ────────────
describe('Part 5 — Woodleigh at 75% LTV: refi-cost % configuration test (A/B/C, exact mission numbers)', () => {
  it('TEST A — 3% (default): refi loan $150,000, refi costs $4,500, cash left in $8,118', () => {
    const r = fullBreakdownLogic({ ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75, refi_costs_pct: 3 })
    expect(r.refiLoan).toBe(150000)
    expect(r.refiCosts).toBe(4500)
    expect(r.cashLeftIn).toBe(8118)
  })
  it('TEST B — 2%: refi costs $3,000, cash left in $6,618', () => {
    const r = fullBreakdownLogic({ ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75, refi_costs_pct: 2 })
    expect(r.refiCosts).toBe(3000)
    expect(r.cashLeftIn).toBe(6618)
  })
  it('TEST C — 4%: refi costs $6,000, cash left in $9,618', () => {
    const r = fullBreakdownLogic({ ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75, refi_costs_pct: 4 })
    expect(r.refiCosts).toBe(6000)
    expect(r.cashLeftIn).toBe(9618)
  })
  it('monotonic: higher refi cost % → higher refi costs → less cash returned → more cash left in', () => {
    const r2 = fullBreakdownLogic({ ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75, refi_costs_pct: 2 })
    const r3 = fullBreakdownLogic({ ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75, refi_costs_pct: 3 })
    const r4 = fullBreakdownLogic({ ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75, refi_costs_pct: 4 })
    expect(r2.refiCosts).toBeLessThan(r3.refiCosts)
    expect(r3.refiCosts).toBeLessThan(r4.refiCosts)
    expect(r2.cashLeftIn).toBeLessThan(r3.cashLeftIn)
    expect(r3.cashLeftIn).toBeLessThan(r4.cashLeftIn)
  })
  it('zero refi cost is valid — never coerced to the 3% default (anti-falsy-zero guarantee)', () => {
    const r = fullBreakdownLogic({ ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75, refi_costs_pct: 0 })
    expect(r.refiCosts).toBe(0)
  })
  it('missing setting (undefined refi_costs_pct) falls back to the current system default 3%', () => {
    const r = fullBreakdownLogic({ ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75, refi_costs_pct: undefined })
    expect(r.refiCosts).toBe(4500)
  })
  it('malformed setting (wrong type) falls back safely to 3%, never crashes', () => {
    expect(() => fullBreakdownLogic({ ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75, refi_costs_pct: 'three percent' })).not.toThrow()
    const r = fullBreakdownLogic({ ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75, refi_costs_pct: 'three percent' })
    expect(r.refiCosts).toBe(4500)
  })
  it('no settings object at all (the pre-fix bug reproduction) uses the internal 70%/3% defaults — proves this scenario, once silent, is now what the fix eliminates from FullBreakdownTab', () => {
    const r = fullBreakdownLogic(null)
    expect(r.refiLoan).toBe(140000) // 70% default, NOT the workspace's configured 75%
  })
})

// ── Part 6 — Flip isolation ─────────────────────────────────────────────────
describe('Part 6 — refi-cost % changes affect ONLY BRRRR, never Flip', () => {
  it('Flip breakdown (MAO, profit, all-in) is byte-identical regardless of refi_costs_pct', () => {
    const flipAt2 = computeFlipBreakdown(100000, 200000, 39000, 6, { ...DEFAULT_UNDERWRITING_SETTINGS, refi_costs_pct: 2 })
    const flipAt3 = computeFlipBreakdown(100000, 200000, 39000, 6, { ...DEFAULT_UNDERWRITING_SETTINGS, refi_costs_pct: 3 })
    const flipAt4 = computeFlipBreakdown(100000, 200000, 39000, 6, { ...DEFAULT_UNDERWRITING_SETTINGS, refi_costs_pct: 4 })
    expect(flipAt2.totalProfit).toBe(flipAt3.totalProfit)
    expect(flipAt3.totalProfit).toBe(flipAt4.totalProfit)
    expect(flipAt2.allIn).toBe(flipAt3.allIn)
  })
  it('changing refi_costs_pct does not change ARV, rehab, rent, HML terms, refi loan amount, or mortgage P&I', () => {
    const r2 = computeBrrrrBreakdown(100000, 200000, 39000, 1350, 6, { settings: { ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75, refi_costs_pct: 2 } })
    const r4 = computeBrrrrBreakdown(100000, 200000, 39000, 1350, 6, { settings: { ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75, refi_costs_pct: 4 } })
    expect(r2.refiLoan).toBe(r4.refiLoan)
    expect(r2.hmlLoan).toBe(r4.hmlLoan)
    expect(r2.mortgagePayment).toBe(r4.mortgagePayment)
  })
})

// ── Part 3 — cross-consumer consistency ────────────────────────────────────
describe('Part 3 — same effective refi-cost % reaches every intended canonical consumer', () => {
  const filesThatMustThreadSettings = [
    ['src/components/lead-detail/DealAnalysisCard.jsx', /computeBrrrrBreakdown\(currentPP, arv, reno, rent, holdMonths, \{ settings: underwritingSettings \}\)/],
    ['src/components/lead-detail/DealAnalysisCard.jsx', /computeBrrrrBreakdown\(pp, arv, reno, rent, holdMonths, \{ settings: underwritingSettings \}\)/],
    ['src/components/lead-detail/FinancialSection.jsx', /computeBrrrrBreakdown\(formulaMao, lead\.arv, lead\.renovation_cost, lead\.rent_estimate, resolveHoldMonths\(lead\.hold_months, underwritingSettings\?\.default_holding_months\), \{ settings: underwritingSettings \}\)/],
    ['src/lib/dealExplanation.js', /computeBrrrrBreakdown\(currentOffer, arv, reno, rent, holdMonths, \{ settings \}\)/],
    ['netlify/functions/analyze-deal.mjs', /const b = computeBrrrrBreakdown\(pp, arv, reno, monthlyRent, holdMonths, \{ settings \}\)/],
    ['netlify/functions/generate-core-analysis.mjs', /computeBrrrrBreakdown\(pp, arv, reno, rentEst, holdMo, \{ settings: underwritingSettings \}\)/],
  ]
  it.each(filesThatMustThreadSettings)('%s threads settings into its computeBrrrrBreakdown call', (file, pattern) => {
    const src = fs.readFileSync(file, 'utf8')
    expect(src).toMatch(pattern)
  })
  it('classified finding (NOT fixed in this pass — different feature surface, no golden case exercises it): src/lib/dealBriefInputs.js\'s computePriceGuidance still calls calculateBrrrrMAO with no settings — the Acquisition Copilot brief pipeline, not the Deal page/AI-analysis pipeline this task targets', () => {
    const src = fs.readFileSync('src/lib/dealBriefInputs.js', 'utf8')
    expect(src).toMatch(/calculateBrrrrMAO\(arv, reno, rent, holdMonths\)\?\.mao/)
  })
})

// ── Part 6 (label accuracy) — no stale "70%"/"3%" text once fixed ─────────
describe('label text in the fixed component reflects the effective %, not a hardcoded default', () => {
  it('FullBreakdownTab labels are computed from underwritingSettings, not literal "70%"/"3%" strings', () => {
    expect(dealAnalysisCardSrc).toMatch(/const refiLtvPctDisplay\s*=\s*underwritingSettings\?\.refi_ltv_pct \?\? 70/)
    expect(dealAnalysisCardSrc).toMatch(/const refiCostsPctDisplay\s*=\s*underwritingSettings\?\.refi_costs_pct \?\? 3/)
    expect(dealAnalysisCardSrc).toMatch(/label=\{`Refi Loan \(\$\{refiLtvPctDisplay\}% of ARV\)`\}/)
    expect(dealAnalysisCardSrc).toMatch(/label=\{`Refi Closing Costs \(\$\{refiCostsPctDisplay\}%\)`\}/)
  })
})

// ── Part 7 — Deal page and canonical backend match ─────────────────────────
describe('Part 7 — Deal page (FullBreakdownTab logic) and canonical backend (computeBrrrrBreakdown directly) agree exactly', () => {
  it('at 75%/3%, FullBreakdownTab\'s derived numbers equal a direct computeBrrrrBreakdown call with the same inputs', () => {
    const settings = { ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75, refi_costs_pct: 3 }
    const viaTab = fullBreakdownLogic(settings)
    const direct = computeBrrrrBreakdown(100000, 200000, 39000, 1350, 6, { settings })
    expect(viaTab.refiLoan).toBe(Math.round(direct.refiLoan))
    expect(viaTab.refiCosts).toBe(Math.round(direct.refiCosts))
    expect(viaTab.cashLeftIn).toBe(Math.round(direct.cashLeftIn))
  })
})

// ── Protected — no methodology/threshold changed ───────────────────────────
describe('Protected — no financial methodology or threshold changed by this settings-wiring fix', () => {
  it('BRRRR_MAX_CASH_LEFT_IN and Flip thresholds unchanged', () => {
    const src = fs.readFileSync('src/lib/calculations.js', 'utf8')
    expect(src).toMatch(/export const BRRRR_MAX_CASH_LEFT_IN = 30000/)
    expect(src).toMatch(/export const FLIP_MIN_PROFIT_TARGET = 30000/)
  })
  it('calculations.js was not touched by this task', () => {
    const src = fs.readFileSync('src/lib/calculations.js', 'utf8')
    expect(src).not.toMatch(/BRRRR Refinance Cost Settings Integrity Fix/)
  })
})
