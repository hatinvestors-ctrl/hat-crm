// src/lib/decisionEngineV2.js
// Capability #15.1 — HAT Unified Acquisition Decision Engine V2 (SHADOW MODE).
//
// Deterministic only. No LLM calls in this file — Capability #15's own
// audit found the current on-market Deal Score is an unverified LLM
// free-text completion; V2 exists specifically to replace that arithmetic
// with real code. AI stays welcome for WHY narration/synthesis LATER, but
// this module never calls it, and nothing here can be talked out of a hard
// Buy Box or financial rule by a prompt.
//
// This module is ADDITIVE — it does not read or write leads.ai_notes,
// leads.deal_analysis, leads.enrichment_data's opportunity_* fields, or any
// other V1 output. Nothing here changes what Kevin sees in production
// Action Center. See scripts/cap15_1_shadow.mjs for how it's exercised.
//
// ── Source-of-truth resolution (Capability #15 financial-rule audit) ────
// MAO:            0.75 x ARV - Reno - $2,450        (src/lib/calculations.js — canonical, matches generate-core-analysis.mjs)
// Flip sell cost: 7% of ARV/sale proceeds            (src/lib/calculations.js calculateFlipProfitAtPrice / dealCalculations.js default sellingCostPct — canonical; the AI-prompt's "8%" is the outlier, not this)
// BRRRR refi LTV: 70% of ARV                         (src/lib/dealCalculations.js default refi_ltv_pct — matches generate-core-analysis.mjs's pre-computed JS block)
// BRRRR refi rate: 6.7%                              (src/lib/dealCalculations.js default refi_interest_rate — the AI prompt's "6.875%" is documented audit drift, not adopted here)
// HML carry costs: 2% points + $1,500 fees + 12%/yr x avg hold months (generate-core-analysis.mjs's own PRE-COMPUTED — not AI-invented — JS block; no other deterministic HML model exists in the codebase, adopted as-is)

import { qualifyBuyBox, qualifyBuyBoxCanonical } from './buyBox.js'
import { calculateMAO, calculateFlipProfitAtPrice } from './calculations.js'
import { classifyDistress, classifyLienStrength } from './distressScoring.js'
import { getPropertyDecisionData } from './propertyDecisionData.js'

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// ══════════════════════════════════════════════════════════════════════
// 1. FIT — ONE canonical Buy Box standard for both market types (Section
// 5/7, Capability #15.2). Reuses the existing semantic buyBox.js output
// via qualifyBuyBoxCanonical(), fed by getPropertyDecisionData() — the one
// resolver, instead of each caller independently guessing where
// property_type/zip actually live this time.
// ══════════════════════════════════════════════════════════════════════
export function computeFit(propertyDecisionData) {
  const result = qualifyBuyBoxCanonical(propertyDecisionData)
  return { status: result.status, reasons: result.reasons, missing: result.missing, conflicts: result.conflicts }
}

