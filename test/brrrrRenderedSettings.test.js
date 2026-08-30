// test/brrrrRenderedSettings.test.js
// P0/P1 — BRRRR Rendered Settings Integrity Fix (2026-08-30).
//
// Confirmed root cause (browser QA, not the canonical engine): the actual
// rendered "Deal → BRRRR Cash Left In → View Calculation" card
// (src/components/lead-detail/workspace/DealDecisionCenter.jsx) reads its
// rows straight from `computeBrrrrResult(lead, settings).breakdown` — a
// SINGLE canonical object, exactly as intended. But
// computeBrrrrBreakdown's own RETURN OBJECT (src/lib/calculations.js) had
// three DESCRIPTIVE fields hardcoded as literals — `refiLtvPct: 0.70`,
// `taxesMonthly: 208`, `insuranceMonthly: 100` — instead of the local
// variables already used for the real math. The real math (refiLoan,
// refiCosts, monthlyCF, cashLeftIn, etc.) was ALWAYS correct; only these
// three labels lied about which settings had actually been used —
// exactly the "Gross Refinance Loan: $150,000 (75%) / Refinance LTV: 70%"
// contradiction from the browser screenshot. This suite tests the ACTUAL
// rendered path (computeBrrrrResult → .breakdown → the exact fields
// DealDecisionCenter's JSX reads) — not computeBrrrrBreakdown in
// isolation — because the previous task's tests already covered the
// engine and browser QA still failed.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { computeBrrrrResult } from '../src/lib/dealExplanation.js'
import { computeFlipResult } from '../src/lib/dealExplanation.js'
import { DEFAULT_UNDERWRITING_SETTINGS } from '../src/lib/underwritingSettings.js'

const dealDecisionCenterSrc = fs.readFileSync('src/components/lead-detail/workspace/DealDecisionCenter.jsx', 'utf8')
const calculationsSrc = fs.readFileSync('src/lib/calculations.js', 'utf8')

const WOODLEIGH = { arv: 200000, renovation_cost: 39000, rent_estimate: 1350, hold_months: 6, asking_price: 100000, starting_offer: 100000 }

// Reproduces EXACTLY what DealDecisionCenter's JSX does: `const b =
// brrrr.breakdown` then reads b.refiLtvPct/b.grossRefiLoan/b.refiCosts/
// b.netRefiCashReturned/b.totalCashInvested/b.monthlyCF/b.taxesMonthly/
// b.insuranceMonthly — the identical field names, identical source.
function renderedBrrrrCard(settings) {
  const brrrr = computeBrrrrResult(WOODLEIGH, settings)
  const b = brrrr.breakdown
  return {
    refiLtvLabel: `${(b.refiLtvPct * 100).toFixed(0)}%`,
    grossRefiLoan: Math.round(b.grossRefiLoan),
    refiCosts: Math.round(b.refiCosts),
    netCashReturned: Math.round(b.netRefiCashReturned),
    cashLeftIn: Math.round(b.totalCashInvested),
    monthlyCF: Math.round(b.monthlyCF),
    taxesMonthly: b.taxesMonthly,
    insuranceMonthly: b.insuranceMonthly,
  }
}

// ── Part 6/13 — the exact rendered card, golden case ───────────────────────
describe('Part 6/13 — the ACTUAL rendered BRRRR Cash Left In card (Woodleigh, 75% LTV / 3% refi costs)', () => {
  const settings = { ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75, refi_costs_pct: 3 }
  const r = renderedBrrrrCard(settings)
  it('Refinance LTV label reads 75% — matching the loan it labels, not a stale 70%', () => {
    expect(r.refiLtvLabel).toBe('75%')
  })
  it('Gross Refinance Loan = $150,000', () => { expect(r.grossRefiLoan).toBe(150000) })
  it('Refinance Closing Costs = $4,500 — NOT the observed-wrong $4,350', () => {
    expect(r.refiCosts).toBe(4500)
    expect(r.refiCosts).not.toBe(4350)
  })
  it('Net Cash Returned = $16,500', () => { expect(r.netCashReturned).toBe(16500) })
  it('Cash Left In = $8,118 — NOT the observed-wrong $7,968', () => {
    expect(r.cashLeftIn).toBe(8118)
    expect(r.cashLeftIn).not.toBe(7968)
  })
  it('Monthly Cash Flow stays ≈ +$74/mo — untouched by this fix (same methodology)', () => {
    expect(r.monthlyCF).toBe(74)
  })
})

