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

// ═══════════════════════════════════════════════════════════════════════
// Capability #19.1 — Strategy-Specific MAO.
//
// calculateMAO() above (0.75×ARV − Reno − $2,450) stays EXACTLY as it was.
// It's decisionEngineV2.js's documented canonical MAO fallback for
// Opportunity/Confidence/Urgency scoring (see decisionEngineV2.js's own
// header comment) — changing its formula would change V2's scoring
// output, which this capability's mission explicitly forbids ("Do NOT
// change Opportunity/Confidence/Urgency weights"). V2 is not touched by
// anything below.
//
// FLIP MAO and BRRRR MAO are NEW, ADDITIVE, strategy-specific numbers for
// display only (Path to a Deal, the Lead Detail economics strip,
// Acquisition Copilot's price guidance). They answer a different
// question than the flat 0.75×ARV rule: "what's the highest price that
// still clears HAT's actual minimum outcome for this strategy?" They are
// never written to lead.mao and never consumed by V2.
//
// Both reuse the SAME canonical cost model FlipRealityCheck/
// BrrrrRealityCheck already used in DealAnalysisCard.jsx (moved here so
// there's exactly one implementation, not one per component) — no second
// simplified formula was invented.
export const FLIP_MIN_PROFIT_TARGET = 30000   // Capability #19.1, Section 2 — HAT's default minimum acceptable Flip profit.
export const BRRRR_MAX_CASH_LEFT_IN = 30000   // Capability #19.1, Section 8 — HAT's default maximum cash left in a BRRRR after refinance.

// Full Flip P&L at a given purchase price — HML financing (90% purchase +
// 100% reno, 2% points, 1%/mo interest), $2,450 fixed closing costs, taxes
// $208/mo + insurance $100/mo holding, sale at 93% of ARV. Same formula as
// calculateFlipProfitAtPrice() below, but returns every intermediate line
// item (needed for the Full Breakdown tab and the BRRRR/Flip solvers).
export function computeFlipBreakdown(pp, arv, reno, holdMonths = 6) {
  const hmlLoan         = pp * 0.90 + reno
  const monthlyPmt      = hmlLoan * 0.01
  const points          = hmlLoan * 0.02
  const downPayment     = pp * 0.10
  const fixedCosts      = 2450
  const totalCashNeeded = downPayment + points + fixedCosts
  const holdingPerMo    = monthlyPmt + 208 + 100
  const totalHolding    = holdingPerMo * holdMonths
  const saleProceeds    = arv * 0.93
  const totalProfit     = saleProceeds - hmlLoan - totalHolding - totalCashNeeded
  const roi             = totalCashNeeded > 0 ? (totalProfit / totalCashNeeded) * 100 : 0
  const annualizedRoi   = holdMonths > 0 ? (roi / holdMonths) * 12 : 0
  return { hmlLoan, monthlyPmt, points, downPayment, fixedCosts, totalCashNeeded, holdingPerMo, totalHolding, saleProceeds, totalProfit, roi, annualizedRoi, holdMonths }
}

// Full BRRRR P&L at a given purchase price — same HML financing as Flip,
// refinance at 70% ARV (3% refi closing costs), 30yr/6.9% refi mortgage
// for post-refi cash flow. Same model FlipRealityCheck/BrrrrRealityCheck
// already used.
export function computeBrrrrBreakdown(pp, arv, reno, monthlyRent, holdMonths = 6) {
  const hmlLoan           = pp * 0.90 + reno
  const monthlyPmt        = hmlLoan * 0.01
  const points            = hmlLoan * 0.02
  const downPayment       = pp * 0.10
  const fixedCosts        = 2450
  const totalCashNeeded   = downPayment + points + fixedCosts
  const holdingPerMo      = monthlyPmt + 208 + 100
  const totalHolding      = holdingPerMo * holdMonths
  const refiLoan          = arv * 0.70
  const refiCosts         = refiLoan * 0.03
  const refiCashOut       = refiLoan - refiCosts - hmlLoan - totalHolding
  const totalCashInvested = refiCashOut >= 0
    ? Math.max(0, totalCashNeeded - refiCashOut)
    : totalCashNeeded + Math.abs(refiCashOut)
  const refiMoPmt         = refiLoan * 0.006607
  const monthlyCF         = monthlyRent > 0 ? monthlyRent - refiMoPmt - 208 - 100 : null
  const annualCF          = monthlyCF != null ? monthlyCF * 12 : null
  const coc               = totalCashInvested > 0 && annualCF != null ? (annualCF / totalCashInvested) * 100 : null
  return { hmlLoan, monthlyPmt, points, downPayment, fixedCosts, totalCashNeeded, holdingPerMo, totalHolding, refiLoan, refiCosts, refiCashOut, totalCashInvested, refiMoPmt, monthlyCF, annualCF, coc, holdMonths }
}

