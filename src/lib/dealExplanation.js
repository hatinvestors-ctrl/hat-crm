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
  FLIP_MIN_PROFIT_TARGET, BRRRR_MAX_CASH_LEFT_IN, formatCurrency as fc, getEffectiveOffer,
} from './calculations.js'

const THIN_MARGIN = 5000 // within $5K of target = WATCH, not a clean PASS (Section 11)

// ── FLIP ──────────────────────────────────────────────────────────────
export function computeFlipResult(lead) {
  const arv = lead.arv != null ? Number(lead.arv) : null
  const reno = lead.renovation_cost != null ? Number(lead.renovation_cost) : null
  const holdMonths = lead.hold_months || 6
  const ask = lead.asking_price != null ? Number(lead.asking_price) : null

  if (arv == null) return { available: false, reason: 'ARV is missing.' }
  if (reno == null) return { available: false, reason: 'Renovation cost is missing.' }

  const mao = calculateFlipMAO(arv, reno, holdMonths)
  // Same effective-offer logic FinancialSection uses (calculations.js) —
  // stored starting_offer when it's still valid, live-recomputed against
  // canonical Flip MAO when ARV/reno moved since the last AI run. Fixes
  // "Starting Offer" here reading a stale number after a rehab edit while
  // Financials' "We Offer" already updated.
  const currentOffer = getEffectiveOffer(lead, mao) ?? ask
  const profitAtCurrentOffer = currentOffer != null ? computeFlipBreakdown(currentOffer, arv, reno, holdMonths).totalProfit : null

  let verdict = 'NO DEAL'
  if (profitAtCurrentOffer != null) {
    if (profitAtCurrentOffer >= 40000) verdict = 'STRONG'
    else if (profitAtCurrentOffer >= FLIP_MIN_PROFIT_TARGET + THIN_MARGIN) verdict = 'PASS'
    else if (profitAtCurrentOffer >= FLIP_MIN_PROFIT_TARGET) verdict = 'WATCH'
    else verdict = 'NO DEAL'
  }

  const why = []
  const biggestRisk = []

  if (currentOffer != null && profitAtCurrentOffer != null) {
    why.push(`At ${fc(currentOffer)}, estimated flip profit is ${fc(profitAtCurrentOffer)}.`)
    if (profitAtCurrentOffer >= FLIP_MIN_PROFIT_TARGET) {
      why.push(verdict === 'WATCH'
        ? `HAT minimum is ${fc(FLIP_MIN_PROFIT_TARGET)}, so the deal works — but with little room.`
        : `HAT minimum flip profit is ${fc(FLIP_MIN_PROFIT_TARGET)}, so the deal works.`)
    } else {
      why.push(`HAT minimum flip profit is ${fc(FLIP_MIN_PROFIT_TARGET)} — this offer falls short by ${fc(FLIP_MIN_PROFIT_TARGET - profitAtCurrentOffer)}.`)
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
    available: true, verdict, mao, currentOffer, projectedProfit: profitAtCurrentOffer,
    targetProfit: FLIP_MIN_PROFIT_TARGET, why: why.slice(0, 4), biggestRisk: biggestRisk.slice(0, 1),
  }
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
  if (cashLeftIn != null) why.push(`About ${fc(cashLeftIn)} would remain in the deal after refinance.`)
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
