const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v))

// Simplified MAO: 75% of ARV minus renovation cost.
// Extra args kept for backwards compatibility but ignored.
export function calculateMAO(arv, renovationCost /*, closingCosts, targetProfit */) {
  const a = num(arv)
  if (!a) return null
  return a * 0.75 - num(renovationCost)
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