// ══════════════════════════════════════════════════════════════════════
// Legacy Buy Box compatibility layer (Section 8/9, Capability #15.2/#15.3).
//
// Capability #15.3 ROOT-CAUSE FINDING — traced the actual hat-ai-agents
// source (lib/acquisition-engine.mjs + .claude/agents/crm-agent.md), not
// inferred from stored statuses. Two real facts, confirmed from that repo:
//
// 1. The DETERMINISTIC engine's hard property-fit rejects (blocked ZIP,
//    condo/townhome/apartment/commercial/land/manufactured home) are
//    ALREADY functionally identical to src/lib/buyBox.js's rules — both
//    were mirrored from the same source, and #15.3 synced the one real
//    drift found (townhome-only regex not matching "townhouse", already
//    fixed here in Capability #11) back into hat-ai-agents.
// 2. `lead.status='not_in_buy_box'` is NOT written by that deterministic
//    engine at all. crm-agent.md, verbatim: "Flag as `not_in_buy_box`
//    only after Tomer reviews in Inbox — do not auto-set this on import."
//    It is a MANUAL, human/AI-assisted triage judgment applied after
//    insertion — which can legitimately be based on information no
//    property-fit engine can see (photos, agent conversation, asking
//    price judgment, portfolio concentration, deal economics) — not a
//    second automated Buy Box authority.
//
// So the 0/6 agreement found in #15.2 was never "rule engine A disagrees
// with rule engine B." It's "a deterministic property-fit re-derivation
// disagrees with a one-time human workflow decision whose actual reasoning
// was never captured in any field this engine (or that one) can read."
// That is exactly why this layer preserves legacy status as HISTORICAL
// EVIDENCE rather than a competing authority (Section 6/18) — it is real
// signal (a human looked at this and passed), just not a Buy Box fact.
// ══════════════════════════════════════════════════════════════════════
export function compareLegacyBuyBox(lead, canonicalFit) {
  const legacyStatus = lead.status === 'not_in_buy_box' ? 'NOT_FIT' : null
  if (legacyStatus === null) return { legacy_ingestion_buy_box_status: null, buy_box_conflict: false, conflict_reason: null }

  const conflict = legacyStatus !== canonicalFit.status
  let reason = null
  if (conflict) {
    if (canonicalFit.missing?.length) reason = `Canonical Buy Box lacks data this lead has (missing: ${canonicalFit.missing.join(', ')}) — cannot confirm the manual review was wrong`
    else reason = '"not_in_buy_box" is a manual workflow judgment applied during Kevin/Tomer\'s Inbox review (see hat-ai-agents/.claude/agents/crm-agent.md), not an automated property-fit rule — it may reflect deal economics, condition, or judgment the canonical property-only Buy Box structurally cannot see. Treat as evidence to review, not as proof the canonical FIT is wrong.'
  }
  return { legacy_ingestion_buy_box_status: legacyStatus, buy_box_conflict: conflict, conflict_reason: reason }
}

// ══════════════════════════════════════════════════════════════════════
// 2. ON-MARKET STRATEGY ECONOMICS — Flip and BRRRR computed SEPARATELY
// (Section 7). Deterministic only — no LLM anywhere in this path.
// ══════════════════════════════════════════════════════════════════════
function computeFlipEconomics(lead) {
  const arv = num(lead.arv)
  const reno = num(lead.renovation_cost)
  if (!arv) return { viable: false, reason: 'ARV unknown', strength: 0 }
  // Capability #15.4 BUG FIX — `reno ?? 0` previously treated an UNKNOWN
  // renovation cost as a KNOWN $0 renovation cost, inflating MAO and net
  // profit with invented economics (Section 4's explicit "null must not
  // become 0" rule). Only proceed on 0 when a human/system already saved
  // an explicit lead.mao (which presumably already accounted for reno);
  // otherwise unknown reno makes flip math genuinely unavailable.
  if (reno == null && lead.mao == null) return { viable: false, reason: 'Renovation cost unknown', strength: 0 }

  const mao = num(lead.mao) ?? calculateMAO(arv, reno ?? 0)
  const netProfit = calculateFlipProfitAtPrice(mao, arv, reno ?? 0, lead.hold_months || 6)
  if (netProfit == null) return { viable: false, reason: 'Insufficient data for flip math', strength: 0 }

  // Same bands Capability #15 documented from generate-core-analysis.mjs's
  // Deal Return sub-score — reused here as the canonical strength tiering,
  // now scoped to Flip ONLY (never blended with BRRRR cash flow).
  let strength
  if (netProfit >= 60000) strength = 30
  else if (netProfit >= 40000) strength = 26
  else if (netProfit >= 25000) strength = 20
  else if (netProfit >= 10000) strength = 10
  else if (netProfit >= 0) strength = 4
  else strength = 0

  return { viable: netProfit >= 25000, netProfit: Math.round(netProfit), mao, strength }
}

