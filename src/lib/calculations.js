const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v))

// MAO: 75% × ARV − Renovation − $2,450 fixed closing costs
// (title $1,600 + lender insurance $500 + doc stamps $200 + intangible $150)
// This matches the formula used in generate-core-analysis.mjs so FinancialSection
// and the AI Summary always show the same number.
// Extra args kept for backwards compatibility but ignored.
export function calculateMAO(arv, renovationCost /*, closingCosts, targetProfit */) {
  const a = num(arv)
  if (!a) return null
  return a * 0.75 - num(renovationCost) - 2450
}

export function calculateFlipNetProceeds(arv) {
  const a = num(arv)
  if (!a) return null
  return a * 0.93
}

export function calculateFlipProfit(arv, purchasePrice, renovationCost) {
  const a = num(arv)
  if (!a) return null
  return a - num(purchasePrice) - num(renovationCost)
}

// Full flip profit at a given purchase price — same math as the Deal Analysis
// Full Breakdown tab (HML financing, holding costs, sale proceeds at 93% of ARV).
// Used to show "expected profit if bought at MAO" next to MAO, since MAO's fixed
// 75%-of-ARV rule doesn't by itself guarantee any particular profit dollar amount
// — that depends on how big the ARV is.
export function calculateFlipProfitAtPrice(purchasePrice, arv, renovationCost, holdMonths = 3) {
  const pp   = num(purchasePrice)
  const rv   = num(arv)
  const reno = num(renovationCost)
  if (!pp || !rv) return null
  const hmlLoan = pp * 0.90 + reno
  const downPayment = pp * 0.10
  const points = hmlLoan * 0.02
  const fixedCosts = 2450
  const totalCashNeeded = downPayment + points + fixedCosts
  const monthlyPmt = hmlLoan * 0.01
  const holdingPerMo = monthlyPmt + 208 + 100
  const totalHolding = holdingPerMo * holdMonths
  const saleProceeds = rv * 0.93
  return saleProceeds - hmlLoan - totalHolding - totalCashNeeded
}

export function formatCurrency(value) {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)
}

export function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('en-US').format(n)
}

export function formatDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function todayISO() {
  const d = new Date()
  return d.toISOString().slice(0, 10)
}

// Format a US phone number for display.
// "9046136162" → "(904) 613-6162"
// "+19046136162" → "+1 (904) 613-6162"
// Preserves whatever the user typed if it doesn't look like a US number.
export function formatPhone(raw) {
  if (!raw) return ''
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) {
    return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`
  }
  return String(raw).trim()
}

export function endOfWeekISO() {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return d.toISOString().slice(0, 10)
}
