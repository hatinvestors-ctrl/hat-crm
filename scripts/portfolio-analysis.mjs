const n = v => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? 0 : Number(v))
const pct = v => (v * 100).toFixed(1) + '%'
const usd = v => '$' + Math.round(v).toLocaleString()

function calc(f) {
  const pp = n(f.purchase_price_actual)
  const ltv = f.loan_to_purchase_pct != null ? n(f.loan_to_purchase_pct) : 0.9
  const isCash = f.renovation_financing === 'Cash'
  const renovBudget = n(f.renovation_lender_amount)
  const renovLenderPct = n(f.renovation_lender_pct)
  const purchaseLoan = pp * ltv
  const renovLoan = isCash ? 0 : renovBudget * renovLenderPct
  const renovGap = Math.max(0, renovBudget - renovLoan)
  const totalLoan = purchaseLoan + renovLoan
  const pointsBase = f.points_charged_on === 'Purchase Only' ? purchaseLoan : totalLoan
  const pointsCost = pointsBase * n(f.points_pct)
  const monthlyInterest = totalLoan * (n(f.interest_rate_annual) / 12)
  const totalInterest = monthlyInterest * n(f.hold_months)
  const hmlCosts = pointsCost + n(f.title_lender_insurance) + n(f.interest_portion) + n(f.doc_stamps_mortgage) + n(f.intangible_tax) + n(f.extension_fee)
  const purchaseClosing = n(f.title_closing_costs) + n(f.purchase_closing_costs_other)
  const monthlyHold = n(f.insurance_monthly) + n(f.utilities_monthly) + n(f.taxes_monthly) + n(f.hoa_monthly) + n(f.misc_holding_monthly)
  const totalHolding = monthlyHold * n(f.hold_months)
  const downPayment = pp * (1 - ltv)
  const totalCashInvested = downPayment + hmlCosts + purchaseClosing + renovGap + totalHolding + totalInterest
  const totalAllIn = pp + renovBudget + hmlCosts + purchaseClosing + totalHolding + totalInterest
  const sellPrice = f.actual_sale_price != null ? n(f.actual_sale_price) : n(f.expected_sell_price)
  const sellingCosts = sellPrice * 0.07
  const netProfit = sellPrice - sellingCosts - totalAllIn
  const roi = totalCashInvested > 0 ? netProfit / totalCashInvested : 0
  const annualizedRoi = n(f.hold_months) > 0 ? roi * (12 / n(f.hold_months)) : 0
  return { pp, ltv, isCash, totalCashInvested, totalAllIn, netProfit, roi, annualizedRoi, sellPrice, renovBudget, totalInterest, totalHolding, downPayment, monthlyHold }
}