// ── Part 8 — LTV regression: label and loan always agree ──────────────────
describe('Part 8 — the rendered LTV label and the rendered loan amount always come from the same effective setting', () => {
  it('70% LTV: loan $140,000, label "70%"', () => {
    const r = renderedBrrrrCard({ ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 70, refi_costs_pct: 3 })
    expect(r.grossRefiLoan).toBe(140000)
    expect(r.refiLtvLabel).toBe('70%')
  })
  it('75% LTV: loan $150,000, label "75%"', () => {
    const r = renderedBrrrrCard({ ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75, refi_costs_pct: 3 })
    expect(r.grossRefiLoan).toBe(150000)
    expect(r.refiLtvLabel).toBe('75%')
  })
  it('never label=70% while loan reflects 75% (the exact confirmed defect) — for 10 arbitrary LTVs, label always matches loan/ARV', () => {
    for (const ltv of [65, 68, 70, 72, 75, 78, 80]) {
      const r = renderedBrrrrCard({ ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: ltv, refi_costs_pct: 3 })
      const impliedLtvFromLoan = Math.round((r.grossRefiLoan / WOODLEIGH.arv) * 100)
      expect(r.refiLtvLabel).toBe(`${impliedLtvFromLoan}%`)
    }
  })
})

// ── Part 7 — A/B/C refi-cost regression on the RENDERED card ──────────────
describe('Part 7 — Settings A/B/C on the rendered card (not just the engine)', () => {
  it('CASE A — 2%: refi costs $3,000, net cash returned $18,000, cash left in $6,618', () => {
    const r = renderedBrrrrCard({ ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75, refi_costs_pct: 2 })
    expect(r.refiCosts).toBe(3000)
    expect(r.netCashReturned).toBe(18000)
    expect(r.cashLeftIn).toBe(6618)
  })
  it('CASE B — 3%: refi costs $4,500, net cash returned $16,500, cash left in $8,118', () => {
    const r = renderedBrrrrCard({ ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75, refi_costs_pct: 3 })
    expect(r.refiCosts).toBe(4500)
    expect(r.netCashReturned).toBe(16500)
    expect(r.cashLeftIn).toBe(8118)
  })
  it('CASE C — 4%: refi costs $6,000, net cash returned $15,000, cash left in $9,618', () => {
    const r = renderedBrrrrCard({ ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75, refi_costs_pct: 4 })
    expect(r.refiCosts).toBe(6000)
    expect(r.netCashReturned).toBe(15000)
    expect(r.cashLeftIn).toBe(9618)
  })
  it('monotonicity on the rendered card: higher refi-cost % → higher refi costs → lower cash returned → higher cash left in', () => {
    const a = renderedBrrrrCard({ ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75, refi_costs_pct: 2 })
    const b = renderedBrrrrCard({ ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75, refi_costs_pct: 3 })
    const c = renderedBrrrrCard({ ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75, refi_costs_pct: 4 })
    expect(a.refiCosts).toBeLessThan(b.refiCosts)
    expect(b.refiCosts).toBeLessThan(c.refiCosts)
    expect(a.netCashReturned).toBeGreaterThan(b.netCashReturned)
    expect(b.netCashReturned).toBeGreaterThan(c.netCashReturned)
    expect(a.cashLeftIn).toBeLessThan(b.cashLeftIn)
    expect(b.cashLeftIn).toBeLessThan(c.cashLeftIn)
  })
})