function computeBrrrrEconomics(lead) {
  const arv = num(lead.arv)
  const reno = num(lead.renovation_cost)
  const rent = num(lead.rent_estimate)
  if (!arv || reno == null) return { viable: false, reason: 'ARV/renovation unknown', strength: 0 }
  // Capability #15.4 BUG FIX — the previous `rent || <bedroom-count
  // default>` fallback invented a rent estimate whenever rent_estimate was
  // unknown, which then silently drove cashflow/strength math (Section 4's
  // "missing rent must not create fake BRRRR economics" rule, and
  // Section 8's explicit test). BRRRR is correctly marked unavailable when
  // rent is unknown — Flip can still be evaluated independently (Section 8).
  if (rent == null) return { viable: false, reason: 'Rent estimate unknown', strength: 0 }

  const pp = num(lead.mao) ?? calculateMAO(arv, reno)
  if (!pp) return { viable: false, reason: 'MAO unavailable', strength: 0 }

  const hmlLoan = pp * 0.90 + reno
  const hmlCosts = hmlLoan * 0.02 + 1500 + hmlLoan * 0.12 * (5.5 / 12)
  const allIn = pp + reno + hmlCosts
  const refi = arv * 0.70 // canonical LTV, see file header
  const cashLeftIn = allIn - refi

  const rentEstimate = rent
  const refiRate = 0.067 // canonical rate, see file header
  const n = 360
  const monthlyRate = refiRate / 12
  const refiPI = refi * (monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1)
  const cashflow = rentEstimate - refiPI - 208 - 100 // taxes/insurance flat estimate, matches generate-core-analysis.mjs's own convention

  let strength
  if (cashLeftIn < 20000) strength = 25
  else if (cashLeftIn < 35000) strength = 20
  else if (cashLeftIn < 50000) strength = 13
  else if (cashLeftIn < 70000) strength = 7
  else strength = 2
  if (cashflow < 0) strength = Math.min(strength, 5) // negative cash flow caps BRRRR strength regardless of cash-left-in

  return { viable: cashLeftIn < 50000 && cashflow > 0, cashLeftIn: Math.round(cashLeftIn), monthlyCashflow: Math.round(cashflow), refi: Math.round(refi), strength }
}

export function computeStrategy(lead) {
  const flip = computeFlipEconomics(lead)
  const brrrr = computeBrrrrEconomics(lead)
  let best = 'UNKNOWN'
  if (flip.viable && brrrr.viable) best = 'BOTH'
  else if (flip.viable) best = 'FLIP'
  else if (brrrr.viable) best = 'BRRRR'
  else if (flip.strength > 0 || brrrr.strength > 0) best = 'NEITHER' // math run but nothing clears the viability bar
  return { flip, brrrr, best }
}

