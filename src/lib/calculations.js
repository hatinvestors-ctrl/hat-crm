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

// Capability — Flip Margin of Safety Explainability, Section 18. These two
// were previously a bare literal (`40000`) duplicated independently in
// dealExplanation.js's verdict computation, DealAnalysisCard.jsx's Path to
// a Flip Deal ("strong" styling), and FinancialSection.jsx's color tones —
// three copies of the same number that happened to agree today but had no
// shared source. Consolidated here as the ONE place the Flip STRONG bar
// and PASS/WATCH thin-margin band live; every other file now imports these
// instead of repeating the numbers. Canonical Flip MAO formula and the
// $30,000 minimum target above are UNCHANGED by this — these only affect
// which of the four already-existing tier labels (STRONG/PASS/WATCH/NO
// DEAL) a given profit number renders as.
export const FLIP_STRONG_PROFIT = 40000        // >= this profit at current offer = STRONG
export const FLIP_PASS_MARGIN = 5000           // >= target + this margin = PASS; between target and target+margin = WATCH (thin)

// Phase 2 — BRRRR Financial Accuracy (approved Issue #1, see RELEASE-
// READINESS.md). HAT's documented canonical BRRRR refinance underwriting
// assumptions — previously only referenced in comments/other files
// (decisionEngineV2.js, dealCalculations.js), now the single named
// source computeBrrrrBreakdown itself uses. NOT a business-policy
// change: 6.7%/30yr was already the documented canonical figure
// elsewhere in this codebase — this fixes the ONE place that had
// silently drifted from it (an undocumented ~6.93% flat-multiplier
// approximation).
export const BRRRR_REFI_RATE = 0.067          // HAT's documented canonical BRRRR refi interest rate
export const BRRRR_REFI_AMORT_YEARS = 30       // HAT's documented canonical BRRRR refi amortization term

// Standard mortgage amortization payment — principal, rate, and term are
// all explicit inputs (never a hidden/hardcoded multiplier baked into a
// caller), so a real deal/settings override can flow through later
// without duplicating this formula. Defaults to HAT's canonical BRRRR
// refi assumptions above. Returns 0 for a non-positive principal (never
// NaN/Infinity); a 0% rate falls back to straight-line principal/term
// (avoids a divide-by-zero in the amortization formula, which is
// undefined at r=0).
export function calculateMortgagePayment(principal, annualRate = BRRRR_REFI_RATE, amortYears = BRRRR_REFI_AMORT_YEARS) {
  const p = num(principal)
  if (!p || p <= 0) return 0
  const rate = annualRate != null ? Number(annualRate) : BRRRR_REFI_RATE
  const years = amortYears != null ? Number(amortYears) : BRRRR_REFI_AMORT_YEARS
  const n = years * 12
  const r = rate / 12
  if (r === 0) return p / n
  const factor = Math.pow(1 + r, n)
  return p * (r * factor) / (factor - 1)
}

// Underwriting Configuration V1 (Part 1/3) — every formula below accepts
// an OPTIONAL trailing `settings` object. When omitted (every pre-existing
// call site, unchanged), each field falls back to the EXACT literal that
// was already hardcoded here — behavior is byte-identical to before this
// capability. Only a caller that explicitly resolves and passes workspace
// underwriting settings (via resolveUnderwritingSettings in
// underwritingSettings.js) gets configured values. This file intentionally
// does NOT import underwritingSettings.js — the fallback literals below
// are this file's own, independent source of truth, never derived from
// another module, so this file keeps working standalone exactly as before.
function pctOrDefault(settings, key, defaultPct) {
  const v = settings?.[key]
  return (typeof v === 'number' && Number.isFinite(v)) ? v / 100 : defaultPct
}
function numOrDefault(settings, key, defaultVal) {
  const v = settings?.[key]
  return (typeof v === 'number' && Number.isFinite(v)) ? v : defaultVal
}

