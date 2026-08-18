// src/lib/dealExplanation.js
// Capability — Deal Analysis Clarity + Flip/BRRRR Separation Cleanup.
//
// Deterministic, template-driven Flip/BRRRR explanations. NO LLM call, no
// independent financial calculation — every number here comes straight
// from the canonical layer (src/lib/calculations.js), the same functions
// FinancialSection/Path to a Deal/Copilot already use. This module only
// decides which plain-English sentence to attach to a canonical number,
// never what the number is.
//
// Root problem this fixes: the old "WHY" bullets were parsed out of
// ai_notes free text (see leadPriority.js's derivePriority), which the AI
// writes by picking whichever of Flip/BRRRR scores best — completely
// independent of which tab Kevin has open. A Flip-tab WHY could describe
// BRRRR cash flow. This module builds each tab's WHY strictly from that
// tab's own strategy result.

import {
  calculateFlipMAO, calculateBrrrrMAO, computeFlipBreakdown, computeBrrrrBreakdown,
  FLIP_MIN_PROFIT_TARGET, BRRRR_MAX_CASH_LEFT_IN, FLIP_STRONG_PROFIT, FLIP_PASS_MARGIN,
  formatCurrency as fc, getEffectiveOffer, describeCashLeftIn,
} from './calculations.js'

const THIN_MARGIN = FLIP_PASS_MARGIN // within $5K of target = WATCH, not a clean PASS (Section 11)

// Capability — Flip Margin of Safety Explainability. MAO already IS the
// price that protects the $30K target (calculateFlipMAO's whole job) —
// the tier never changes that target. What the tier actually measures is
// how much room exists between the price being evaluated and that ceiling.
// One deterministic template per tier, built strictly from numbers
// computeFlipResult already computed — no new scoring, no LLM.
function marginOfSafetyExplanation({ verdict, priceCushion, profitCushion, maoFeasible, mao }) {
  const pc = priceCushion != null ? fc(Math.round(priceCushion)) : null
  switch (verdict) {
    case 'STRONG':
      return {
        title: 'Healthy margin of safety',
        why: `The current price is ${pc || 'well'} below Flip MAO, leaving meaningful room for normal underwriting variance — a rehab overrun, a softer ARV, or extra holding time can happen here without the deal falling below HAT's $30,000 minimum.`,
      }
    case 'PASS':
      return {
        title: 'Some margin of safety',
        why: `The deal clears HAT's $30,000 target with a reasonable cushion (${pc} below Flip MAO) — not maximum room, but enough to absorb a normal-sized surprise.`,
      }
    case 'WATCH':
      return {
        title: 'Thin margin of safety',
        why: `This deal technically meets HAT's $30,000 minimum, but the price is only ${pc} below Flip MAO. A small rehab overrun, a lower ARV, or extra holding cost could push projected profit below target.`,
      }
    case 'NO DEAL':
      // F2 — Max Buy at or below $0 means no purchase price makes this
      // Flip work under current assumptions; this is a distinct case from
      // "the current price just happens to be too high" (F1) and gets its
      // own, unambiguous explanation rather than reusing price-cushion
      // language that doesn't apply when there IS no valid ceiling price.
      if (!maoFeasible) {
        return {
          title: 'Not economically feasible',
          why: 'Required purchase price is not economically feasible under the current rehab and ARV assumptions.',
        }
      }
      if (priceCushion == null) {
        return { title: 'No price to evaluate', why: 'No asking price or offer is on file yet, so a Flip Margin of Safety can\'t be calculated.' }
      }
      // F1 — the current price doesn't work, but Max Buy (a lower,
      // realistic price) is still a genuine number worth negotiating
      // toward. Say both things: the current price fails, AND the
      // negotiation opportunity is still on the table.
      if (priceCushion < 0) {
        return {
          title: 'No deal at current price',
          why: `At the current price, this does not support HAT's $30,000 minimum Flip profit. Could work around ${fc(Math.round(mao / 100) * 100)} or below.`,
        }
      }
      return {
        title: 'Below the minimum target',
        why: `Projected profit at this price is below HAT's $30,000 minimum Flip profit target.`,
      }
    default:
      return { title: '', why: '' }
  }
}