// ══════════════════════════════════════════════════════════════════════
// 3. ON-MARKET OPPORTUNITY (0-100) — Section 6. Price Gap and Deal Return
// no longer independently reward the same economics: Economics Strength
// (40) reflects "how good at MAO"; Closeability (20) reflects only "how
// far is ask from MAO" as a DISTINCT, capped fact, not a second reward
// for the same profit number. Seller Signals (25) and Market/Exit (15)
// are unchanged in spirit from V1 but capped independently.
// ══════════════════════════════════════════════════════════════════════
export function computeOnMarketOpportunity(lead) {
  const reasons = []
  const strategy = computeStrategy(lead)
  const bestStrength = Math.max(strategy.flip.strength || 0, strategy.brrrr.strength || 0)
  const economics = Math.round((bestStrength / 30) * 40) // normalize either tier scale (0-30) onto the 0-40 Economics band
  if (economics > 0) reasons.push(`${strategy.best !== 'NEITHER' && strategy.best !== 'UNKNOWN' ? strategy.best : 'Best available'} economics: ${economics}/40`)

  // Closeability — ask vs MAO gap, capped 20, independent fact from Economics.
  // Capability #15.4 BUG FIX — same reno-as-$0 invention as Flip/BRRRR
  // above; only derive an unstored MAO when renovation is actually known.
  let closeability = 0
  const ask = num(lead.asking_price)
  const mao = num(lead.mao) ?? (lead.arv && lead.renovation_cost != null ? calculateMAO(lead.arv, lead.renovation_cost) : null)
  if (ask && mao) {
    const pctAbove = ((ask - mao) / mao) * 100
    if (pctAbove <= 0) { closeability = 20; reasons.push('Ask already at/below MAO') }
    else if (pctAbove <= 10) { closeability = 16; reasons.push('Gap to MAO is small (<10%)') }
    else if (pctAbove <= 20) { closeability = 10 }
    else if (pctAbove <= 30) { closeability = 5 }
    else { closeability = 1 }
  }

  // Seller Signals — capped 25, real evidence only (notes/status text), no invented motivation.
  let sellerSignals = 0
  const text = `${lead.notes || ''} ${lead.status || ''}`.toLowerCase()
  const dom = num(lead.days_on_market)
  if (/estate|probate|divorce|foreclosure|short sale/.test(text)) { sellerSignals += 8; reasons.push('Distressed-seller language found') }
  if (/as.is|deferred maint|fixer/.test(text)) { sellerSignals += 4 }
  if (dom != null) {
    if (dom > 90) { sellerSignals += 6; reasons.push(`${dom} days on market`) }
    else if (dom > 60) sellerSignals += 4
    else if (dom > 30) sellerSignals += 2
  }
  if (lead.list_price && ask && Number(lead.list_price) > ask) {
    const dropPct = ((lead.list_price - ask) / lead.list_price) * 100
    if (dropPct > 5) { sellerSignals += 5; reasons.push(`Price reduced ${dropPct.toFixed(0)}% from original list`) }
  }
  sellerSignals = clamp(sellerSignals, 0, 25)

  // Market & exit — ZIP tier only (buyBox.js is the single ZIP-tier source of truth), capped 15.
  let marketExit = 0
  if (lead.zip_code) {
    const fitResult = qualifyBuyBox({ zip_code: lead.zip_code })
    if (fitResult.reasons.includes('Preferred HAT geography')) { marketExit = 15; reasons.push('Preferred HAT geography') }
    else if (fitResult.reasons.includes('Acceptable HAT geography')) marketExit = 10
    else if (fitResult.reasons.includes('Low-priority geography')) marketExit = 5
    else marketExit = 7
  }

  const score = clamp(economics + closeability + sellerSignals + marketExit, 0, 100)
  return { score, reasons: reasons.slice(0, 5), breakdown: { economics, closeability, sellerSignals, marketExit }, strategy }
}

