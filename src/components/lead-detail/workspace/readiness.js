// src/components/lead-detail/workspace/readiness.js
// Lead Workspace redesign, Final UX Polish — DATA-AWARE readiness checks,
// not status-dependent branching (explicit mission directive: the same 5
// tabs and mental model must stay consistent for every lead; only DATA
// AVAILABILITY changes what's shown).
//
// These are presentation-layer field-presence checks ONLY — the exact same
// `!lead.arv`/`renovation_cost == null`/etc. guards that FinancialSection,
// DealAnalysisCard, and computeFlipResult/computeBrrrrResult already use
// individually. Consolidating them here means every tab/header/empty-state
// asks the SAME question the same way instead of five slightly different
// inline checks drifting apart. This file computes ZERO business values
// (no MAO, no profit, no score) — it only answers "is X present."

export function getDealReadiness(lead) {
  const missing = []
  if (!lead.arv) missing.push({ key: 'arv', label: 'ARV', reason: 'Required to calculate Flip and BRRRR economics.' })
  if (lead.renovation_cost == null) missing.push({ key: 'reno', label: 'Renovation Cost', reason: 'Required to calculate Flip and BRRRR economics.' })
  const flipReady = missing.length === 0
  const brrrrMissing = lead.rent_estimate == null
  return {
    flipReady,
    brrrrReady: flipReady && !brrrrMissing,
    missing,
    brrrrMissingReason: brrrrMissing ? { key: 'rent', label: 'Rent Estimate', reason: 'Required to evaluate BRRRR.' } : null,
  }
}

export function getAcquisitionReadiness(lead) {
  const hasAgent = !!(lead.listing_agent_name || lead.listing_agent_phone || lead.listing_agent_email || lead.listing_brokerage)
  const hasContact = !!(lead.owner_name || lead.phone || lead.email)
  return { hasAgent, hasContact, ready: hasAgent || hasContact }
}

export function getAiReadiness(lead) {
  return { hasRun: !!lead.deal_analysis?.verdict || !!lead.ai_notes }
}
