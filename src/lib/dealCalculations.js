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

  // --- JV (Joint Venture) deal ---
  const isJV            = !!f.is_jv
  const jvSplitPct      = isJV ? (f.jv_profit_split_pct != null ? n(f.jv_profit_split_pct) : 0.5) : 1
  const jvPartnerPurch  = isJV ? n(f.jv_partner_purchase) : 0   // partner's purchase + their closing
  const jvPartnerLoan   = isJV ? n(f.jv_partner_loan) : 0       // partner lent us for reno
  const jvPartnerRate   = isJV ? n(f.jv_partner_loan_rate) : 0  // annual rate on partner loan

  // --- Basic ---
  const purchasePrice  = isJV ? 0 : n(f.purchase_price_actual)  // JV: we didn't buy
  const ltvPct         = f.loan_to_purchase_pct != null ? n(f.loan_to_purchase_pct) : 0.90

  // --- Selling Costs (detailed breakdown or legacy single %) ---
  const agentCommissionPct = f.agent_commission_pct != null ? n(f.agent_commission_pct) : 0.03
  const buyerAgentPct      = f.buyer_agent_pct      != null ? n(f.buyer_agent_pct)      : 0.03
  const sellingClosingPct  = f.selling_closing_pct  != null ? n(f.selling_closing_pct)  : 0.01
  const sellingOtherPct    = f.selling_other_pct    != null ? n(f.selling_other_pct)    : 0.00
  // If any detailed field has been explicitly saved, use sum; otherwise fall back to legacy field
  const hasDetailedSelling = f.agent_commission_pct != null || f.buyer_agent_pct != null || f.selling_closing_pct != null
  const sellingCostPct     = hasDetailedSelling
    ? agentCommissionPct + buyerAgentPct + sellingClosingPct + sellingOtherPct
    : (n(f.selling_cost_pct) || 0.07)

  // --- Renovation (must come before loan so renovationLoan can use totalRenovationCost) ---
  // renovation_lender_amount doubles as a "renovation budget" fallback when no line items exist yet
  const renovationBudget      = n(f.renovation_lender_amount)
  const totalRenovationEst    = items.length > 0 ? items.reduce((s, i) => s + n(i.estimated_cost), 0) : renovationBudget
  const totalRenovationActual = items.length > 0 ? items.reduce((s, i) => s + (i.actual_cost != null ? n(i.actual_cost) : n(i.estimated_cost)), 0) : renovationBudget
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

  // --- Holding Costs ---
  const monthlyHoldCosts  = n(f.insurance_monthly) + n(f.utilities_monthly) + n(f.taxes_monthly) + n(f.hoa_monthly) + n(f.misc_holding_monthly)

  // --- JV: interest on partner loan (we pay this, it's our cost) ---
  const jvPartnerInterest = isJV ? jvPartnerLoan * jvPartnerRate * (n(f.hold_months) / 12) : 0

  const totalHoldingCosts = monthlyHoldCosts * n(f.hold_months) + totalInterest + jvPartnerInterest

  // --- All-In Cost (total deal spend, including partner's purchase for JV) ---
  const totalAllInCost   = (isJV ? jvPartnerPurch : purchasePrice)
    + totalRenovationCost + hmlClosingCosts + purchaseClosing + totalHoldingCosts

  // --- Our Cash Invested ---
  // JV: we invest only our reno gap + interest we owe partner (partner funds the purchase + their loan portion)
  // Standard: down payment + closing fees + reno gap + carrying costs
  const ourCashInvested  = isJV
    ? renovationGap + jvPartnerInterest + (monthlyHoldCosts * n(f.hold_months))
    : downPayment + hmlClosingCosts + purchaseClosing + renovationGap + totalHoldingCosts
  const totalCashInvested = ourCashInvested

  // --- Break-Even ---
  const breakEvenPrice   = sellingCostPct < 1 ? totalAllInCost / (1 - sellingCostPct) : 0
  const allInVsARV       = n(f.expected_sell_price) > 0 ? totalAllInCost / n(f.expected_sell_price) : 0

  // --- Scenario helper ---
  const holdMonthsN = n(f.hold_months) || 1
  const scenario = (sellPrice) => {
    if (!sellPrice) return null
    const sp              = n(sellPrice)
    const sellingCosts    = sp * sellingCostPct
    const totalDealProfit = sp - sellingCosts - totalAllInCost
    // JV: we only get our split of the profit
    const netProfit       = isJV ? totalDealProfit * jvSplitPct : totalDealProfit
    const roi             = ourCashInvested > 0 ? netProfit / ourCashInvested : 0
    const annualizedRoi   = roi * (12 / holdMonthsN)
    return { sellPrice: sp, sellingCosts, netProfit, totalDealProfit, roi, annualizedRoi }
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
    // JV
    isJV, jvSplitPct, jvPartnerPurch, jvPartnerLoan, jvPartnerInterest,
    // Selling cost breakdown
    agentCommissionPct, buyerAgentPct, sellingClosingPct, sellingOtherPct,
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

/**
 * BRRRR strategy financial calculations.
 * Buy → Rehab → Rent → Refinance → Repeat
 * @param {object} f - deal_financials row (project_strategy === 'brrrr')
 * @returns {object} all derived BRRRR metrics
 */
export function calcBRRRR(f) {
  if (!f) return null

  const purchasePrice = n(f.purchase_price_actual)
  const renovBudget   = n(f.renovation_lender_amount)
  const arv           = n(f.expected_sell_price)
  const holdMonths    = n(f.hold_months) || 6

  // ── Phase 1: Acquisition Loans (same structure as calcDeal) ──
  const ltvPct       = f.loan_to_purchase_pct != null ? n(f.loan_to_purchase_pct) : 0.90
  const purchaseLoan = f.purchase_loan_amount  != null ? n(f.purchase_loan_amount) : purchasePrice * ltvPct
  const downPayment  = purchasePrice - purchaseLoan

  const renovLenderPct = f.renovation_lender_pct != null ? n(f.renovation_lender_pct) : 1.0
  const renovLoan      = f.renovation_financing === 'Cash' ? 0 : renovBudget * renovLenderPct
  const renovGap       = Math.max(0, renovBudget - renovLoan)
  const totalLoan      = purchaseLoan + renovLoan

  const pointsBase  = f.points_charged_on === 'Purchase Only' ? purchaseLoan : totalLoan
  const pointsCost  = pointsBase * n(f.points_pct)
  const monthlyInterest = totalLoan * (n(f.interest_rate_annual) / 12)
  const totalInterest   = monthlyInterest * holdMonths

  const hmlClosing = pointsCost
    + n(f.title_lender_insurance)
    + n(f.interest_portion)
    + n(f.doc_stamps_mortgage)
    + n(f.intangible_tax)
    + n(f.extension_fee)

  const purchaseClosing = n(f.title_closing_costs) + n(f.purchase_closing_costs_other)
  const sellerCredits   = n(f.seller_credits)

  // Cash we pay at closing (out of pocket on day 1)
  const cashAtClose = downPayment + hmlClosing + purchaseClosing + renovGap - sellerCredits

  // ── Phase 2: Carrying Costs During Renovation ──
  const monthlyHoldCosts  = n(f.insurance_monthly) + n(f.utilities_monthly) +
                            n(f.taxes_monthly) + n(f.hoa_monthly) + n(f.misc_holding_monthly)
  const totalHoldingCosts = monthlyHoldCosts * holdMonths
  const totalCarrying     = totalInterest + totalHoldingCosts   // paid during reno

  // Total cash we have put in before refinance
  const totalCashIn = cashAtClose + totalCarrying

  // Total all-in project cost
  const totalAllIn  = purchasePrice + renovBudget + hmlClosing + purchaseClosing + totalCarrying

  // ── Phase 3: Refinance ──
  const refiLtvPct       = f.refi_ltv_pct        != null ? n(f.refi_ltv_pct)        : 0.70
  const refiRate         = f.refi_interest_rate   != null ? n(f.refi_interest_rate)  : 0.067
  const refiClosingCosts = f.refi_closing_costs   != null ? n(f.refi_closing_costs)  : 2000
  const refiLoan         = arv * refiLtvPct
  const loanPayoff       = totalLoan

  // Cash received at refi (refi loan − pay off HML − refi closing costs)
  const refiCashOut = refiLoan - loanPayoff - refiClosingCosts

  // Net cash still left in the deal after pulling refi cash out
  const netCashInDeal      = totalCashIn - refiCashOut   // positive = still have money in deal
  const cashRecapturedPct  = totalCashIn > 0 ? refiCashOut / totalCashIn : 0

  // Equity position at refi
  const equityAtRefi = arv - refiLoan
  const allInVsARV   = arv > 0 ? totalAllIn / arv : 0

  // 30-year P&I on new refi loan
  const refiMonthlyRate = refiRate / 12
  const refiMonthlyPI   = refiLoan > 0 && refiMonthlyRate > 0
    ? refiLoan * (refiMonthlyRate * Math.pow(1 + refiMonthlyRate, 360)) /
      (Math.pow(1 + refiMonthlyRate, 360) - 1)
    : 0

  // ── Phase 4: Ongoing Rental Cash Flow (post-refi) ──
  const monthlyRent        = n(f.monthly_rent)
  const vacancyPct         = f.vacancy_rate_pct    != null ? n(f.vacancy_rate_pct)    : 0.05
  const mgmtPct            = f.property_mgmt_pct   != null ? n(f.property_mgmt_pct)   : 0.10
  const maintenanceMonthly = f.maintenance_monthly != null ? n(f.maintenance_monthly) : monthlyRent * 0.05

  const monthlyTax       = n(f.taxes_monthly)
  const monthlyInsurance = n(f.insurance_monthly)
  const monthlyHOA       = n(f.hoa_monthly)
  const monthlyVacancy   = monthlyRent * vacancyPct
  const monthlyMgmt      = monthlyRent * mgmtPct

  const monthlyOpex     = monthlyTax + monthlyInsurance + monthlyHOA +
                          monthlyVacancy + monthlyMgmt + maintenanceMonthly
  const monthlyNOI      = monthlyRent - monthlyOpex
  const annualNOI       = monthlyNOI * 12

  const monthlyCashFlow = monthlyRent - refiMonthlyPI - monthlyOpex
  const annualCashFlow  = monthlyCashFlow * 12

  const capRate    = arv > 0 ? annualNOI / arv : 0
  const cashOnCash = netCashInDeal > 0 ? annualCashFlow / netCashInDeal : null
  const grm        = monthlyRent > 0 ? arv / (monthlyRent * 12) : 0

  const warnings = []
  if (allInVsARV > 0.80) warnings.push(`All-In vs ARV: ${(allInVsARV * 100).toFixed(1)}% — above 80%`)
  if (capRate > 0 && capRate < 0.06) warnings.push(`Cap rate ${(capRate * 100).toFixed(1)}% below 6%`)
  if (monthlyCashFlow < 0) warnings.push('Negative monthly cash flow after refi')

  return {
    // Loan structure
    ltvPct, purchaseLoan, downPayment, renovLoan, renovGap, totalLoan,
    pointsCost, monthlyInterest, totalInterest,
    hmlClosing, purchaseClosing, sellerCredits,
    // Phase 1
    cashAtClose,
    // Phase 2
    monthlyHoldCosts, totalHoldingCosts, totalCarrying,
    totalCashIn, totalAllIn,
    // Phase 3
    refiLtvPct, refiRate, refiLoan, refiClosingCosts, loanPayoff,
    refiCashOut, netCashInDeal, cashRecapturedPct,
    refiMonthlyPI, equityAtRefi, allInVsARV,
    // Phase 4
    monthlyRent, vacancyPct, mgmtPct, maintenanceMonthly,
    monthlyTax, monthlyInsurance, monthlyHOA, monthlyVacancy, monthlyMgmt,
    monthlyOpex, monthlyNOI, annualNOI,
    monthlyCashFlow, annualCashFlow,
    capRate, cashOnCash, grm,
    holdMonths, warnings,
    // Legacy compat
    purchasePrice, renovBudget,
    ourCashInvested: cashAtClose,  // alias for ProjectsPage stat cards
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