// ── FLIP ──────────────────────────────────────────────────────────────
//
// F1/F2 (Release Readiness findings, see docs/release-readiness/RELEASE-
// READINESS.md) — this function answers TWO separate questions, and never
// lets one silently stand in for the other:
//
//   1. "Does this work at the price actually on the table?" — the CURRENT
//      DEAL verdict/profit, evaluated at the real ACTUAL/SUBMITTED offer
//      (lead.offer_price) when one exists, otherwise the asking price.
//      Never swapped for Max Buy, and never for the RECOMMENDED offer
//      (lead.starting_offer/currentOffer, a system suggestion, not a real
//      price) — a bad current price is reported as a bad current price.
//   2. "Is there a lower price where this WOULD work?" — Max Buy, computed
//      independently and always returned (when feasible) so a genuine
//      negotiation opportunity stays visible even when #1 is NO DEAL.
//
// `currentOffer` keeps its pre-existing meaning: the MAO-anchored
// NEGOTIATED offer HAT would extend (getEffectiveOffer/calculateLiveOffer)
// — still useful, still returned, never confused with the real evaluation
// price above.
export function computeFlipResult(lead) {
  const arv = lead.arv != null ? Number(lead.arv) : null
  const reno = lead.renovation_cost != null ? Number(lead.renovation_cost) : null
  const holdMonths = lead.hold_months || 6
  const ask = lead.asking_price != null ? Number(lead.asking_price) : null
  // D2 (System Validation Review — Product Decision, see RELEASE-
  // READINESS.md) — field provenance audit confirmed `lead.offer_price`
  // and `lead.starting_offer` are NOT duplicates of the same concept:
  //   - offer_price  = a REAL offer HAT actually submitted/logged (set by
  //     LeadForm's "Offer Price" field or LogOutcomeModal when an outcome
  //     records an offer having been made) — the ACTUAL/SUBMITTED offer.
  //   - starting_offer = the system's negotiation-anchor recommendation
  //     ("We Offer" in FinancialSection), AI-suggested or manually
  //     overridden, always clamped to Max Buy — the RECOMMENDED offer.
  // These must never be conflated. `actualOffer` below is ONLY ever
  // offer_price, never starting_offer.
  const actualOffer = lead.offer_price != null ? Number(lead.offer_price) : null

  if (arv == null) return { available: false, reason: 'ARV is missing.' }
  if (reno == null) return { available: false, reason: 'Renovation cost is missing.' }

  const rawMao = calculateFlipMAO(arv, reno, holdMonths)
  // F2 — a Max Buy at or below $0 is not a valid acquisition price under
  // any purchase-price assumption; expose it as unusable (null) rather
  // than a negative dollar figure a downstream reader (or a clamp) could
  // evaluate profit against. `rawMao` is kept as a local-only diagnostic,
  // never returned or fed into any price/profit calculation below.
  const maoFeasible = rawMao != null && rawMao > 0
  const mao = maoFeasible ? rawMao : null

  // F1/D2 — the CURRENT DEAL question is evaluated at the real, actual
  // price on the table: the ACTUAL/SUBMITTED offer (offer_price) when one
  // has genuinely been made, otherwise the asking price. Never Max Buy,
  // and never the RECOMMENDED offer (starting_offer/currentOffer below) —
  // a system-generated negotiation suggestion is not a real price anyone
  // has actually agreed to pay or offer.
  const evaluationPrice = actualOffer ?? ask
  // Phase 2 — Financial Transparency (Part 12, single source of truth).
  // The full line-item breakdown at the real evaluation price, computed
  // ONCE here and exposed as-is — a "View Calculation" UI reads this
  // object directly instead of re-deriving All-In/profit math itself.
  const evaluationBreakdown = (evaluationPrice != null && evaluationPrice > 0)
    ? computeFlipBreakdown(evaluationPrice, arv, reno, holdMonths)
    : null
  const profitAtEvaluationPrice = evaluationBreakdown ? evaluationBreakdown.totalProfit : null

  let verdict = 'NO DEAL'
  if (profitAtEvaluationPrice != null) {
    if (profitAtEvaluationPrice >= FLIP_STRONG_PROFIT) verdict = 'STRONG'
    else if (profitAtEvaluationPrice >= FLIP_MIN_PROFIT_TARGET + THIN_MARGIN) verdict = 'PASS'
    else if (profitAtEvaluationPrice >= FLIP_MIN_PROFIT_TARGET) verdict = 'WATCH'
    else verdict = 'NO DEAL'
  }
  // F2 — an infeasible Max Buy means no purchase price meets HAT's target
  // under current assumptions; the current-price verdict can never read
  // better than NO DEAL regardless of what the evaluation price produced.
  if (!maoFeasible) verdict = 'NO DEAL'

  // The negotiated/recommended offer HAT would actually extend — MAO-
  // anchored, never above Max Buy. Distinct from evaluationPrice above.
  // Null when Max Buy itself isn't feasible (F2) — there is no valid
  // offer to recommend on a deal with no working price.
  const currentOffer = maoFeasible ? (getEffectiveOffer(lead, mao) ?? ask) : null

  // Margin of Safety (Section 2) — PRICE cushion is now measured against
  // the real evaluation price (F1: can go negative when asking price is
  // above Max Buy — that's the whole point, it's what makes "no deal at
  // current price" visible) rather than the already-clamped negotiated
  // offer, which by construction could never read as "over Max Buy."
  const priceCushion = (mao != null && evaluationPrice != null) ? mao - evaluationPrice : null
  const profitCushion = profitAtEvaluationPrice != null ? profitAtEvaluationPrice - FLIP_MIN_PROFIT_TARGET : null
  const marginOfSafety = {
    ...marginOfSafetyExplanation({ verdict, priceCushion, profitCushion, maoFeasible, mao }),
    priceCushion, profitCushion,
  }

  const why = []
  const biggestRisk = []

  if (!maoFeasible) {
    biggestRisk.push('Renovation cost is too high relative to ARV — no purchase price makes this Flip work under current assumptions.')
  }

  if (evaluationPrice != null && profitAtEvaluationPrice != null) {
    why.push(`At ${fc(evaluationPrice)}, estimated flip profit is ${fc(profitAtEvaluationPrice)}.`)
    if (profitAtEvaluationPrice >= FLIP_MIN_PROFIT_TARGET) {
      why.push(verdict === 'WATCH'
        ? `HAT minimum is ${fc(FLIP_MIN_PROFIT_TARGET)}, so the deal works — but with little room.`
        : `HAT minimum flip profit is ${fc(FLIP_MIN_PROFIT_TARGET)}, so the deal works.`)
    } else if (maoFeasible) {
      why.push(`HAT minimum flip profit is ${fc(FLIP_MIN_PROFIT_TARGET)} — this price falls short by ${fc(FLIP_MIN_PROFIT_TARGET - profitAtEvaluationPrice)}.`)
    }
  }
  if (mao != null) why.push(`Maximum flip purchase price is ${fc(Math.round(mao / 100) * 100)}.`)
  // Renovation-scope sanity note — deterministic, coarse (no confidence
  // score exists yet for reno estimates; only shown when a number exists).
  if (reno != null && arv) {
    const renoPctOfArv = reno / arv
    why.push(renoPctOfArv <= 0.30
      ? `${fc(reno)} renovation budget looks reasonable based on current property data.`
      : `${fc(reno)} renovation budget is large relative to ARV — worth confirming scope before committing.`)
  }

  if (ask != null && mao != null && ask > mao) {
    biggestRisk.push(`Asking price is ${fc(ask)}, which is ${fc(ask - mao)} above HAT's Flip MAO. We need a major price reduction.`)
  } else if (ask != null && mao != null) {
    biggestRisk.push(`Asking price is already at or below HAT's Flip MAO — the main risk is renovation cost or ARV coming in worse than estimated.`)
  }
  if (currentOffer != null && mao != null && currentOffer <= mao) {
    const cushion = mao - currentOffer
    if (cushion < 3000) {
      biggestRisk.push(`Current offer is only ${fc(cushion)} below the maximum. There is very little room for surprises.`)
    }
  }

  return {
    available: true, verdict, mao, maoFeasible, evaluationPrice, actualOffer, currentOffer,
    projectedProfit: profitAtEvaluationPrice, breakdown: evaluationBreakdown,
    targetProfit: FLIP_MIN_PROFIT_TARGET, why: why.slice(0, 4), biggestRisk: biggestRisk.slice(0, 1),
    marginOfSafety,
  }
}

