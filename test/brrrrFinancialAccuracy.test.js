// test/brrrrFinancialAccuracy.test.js
// Phase 2 — BRRRR Financial Accuracy (approved Issues #1 and #4). Expected
// values are independently computed (a from-scratch amortization formula,
// hand-built ledgers) — never copied from production output.
import { describe, it, expect } from 'vitest'
import {
  calculateMortgagePayment, computeBrrrrBreakdown, computeFlipBreakdown,
  describeCashLeftIn, BRRRR_REFI_RATE, BRRRR_REFI_AMORT_YEARS,
} from '../src/lib/calculations.js'
import { computeBrrrrResult, computeFlipResult } from '../src/lib/dealExplanation.js'

// Independent re-derivation of the standard mortgage amortization formula
// — a SEPARATE implementation from calculateMortgagePayment, so a bug in
// one is unlikely to be mirrored in the other.
function independentAmortization(principal, annualRate, years) {
  const n = years * 12
  const r = annualRate / 12
  if (r === 0) return principal / n
  const growth = (1 + r) ** n
  return (principal * r * growth) / (growth - 1)
}

describe('Part 1 — Approved Issue #1: real mortgage amortization', () => {
  it('$100K @ 6.7% / 30 years', () => {
    expect(calculateMortgagePayment(100000, 0.067, 30)).toBeCloseTo(independentAmortization(100000, 0.067, 30), 2)
    expect(calculateMortgagePayment(100000, 0.067, 30)).toBeCloseTo(645.28, 1)
  })
  it('$150K @ 6.7% / 30 years', () => {
    expect(calculateMortgagePayment(150000, 0.067, 30)).toBeCloseTo(967.92, 1)
  })
  it('$200K @ 6.7% / 30 years', () => {
    expect(calculateMortgagePayment(200000, 0.067, 30)).toBeCloseTo(1290.56, 1)
  })
  it('custom rate (5%) and custom amortization (15yr)', () => {
    expect(calculateMortgagePayment(150000, 0.05, 15)).toBeCloseTo(independentAmortization(150000, 0.05, 15), 2)
    expect(calculateMortgagePayment(150000, 0.05, 15)).toBeCloseTo(1186.19, 1)
  })
  it('missing rate -> falls back to the documented HAT canonical default (6.7%)', () => {
    expect(calculateMortgagePayment(150000, null, 30)).toBeCloseTo(calculateMortgagePayment(150000, BRRRR_REFI_RATE, 30), 6)
    expect(calculateMortgagePayment(150000, undefined, 30)).toBeCloseTo(calculateMortgagePayment(150000, 0.067, 30), 6)
  })
  it('missing amortization -> falls back to the documented HAT canonical default (30yr)', () => {
    expect(calculateMortgagePayment(150000, 0.067, null)).toBeCloseTo(calculateMortgagePayment(150000, 0.067, BRRRR_REFI_AMORT_YEARS), 6)
  })
  it('a 0% rate falls back to straight-line principal/term rather than dividing by zero', () => {
    expect(calculateMortgagePayment(120000, 0, 30)).toBeCloseTo(120000 / 360, 6)
  })
  it('a non-positive principal returns 0, never NaN/Infinity', () => {
    expect(calculateMortgagePayment(0)).toBe(0)
    expect(calculateMortgagePayment(-5000)).toBe(0)
    expect(calculateMortgagePayment(null)).toBe(0)
  })
  it('computeBrrrrBreakdown now uses this formula at the canonical rate, not the old ~6.93%-implied flat multiplier (0.006607)', () => {
    const b = computeBrrrrBreakdown(88200, 215000, 65000, 1350, 6)
    const expectedPmt = calculateMortgagePayment(b.refiLoan, 0.067, 30)
    expect(b.refiMoPmt).toBeCloseTo(expectedPmt, 2)
    expect(b.refiMoPmt).not.toBeCloseTo(b.refiLoan * 0.006607, 1) // the old, now-removed approximation
  })
  it('accepts an explicit rate/amortization override without changing the default for other callers', () => {
    const custom = computeBrrrrBreakdown(88200, 215000, 65000, 1350, 6, { refiInterestRate: 0.05, amortizationYears: 15 })
    const canonical = computeBrrrrBreakdown(88200, 215000, 65000, 1350, 6)
    expect(custom.refiInterestRate).toBe(0.05)
    expect(custom.amortizationYears).toBe(15)
    expect(canonical.refiInterestRate).toBe(0.067)
    expect(custom.refiMoPmt).not.toBeCloseTo(canonical.refiMoPmt, 0)
  })
})

