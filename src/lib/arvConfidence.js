// src/lib/arvConfidence.js
// Comps Intelligence / ARV Confidence Engine — SCOPED V1 (wholesaler-demo
// final polish).
//
// AUDIT FINDING (see docs — Part 1 of the mission): there is no structured,
// real per-comp dataset anywhere in this system today. "Market comps" are
// generated as free-form prose by netlify/functions/generate-comps.mjs
// (an LLM writing plausible-looking "COMP: ..." lines from generic ZIP
// price bands) — not queried records with real distance/sale-date/sqft
// fields. Building a deterministic 0–100 "Comp Quality Score" on top of
// that would mean pretending AI-generated text has precision it doesn't
// have — exactly what this feature exists to warn against. Per explicit
// product decision, V1 does NOT attempt that. It ships only what's real:
//
//   1. DECISION SENSITIVITY — stress-tests the EXISTING canonical ARV
//      through the EXISTING canonical financial engine
//      (computeFlipResult/computeBrrrrResult in dealExplanation.js) at a
//      conservative/base/upside ARV. No new financial formula.
//   2. HAT INTERNAL EVIDENCE — real past HAT leads/deal_financials rows,
//      labeled by genuine evidence type (never called a "comp").
//   3. EXTERNAL COMP STATE — an honest, static "not yet scoreable" state
//      instead of a fabricated confidence number.
//
// Nothing here recomputes MAO, profit, cash-left-in, or verdict thresholds
// — every dollar figure below comes from dealExplanation.js/calculations.js,
// called with an ARV override only.
import { computeFlipResult, computeBrrrrResult } from './dealExplanation.js'

// A generic underwriting stress-test band — NOT a comp-evidence-derived
// range (Part 9 of the original brief is explicitly descoped: there is no
// real comp dispersion data to derive a defensible "supported ARV range"
// from). This is presented as a sensitivity test, never as "the range the
// evidence supports."
export const ARV_SCENARIO_BAND_PCT = 0.05

const VERDICT_RANK = { 'NO DEAL': 0, WATCH: 1, PASS: 2, STRONG: 3 }
const rank = (result) => VERDICT_RANK[result?.verdict] ?? 0
const meetsTarget = (result) => rank(result) >= 1 // anything but NO DEAL clears HAT's target

function scenarioArv(baseArv, deltaPct) {
  return Math.round(baseArv * (1 + deltaPct))
}

// Pre-demo consistency fix (Part 2) — root cause of the earlier defect:
// the old 3-state LOW/MODERATE/HIGH scale conflated two different
// questions under one HIGH label — "the decision genuinely swings across
// the tested range" (real ARV sensitivity) vs. "the deal fails everywhere
// tested, ARV movement doesn't matter" (a margin problem, not an
// ARV-confidence problem). 8054 Paschal Street is NO DEAL at conservative,
// base, AND upside — labeling that "HIGH sensitivity" implied ARV
// uncertainty was the reason it fails, which is false; the price is too
// high relative to Max Buy regardless of which tested ARV is used. Four
// states now separate "decision changes across the range" from "decision
// never changes across the range," in both directions:
export const STRESS_CLASSIFICATION = {
  ROBUST_DEAL: 'ROBUST_DEAL',           // meets target even at conservative ARV
  ARV_SENSITIVE: 'ARV_SENSITIVE',       // conclusion materially changes across the range
  UPSIDE_DEPENDENT: 'UPSIDE_DEPENDENT', // only meets target at/near upside — a narrower case of ARV_SENSITIVE worth calling out
  NO_DEAL_ACROSS_RANGE: 'NO_DEAL_ACROSS_RANGE', // fails at conservative, base, AND upside — ARV is not the constraint
}

const STRESS_LABEL = {
  ROBUST_DEAL: 'ROBUST DEAL',
  ARV_SENSITIVE: 'ARV SENSITIVE',
  UPSIDE_DEPENDENT: 'UPSIDE DEPENDENT',
  NO_DEAL_ACROSS_RANGE: 'NO DEAL ACROSS RANGE',
}