// Section 15 (optional) — downside sensitivity. Reuses computeFlipBreakdown
// with modified inputs ONLY; no new financial model, no probability claims,
// just "what does profit become if X changes" using the exact same formula.
export function computeFlipDownsideSensitivity(lead, flipResult) {
  if (!flipResult?.available || flipResult.currentOffer == null) return null
  const arv = lead.arv != null ? Number(lead.arv) : null
  const reno = lead.renovation_cost != null ? Number(lead.renovation_cost) : null
  if (arv == null || reno == null) return null
  const holdMonths = lead.hold_months || 6
  const pp = flipResult.currentOffer

  const renoOverrun = computeFlipBreakdown(pp, arv, reno + 5000, holdMonths).totalProfit
  const softerArv = computeFlipBreakdown(pp, arv - 10000, reno, holdMonths).totalProfit

  return [
    { label: 'Rehab +$5,000', profit: renoOverrun },
    { label: 'ARV −$10,000', profit: softerArv },
  ]
}

// ── BRRRR ─────────────────────────────────────────────────────────────
export function computeBrrrrResult(lead) {
  const arv = lead.arv != null ? Number(lead.arv) : null
  const reno = lead.renovation_cost != null ? Number(lead.renovation_cost) : null
  const rent = lead.rent_estimate != null ? Number(lead.rent_estimate) : null
  const holdMonths = lead.hold_months || 6

  if (arv == null) return { available: false, reason: 'ARV is missing.', missingField: 'ARV' }
  if (reno == null) return { available: false, reason: 'Renovation cost is missing.', missingField: 'renovation cost' }
  if (rent == null) return { available: false, reason: 'BRRRR cannot be confirmed yet — rent estimate is missing.', missingField: 'rent estimate' }

  const maoResult = calculateBrrrrMAO(arv, reno, rent, holdMonths)
  // Same effective-offer logic as Flip (see computeFlipResult) — keeps
  // BRRRR's cash-left-in/cash-flow figures aligned with whatever
  // Financials is currently showing, not a stale stored offer.
  const currentOffer = getEffectiveOffer(lead, maoResult.mao) ?? (lead.asking_price != null ? Number(lead.asking_price) : null)
  const current = currentOffer != null ? computeBrrrrBreakdown(currentOffer, arv, reno, rent, holdMonths) : null
  const cashLeftIn = current ? Math.round(current.totalCashInvested) : null
  const monthlyCashFlow = current?.monthlyCF != null ? Math.round(current.monthlyCF) : null
  const coc = current?.coc ?? null

  let verdict = 'NO DEAL'
  if (cashLeftIn != null && monthlyCashFlow != null) {
    const meetsMin = monthlyCashFlow > 0 && cashLeftIn < BRRRR_MAX_CASH_LEFT_IN
    if (meetsMin && cashLeftIn < 20000 && monthlyCashFlow >= 200) verdict = 'STRONG'
    else if (meetsMin && cashLeftIn < BRRRR_MAX_CASH_LEFT_IN - 5000) verdict = 'PASS'
    else if (meetsMin) verdict = 'WATCH' // meets the bar but thin (cash-left-in within $5K of the ceiling)
    else verdict = 'NO DEAL'
  }

  const why = []
  const biggestRisk = []
  if (cashLeftIn != null) {
    // Part 2/18 — a signed cashLeftIn (approved Issue #4) never renders
    // as a raw negative dollar figure in narrative text either.
    const cli = describeCashLeftIn(cashLeftIn)
    why.push(cli.extracted != null
      ? `All capital is recovered at refinance, with about ${fc(cli.extracted)} extracted beyond that.`
      : `About ${cli.display} would remain in the deal after refinance.`)
  }
  if (monthlyCashFlow != null) {
    why.push(monthlyCashFlow > 0
      ? `At ${fc(rent)} rent, estimated cash flow is ${fc(monthlyCashFlow)}/month.`
      : `At ${fc(rent)} rent, estimated cash flow is ${fc(monthlyCashFlow)}/month — negative.`)
  }
  if (verdict === 'STRONG' || verdict === 'PASS' || verdict === 'WATCH') {
    why.push(`The property meets HAT's BRRRR targets${verdict === 'WATCH' ? ', but with little cushion' : ''}.`)
  }

  biggestRisk.push('BRRRR depends on achieving the expected rent and ARV.')
  if (maoResult.mao == null) biggestRisk.unshift(`BRRRR MAO: Not confirmed — ${maoResult.reason}.`)

  return {
    available: true, verdict, mao: maoResult.mao, limitingFactor: maoResult.limitingFactor ?? null,
    currentOffer, rent, cashLeftIn, monthlyCashFlow, coc,
    // Phase 2 — Financial Transparency (Part 12). The full canonical
    // breakdown at the evaluated price — a "View Calculation" UI reads
    // this directly instead of re-deriving the waterfall itself.
    breakdown: current,
    why: why.slice(0, 4), biggestRisk: biggestRisk.slice(0, 1),
  }
}