// Full Flip P&L at a given purchase price — HML financing (90% purchase +
// 100% reno, 2% points, 1%/mo interest), $2,450 fixed closing costs, taxes
// $208/mo + insurance $100/mo holding, sale at 93% of ARV. Same formula as
// calculateFlipProfitAtPrice() below, but returns every intermediate line
// item (needed for the Full Breakdown tab and the BRRRR/Flip solvers).
export function computeFlipBreakdown(pp, arv, reno, holdMonths = 6, settings = null) {
  const purchaseFinancingPct = pctOrDefault(settings, 'hml_purchase_financing_pct', 0.90)
  const rehabFinancingPct    = pctOrDefault(settings, 'hml_rehab_financing_pct', 1.00)
  const hmlMonthlyRatePct    = pctOrDefault(settings, 'hml_interest_monthly_pct', 0.01)
  const hmlPointsPct         = pctOrDefault(settings, 'hml_points_pct', 0.02)
  const fixedClosing         = numOrDefault(settings, 'acquisition_closing_costs', 2450)
  const monthlyTaxes         = numOrDefault(settings, 'monthly_taxes', 208)
  const monthlyInsurance     = numOrDefault(settings, 'monthly_insurance', 100)
  const sellingCostPct       = pctOrDefault(settings, 'flip_selling_cost_pct', 0.07)

  const hmlLoan         = pp * purchaseFinancingPct + reno * rehabFinancingPct
  const monthlyPmt      = hmlLoan * hmlMonthlyRatePct
  const points          = hmlLoan * hmlPointsPct
  const downPayment     = pp * (1 - purchaseFinancingPct)
  const fixedCosts      = fixedClosing
  const totalCashNeeded = downPayment + points + fixedCosts
  const holdingPerMo    = monthlyPmt + monthlyTaxes + monthlyInsurance
  const totalHolding    = holdingPerMo * holdMonths
  const saleProceeds    = arv * (1 - sellingCostPct)
  const totalProfit     = saleProceeds - hmlLoan - totalHolding - totalCashNeeded
  const roi             = totalCashNeeded > 0 ? (totalProfit / totalCashNeeded) * 100 : 0
  const annualizedRoi   = holdMonths > 0 ? (roi / holdMonths) * 12 : 0
  // Phase 2 — Financial Transparency (Part 5/9/12). Total economic project
  // cost before disposition — purchase + rehab + acquisition closing +
  // HML financing costs (points) + holding costs — using ONLY costs
  // already modeled above (never a new expense assumption). Reconciles
  // exactly: totalProfit === saleProceeds - allIn (verified by
  // construction and asserted in test/brrrrFinancialAccuracy.test.js).
  const acquisitionCosts = fixedCosts
  const financingCosts   = points
  const allIn            = pp + reno + acquisitionCosts + financingCosts + totalHolding
  const investorCashContributed = totalCashNeeded + totalHolding
  return {
    hmlLoan, monthlyPmt, points, downPayment, fixedCosts, totalCashNeeded, holdingPerMo, totalHolding,
    saleProceeds, totalProfit, roi, annualizedRoi, holdMonths,
    purchasePrice: pp, rehab: reno, acquisitionCosts, financingCosts, allIn, investorCashContributed,
  }
}