// CASE A-D from the mission's test list. Evaluates the SAME lead at three
// ARV assumptions and classifies how the acquisition DECISION behaves
// across that range — this is Decision/ARV Stress classification, and is
// explicitly NOT "ARV Confidence" (see getExternalCompConfidenceState).
// Never infer one from the other (Part 3): a ROBUST_DEAL says nothing
// about whether the $220K ARV itself is well-evidenced, and
// NO_DEAL_ACROSS_RANGE says nothing about weak comps — it can happen with
// a perfectly-evidenced ARV that's simply not enough to clear Max Buy.
export function computeDecisionSensitivity(lead, { bandPct = ARV_SCENARIO_BAND_PCT, underwritingSettings = null } = {}) {
  const arv = lead?.arv != null ? Number(lead.arv) : null
  if (arv == null) return { available: false, reason: 'ARV is missing — ARV stress test cannot be evaluated.' }
  const reno = lead?.renovation_cost != null ? Number(lead.renovation_cost) : null
  if (reno == null) return { available: false, reason: 'Renovation cost is missing — ARV stress test cannot be evaluated.' }

  const tiers = [
    { tier: 'conservative', delta: -bandPct },
    { tier: 'base', delta: 0 },
    { tier: 'upside', delta: bandPct },
  ]
  const scenarios = tiers.map(({ tier, delta }) => {
    const scenarioLead = { ...lead, arv: scenarioArv(arv, delta) }
    return {
      tier,
      arv: scenarioLead.arv,
      flip: computeFlipResult(scenarioLead, underwritingSettings),
      brrrr: lead.rent_estimate != null ? computeBrrrrResult(scenarioLead, underwritingSettings) : null,
    }
  })
  const [conservative, base, upside] = scenarios

  if (!base.flip.available) return { available: false, reason: base.flip.reason }

  const consOk = meetsTarget(conservative.flip)
  const baseOk = meetsTarget(base.flip)
  const upsideOk = meetsTarget(upside.flip)

  let sensitivity, sensitivityReason
  if (consOk) {
    sensitivity = STRESS_CLASSIFICATION.ROBUST_DEAL
    sensitivityReason = "Deal remains viable under the conservative ARV stress scenario."
  } else if (!baseOk && !upsideOk) {
    sensitivity = STRESS_CLASSIFICATION.NO_DEAL_ACROSS_RANGE
    sensitivityReason = "Deal does not meet HAT's target anywhere in the tested ARV range. Acquisition price — not ARV uncertainty — is the primary constraint."
  } else if (!baseOk && upsideOk) {
    sensitivity = STRESS_CLASSIFICATION.UPSIDE_DEPENDENT
    sensitivityReason = "Deal only meets HAT's target toward the upside ARV scenario — it requires optimistic ARV performance to work."
  } else {
    sensitivity = STRESS_CLASSIFICATION.ARV_SENSITIVE
    sensitivityReason = "The acquisition conclusion changes materially across the tested ARV range. Validate the ARV before increasing the acquisition price."
  }

  return {
    available: true, bandPct, scenarios, conservative, base, upside,
    sensitivity, sensitivityLabel: STRESS_LABEL[sensitivity], sensitivityReason,
  }
}

// Evidence types kept deliberately distinct (Part 12) — a past HAT lead
// with an actual completed sale is stronger evidence than one that's only
// ever had an internal ARV estimate, and this function never blurs the two.
const SOLD_STATUSES = new Set(['flip_sold', 'sold'])

