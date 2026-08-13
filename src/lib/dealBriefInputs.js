// src/lib/dealBriefInputs.js
// Capability #16 — deterministic inputs for the AI Acquisition Copilot.
// Everything here is presentation/derivation logic on top of V2's ALREADY
// COMPUTED output (lead.decision_v2) — nothing here recalculates Buy Box,
// Opportunity, Confidence, Urgency, or MAO. Price guidance reuses
// computeStrategy()/calculateMAO() from decisionEngineV2.js/calculations.js
// (the same functions V2 itself uses) rather than inventing a second
// formula — this file only decides how to PRESENT that math, never what
// the math is.

import { computeStrategy } from './decisionEngineV2.js'
import { calculateMAO } from './calculations.js'

// Browser-safe (no node:crypto — this module is imported client-side too).
// Not cryptographic — just needs to change whenever the input does, for
// cache-staleness comparison, same as decisionInputHash()'s use elsewhere.
function stableHash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16)
}

// ── Cache key (Section 10) ───────────────────────────────────────────────
// Every field that could change what the brief SHOULD say. A meaningful
// change here means the cached brief is stale; anything else (page views,
// unrelated field edits) never invalidates it.
export function computeDealBriefInputHash(lead) {
  const parts = {
    asking_price: lead.asking_price ?? null,
    arv: lead.arv ?? null,
    renovation_cost: lead.renovation_cost ?? null,
    rent_estimate: lead.rent_estimate ?? null,
    recommendation: lead.decision_v2?.recommendation ?? null,
    next_best_action: lead.decision_v2?.next_best_action ?? null,
    fit: lead.decision_v2?.fit?.status ?? null,
    distress_data: JSON.stringify(lead.distress_data || {}),
    notes: lead.notes || '',
    ai_notes_len: (lead.ai_notes || '').length, // full text is long/volatile; length is a cheap-enough proxy for "materially changed"
    follow_up_date: lead.follow_up_date ?? null, // Capability #17 — a new outcome/follow-up date is a "what changed" the brief should reflect
    status: lead.status,
  }
  return stableHash(JSON.stringify(parts))
}

// ── Price guidance (Section 5) — deterministic, never LLM-computed ──────
export function computePriceGuidance(lead) {
  if (lead.is_distressed) return null // off-market rarely has an asking price at all; Copilot uses MAO/owner context instead, not a range

  const strategy = computeStrategy(lead)
  const arv = lead.arv ? Number(lead.arv) : null
  const reno = lead.renovation_cost != null ? Number(lead.renovation_cost) : null
  const ask = lead.asking_price ? Number(lead.asking_price) : null
  const mao = lead.mao != null ? Number(lead.mao) : (arv && reno != null ? calculateMAO(arv, reno) : null)

  const missing = []
  if (!arv) missing.push('ARV')
  if (reno == null) missing.push('Renovation estimate')
  if (strategy.best === 'BRRRR' && lead.rent_estimate == null) missing.push('Rent estimate')

  if (!mao || missing.length > 0) {
    return {
      ready: false,
      missing,
      next: missing.includes('ARV') ? 'VERIFY_ARV' : 'ESTIMATE_REHAB',
    }
  }

  const gap = ask != null ? Math.max(0, ask - mao) : 0
  // Conservative, clearly-derived anchor: open 10% of the ask-to-MAO gap
  // below MAO (never above ask, never below a sane floor), target MAO,
  // ceiling MAO. Same "anchor near MAO, leave room to meet in the middle"
  // convention already used elsewhere in this codebase's offer logic
  // (hat-ai-agents/lib/acquisition-engine.mjs offerEngine()) — not a new
  // formula invented for this feature.
  const opening = Math.round((mao - gap * 0.10) / 1000) * 1000
  return {
    ready: true,
    ask, mao,
    opening: Math.min(opening, ask ?? opening),
    target: mao,
    ceiling: mao,
    strategy: strategy.best,
  }
}

// ── The exact, bounded set of fields the AI is allowed to read (Section 2/6) ──
// Mirrors qualitativeIntelligence.js's contract: structured facts only,
// AI never sees or touches raw scoring weights/formulas.
// Capability #17, Section 9 — last contact outcome/note/seller-expectation/
// offer/counter, so the Copilot can answer WHAT HAPPENED / WHAT CHANGED /
// WHY CONTACT NOW without re-deriving it from raw activity rows itself.
// `contactHistory` is optional and caller-supplied (the Netlify function
// queries lead_activities server-side) — this function stays deterministic
// and never queries the DB itself.
export function buildDealBriefContext(lead, contactHistory = null) {
  const d = lead.decision_v2 || {}
  const dd = lead.distress_data || {}
  const priceGuidance = computePriceGuidance(lead)
  return {
    address: lead.address,
    market_type: lead.is_distressed ? 'off_market' : 'on_market',
    source: lead.is_distressed ? (dd.distress_source || 'unknown') : (lead.lead_source || 'unknown'),
    fit: d.fit?.status, opportunity: d.opportunity?.score, confidence: d.confidence?.score,
    urgency: d.urgency?.level, recommendation: d.recommendation, next_best_action: d.next_best_action,
    strategy: d.strategy, why: d.why || [], risks_missing: d.risks_missing || [],
    asking_price: lead.asking_price, arv: lead.arv, renovation_cost: lead.renovation_cost,
    rent_estimate: lead.rent_estimate, days_on_market: lead.days_on_market, list_price: lead.list_price,
    price_guidance: priceGuidance,
    distress_type: dd.distress_type, distress_category: dd.distress_category, filing_date: dd.distress_filing_date,
    absentee_owner: dd.absentee_owner, lien_amount: dd.lien_amount || null,
    owner_name: lead.owner_name || null, contact_ready: Boolean(lead.phone || lead.email),
    listing_agent_name: lead.listing_agent_name || null,
    notes: (lead.notes || '').slice(0, 1500),
    workflow_status: lead.status,
    last_contact: contactHistory,
  }
}