// Full BRRRR P&L at a given purchase price — same HML financing as Flip,
// refinance at 70% ARV, 30yr refi mortgage at HAT's documented canonical
// rate (BRRRR_REFI_RATE) for post-refi cash flow.
//
// Phase 2 — BRRRR Financial Accuracy (approved Issues #1 and #4; see
// RELEASE-READINESS.md). Two real fixes here, both approved, neither a
// business-policy change:
//   #1 refiMoPmt now uses calculateMortgagePayment() — the real 30yr
//      amortization formula at HAT's documented canonical 6.7% — instead
//      of an undocumented flat multiplier (0.006607) that implied an
//      unstated ~6.93% rate.
//   #4 totalCashInvested ("Cash Left In") no longer clamps a negative
//      result to $0 inside the calculation. A cash-out-positive BRRRR
//      (refinance returns MORE than was invested) now correctly reports
//      a negative number internally — presentation-layer "$0, capital
//      recovered + $X extracted" framing belongs in the UI, never inside
//      this financial engine. This was proven with two independently-
//      built reconciliation methods before being approved (see the
//      forensic audit report) — both agree exactly once unclamped.
//
// refiCostsPct (currently 3%) and the acquisition fixedCosts ($2,450)
// are Issues #2 and #3 from the same audit — NOT approved for correction
// this pass, deliberately left unchanged. `opts` only exposes the
// APPROVED Issue #1 override surface (rate/amortization); it does not
// add an unapproved override for refi costs.
// Underwriting Configuration V1 — `opts.settings` (optional, resolved
// underwriting settings from underwritingSettings.js) is a NEW, additive
// override surface alongside the pre-existing `opts.refiInterestRate`/
// `opts.amortizationYears` (Issue #1's approved override, unchanged).
// When `opts.settings` is absent (every pre-existing call site), every
// field below falls back to the exact literal already hardcoded here.
export function computeBrrrrBreakdown(pp, arv, reno, monthlyRent, holdMonths = 6, opts = {}) {
  const settings = opts.settings || null
  const refiInterestRate   = opts.refiInterestRate != null
    ? Number(opts.refiInterestRate)
    : (typeof settings?.refi_interest_rate_pct === 'number' ? settings.refi_interest_rate_pct / 100 : BRRRR_REFI_RATE)
  const amortizationYears  = opts.amortizationYears != null ? Number(opts.amortizationYears) : numOrDefault(settings, 'refi_amort_years', BRRRR_REFI_AMORT_YEARS)

  const purchaseFinancingPct = pctOrDefault(settings, 'hml_purchase_financing_pct', 0.90)
  const rehabFinancingPct    = pctOrDefault(settings, 'hml_rehab_financing_pct', 1.00)
  const hmlMonthlyRatePct    = pctOrDefault(settings, 'hml_interest_monthly_pct', 0.01)
  const hmlPointsPct         = pctOrDefault(settings, 'hml_points_pct', 0.02)
  const fixedClosing         = numOrDefault(settings, 'acquisition_closing_costs', 2450)
  const monthlyTaxes         = numOrDefault(settings, 'monthly_taxes', 208)
  const monthlyInsurance     = numOrDefault(settings, 'monthly_insurance', 100)
  const refiLtvPct           = pctOrDefault(settings, 'refi_ltv_pct', 0.70)
  const refiCostsPct         = pctOrDefault(settings, 'refi_costs_pct', 0.03)

  const hmlLoan           = pp * purchaseFinancingPct + reno * rehabFinancingPct
  const monthlyPmt        = hmlLoan * hmlMonthlyRatePct
  const points            = hmlLoan * hmlPointsPct
  const downPayment       = pp * (1 - purchaseFinancingPct)
  const fixedCosts        = fixedClosing
  const totalCashNeeded   = downPayment + points + fixedCosts
  const holdingPerMo      = monthlyPmt + monthlyTaxes + monthlyInsurance
  const totalHolding      = holdingPerMo * holdMonths
  const refiLoan          = arv * refiLtvPct
  const refiCosts         = refiLoan * refiCostsPct   // Issue #2 — estimated/defaulted, NOT approved to change the DEFAULT this pass; now configurable, default unchanged
  const refiCashOut       = refiLoan - refiCosts - hmlLoan - totalHolding
  // Issue #4 fix — signed, never clamped inside the engine.
  const totalCashInvested = totalCashNeeded - refiCashOut
  // Issue #1 fix — real amortization at the canonical rate, not a flat multiplier.
  const refiMoPmt         = calculateMortgagePayment(refiLoan, refiInterestRate, amortizationYears)
  const monthlyCF         = monthlyRent > 0 ? monthlyRent - refiMoPmt - monthlyTaxes - monthlyInsurance : null
  const annualCF          = monthlyCF != null ? monthlyCF * 12 : null
  // Part 3 — CoC edge-case handling was ALREADY correct: null whenever
  // cash left in is <= 0 (never divides by zero or a negative number,
  // never an artificial huge percentage). Unchanged, just re-verified.
  const coc               = totalCashInvested > 0 && annualCF != null ? (annualCF / totalCashInvested) * 100 : null
  // Phase 2 — Financial Transparency (Part 5/6/12). Additive fields only
  // — every pre-existing field name/value contract above is preserved.
  const acquisitionCosts  = fixedCosts
  const financingCosts    = points
  const investorPurchaseEquity = downPayment
  // investorCashContributed folds holding costs into the INVESTOR side of
  // the ledger (matches the mission's own Section 8/17 waterfall, which
  // lists "Investor-Paid Holding Costs" as a contribution line, not a
  // refi deduction) — so netRefiCashReturned below must NOT also
  // subtract holding costs, or the two would double-count it and the
  // ledger wouldn't reconcile (caught by test/brrrrFinancialAccuracy.test.js's
  // exact-reconciliation assertions). `refiCashOut` (the pre-existing
  // field, holding-inclusive) and `totalCashInvested` are UNCHANGED and
  // remain the actual calculation Issue #4 fixed — these two new fields
  // are a presentation-only re-split of the identical economic result.
  const investorCashContributed = totalCashNeeded + totalHolding
  const netRefiCashReturned = refiLoan - hmlLoan - refiCosts
  const allIn             = pp + reno + acquisitionCosts + financingCosts + totalHolding
  const cashLeftIn        = totalCashInvested > 0 ? totalCashInvested : 0
  const cashExtracted     = totalCashInvested < 0 ? Math.abs(totalCashInvested) : 0
  return {
    hmlLoan, monthlyPmt, points, downPayment, fixedCosts, totalCashNeeded, holdingPerMo, totalHolding,
    refiLoan, refiCosts, refiCashOut, totalCashInvested, refiMoPmt, monthlyCF, annualCF, coc, holdMonths,
    // Transparency additions:
    purchasePrice: pp, rehab: reno, acquisitionCosts, financingCosts, investorPurchaseEquity,
    investorCashContributed, allIn, cashLeftIn, cashExtracted,
    // BRRRR Rendered Settings Integrity Fix (2026-08-30) — real, confirmed
    // root cause: these three DESCRIPTIVE fields were hardcoded literals
    // (0.70 / 208 / 100) instead of the `refiLtvPct`/`monthlyTaxes`/
    // `monthlyInsurance` local variables already computed above and
    // already used for the ACTUAL math (refiLoan, holdingPerMo, monthlyCF
    // etc. were always correct). A UI reading `b.refiLtvPct` to LABEL the
    // Gross Refinance Loan therefore showed a stale "70%" next to a
    // correctly-computed 75%-derived dollar amount — exactly the
    // "label = 70%, loan = 75%" defect this fix removes. No math changed:
    // every dollar value in this return object is unchanged; only these
    // three fields now describe the settings that were already in effect.
    refiValue: arv, refiLtvPct, grossRefiLoan: refiLoan, hmlPayoff: hmlLoan,
    netRefiCashReturned, refiInterestRate, amortizationYears,
    rent: monthlyRent, taxesMonthly: monthlyTaxes, insuranceMonthly: monthlyInsurance, mortgagePayment: refiMoPmt,
  }
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
// Underwriting Configuration V1 — the closed-form coefficients below are
// algebraically re-derived (independently verified, not just re-typed)
// from computeFlipBreakdown's formula with the same optional `settings`
// generalization. At every default value, ppCoeff/renoCoeff/constant
// reduce EXACTLY to the original hardcoded 1.018+0.009×hold /
// 1.02+0.01×hold / arv×0.93−hold×308−2450 — proven identical by
// construction and locked by test/underwritingSettings.test.js.
export function calculateFlipMAO(arv, renovationCost, holdMonths = 6, targetProfit = FLIP_MIN_PROFIT_TARGET, settings = null) {
  const a = num(arv)
  if (!a) return null
  // Real-data validation (Section 21) caught this: the module-level num()
  // helper coerces null/undefined to 0 (by design, for callers that WANT
  // that default), which silently turned "rehab unknown" into "rehab is
  // $0" here — inventing a materially wrong MAO. Renovation cost must be
  // explicitly known for a Flip MAO to mean anything.
  if (renovationCost === null || renovationCost === undefined || renovationCost === '') return null
  const reno = num(renovationCost)

  const financePct   = pctOrDefault(settings, 'hml_purchase_financing_pct', 0.90)
  const rehabFinPct  = pctOrDefault(settings, 'hml_rehab_financing_pct', 1.00)
  const hmlRate      = pctOrDefault(settings, 'hml_interest_monthly_pct', 0.01)
  const pointsPct    = pctOrDefault(settings, 'hml_points_pct', 0.02)
  const fixedClosing = numOrDefault(settings, 'acquisition_closing_costs', 2450)
  const monthlyTI    = numOrDefault(settings, 'monthly_taxes', 208) + numOrDefault(settings, 'monthly_insurance', 100)
  const sellingCostPct = pctOrDefault(settings, 'flip_selling_cost_pct', 0.07)

  const ppCoeff   = 1 + financePct * (holdMonths * hmlRate + pointsPct)
  const renoCoeff = rehabFinPct * (1 + holdMonths * hmlRate + pointsPct)
  const constant  = a * (1 - sellingCostPct) - holdMonths * monthlyTI - fixedClosing
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
export function calculateBrrrrMAO(arv, renovationCost, monthlyRent, holdMonths = 6, maxCashLeftIn = BRRRR_MAX_CASH_LEFT_IN, settings = null) {
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
  const cashFlowAtAnyPrice = computeBrrrrBreakdown(a, a, reno, rent, holdMonths, { settings }).monthlyCF
  if (cashFlowAtAnyPrice == null || cashFlowAtAnyPrice <= 0) {
    return { mao: null, reason: 'Cash flow is not positive at this rent/ARV/reno — no purchase price fixes this, since the refi loan (and its payment) is fixed at 70% of ARV regardless of price' }
  }

  const cashLeftInOk = (pp) => computeBrrrrBreakdown(pp, a, reno, rent, holdMonths, { settings }).totalCashInvested < maxCashLeftIn
  const lo = a * 0.1, hi = a * 3 // comfortably brackets any realistic purchase price
  const mao = bisectThreshold(cashLeftInOk, lo, hi)
  if (mao == null) return { mao: null, reason: 'No purchase price in range keeps cash left in under the limit' }

  return { mao, limitingFactor: 'CASH_LEFT_IN', ...breakdownAt(mao, a, reno, rent, holdMonths, settings) }
}

function breakdownAt(pp, arv, reno, rent, holdMonths, settings = null) {
  const b = computeBrrrrBreakdown(pp, arv, reno, rent, holdMonths, { settings })
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
  // Bug fix (found via scripts/verify-financial-consistency.mjs) — `mao *
  // 0.995` was meant as "0.5% below MAO", which only holds when mao is
  // positive. On a lead where the deal is underwater at any price (ARV <
  // renovation cost, e.g. bad/placeholder data), MAO itself is negative,
  // and multiplying a negative number by 0.995 moves it 0.5% TOWARD zero
  // (i.e. above MAO), silently breaking the "offer never exceeds MAO"
  // guarantee. `mao - |mao| * 0.005` always moves 0.5% AWAY from zero,
  // so the cap is below MAO regardless of sign.
  const cap = mao - Math.abs(mao) * 0.005
  return Math.round(Math.min(raw, cap) / 100) * 100
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
// Underwriting Configuration V1, Part 13 duplicate-formula cleanup — this
// used to independently re-derive the exact same lines computeFlipBreakdown
// already computes. Now delegates to it (same formula, verified identical
// output at every default), so there is only ONE place this math lives.
// `settings` optional, same contract as everywhere else in this file.
export function calculateFlipProfitAtPrice(purchasePrice, arv, renovationCost, holdMonths = 6, settings = null) {
  const pp   = num(purchasePrice)
  const rv   = num(arv)
  const reno = num(renovationCost)
  if (!pp || !rv) return null
  return computeFlipBreakdown(pp, rv, reno, holdMonths, settings).totalProfit
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

// Phase 2 — Financial Transparency (Part 2/18, approved Issue #4).
// Single shared presentation helper for a signed Cash Left In value —
// the ONE place that turns a negative "cash extracted" result into
// user-facing copy, so no component reinvents this framing. The
// canonical engine value (computeBrrrrBreakdown's totalCashInvested)
// stays signed; this only formats it for display.
// Returns { display, extracted, allRecovered } — `display` is always a
// non-negative currency string; `extracted` is the positive dollar
// amount pulled out beyond 100% capital recovery (null if none);
// `allRecovered` is true whenever cashLeftIn <= 0 (capital fully back).
export function describeCashLeftIn(value) {
  if (value == null || Number.isNaN(Number(value))) return { display: '—', extracted: null, allRecovered: false }
  const v = Number(value)
  if (v <= 0) {
    const extracted = Math.round(Math.abs(v))
    return { display: formatCurrency(0), extracted: extracted > 0 ? extracted : null, allRecovered: true }
  }
  return { display: formatCurrency(v), extracted: null, allRecovered: false }
}

// Price Clarity + Max Buy Consistency (see RELEASE-READINESS.md) — the
// ONE shared presentation-rounding helper for Max Buy. Several places
// already rounded the raw calculateFlipMAO/calculateBrrrrMAO output to
// the nearest $100 independently (DealDecisionCenter's headline,
// FinancialSection's price strip) — that rounding was applied
// inconsistently: only to the HEADLINE Max Buy number, never to numbers
// DERIVED from it (Seller Gap, offer-to-Max-Buy room), which kept
// re-deriving from the unrounded raw value instead. This is presentation
// rounding only — it does NOT change the canonical Max Buy formula, and
// the raw/exact value is still always available from
// computeFlipResult(lead).mao for calculation-disclosure UI. Returns
// null if the raw value is null/infeasible — never invents a number.
export function roundMaxBuy(value) {
  if (value == null || Number.isNaN(Number(value))) return null
  return Math.round(Number(value) / 100) * 100
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