// Generic bisection: finds where evalFn(x) flips from false to true across
// [lo, hi]. Works regardless of whether increasing x makes the condition
// more or less likely to be true. Returns null if the condition doesn't
// change within [lo, hi] at all.
export function bisectThreshold(evalFn, lo, hi, iterations = 60) {
  const trueAtLo = evalFn(lo)
  const trueAtHi = evalFn(hi)
  if (trueAtLo === trueAtHi) return trueAtLo ? lo : null
  let a = lo, b = hi
  for (let i = 0; i < iterations; i++) {
    const mid = (a + b) / 2
    if (evalFn(mid) === trueAtHi) b = mid; else a = mid
  }
  return trueAtHi ? b : a
}

// FLIP MAO (Capability #19.1, Section 3) — the highest purchase price at
// which computeFlipBreakdown's totalProfit still equals at least
// `targetProfit` (default HAT's $30,000 minimum). Solved backward from
// the same formula computeFlipBreakdown uses (closed-form, not bisected —
// totalProfit is linear in purchase price for fixed arv/reno/holdMonths).
// Returns null when ARV is unknown — never invents a price ceiling from
// no data.
export function calculateFlipMAO(arv, renovationCost, holdMonths = 6, targetProfit = FLIP_MIN_PROFIT_TARGET) {
  const a = num(arv)
  if (!a) return null
  // Real-data validation (Section 21) caught this: the module-level num()
  // helper coerces null/undefined to 0 (by design, for callers that WANT
  // that default), which silently turned "rehab unknown" into "rehab is
  // $0" here — inventing a materially wrong MAO. Renovation cost must be
  // explicitly known for a Flip MAO to mean anything.
  if (renovationCost === null || renovationCost === undefined || renovationCost === '') return null
  const reno = num(renovationCost)
  const ppCoeff   = 1.018 + 0.009 * holdMonths
  const renoCoeff = 1.02 + 0.01 * holdMonths
  const constant  = a * 0.93 - holdMonths * 308 - 2450
  return (constant - reno * renoCoeff - targetProfit) / ppCoeff
}

// BRRRR MAO (Capability #19.1, Section 8/9) — the highest purchase price
// at which BOTH hold simultaneously:
//   A. post-refi monthly cash flow > $0
//   B. cash left in the deal after refinance < maxCashLeftIn (default $30K)
// Each condition is monotonic in purchase price (higher price → worse
// cash flow AND more cash left in), so the binding constraint is whichever
// of the two independently-solved thresholds is LOWER — bisected with the
// same technique as the existing Flip/BRRRR "Reality Check" lever solves,
// centralized here instead of duplicated per caller.
// Returns { mao, limitingFactor: 'CASH_LEFT_IN'|'CASH_FLOW', cashLeftInAtMao, cashFlowAtMao }
// or { mao: null, reason } when a required input (ARV, rent) is missing —
// never a fabricated number (Section 9's explicit "NOT READY" requirement).
export function calculateBrrrrMAO(arv, renovationCost, monthlyRent, holdMonths = 6, maxCashLeftIn = BRRRR_MAX_CASH_LEFT_IN) {
  const a = num(arv)
  if (!a) return { mao: null, reason: 'ARV unknown' }
  // Same null-coerces-to-0 trap as calculateFlipMAO above — checked against
  // the raw parameter, never the num()-coerced value, which is always a
  // number and can never equal null/undefined.
  if (renovationCost === null || renovationCost === undefined || renovationCost === '') return { mao: null, reason: 'Renovation cost unknown' }
  const reno = num(renovationCost)
  const rent = num(monthlyRent)
  if (!rent) return { mao: null, reason: 'Rent estimate unknown' }

  // Real-data validation (Capability #19.1, Section 22) caught a solver bug
  // here: in this cost model, monthly cash flow does NOT vary with purchase
  // price at all — the refi loan is fixed at 70% of ARV regardless of what
  // was paid (see computeBrrrrBreakdown: refiLoan/refiMoPmt/monthlyCF have
  // no `pp` term). Bisecting cash flow as if it were a price threshold
  // returned the search floor for any lead where cash flow happened to be
  // positive everywhere — a nonsensical, overly-conservative "MAO".
  // Cash flow is correctly a PASS/FAIL GATE on the rent/ARV/reno inputs,
  // not a price-dependent constraint; only cash-left-in actually moves
  // with purchase price, so it's the only one ever bisected.
  const cashFlowAtAnyPrice = computeBrrrrBreakdown(a, a, reno, rent, holdMonths).monthlyCF
  if (cashFlowAtAnyPrice == null || cashFlowAtAnyPrice <= 0) {
    return { mao: null, reason: 'Cash flow is not positive at this rent/ARV/reno — no purchase price fixes this, since the refi loan (and its payment) is fixed at 70% of ARV regardless of price' }
  }

  const cashLeftInOk = (pp) => computeBrrrrBreakdown(pp, a, reno, rent, holdMonths).totalCashInvested < maxCashLeftIn
  const lo = a * 0.1, hi = a * 3 // comfortably brackets any realistic purchase price
  const mao = bisectThreshold(cashLeftInOk, lo, hi)
  if (mao == null) return { mao: null, reason: 'No purchase price in range keeps cash left in under the limit' }

  return { mao, limitingFactor: 'CASH_LEFT_IN', ...breakdownAt(mao, a, reno, rent, holdMonths) }
}

