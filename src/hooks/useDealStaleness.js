/**
 * Single source of truth for "does the AI analysis need re-running".
 * Compares the lead's live ARV / renovation cost / asking price / rent
 * estimate / strategy against the values that were actually used to
 * produce lead.deal_analysis (frozen in lead.deal_analysis.inputs at
 * generation time by netlify/functions/analyze-deal.mjs).
 *
 * Analysis Readiness + Decision Integrity Fix, Part 9/10/11 — extended
 * from ARV/renovation_cost/strategy-only to also cover asking_price and
 * (BRRRR-only) rent_estimate, the two other material financial inputs the
 * QA audit found were NOT tracked, meaning an analysis could still show
 * "✓ Up to date" after the asking price or rent assumption changed.
 *
 * BACKWARD COMPATIBILITY (Part 10) — analyses generated before this fix
 * have no `asking_price`/`rent_estimate` key in `inputs` at all (not even
 * `null`). Per the mission's explicit conservative rule ("if the system
 * cannot prove the old analysis used the current material input, it is
 * safer to mark it as needing refresh than to falsely show Up to date"):
 *   - if the key is ABSENT and the lead currently has a real value for it,
 *     that's treated as stale (can't prove the old analysis reflects it).
 *   - if the key is ABSENT and the lead also has no value for it (both
 *     genuinely empty), that's NOT stale — nothing to compare, same
 *     leniency the existing null-vs-null renovation_cost check already used.
 */
import { UNDERWRITING_FIELDS, DEFAULT_UNDERWRITING_SETTINGS } from '../lib/underwritingSettings'

/**
 * @param {object} lead
 * @param {object|null} underwritingSettings - the CURRENT effective
 *   resolved underwriting settings (Underwriting Configuration V1, Part
 *   12) — optional, defaults to system defaults so every existing call
 *   site (that doesn't pass it) behaves exactly as before this capability.
 */
export function useDealStaleness(lead, underwritingSettings = null) {
  const inp = lead?.deal_analysis?.inputs
  if (!inp) return { stale: false, reasons: [] }

  const reasons = []
  const currentUnderwriting = underwritingSettings || DEFAULT_UNDERWRITING_SETTINGS

  if (Number(lead.arv || 0) !== Number(inp.arv || 0)) {
    reasons.push('ARV changed')
  }

  const curReno = lead.renovation_cost != null ? Number(lead.renovation_cost) : null
  const renoMatch = curReno === inp.renovation_cost || (curReno == null && inp.renovation_cost == null)
  if (!renoMatch) {
    reasons.push('Renovation cost changed')
  }

  // Asking price — new material input tracked (Part 9).
  const hasFrozenAskingPrice = Object.prototype.hasOwnProperty.call(inp, 'asking_price')
  const curAsk = lead.asking_price != null ? Number(lead.asking_price) : null
  if (hasFrozenAskingPrice) {
    const askMatch = curAsk === (inp.asking_price != null ? Number(inp.asking_price) : null) || (curAsk == null && inp.asking_price == null)
    if (!askMatch) reasons.push('Asking price changed')
  } else if (curAsk != null) {
    // Legacy analysis, generated before asking_price was frozen — cannot
    // prove it reflects the current asking price. Conservative per Part 10.
    reasons.push('Analysis predates asking-price tracking — refresh to confirm it reflects the current price')
  }

  const curStrategy = lead.deal_analysis?.strategy || 'flip'
  const inpStrategy = inp.strategy || 'flip'
  if (inp.strategy != null && curStrategy !== inpStrategy) {
    reasons.push('Strategy changed')
  }

  // Rent estimate — new material input, BRRRR only (Part 9). Relevant
  // whenever either the frozen analysis or the live lead's current
  // strategy is BRRRR — covers both "was BRRRR, rent changed" and the
  // legacy "no frozen strategy recorded, but currently viewing as BRRRR" case.
  const hasFrozenRent = Object.prototype.hasOwnProperty.call(inp, 'rent_estimate')
  const strategyIsOrWasBrrrr = curStrategy === 'brrrr' || inpStrategy === 'brrrr'
  if (strategyIsOrWasBrrrr) {
    const curRent = lead.rent_estimate != null ? Number(lead.rent_estimate) : null
    if (hasFrozenRent) {
      const rentMatch = curRent === (inp.rent_estimate != null ? Number(inp.rent_estimate) : null) || (curRent == null && inp.rent_estimate == null)
      if (!rentMatch) reasons.push('Rent estimate changed')
    } else if (curRent != null) {
      reasons.push('Analysis predates rent tracking — refresh to confirm it reflects the current rent estimate')
    }
  }

  // Underwriting assumptions (Part 12) — the effective global/workspace
  // settings used at generation time (frozen in inp.underwriting) vs. the
  // CURRENT effective settings. Same conservative legacy rule as above:
  // an analysis with no frozen underwriting snapshot at all can only be
  // trusted if the workspace has never customized its defaults (i.e.
  // current settings still equal the system defaults) — otherwise there's
  // no way to prove the old analysis reflects today's assumptions.
  const frozenUnderwriting = inp.underwriting
  if (frozenUnderwriting) {
    for (const field of UNDERWRITING_FIELDS) {
      const frozenVal = frozenUnderwriting[field.key]
      const curVal = currentUnderwriting[field.key]
      if (frozenVal != null && curVal != null && Number(frozenVal) !== Number(curVal)) {
        reasons.push(`Underwriting assumptions changed (${field.label})`)
      }
    }
  } else {
    const anyCustomized = UNDERWRITING_FIELDS.some(f => currentUnderwriting[f.key] !== DEFAULT_UNDERWRITING_SETTINGS[f.key])
    if (anyCustomized) {
      reasons.push('Analysis predates underwriting-settings tracking — refresh to confirm it reflects the current defaults')
    }
  }

  return { stale: reasons.length > 0, reasons }
}