// ── Part 3/4 — source-level single-source-of-truth proof ──────────────────
describe('Part 3/4 — DealDecisionCenter renders directly from the canonical breakdown, no independent recompute', () => {
  it('the JSX reads b.refiLtvPct/b.grossRefiLoan/b.refiCosts/b.netRefiCashReturned straight from the canonical breakdown object', () => {
    expect(dealDecisionCenterSrc).toMatch(/const b = brrrr\.breakdown/)
    expect(dealDecisionCenterSrc).toMatch(/value: `\$\{\(b\.refiLtvPct \* 100\)\.toFixed\(0\)\}%`/)
    expect(dealDecisionCenterSrc).toMatch(/value: fc\(Math\.round\(b\.grossRefiLoan\)\)/)
    expect(dealDecisionCenterSrc).toMatch(/value: `−\$\{fc\(Math\.round\(b\.refiCosts\)\)\}`/)
  })
  it('no hand-written BRRRR refi-loan/refi-cost formula exists inside DealDecisionCenter.jsx — the BRRRR rows are pure presentation of the canonical breakdown', () => {
    // Scoped to the BRRRR section specifically (Flip's own separate,
    // pre-existing "arv * 0.93" selling-costs display line is a
    // different, out-of-scope finding — not what this task fixes).
    const brrrrSection = dealDecisionCenterSrc.slice(dealDecisionCenterSrc.indexOf('BRRRR — Refi'), dealDecisionCenterSrc.indexOf('Monthly Cash Flow'))
    expect(brrrrSection).not.toMatch(/arv \* 0\.\d+/i)
    expect(brrrrSection).not.toMatch(/refiLoan \* 0\.\d+/)
    expect(brrrrSection).not.toMatch(/0\.70|0\.75/)
    expect(brrrrSection).not.toMatch(/'70%'|"70%"|`70%`/)
  })
  it('calculations.js\'s computeBrrrrBreakdown no longer hardcodes refiLtvPct/taxesMonthly/insuranceMonthly in its return object — they now reuse the same local variables the real math uses', () => {
    const liveCode = calculationsSrc.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(liveCode).not.toMatch(/refiLtvPct: 0\.70/)
    expect(liveCode).not.toMatch(/taxesMonthly: 208/)
    expect(liveCode).not.toMatch(/insuranceMonthly: 100/)
    expect(calculationsSrc).toMatch(/refiValue: arv, refiLtvPct, grossRefiLoan: refiLoan, hmlPayoff: hmlLoan,/)
    expect(calculationsSrc).toMatch(/taxesMonthly: monthlyTaxes, insuranceMonthly: monthlyInsurance/)
  })
})

// ── Part 9 — cross-screen consistency ──────────────────────────────────────
describe('Part 9 — cross-screen consistency: Deal summary, rendered card, and direct engine call all agree', () => {
  it('the compact BRRRR summary row (brrrr.cashLeftIn) and the expanded card (b.totalCashInvested) report the same number', () => {
    const settings = { ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75, refi_costs_pct: 3 }
    const brrrr = computeBrrrrResult(WOODLEIGH, settings)
    expect(brrrr.cashLeftIn).toBe(Math.round(brrrr.breakdown.totalCashInvested))
  })
})

// ── Part 11 — Flip isolation ───────────────────────────────────────────────
describe('Part 11 — refi_ltv_pct / refi_costs_pct changes never affect Flip', () => {
  it('Flip MAO/profit/all-in identical across 70/75% LTV and 2/3/4% refi costs', () => {
    const base = computeFlipResult(WOODLEIGH, DEFAULT_UNDERWRITING_SETTINGS)
    for (const s of [
      { ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 70 },
      { ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75 },
      { ...DEFAULT_UNDERWRITING_SETTINGS, refi_costs_pct: 2 },
      { ...DEFAULT_UNDERWRITING_SETTINGS, refi_costs_pct: 4 },
    ]) {
      const flip = computeFlipResult(WOODLEIGH, s)
      expect(flip.mao).toBe(base.mao)
      expect(flip.projectedProfit).toBe(base.projectedProfit)
      expect(flip.breakdown.allIn).toBe(base.breakdown.allIn)
    }
  })
})

// ── Part 12 — no business-rule changes ─────────────────────────────────────
describe('Part 12 — no threshold/methodology change', () => {
  it('BRRRR_MAX_CASH_LEFT_IN / FLIP_MIN_PROFIT_TARGET unchanged', () => {
    expect(calculationsSrc).toMatch(/export const BRRRR_MAX_CASH_LEFT_IN = 30000/)
    expect(calculationsSrc).toMatch(/export const FLIP_MIN_PROFIT_TARGET = 30000/)
  })
  it('mortgage-payment / cash-flow formula source lines unchanged (only descriptive return fields were fixed)', () => {
    expect(calculationsSrc).toMatch(/const refiMoPmt\s+= calculateMortgagePayment\(refiLoan, refiInterestRate, amortizationYears\)/)
    expect(calculationsSrc).toMatch(/const monthlyCF\s+= monthlyRent > 0 \? monthlyRent - refiMoPmt - monthlyTaxes - monthlyInsurance : null/)
  })
})