// ══════════════════════════════════════════════════════════════════════
// 4. OFF-MARKET OPPORTUNITY (0-100) — Section 9/10/11. identityVerified +
// ownerResolvedMatch are merged into ONE Identity/Owner Confidence
// component (Section 10) rather than double-rewarded. Multi-signal gets
// an explicit, capped, explained bonus (Section 11) instead of an
// emergent side effect.
// ══════════════════════════════════════════════════════════════════════
export function computeOffMarketOpportunity(lead, pdd) {
  const reasons = []
  const dd = lead.distress_data || {}
  const e = lead.enrichment_data || {}
  pdd = pdd || getPropertyDecisionData(lead)

  // Capability #15.4 BUG FIX — this previously only checked
  // dd.distress_category, silently falling back to re-classifying from
  // dd.source_party (often a person's name, e.g. a Lis Pendens defendant,
  // which never matches a bank/HOA/tax filer regex) whenever it was
  // missing. Confirmed live: 9712 Woodstone Mill Dr — a real Mortgage
  // Foreclosure — has distress_category stored ONLY in enrichment_data
  // (the older Capability #10.2 backfill target), not distress_data, so
  // this fell all the way through to 'OTHER_CIVIL' (8 pts instead of the
  // correct 30), dropping Opportunity from a genuine 85-equivalent down to
  // 48. Same root cause distressInfo.js's getOpportunityInfo() already
  // fixed in Capability #15.2 — this call site was missed.
  const { distress_category } = classifyDistress({ filer: dd.source_party || '' })
  const category = dd.distress_category || e.distress_category || distress_category || 'UNKNOWN'

  // Distress quality — Mortgage Foreclosure materially stronger than a bare
  // Recorded Lien (Section 9's explicit requirement, carried over from V1).
  const DISTRESS_QUALITY = { MORTGAGE_FORECLOSURE: 30, HOA_CONDO_LIEN: 12, TAX_RELATED: 15, MUNICIPAL_LIEN: 12, CONTRACTOR_LIEN: 12, OTHER_CIVIL: 8, UNKNOWN: 3 }
  let distressQuality = DISTRESS_QUALITY[category] ?? DISTRESS_QUALITY.UNKNOWN
  if (category === 'MORTGAGE_FORECLOSURE') reasons.push('Mortgage foreclosure')
  else if (category !== 'UNKNOWN') reasons.push(category.replace(/_/g, ' ').toLowerCase())

  // Lien-strength modifier (Section 9/11) — computed once in Capability #14
  // but previously discarded before scoring; now actually applied.
  const lienStrength = dd.lien_strength || (dd.distress_type === 'recorded_lien'
    ? classifyLienStrength({ distressCategory: category, hasLegalDescription: Boolean(dd.legal_description), partyLooksLikeBusiness: false }).strength
    : null)
  if (lienStrength === 'WEAK_DISTRESS') distressQuality = Math.round(distressQuality * 0.6)
  if (lienStrength === 'NON_ACQUISITION_SIGNAL') distressQuality = 0
  distressQuality = clamp(distressQuality, 0, 30)

  // Identity / Owner Confidence — MERGED component (Section 10), max 20 —
  // replaces V1's separate identityVerified(10) + ownerResolvedMatch(15).
  let identityOwner = 0
  const ownerMatch = dd.owner_match_status || e.contact_match_status
  if (ownerMatch === 'MATCH' || ownerMatch === 'VERIFIED') { identityOwner = 20; reasons.push('Owner identity verified') }
  else if (ownerMatch === 'POSSIBLE_MATCH' || ownerMatch === 'LIKELY') identityOwner = 12
  else if (ownerMatch === 'AMBIGUOUS') identityOwner = 5

  // Absentee — real, distinct signal, kept separate.
  let absentee = 0
  if (dd.absentee_owner === true) { absentee = 10; reasons.push('Absentee owner') }

  // Contact readiness — real, distinct signal.
  let contact = 0
  if (lead.phone || lead.email) { contact = 10; reasons.push('Contact available') }

  // Multi-signal corroboration — explicit, capped bonus (Section 11), not
  // an emergent accident of overlapping fields.
  let multiSignal = 0
  const signalCount = [dd.distress_type === 'lis_pendens', dd.distress_type === 'recorded_lien', dd.absentee_owner === true].filter(Boolean).length
  const hasCorroboratingHistory = Boolean(e.opportunity_why?.length > 2) // proxy for "property already had prior distress/source history" without a second DB round-trip
  if (signalCount >= 2 || hasCorroboratingHistory) { multiSignal = 10; reasons.push('Corroborated by multiple independent signals') }
  multiSignal = clamp(multiSignal, 0, 15)

  // Data completeness — small, capped. Reads the CANONICAL resolver
  // (Capability #15.2), not enrichment_data directly — see propertyDecisionData.js
  // header for why that was the root cause of #15.1's stale-data findings.
  let completeness = 0
  if (pdd.zip) completeness += 3
  if (pdd.property_type) completeness += 4
  if (pdd.year_built || pdd.sqft) completeness += 3
  completeness = clamp(completeness, 0, 10)

  const score = clamp(distressQuality + identityOwner + absentee + contact + multiSignal + completeness, 0, 100)
  return { score, reasons: reasons.slice(0, 5), breakdown: { distressQuality, identityOwner, absentee, contact, multiSignal, completeness }, category, lienStrength }
}