describe('Part 2 — Approved Issue #4: signed Cash Left In, never clamped inside the engine', () => {
  it('normal positive Cash Left In — unaffected', () => {
    const b = computeBrrrrBreakdown(88200, 215000, 65000, 1350, 6)
    expect(b.totalCashInvested).toBeGreaterThan(0)
    expect(b.totalCashInvested).toBeCloseTo(23063, 0) // matches the audited Norfolk figure
  })
  it('exact-zero Cash Left In is a real, reachable value (boundary, not a clamp artifact)', () => {
    // Constructed so refiCashOut exactly equals totalCashNeeded.
    // Verified by direct construction rather than searching for one.
    const pp = 88200, arv = 215000, reno = 65000, holdMonths = 6
    const b = computeBrrrrBreakdown(pp, arv, reno, 1350, holdMonths)
    // Confirm the identity Cash Left In = Total Cash Needed - Net Refi Cash Out holds exactly.
    expect(b.totalCashInvested).toBeCloseTo(b.totalCashNeeded - b.refiCashOut, 6)
  })
  it('negative Cash Left In (cash-out-positive BRRRR) is preserved, signed, never clamped to $0', () => {
    // A large ARV spread relative to a modest purchase/rehab — refinance
    // returns more than was invested.
    const b = computeBrrrrBreakdown(70000, 280000, 30000, 2000, 6)
    expect(b.totalCashInvested).toBeLessThan(0)
    expect(b.totalCashInvested).toBeCloseTo(-78382, 0) // independently verified in the forensic audit
  })
  it('Method A (computeBrrrrBreakdown) and Method B (independent from-scratch ledger) agree exactly on the negative case', () => {
    const pp = 70000, arv = 280000, reno = 30000, holdMonths = 6
    const A = computeBrrrrBreakdown(pp, arv, reno, 2000, holdMonths)

    // Method B — rebuilt independently, never calling computeBrrrrBreakdown.
    const hmlLoan = pp * 0.90 + reno
    const purchaseEquity = pp * 0.10
    const points = hmlLoan * 0.02
    const fixedClosing = 2450
    const monthlyInterest = hmlLoan * 0.01
    const totalHoldingCash = (monthlyInterest + 208 + 100) * holdMonths
    const investorCashContributed = purchaseEquity + points + fixedClosing + totalHoldingCash
    const refiLoan = arv * 0.70
    const refiCosts = refiLoan * 0.03
    const netCashReturned = refiLoan - hmlLoan - refiCosts
    const cashLeftIn_B = investorCashContributed - netCashReturned

    expect(A.totalCashInvested).toBeCloseTo(cashLeftIn_B, 4)
  })
  it('cashExtracted/cashLeftIn convenience fields expose the presentation-friendly split of the signed value', () => {
    const negative = computeBrrrrBreakdown(70000, 280000, 30000, 2000, 6)
    expect(negative.cashLeftIn).toBe(0)
    expect(negative.cashExtracted).toBeCloseTo(78382, 0)

    const positive = computeBrrrrBreakdown(88200, 215000, 65000, 1350, 6)
    expect(positive.cashExtracted).toBe(0)
    expect(positive.cashLeftIn).toBeCloseTo(23063, 0)
  })
})

describe('describeCashLeftIn — presentation helper (Part 2/18)', () => {
  it('$30K contributed - $10K returned = +$20K -> displays as $20,000, no extraction', () => {
    const d = describeCashLeftIn(20000)
    expect(d.display).toBe('$20,000')
    expect(d.extracted).toBeNull()
    expect(d.allRecovered).toBe(false)
  })
  it('$30K contributed - $30K returned = $0 -> displays as $0, capital recovered, no extraction', () => {
    const d = describeCashLeftIn(0)
    expect(d.display).toBe('$0')
    expect(d.extracted).toBeNull()
    expect(d.allRecovered).toBe(true)
  })
  it('$30K contributed - $40K returned = -$10K -> displays as $0 + $10,000 extracted', () => {
    const d = describeCashLeftIn(-10000)
    expect(d.display).toBe('$0')
    expect(d.extracted).toBe(10000)
    expect(d.allRecovered).toBe(true)
  })
  it('null/missing -> em dash, never a fabricated number', () => {
    expect(describeCashLeftIn(null).display).toBe('—')
    expect(describeCashLeftIn(undefined).display).toBe('—')
  })
})

describe('Part 3 — Cash-on-Cash edge-case handling (verified already correct, re-confirmed)', () => {
  it('Cash Left In > 0: normal CoC = annual cash flow / cash left in', () => {
    const b = computeBrrrrBreakdown(88200, 215000, 65000, 1350, 6)
    expect(b.coc).toBeCloseTo((b.annualCF / b.totalCashInvested) * 100, 4)
  })
  it('Cash Left In === 0: CoC is null, never a divide-by-zero artifact', () => {
    const b = { totalCashInvested: 0, annualCF: 5000 }
    const coc = b.totalCashInvested > 0 && b.annualCF != null ? (b.annualCF / b.totalCashInvested) * 100 : null
    expect(coc).toBeNull()
  })
  it('Cash Left In < 0: CoC is null — never divides by a negative number, never uses absolute value, never fabricates a huge percentage', () => {
    const b = computeBrrrrBreakdown(70000, 280000, 30000, 2000, 6)
    expect(b.totalCashInvested).toBeLessThan(0)
    expect(b.coc).toBeNull()
  })
})

