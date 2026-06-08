// src/lib/dealCalculations.js
// Pure financial calculation functions for deal analysis.
// No Supabase calls — all inputs are plain JS numbers.

const n = v => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? 0 : Number(v))

export const RENOVATION_CATEGORIES = [
  'Demo', 'Flooring', 'Roof', 'Kitchen', 'Bathrooms',
  'HVAC', 'Plumbing', 'Electrical', 'Paint', 'Landscaping',
  'Windows & Doors', 'Drywall', 'Foundation', 'Other',
]

export const ITEM_STATUSES = [
  { value: 'planned',     label: 'Planned',     cls: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]' },
  { value: 'in_progress', label: 'In Progress', cls: 'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]' },
  { value: 'complete',    label: 'Complete',    cls: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]' },
]

export const DEAL_RATING_INFO = {
  A: { label: 'A - Excellent', description: 'ROI ≥ 70% and profit ≥ $30K. Strong deal — move fast.' },
  B: { label: 'B - Good',      description: 'ROI ≥ 45% and profit ≥ $20K. Solid deal with good upside.' },
  C: { label: 'C - Fair',      description: 'ROI ≥ 25%. Acceptable — watch costs closely.' },
  D: { label: 'D - Poor',      description: 'ROI below 25%. Risky — renegotiate price or pass.' },
}

/**
 * Core deal financial calculations.
 * @param {object} f   - deal_financials row
 * @param {Array}  items - deal_renovation_items rows
 * @returns {object} all derived metrics
 */
export function calcDeal(f, items = []) {
  if (!f) return null

  // --- Basic ---
  const purchasePrice  = n(f.purchase_price_actual)
  const ltvPct         = n(f.loan_to_purchase_pct) || 0.90
  const sellingCostPct = n(f.selling_cost_pct) || 0.07

  // --- Renovation (must come before loan so renovationLoan can use totalRenovationCost) ---
  const totalRenovationEst    = items.reduce((s, i) => s + n(i.estimated_cost), 0)
  const totalRenovationActual = items.reduce((s, i) => s + (i.actual_cost != null ? n(i.actual_cost) : n(i.estimated_cost)), 0)
  const totalRenovationCost   = totalRenovationActual

  // --- Loans ---
  const purchaseLoan     = f.purchase_loan_amount != null
    ? n(f.purchase_loan_amount)
    : purchasePrice * ltvPct

  const renovLenderPct   = f.renovation_lender_pct != null ? n(f.renovation_lender_pct) : 1.0
  const renovationLoan   = f.renovation_financing === 'Cash' ? 0 : totalRenovationCost * renovLenderPct
  const renovationGap    = Math.max(0, totalRenovationCost - renovationLoan)

  const totalLoan        = purchaseLoan + renovationLoan
  const pointsBase       = f.points_charged_on === 'Purchase Only' ? purchaseLoan : totalLoan
  const pointsCost       = pointsBase * n(f.points_pct)
  const monthlyInterest  = totalLoan * (n(f.interest_rate_annual) / 12)
  const totalInterest    = monthlyInterest * n(f.hold_months)

  // --- HML Closing Costs (paid at closing) ---
  const hmlClosingCosts  = pointsCost
    + n(f.title_lender_insurance)
    + n(f.interest_portion)
    + n(f.doc_stamps_mortgage)
    + n(f.intangible_tax)
    + n(f.extension_fee)

  // --- Down Payment ---
  const downPayment      = purchasePrice * (1 - ltvPct)

  // --- Purchase Closing ---
  const purchaseClosing  = n(f.title_closing_costs) + n(f.purchase_closing_costs_other)

  // --- Holding Costs (ongoing, not upfront cash) ---
  const monthlyHoldCosts  = n(f.insurance_monthly) + n(f.utilities_monthly) + n(f.taxes_monthly) + n(f.hoa_monthly) + n(f.misc_holding_monthly)
  const totalHoldingCosts = monthlyHoldCosts * n(f.hold_months) + totalInterest

  // --- All-In Cost (total money spent on the deal) ---
  const totalAllInCost   = purchasePrice + totalRenovationCost + hmlClosingCosts + purchaseClosing + totalHoldingCosts

  // --- Total Cash Invested (cash you bring to the table at closing + renovation gap) ---
  // This is the basis for ROI — what you actually invest out of pocket.
  const totalCashInvested = downPayment + hmlClosingCosts + purchaseClosing + renovationGap

  // --- Break-Even ---
  const breakEvenPrice   = sellingCostPct < 1 ? totalAllInCost / (1 - sellingCostPct) : 0
  const allInVsARV       = n(f.expected_sell_price) > 0 ? totalAllInCost / n(f.expected_sell_price) : 0

  // --- Scenario helper ---
  const scenario = (sellPrice) => {
    if (!sellPrice) return null
    const sp           = n(sellPrice)
    const sellingCosts = sp * sellingCostPct
    const netProfit    = sp - sellingCosts - totalAllInCost
    const roi          = totalCashInvested > 0 ? netProfit / totalCashInvested : 0
    return { sellPrice: sp, sellingCosts, netProfit, roi }
  }

  const conservative = scenario(f.conservative_sell_price)
  const expected     = scenario(f.expected_sell_price)
  const optimistic   = scenario(f.optimistic_sell_price)
  const actual       = scenario(f.actual_sale_price)

  // --- Deal Rating ---
  let dealRating = 'D - Poor'
  if (expected) {
    const { roi, netProfit } = expected
    if (roi >= 0.70 && netProfit >= 30000)      dealRating = 'A - Excellent'
    else if (roi >= 0.45 && netProfit >= 20000) dealRating = 'B - Good'
    else if (roi >= 0.25)                        dealRating = 'C - Fair'
  }

  // --- Warning flags ---
  const warnings = []
  if (allInVsARV > 0.75) warnings.push(`All-In vs ARV: ${(allInVsARV * 100).toFixed(1)}% (above 75%)`)
  if (expected && expected.netProfit < 30000 && expected.netProfit > -999999) warnings.push('Expected profit below $30K')

  return {
    // Loans
    purchaseLoan, renovationLoan, renovLenderPct, renovationGap, totalLoan,
    pointsCost, monthlyInterest, totalInterest,
    // Costs
    hmlClosingCosts, downPayment, purchaseClosing,
    totalRenovationEst, totalRenovationActual, totalRenovationCost,
    monthlyHoldCosts, totalHoldingCosts,
    totalAllInCost,
    // Cash invested & break-even
    totalCashInvested,
    breakEvenPrice, allInVsARV,
    // Scenarios
    conservative, expected, optimistic, actual,
    // Rating
    dealRating, warnings,
    holdMonths: n(f.hold_months),
    sellingCostPct,
  }
}

export function fmtUSD(v) {
  if (v == null || isNaN(Number(v))) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(v))
}

export function fmtPct(v) {
  if (v == null || isNaN(Number(v))) return '—'
  return (Number(v) * 100).toFixed(1) + '%'
}

export function dealRatingColor(rating) {
  if (rating?.startsWith('A')) return 'text-[color:var(--color-success-text)] bg-[color:var(--color-success-soft)]'
  if (rating?.startsWith('B')) return 'text-[color:var(--color-accent-text)] bg-[color:var(--color-accent-soft)]'
  if (rating?.startsWith('C')) return 'text-[color:var(--color-warn-text,oklch(0.5_0.15_80))] bg-[color:var(--color-warn-soft,oklch(0.97_0.04_80))]'
  return 'text-[color:var(--color-danger-text)] bg-[color:var(--color-danger-soft)]'
}