function breakdownAt(pp, arv, reno, rent, holdMonths) {
  const b = computeBrrrrBreakdown(pp, arv, reno, rent, holdMonths)
  return { cashLeftInAtMao: Math.round(b.totalCashInvested), cashFlowAtMao: b.monthlyCF != null ? Math.round(b.monthlyCF) : null }
}

// Capability — "current offer" single source of truth. Before this, two
// different places computed "the current offer": FinancialSection
// live-recomputed it whenever ARV/reno changed since the last AI run,
// while DealAnalysisCard's Detailed Analysis and dealExplanation.js's
// WHY/Biggest Risk bullets just read the raw stored lead.starting_offer
// — so a fresh renovation-cost edit could move Financials' "We Offer" but
// leave Detailed Analysis's "Starting Offer" (and every profit number
// computed from it) stuck on a stale figure. This is now the ONE place
// "current offer" is computed; every surface calls it with the same
// canonical Flip MAO instead of re-deriving its own opinion.
//
// Same simplified negotiation-room model FinancialSection always used
// (no motivation scoring — that's the AI-assisted version): anchor near
// MAO, floor at 80% of ask, never above 99.5% of MAO, never above ask.
export function calculateLiveOffer(mao, ask) {
  if (!mao || !ask) return null
  if (ask <= mao) return Math.round(ask / 100) * 100
  const gap = ask - mao
  const anchor = mao - gap * 0.45
  const floor = ask * 0.80
  const raw = Math.max(anchor, floor)
  return Math.round(Math.min(raw, mao * 0.995) / 100) * 100
}

// True when lead.starting_offer was computed against ARV/reno values that
// have since changed — i.e. the stored offer no longer matches today's
// MAO. Compares against deal_analysis.inputs, the same snapshot
// useDealStaleness.js already uses for its own staleness check.
export function isStoredOfferStale(lead) {
  const inp = lead?.deal_analysis?.inputs
  if (!inp) return false
  const aiArv = inp.arv
  const aiReno = inp.renovation_cost
  const arvChanged = aiArv != null && Number(lead.arv) !== Number(aiArv)
  const renoChanged = aiReno !== undefined && Number(lead.renovation_cost || 0) !== Number(aiReno || 0)
  return arvChanged || renoChanged
}

// The number every "current offer" / "starting offer" display and every
// profit-at-current-offer calculation should use — stored offer when it's
// still valid, live-recomputed (against canonicalMao) when stale or
// missing. `canonicalMao` should be the strategy-appropriate canonical
// MAO (calculateFlipMAO or calculateBrrrrMAO's .mao) — never the flat
// legacy calculateMAO() fallback.
export function getEffectiveOffer(lead, canonicalMao) {
  const ask = lead.asking_price != null ? Number(lead.asking_price) : null
  const stored = lead.starting_offer != null ? Number(lead.starting_offer) : null
  const stale = isStoredOfferStale(lead)
  if (stored != null && !stale) {
    // Bug fix — the AI-suggested starting_offer (analyze-deal's negotiation
    // anchor, stored verbatim from the LLM's response) was never checked
    // against the canonical MAO this same analysis computes, so it could
    // come back ABOVE the maximum HAT would ever pay (e.g. "open high,
    // negotiate down" reasoning with no MAO awareness) — every downstream
    // reader (profit-at-offer, the verdict, "Biggest Risk") then silently
    // evaluated a starting offer HAT itself would never actually extend.
    // The live-computed branch below already guarantees its result never
    // exceeds `canonicalMao * 0.995` (calculateLiveOffer); a stored AI
    // offer gets the same ceiling applied here so "current offer" can
    // never be a number above what MAO allows, from either source.
    if (canonicalMao != null && stored > canonicalMao) {
      return Math.round((canonicalMao * 0.995) / 100) * 100
    }
    return stored
  }
  return calculateLiveOffer(canonicalMao, ask) ?? stored
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
export function calculateFlipProfitAtPrice(purchasePrice, arv, renovationCost, holdMonths = 6) {
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