// ── Strategy recommendation (Section 2/9) ───────────────────────────────
const VERDICT_RANK = { STRONG: 3, PASS: 2, WATCH: 1, 'NO DEAL': 0 }

export function computeStrategyRecommendation(flip, brrrr) {
  const flipOk = flip?.available && flip.verdict !== 'NO DEAL'
  const brrrrOk = brrrr?.available && brrrr.verdict !== 'NO DEAL'

  if (!flipOk && !brrrrOk) {
    return { preferredStrategy: 'NONE', summary: 'NO STRATEGY MEETS HAT TARGETS', reason: null }
  }
  if (flipOk && !brrrrOk) {
    return { preferredStrategy: 'FLIP', summary: 'BEST EXIT: FLIP', reason: null }
  }
  if (brrrrOk && !flipOk) {
    return { preferredStrategy: 'BRRRR', summary: 'BEST EXIT: BRRRR', reason: null }
  }
  // Both viable — rank by verdict strength, tie → SIMILAR.
  const fr = VERDICT_RANK[flip.verdict] ?? 0
  const br = VERDICT_RANK[brrrr.verdict] ?? 0
  if (fr === br) return { preferredStrategy: 'BOTH', summary: 'BOTH WORK — SIMILAR', reason: null }
  const winner = fr > br ? 'FLIP' : 'BRRRR'
  return {
    preferredStrategy: 'BOTH',
    summary: `BOTH WORK — ${winner} PREFERRED`,
    reason: winner === 'BRRRR'
      ? 'BRRRR has the stronger risk-adjusted numbers.'
      : 'Flip has the stronger risk-adjusted numbers.',
  }
}