const projects = [
  { name: 'Beckner',    status: 'active', f: { purchase_price_actual:120000, loan_to_purchase_pct:0.9,   renovation_financing:'Financed', points_charged_on:'Full Loan', renovation_lender_amount:47000,  renovation_lender_pct:0.85, interest_rate_annual:0.12, points_pct:0.02, title_lender_insurance:500, interest_portion:283, doc_stamps_mortgage:200, intangible_tax:150, extension_fee:0,    title_closing_costs:1691, purchase_closing_costs_other:0, hold_months:5, insurance_monthly:0, utilities_monthly:0,   taxes_monthly:0, hoa_monthly:0, misc_holding_monthly:0, expected_sell_price:230000, actual_sale_price:null }},
  { name: 'Plymouth',   status: 'active', f: { purchase_price_actual:131000, loan_to_purchase_pct:0.9,   renovation_financing:'Financed', points_charged_on:'Full Loan', renovation_lender_amount:96002,  renovation_lender_pct:0.54, interest_rate_annual:0.12, points_pct:0.02, title_lender_insurance:500, interest_portion:283, doc_stamps_mortgage:200, intangible_tax:150, extension_fee:1700, title_closing_costs:2351, purchase_closing_costs_other:0, hold_months:9, insurance_monthly:0, utilities_monthly:0,   taxes_monthly:0, hoa_monthly:0, misc_holding_monthly:0, expected_sell_price:329900, actual_sale_price:null }},
  { name: 'Kingsbury',  status: 'active', f: { purchase_price_actual:100000, loan_to_purchase_pct:0,     renovation_financing:'Cash',     points_charged_on:'Full Loan', renovation_lender_amount:72000,  renovation_lender_pct:0,    interest_rate_annual:0,    points_pct:0,    title_lender_insurance:0,   interest_portion:0,   doc_stamps_mortgage:0,   intangible_tax:0,   extension_fee:0,    title_closing_costs:0,    purchase_closing_costs_other:0, hold_months:6, insurance_monthly:0, utilities_monthly:150, taxes_monthly:0, hoa_monthly:0, misc_holding_monthly:0, expected_sell_price:240000, actual_sale_price:null }},
  { name: 'Toledo',     status: 'active', f: { purchase_price_actual:175000, loan_to_purchase_pct:0.9,   renovation_financing:'Financed', points_charged_on:'Full Loan', renovation_lender_amount:50000,  renovation_lender_pct:0.8,  interest_rate_annual:0.12, points_pct:0.02, title_lender_insurance:500, interest_portion:350, doc_stamps_mortgage:0,   intangible_tax:0,   extension_fee:0,    title_closing_costs:1500, purchase_closing_costs_other:0, hold_months:4, insurance_monthly:0, utilities_monthly:0,   taxes_monthly:0, hoa_monthly:0, misc_holding_monthly:0, expected_sell_price:315000, actual_sale_price:null }},
  { name: 'Volusia',    status: 'active', f: { purchase_price_actual:113500, loan_to_purchase_pct:0,     renovation_financing:'Cash',     points_charged_on:'Full Loan', renovation_lender_amount:80000,  renovation_lender_pct:0,    interest_rate_annual:0,    points_pct:0,    title_lender_insurance:0,   interest_portion:0,   doc_stamps_mortgage:0,   intangible_tax:0,   extension_fee:0,    title_closing_costs:2243, purchase_closing_costs_other:0, hold_months:6, insurance_monthly:0, utilities_monthly:0,   taxes_monthly:0, hoa_monthly:0, misc_holding_monthly:0, expected_sell_price:265000, actual_sale_price:null }},
  { name: 'Parrish',    status: 'active', f: { purchase_price_actual:218000, loan_to_purchase_pct:0.9,   renovation_financing:'Financed', points_charged_on:'Full Loan', renovation_lender_amount:46414,  renovation_lender_pct:0.51, interest_rate_annual:0.12, points_pct:0.02, title_lender_insurance:500, interest_portion:0,   doc_stamps_mortgage:200, intangible_tax:150, extension_fee:0,    title_closing_costs:6501, purchase_closing_costs_other:0, hold_months:6, insurance_monthly:0, utilities_monthly:0,   taxes_monthly:0, hoa_monthly:0, misc_holding_monthly:0, expected_sell_price:314000, actual_sale_price:null }},
  { name: 'Pennant',    status: 'active', f: { purchase_price_actual:127000, loan_to_purchase_pct:0.921, renovation_financing:'Financed', points_charged_on:'Full Loan', renovation_lender_amount:69870,  renovation_lender_pct:0.78, interest_rate_annual:0.12, points_pct:0.02, title_lender_insurance:500, interest_portion:283, doc_stamps_mortgage:200, intangible_tax:150, extension_fee:0,    title_closing_costs:1691, purchase_closing_costs_other:0, hold_months:5, insurance_monthly:0, utilities_monthly:0,   taxes_monthly:0, hoa_monthly:0, misc_holding_monthly:0, expected_sell_price:272000, actual_sale_price:null }},
  { name: 'Darlington', status: 'sold',   f: { purchase_price_actual:120000, loan_to_purchase_pct:0,     renovation_financing:'Cash',     points_charged_on:'Full Loan', renovation_lender_amount:85000,  renovation_lender_pct:0,    interest_rate_annual:0,    points_pct:0,    title_lender_insurance:0,   interest_portion:0,   doc_stamps_mortgage:0,   intangible_tax:0,   extension_fee:0,    title_closing_costs:3378, purchase_closing_costs_other:0, hold_months:9, insurance_monthly:0, utilities_monthly:0,   taxes_monthly:0, hoa_monthly:0, misc_holding_monthly:0, expected_sell_price:254000, actual_sale_price:254000 }},
]

console.log('\n=== PER-DEAL BREAKDOWN ===\n')
let totalLocked = 0, totalExpected = 0, totalRealized = 0
let cashActive = [], hmlActive = []

for (const p of projects) {
  const c = calc(p.f)
  const tag = p.status === 'sold' ? '[SOLD  ]' : '[ACTIVE]'
  const type = c.isCash ? 'CASH' : 'HML '
  console.log(`${tag} ${p.name.padEnd(11)} ${type}  Buy:${usd(c.pp).padStart(9)}  Reno:${usd(c.renovBudget).padStart(8)}  Hold:${p.f.hold_months}mo`)
  console.log(`         Cash In:${usd(c.totalCashInvested).padStart(10)}  Profit:${usd(c.netProfit).padStart(9)}  ROI:${pct(c.roi).padStart(7)}  Ann.ROI:${pct(c.annualizedRoi).padStart(7)}  AllIn/ARV:${pct(c.totalAllIn/c.sellPrice).padStart(6)}`)
  console.log()
  if (p.status === 'active') {
    totalLocked += c.totalCashInvested
    totalExpected += c.netProfit
    if (c.isCash) cashActive.push({ name: p.name, c })
    else hmlActive.push({ name: p.name, c })
  } else {
    totalRealized += c.netProfit
  }
}

console.log('=== PORTFOLIO SUMMARY ===')
console.log(`Cash LOCKED in active deals:       ${usd(totalLocked)}`)
console.log(`Expected profit (active pipeline): ${usd(totalExpected)}`)
console.log(`Realized profit (sold):            ${usd(totalRealized)}`)
console.log(`Total P&L (realized + expected):   ${usd(totalRealized + totalExpected)}`)
console.log()
console.log(`CASH DEALS (${cashActive.length} active):`)
for (const d of cashActive) {
  console.log(`  ${d.name}: locked ${usd(d.c.totalCashInvested)}, profit ${usd(d.c.netProfit)}, ann.ROI ${pct(d.c.annualizedRoi)}`)
}
console.log(`  Total locked in cash deals: ${usd(cashActive.reduce((s,d)=>s+d.c.totalCashInvested,0))}`)
console.log()
console.log(`HML DEALS (${hmlActive.length} active):`)
for (const d of hmlActive) {
  console.log(`  ${d.name}: locked ${usd(d.c.totalCashInvested)}, profit ${usd(d.c.netProfit)}, ann.ROI ${pct(d.c.annualizedRoi)}`)
}
console.log(`  Total locked in HML deals: ${usd(hmlActive.reduce((s,d)=>s+d.c.totalCashInvested,0))}`)
