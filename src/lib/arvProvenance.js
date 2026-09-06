// src/lib/arvProvenance.js
import { parseAiValuation } from './aiValuation'

// Capability #16.1 — ARV authority/provenance (Section 5). Deliberately NO
// new database column: derived at read time from data that already exists
// (ai_notes' own "MARKET COMPS" section, written verbatim by
// generate-core-analysis.mjs — see its COMP: line format). "Do not create
// unnecessary duplicate fields" — this satisfies the mission's minimum bar
// (ARV value / source / comps available / comps count / last updated)
// without persisting anything new.
export function getArvProvenance(lead) {
  const arv = lead.arv != null ? Number(lead.arv) : null
  if (arv == null) return { arv: null, source: null, comps_available: false, comps_count: 0, last_updated: null }

  const notes = lead.ai_notes || ''
  const compLines = notes.match(/^COMP:\s.+$/gim) || []
  const compsAvailable = compLines.length > 0

  // Manual-vs-AI heuristic: FinancialSection's own comment (DealAnalysisCard.jsx)
  // already establishes the real precedence rule — "the Financials value is
  // always the source of truth; the AI comps ARV only fills in when
  // Financials has no ARV set yet, never overrides one that's already
  // there." So: if ai_notes has no comps section at all but ARV is set,
  // it was entered manually (or came from an older/other path) — never
  // claim AI/comps authority we can't actually evidence.
  const source = compsAvailable ? 'AI_COMPS' : 'MANUAL_OR_UNVERIFIED'

  return {
    arv,
    source,
    comps_available: compsAvailable,
    comps_count: compLines.length,
    last_updated: lead.updated_at || null,
  }
}

// AI Valuation + Guided Lead Underwriting Flow V1, Part 9 — provenance
// audit finding: proper "was this ARV set by AI, and has it since been
// manually changed" tracking CAN be done safely WITHOUT a schema change
// (per the mission's explicit requirement to prefer that). Same principle
// as getArvProvenance above: derived at read time, nothing new persisted.
// The AI's own most recent recommendation is already stored verbatim in
// ai_notes' VALUATION section (see generate-comps.mjs) — if the current
// canonical lead.arv exactly equals that number, it is still AI-owned
// (either just auto-filled, or the user hasn't touched it since). The
// moment a user edits ARV to any other value, this naturally returns
// false on the very next read — no extra write, no extra field, no
// migration. This is intentionally a fingerprint match, not a persisted
// flag: if a user happens to manually type the exact same number the AI
// recommended, it is indistinguishable from (and functionally equivalent
// to) accepting the AI's estimate — never a meaningful edge case.
export function wasArvSetByAi(lead) {
  const arv = lead.arv != null ? Number(lead.arv) : null
  if (arv == null) return false
  const valuation = parseAiValuation(lead.ai_notes)
  return !!valuation && valuation.recommended === arv
}

// Preliminary vs Refined (Section 3) — reuses EXISTING V2 Confidence/missing
// output, never a new score. A lead is Refined once its own decision_v2
// Confidence no longer flags ARV/renovation as unresolved.
export function getDecisionMaturity(lead) {
  const d = lead.decision_v2
  if (!d) return null
  const missing = d.confidence?.missing || []
  const stillMissingCoreEconomics = missing.some(m => /ARV|Renovation|Rent/i.test(m))
  return stillMissingCoreEconomics || d.confidence.score < 55 ? 'PRELIMINARY' : 'REFINED'
}