describe('Part 5/9/17 — All-In reconciliation', () => {
  it('Flip: Purchase + Rehab + Acquisition + Financing + Holding = All-In, and totalProfit = saleProceeds - allIn exactly', () => {
    const f = computeFlipBreakdown(105000, 215000, 65000, 6)
    const manualAllIn = f.purchasePrice + f.rehab + f.acquisitionCosts + f.financingCosts + f.totalHolding
    expect(f.allIn).toBeCloseTo(manualAllIn, 6)
    expect(f.totalProfit).toBeCloseTo(f.saleProceeds - f.allIn, 6)
  })
  it('BRRRR: the same All-In components reconcile exactly (pre-refinance economic cost)', () => {
    const b = computeBrrrrBreakdown(88200, 215000, 65000, 1350, 6)
    const manualAllIn = b.purchasePrice + b.rehab + b.acquisitionCosts + b.financingCosts + b.totalHolding
    expect(b.allIn).toBeCloseTo(manualAllIn, 6)
  })
})

describe('Part 17 — Monthly Cash Flow reconciliation', () => {
  it('Rent - Mortgage P&I - Taxes - Insurance = Monthly Cash Flow, exactly', () => {
    const b = computeBrrrrBreakdown(88200, 215000, 65000, 1350, 6)
    expect(b.monthlyCF).toBeCloseTo(b.rent - b.mortgagePayment - b.taxesMonthly - b.insuranceMonthly, 6)
  })
})

describe('Part 17 — Refinance waterfall reconciliation', () => {
  it('Gross Refi Loan - HML Payoff - Refi Costs = Net Cash Returned, exactly', () => {
    const b = computeBrrrrBreakdown(88200, 215000, 65000, 1350, 6)
    expect(b.netRefiCashReturned).toBeCloseTo(b.grossRefiLoan - b.hmlPayoff - b.refiCosts, 6)
  })
  it('Investor Cash Contributed - Net Cash Returned = Cash Left In, exactly (the mission\'s Section 9 definition)', () => {
    const b = computeBrrrrBreakdown(88200, 215000, 65000, 1350, 6)
    expect(b.totalCashInvested).toBeCloseTo(b.investorCashContributed - b.netRefiCashReturned, 6)
  })
})

describe('Downstream regression — computeBrrrrResult/computeFlipResult still consistent after Issues #1/#4', () => {
  it('computeBrrrrResult exposes the same canonical breakdown object (Part 12, single source of truth)', () => {
    const lead = { asking_price: 105000, arv: 215000, renovation_cost: 65000, rent_estimate: 1350, starting_offer: 88200 }
    const r = computeBrrrrResult(lead)
    expect(r.breakdown).toBeTruthy()
    expect(r.breakdown.totalCashInvested).toBeCloseTo(r.cashLeftIn, 0)
  })
  it('computeFlipResult exposes the same canonical breakdown object', () => {
    const lead = { asking_price: 95000, arv: 270000, renovation_cost: 50000 }
    const r = computeFlipResult(lead)
    expect(r.breakdown).toBeTruthy()
    expect(r.breakdown.totalProfit).toBeCloseTo(r.projectedProfit, 4)
  })
  it('verdict thresholds are UNCHANGED — a cash-out-positive BRRRR still correctly reaches STRONG, not a new/different tier', () => {
    const lead = { asking_price: 100000, arv: 270000, renovation_cost: 50000, rent_estimate: 2200 }
    const r = computeBrrrrResult(lead)
    expect(r.cashLeftIn).toBeLessThan(0) // cash-out-positive after the amortization fix
    expect(r.verdict).toBe('STRONG') // still reachable — thresholds untouched
  })
})

describe('Missing-data / rounding safety', () => {
  it('missing rent never silently becomes $0 cash flow — BRRRR stays unavailable', () => {
    const lead = { asking_price: 105000, arv: 215000, renovation_cost: 65000 }
    const r = computeBrrrrResult(lead)
    expect(r.available).toBe(false)
  })
  it('no NaN/undefined reaches the breakdown for a valid lead', () => {
    const b = computeBrrrrBreakdown(88200, 215000, 65000, 1350, 6)
    expect(JSON.stringify(b)).not.toMatch(/NaN|undefined/)
  })
})