// ══════════════════════════════════════════════════════════════════════
// 5. CONFIDENCE (0-100) — Section 12. Evidence QUALITY, never deal quality.
// ══════════════════════════════════════════════════════════════════════
export function computeConfidence(lead, marketType, pdd) {
  const reasons = []
  const missing = []
  let score = 0
  pdd = pdd || getPropertyDecisionData(lead)

  if (marketType === 'on_market') {
    if (pdd.arv) { score += 25; reasons.push('ARV on file') } else missing.push('ARV unknown')
    if (pdd.asking_price) { score += 20; reasons.push('Asking price known') } else missing.push('Asking price unknown')
    if (pdd.renovation != null) { score += 20; reasons.push('Renovation estimate on file') } else missing.push('Renovation cost unknown')
    if (pdd.sqft && pdd.bedrooms && pdd.bathrooms) { score += 15; reasons.push('Property characteristics complete') } else missing.push('Property characteristics incomplete')
    if (pdd.zip) score += 10
    const ageDays = lead.created_at ? (Date.now() - new Date(lead.created_at).getTime()) / 86400000 : null
    if (ageDays != null && ageDays < 30) { score += 10; reasons.push('Recently sourced data') } else if (ageDays != null && ageDays > 120) missing.push('Data may be stale (sourced 120+ days ago)')
  } else {
    const dd = lead.distress_data || {}
    const e = lead.enrichment_data || {}
    if (e.identity_source || e.matched) { score += 25; reasons.push('Property identity verified') } else missing.push('Property identity unresolved')
    const ownerMatch = dd.owner_match_status || e.contact_match_status
    if (ownerMatch === 'MATCH' || ownerMatch === 'VERIFIED') { score += 25; reasons.push('Owner match verified') }
    else if (ownerMatch === 'POSSIBLE_MATCH' || ownerMatch === 'LIKELY') { score += 12; missing.push('Owner match not fully verified') }
    else missing.push('Owner match unknown')
    if (lead.phone || lead.email) { score += 15; reasons.push('Contact confirmed') } else missing.push('Contact not found')
    if (pdd.property_type) { score += 15; reasons.push('Property characteristics known') } else missing.push('Property type unknown')
    if (dd.source_reference) score += 10
    if (dd.distress_filing_date) {
      const ageDays = (Date.now() - new Date(dd.distress_filing_date).getTime()) / 86400000
      if (ageDays < 60) { score += 10; reasons.push('Recent filing') } else missing.push('Filing is not recent')
    }
    if (pdd.conflicts?.some(c => c.field === 'property_type' || c.field === 'zip')) missing.push('Property data conflict detected — see conflicts')
  }

  return { score: clamp(Math.round(score), 0, 100), reasons: reasons.slice(0, 5), missing: [...new Set(missing)].slice(0, 5) }
}

// ══════════════════════════════════════════════════════════════════════
// 6. URGENCY — Section 13. Real timing evidence ONLY. No evidence = never HIGH.
// ══════════════════════════════════════════════════════════════════════
export function computeUrgency(lead, marketType) {
  const reasons = []
  if (marketType === 'on_market') {
    const dom = num(lead.days_on_market)
    const ask = num(lead.asking_price)
    if (lead.list_price && ask && Number(lead.list_price) > ask * 1.05) { reasons.push('Recent price reduction'); return { level: 'HIGH', reasons } }
    if (dom != null && dom <= 14) { reasons.push('Fresh listing'); return { level: 'MEDIUM', reasons } }
    if (['follow_up'].includes(lead.status) && lead.follow_up_date && new Date(lead.follow_up_date) <= new Date()) { reasons.push('Follow-up overdue'); return { level: 'HIGH', reasons } }
    if (dom != null && dom > 90) { reasons.push('Stale listing, no recent movement'); return { level: 'LOW', reasons } }
    return { level: 'MEDIUM', reasons: ['No strong timing signal either way'] }
  }

  const dd = lead.distress_data || {}
  if (dd.distress_filing_date) {
    const ageDays = (Date.now() - new Date(dd.distress_filing_date).getTime()) / 86400000
    if (dd.distress_type === 'lis_pendens' && ageDays < 45) { reasons.push(`Foreclosure filed ${Math.round(ageDays)} days ago`); return { level: 'HIGH', reasons } }
    if (ageDays < 30) { reasons.push('Recent filing'); return { level: 'MEDIUM', reasons } }
    if (ageDays > 120) { reasons.push('Filing is over 4 months old'); return { level: 'LOW', reasons } }
  }
  return { level: 'MEDIUM', reasons: ['No strong timing signal either way'] }
}