// Part 10/11 — pure matcher/labeler. Callers are responsible for the
// (efficient, zip-pre-filtered — Part 29) DB query; this function performs
// zero I/O so it's deterministic and unit-testable.
export function getHatInternalEvidence(lead, candidateLeads = []) {
  if (!lead) return { available: false, matches: [], count: 0 }
  const subjSqft = lead.sqft != null ? Number(lead.sqft) : null

  const matches = candidateLeads
    .filter(c => c && c.id !== lead.id && c.address)
    .map(c => {
      const financials = c.deal_financials || null
      const sold = SOLD_STATUSES.has(c.status) && financials?.actual_sale_price != null
      // Never call a bare prior-ARV lead a "closed sale" — only a real
      // actual_sale_price on a genuinely sold record earns ACTUAL_SALE.
      const evidenceType = sold ? 'ACTUAL_SALE' : (c.arv != null ? 'PRIOR_ARV_ESTIMATE' : null)
      if (!evidenceType) return null
      const sqft = c.sqft != null ? Number(c.sqft) : null
      const sqftDiffPct = (subjSqft && sqft) ? Math.abs(sqft - subjSqft) / subjSqft : null
      return {
        id: c.id,
        address: c.address,
        city: c.city || null,
        zip_code: c.zip_code || null,
        bedrooms: c.bedrooms ?? null,
        bathrooms: c.bathrooms ?? null,
        sqft,
        evidenceType,
        actualSalePrice: sold ? Number(financials.actual_sale_price) : null,
        soldDate: sold ? (financials.sold_date || null) : null,
        priorArv: c.arv != null ? Number(c.arv) : null,
        sqftDiffPct,
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.sqftDiffPct ?? 1) - (b.sqftDiffPct ?? 1))
    .slice(0, 5)

  return { available: matches.length > 0, matches, count: matches.length }
}

// Part 3/16/25 — an honest, static state, in customer-facing product
// copy (no "AI-generated narrative" / "structured records" / "isn't
// stored" implementation language — that belongs in this code comment,
// not the UI). Never a fabricated number.
//
// Analysis Readiness + Decision Integrity Fix (Part 1) — real bug found in
// QA: this function used to take no argument and always claimed "Current
// ARV is available," even when lead.arv was null. It now branches on
// whether ARV actually exists, without fabricating a confidence score in
// either branch.
export function getExternalCompConfidenceState(lead) {
  const hasArv = lead?.arv != null
  if (!hasArv) {
    return {
      status: 'NOT_SCOREABLE',
      label: 'Detailed confidence scoring not yet available',
      message: 'No current ARV is set for this property yet, so comp-by-comp validation of proximity, recency, and property similarity cannot be evaluated. HAT AI can estimate an ARV from comparable sales during analysis, or one can be entered manually.',
    }
  }
  return {
    status: 'NOT_SCOREABLE',
    label: 'Detailed confidence scoring not yet available',
    message: 'Current ARV is available, but comp-by-comp validation of proximity, recency, and property similarity is not yet available for this property. Review market comps before making an ARV-sensitive acquisition decision.',
  }
}

// UX V2.8, Part 8 — COMPARABLE SALES EVIDENCE (presentation support only).
// Pure reader over the ONE place real comp evidence already lives in this
// system: the "MARKET COMPS" block generate-comps.mjs writes into
// lead.ai_notes (its COMP: / "Market Range" / "Evidence Read" lines — see
// that function's SYSTEM_PROMPT template). Deliberately parse-only: it
// invents no field the template doesn't emit, derives no score, and never
// touches ARV/MAO/profit. `count` uses the SAME `^COMP:` line definition
// getArvProvenance() (arvProvenance.js) already uses, so the two can never
// disagree about whether comp evidence exists for a lead.
export function getCompEvidenceSummary(lead) {
  const notes = lead?.ai_notes || ''
  const compLines = notes.match(/^COMP:\s.+$/gim) || []
  const marketRange = notes.match(/^Market Range[^:\n]*:\s*(.+)$/im)?.[1]?.trim() || null
  const evidenceRead = notes.match(/^Evidence Read:\s*(.+)$/im)?.[1]?.trim() || null
  const comps = compLines.slice(0, 5).map((line, i) => {
    const parts = line.replace(/^COMP:\s*/i, '').split('|').map(p => p.trim()).filter(Boolean)
    return { key: `${i}-${parts[0] || ''}`, label: parts[0] || '—', details: parts.slice(1) }
  })
  return { available: compLines.length > 0, count: compLines.length, comps, marketRange, evidenceRead }
}

// Part 5/19 — recommendation text is driven ONLY by the deterministic
// stress classification above; nothing here is AI-decided, and nothing
// here claims comp quality that hasn't actually been evidenced (Part 5:
// a NO_DEAL_ACROSS_RANGE deal has nothing to do with comp confidence —
// don't tell the user to "get better comps" when better comps wouldn't
// change the conclusion).
export function getValuationRecommendation(sensitivity) {
  switch (sensitivity) {
    case STRESS_CLASSIFICATION.ROBUST_DEAL:
      return 'Deal remains viable under the conservative ARV stress scenario. Proceed with normal underwriting.'
    case STRESS_CLASSIFICATION.NO_DEAL_ACROSS_RANGE:
      return "Deal does not meet HAT's target anywhere in the tested ARV range. Focus negotiation on purchase price before relying on additional ARV upside."
    case STRESS_CLASSIFICATION.UPSIDE_DEPENDENT:
      return 'This deal requires optimistic ARV performance to meet the acquisition target. Validate the ARV before relying on the upside scenario.'
    case STRESS_CLASSIFICATION.ARV_SENSITIVE:
      return 'Deal outcome changes materially across the tested ARV range. Validate the ARV before increasing the acquisition price.'
    default:
      return null
  }
}