// ══════════════════════════════════════════════════════════════════════
// 7. RECOMMENDATION + NEXT BEST ACTION — Sections 14/15. HARD PRINCIPLE:
// a NOT_FIT property can never reach ACT_NOW/SEND_OFFER, regardless of
// Opportunity. Workflow state (FOLLOW_UP_STATUSES) takes precedence over
// a fresh recommendation once a lead is already engaged.
// ══════════════════════════════════════════════════════════════════════
const FOLLOW_UP_STATUSES = ['follow_up', 'offer_sent', 'negotiating', 'offer_pending_hat_signing', 'offer_signed']

export function computeRecommendation({ fit, opportunity, confidence, urgency, status, marketType }) {
  if (FOLLOW_UP_STATUSES.includes(status)) {
    return { recommendation: 'FOLLOW_UP', next_best_action: 'FOLLOW_UP' }
  }
  if (fit.status === 'NOT_FIT') {
    // Hard principle — no Opportunity number can override this.
    return { recommendation: opportunity.score >= 60 ? 'MONITOR' : 'PASS', next_best_action: opportunity.score >= 60 ? 'MONITOR_PROPERTY' : 'PASS' }
  }
  if (status === 'dead_lead') {
    return { recommendation: 'PASS', next_best_action: 'PASS' }
  }

  const strong = opportunity.score >= 65 && confidence.score >= 60
  const promising = opportunity.score >= 45
  const weak = opportunity.score < 30

  if (strong && urgency.level !== 'LOW') {
    const onMarketAction = fit.status === 'INSUFFICIENT_DATA' ? 'VERIFY_CONDITION' : 'SEND_OFFER'
    const offMarketAction = confidence.score < 50 ? 'VERIFY_OWNER' : 'CONTACT_OWNER'
    return {
      recommendation: 'ACT_NOW',
      next_best_action: marketType === 'on_market' ? onMarketAction : offMarketAction,
    }
  }
  // Capability #15.4 — Next Best Action precision fix (Section 7/14): pick
  // VERIFY_CONDITION when renovation is specifically the gap rather than
  // always defaulting to VERIFY_ARV, using the same controlled vocabulary
  // (no new actions added, per the mission's "do not expand unless clearly
  // necessary" instruction — VERIFY_CONDITION already existed for the
  // INSUFFICIENT_DATA fit case above).
  const onMarketVerifyAction = confidence.missing?.includes('Renovation cost unknown') && !confidence.missing?.includes('ARV unknown')
    ? 'VERIFY_CONDITION'
    : 'VERIFY_ARV'

  if (promising && confidence.score < 55) {
    return { recommendation: 'REVIEW_TODAY', next_best_action: marketType === 'on_market' ? onMarketVerifyAction : 'VERIFY_OWNER' }
  }
  if (promising) {
    return { recommendation: 'REVIEW_TODAY', next_best_action: marketType === 'on_market' ? 'CALL_AGENT' : 'CONTACT_OWNER' }
  }
  if (weak) {
    return { recommendation: 'PASS', next_best_action: 'PASS' }
  }
  if (fit.status === 'INSUFFICIENT_DATA' || confidence.score < 40) {
    return { recommendation: 'RESEARCH', next_best_action: marketType === 'on_market' ? onMarketVerifyAction : 'RESEARCH_OWNER' }
  }
  return { recommendation: 'MONITOR', next_best_action: urgency.level === 'LOW' ? 'WAIT_FOR_PRICE_DROP' : 'MONITOR_PROPERTY' }
}

// ══════════════════════════════════════════════════════════════════════
// 8. WHY + RISKS — Section 16. Deterministic synthesis only in this phase
// (no LLM call — Section 24: "no unnecessary LLM calls" during shadow mode).
// ══════════════════════════════════════════════════════════════════════
function buildWhy(fit, opportunity, confidence, urgency) {
  const why = []
  if (fit.status === 'FIT') why.push('Matches HAT Buy Box')
  why.push(...opportunity.reasons)
  if (urgency.level === 'HIGH') why.push(...urgency.reasons)
  return [...new Set(why)].slice(0, 6)
}
function buildRisks(fit, confidence) {
  const risks = [...confidence.missing]
  if (fit.status === 'NOT_FIT') risks.unshift(`Buy Box: ${fit.reasons.join(', ')}`)
  if (fit.status === 'INSUFFICIENT_DATA') risks.unshift('Buy Box fit not yet determinable')
  return [...new Set(risks)].slice(0, 6)
}

// ══════════════════════════════════════════════════════════════════════
// TOP-LEVEL — one shared output contract for both market types (Section
// 4), now built entirely on the canonical property-decision-data resolver
// (Capability #15.2) instead of each sub-function independently guessing
// where a field lives.
// ══════════════════════════════════════════════════════════════════════
export function computeDecisionV2(lead, marketType, { trigger = 'MANUAL_RECALCULATION' } = {}) {
  const pdd = getPropertyDecisionData(lead)
  const fit = computeFit(pdd)
  const legacyBuyBox = compareLegacyBuyBox(lead, fit)
  const opportunity = marketType === 'on_market' ? computeOnMarketOpportunity(lead) : computeOffMarketOpportunity(lead, pdd)
  const confidence = computeConfidence(lead, marketType, pdd)
  const urgency = computeUrgency(lead, marketType)
  const { recommendation, next_best_action } = computeRecommendation({ fit, opportunity, confidence, urgency, status: lead.status, marketType })

  return {
    fit,
    legacy_ingestion_buy_box_status: legacyBuyBox.legacy_ingestion_buy_box_status,
    buy_box_conflict: legacyBuyBox.buy_box_conflict,
    buy_box_conflict_reason: legacyBuyBox.conflict_reason,
    opportunity: { score: opportunity.score, reasons: opportunity.reasons },
    confidence,
    urgency,
    recommendation,
    next_best_action,
    why: buildWhy(fit, opportunity, confidence, urgency),
    risks_missing: buildRisks(fit, confidence),
    data_conflicts: pdd.conflicts,
    strategy: marketType === 'on_market' ? opportunity.strategy?.best : null,
    source: marketType === 'on_market' ? (lead.lead_source || 'unknown') : (lead.distress_data?.distress_source || 'unknown'),
    calculated_at: new Date().toISOString(),
    trigger,
    version: '2.0-shadow',
  }
}

// ══════════════════════════════════════════════════════════════════════
// EVENT-DRIVEN SHADOW RECALCULATION TRIGGER (Section 15/18, Capability
// #15.2). Pure decision function — callers pass old/new lead field
// snapshots; this never touches the network or DB itself. Deliberately
// conservative: only fields that can actually change FIT/Opportunity/
// Confidence/Urgency/Recommendation trigger a recompute. No page-load
// trigger exists anywhere in this codebase (Section 15's explicit rule).
// ══════════════════════════════════════════════════════════════════════
const TRIGGER_FIELDS = {
  NEW_LEAD: null, // handled by caller (no "old" lead exists)
  PRICE_CHANGE: ['asking_price', 'list_price'],
  PROPERTY_DATA_UPDATE: ['property_type', 'bedrooms', 'bathrooms', 'sqft', 'zip_code', 'year_built', 'lot_size_sqft', 'arv', 'renovation_cost', 'rent_estimate'],
  DISTRESS_EVENT: ['distress_data'],
  CONTACT_ENRICHMENT: ['phone', 'email', 'enrichment_data'],
  STATUS_CHANGE: ['status'],
}

export function shouldTriggerV2Recalc(oldLead, newLead) {
  if (!oldLead) return { should: true, trigger: 'NEW_LEAD' }
  for (const [trigger, fields] of Object.entries(TRIGGER_FIELDS)) {
    if (!fields) continue
    for (const f of fields) {
      const oldVal = f === 'distress_data' || f === 'enrichment_data' ? JSON.stringify(oldLead[f] || {}) : oldLead[f]
      const newVal = f === 'distress_data' || f === 'enrichment_data' ? JSON.stringify(newLead[f] || {}) : newLead[f]
      if (oldVal !== newVal) return { should: true, trigger }
    }
  }
  return { should: false, trigger: null }
}
