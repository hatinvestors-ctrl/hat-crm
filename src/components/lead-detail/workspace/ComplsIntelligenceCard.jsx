// src/components/lead-detail/workspace/ComplsIntelligenceCard.jsx
// Comps & ARV — Lead Workspace UX V2.8.
//
// This card answers exactly ONE question: "what market evidence supports
// our ARV?" It is deliberately NOT a second acquisition-decision surface.
//
// V2.8 removed the underwriting/decision layer that had accumulated here
// (ARV stress-test verdict — ROBUST DEAL / ARV SENSITIVE — the ±5% scenario
// table, the stress-test recommendation box, and the "What Makes This Deal
// Work?" block with Evaluation Price / HAT Max Buy / Room to Max Buy /
// Seller Gap to Max Buy / Profit Shortfall). Every one of those restated a
// conclusion the Overview and Deal tabs already own; none of them was comp
// evidence. NOTHING was deleted from the library: computeDecisionSensitivity
// and getValuationRecommendation are still exported (and still tested) in
// src/lib/arvConfidence.js for any future Deal-side sensitivity surface —
// this change is an unmount, not a capability removal.
//
// The semantic distinction from arvConfidence.js still holds and is the
// reason this card shows no confidence NUMBER: ARV stress sensitivity
// ("does the decision survive ±5% ARV") is NOT comp-evidence confidence
// ("how good is the evidence behind the ARV"). There is no real per-comp
// dataset with distance/recency/similarity fields in this system yet, so
// this card says so honestly instead of inventing a score.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { formatCurrency as fc } from '../../../lib/calculations'
import { getHatInternalEvidence, getExternalCompConfidenceState, getCompEvidenceSummary } from '../../../lib/arvConfidence'
import { getArvProvenance } from '../../../lib/arvProvenance'
import { parseAiDealScore, getAiInsights } from '../../../lib/aiDealScore'

function EvidenceTypeBadge({ type }) {
  // Two-tier hierarchy preserved from V1: VERIFIED OUTCOME EVIDENCE (an
  // actual completed sale) stays visually distinct from INTERNAL MARKET
  // HISTORY (a prior HAT estimate) — the latter never reads as verified.
  if (type === 'ACTUAL_SALE') {
    return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">VERIFIED — ACTUAL SALE</span>
  }
  return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]">PRIOR HAT ARV ESTIMATE</span>
}

export default function ComplsIntelligenceCard({ lead }) {
  const [candidates, setCandidates] = useState([])
  const [evidenceLoading, setEvidenceLoading] = useState(true)
  const [evidenceError, setEvidenceError] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const compEvidence = getCompEvidenceSummary(lead)
  const provenance = getArvProvenance(lead)
  const hasCompAnalysis = compEvidence.available
  // UX V3, Part 3/4/19 — genuinely AI-generated content (the LLM's own
  // scored rubric + its own PROS/CONS observations), parsed read-only
  // from the SAME ai_notes text the rest of this card already reads.
  // Independent of compEvidence.available — a lead can have a Deal Score
  // even before/without fresh comps (e.g. right after a refresh that
  // reused existing comps).
  const dealScore = parseAiDealScore(lead.ai_notes)
  const aiInsights = getAiInsights(lead.ai_notes)

  // ONE scoped query (same ZIP only, small column list, capped rows), never
  // a full-table scan. Only runs once comp analysis exists — before that,
  // this card is intentionally near-empty and has nothing to show it in.
  useEffect(() => {
    let cancelled = false
    async function loadCandidates() {
      if (!lead.zip_code || !hasCompAnalysis) { setEvidenceLoading(false); return }
      setEvidenceLoading(true)
      setEvidenceError(null)
      try {
        const { data, error } = await supabase
          .from('leads')
          .select('id,address,city,zip_code,bedrooms,bathrooms,sqft,arv,status')
          .eq('zip_code', lead.zip_code)
          .neq('id', lead.id)
          .limit(25)
        if (error) throw error
        const soldIds = (data || []).filter(r => r.status === 'flip_sold' || r.status === 'sold').map(r => r.id)
        let financialsById = {}
        if (soldIds.length > 0) {
          const { data: fin, error: finErr } = await supabase
            .from('deal_financials')
            .select('lead_id,actual_sale_price,sold_date')
            .in('lead_id', soldIds)
          if (finErr) throw finErr
          financialsById = Object.fromEntries((fin || []).map(f => [f.lead_id, f]))
        }
        if (!cancelled) setCandidates((data || []).map(r => ({ ...r, deal_financials: financialsById[r.id] || null })))
      } catch (err) {
        if (!cancelled) setEvidenceError(err.message || 'Could not load HAT market history.')
      } finally {
        if (!cancelled) setEvidenceLoading(false)
      }
    }
    loadCandidates()
    return () => { cancelled = true }
  }, [lead.zip_code, lead.id, hasCompAnalysis])

  const externalState = getExternalCompConfidenceState(lead)
  const evidence = getHatInternalEvidence(lead, candidates)

  return (
    <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4 space-y-3.5">
      <div>
        <h3 className="text-[14px] font-bold">Comps &amp; ARV</h3>
        <p className="text-[11px] text-[color:var(--color-text-dim)] mt-0.5">What market evidence supports our ARV?</p>
      </div>

      {/* Current ARV — the canonical value, read straight from the lead and
          never recomputed here. Its provenance caption comes from the
          EXISTING getArvProvenance() reader (no new source of truth). */}
      <div>
        <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Current ARV</div>
        <div className="text-[22px] font-extrabold tabular-nums leading-tight">{lead.arv != null ? fc(lead.arv) : '—'}</div>
        {lead.arv != null && (
          <div className="text-[10.5px] text-[color:var(--color-text-dim)] mt-0.5">
            {provenance.source === 'AI_COMPS'
              ? `Referenced against ${provenance.comps_count} comp line${provenance.comps_count === 1 ? '' : 's'} in the latest AI analysis.`
              : 'Not yet validated against comparable sales.'}
          </div>
        )}
      </div>

      {!hasCompAnalysis ? (
        /* BEFORE ANALYSIS — deliberately almost empty. The single CTA lives
           in Deal Analysis directly below; duplicating it here would mean a
           second copy of the readiness/reno-picker/generation logic. */
        <div className="text-[11.5px] text-[color:var(--color-text-dim)] space-y-1">
          <div>No detailed comp analysis has been run yet.</div>
          <div>Run <span className="font-semibold text-[color:var(--color-text-muted)]">✦ Get Comps &amp; Detailed AI</span> below to pull comparable sales evidence for this property.</div>
        </div>
      ) : (
        <>
          {/* COMPARABLE SALES EVIDENCE — the centre of gravity once comps
              exist. Every field here is parsed verbatim from what
              generate-comps.mjs actually wrote; no field is invented, and
              anything the template didn't emit simply isn't rendered. */}
          <div className="pt-3 border-t border-[color:var(--color-line)] space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Comparable Sales Evidence</div>
              <div className="text-[10px] text-[color:var(--color-text-dim)]">{compEvidence.count} comp reference{compEvidence.count === 1 ? '' : 's'}</div>
            </div>

            {compEvidence.marketRange && (
              <div className="text-[11.5px]">
                <span className="text-[color:var(--color-text-dim)]">Market range: </span>
                <span className="font-semibold text-[color:var(--color-text)]">{compEvidence.marketRange}</span>
              </div>
            )}

            <div className="space-y-1">
              {compEvidence.comps.map(c => (
                <div key={c.key} className="text-[11.5px]">
                  <span className="font-semibold text-[color:var(--color-text)]">{c.label}</span>
                  {c.details.length > 0 && (
                    <span className="text-[color:var(--color-text-dim)]"> · {c.details.join(' · ')}</span>
                  )}
                </div>
              ))}
            </div>

            {compEvidence.evidenceRead && (
              <p className="text-[11.5px] text-[color:var(--color-text-muted)]">{compEvidence.evidenceRead}</p>
            )}

            <div className="text-[10.5px] text-[color:var(--color-text-dim)]">
              Full comp detail, rental comps and the AI narrative are in the Comps tab of Deal Analysis below.
            </div>
          </div>

          {/* COMP-EVIDENCE CONFIDENCE — honest state from the existing
              getExternalCompConfidenceState(). This is NOT the ±5% ARV
              stress test (removed in V2.8), and no score is fabricated in
              its place. */}
          <div className="pt-3 border-t border-[color:var(--color-line)]">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Comp Confidence</div>
            <div className="text-[11.5px] font-semibold text-[color:var(--color-text-dim)]">{externalState.label}</div>
            <div className="text-[11px] text-[color:var(--color-text-dim)] mt-0.5">{externalState.message}</div>
          </div>

          {/* AI DEAL SCORE — UX V3, Part 3/4/5. Genuinely AI-generated
              (the LLM's own rubric-based judgment), parsed verbatim from
              ai_notes — no new scoring, no changed criteria, no new
              band language beyond the neutral caption below. Explicitly
              NOT the acquisition decision — Overview owns that. This
              replaces the removed "AI Read" card (which was NOT actually
              AI-generated — see DealAnalysisCard.jsx's disposition). */}
          {dealScore && (
            <div className="pt-3 border-t border-[color:var(--color-line)]">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">AI Deal Score</div>
                <div className="text-[18px] font-extrabold tabular-nums">{dealScore.total}<span className="text-[11px] font-semibold text-[color:var(--color-text-dim)]">/100</span></div>
              </div>
              <p className="text-[11px] text-[color:var(--color-text-dim)] mt-0.5">
                AI assessment of the opportunity across returns, pricing, seller signals, market strength, cash flow, and data quality.
              </p>
              {dealScore.categories.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {dealScore.categories.map(c => (
                    <div key={c.key} className="text-[11.5px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[color:var(--color-text)]">{c.label}</span>
                        <span className="font-bold tabular-nums text-[color:var(--color-text-dim)]">{c.score}/{c.max}</span>
                      </div>
                      {c.note && <div className="text-[10.5px] text-[color:var(--color-text-dim)]">{c.note}</div>}
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-[color:var(--color-text-dim)] mt-2 pt-1.5 border-t border-[color:var(--color-line)]">
                Higher scores indicate a stronger overall AI-assessed opportunity across the scored dimensions. This score does not replace Overview's Acquisition Decision or Deal's Margin of Safety — those come from HAT's deterministic underwriting engine, not this AI assessment.
              </p>
            </div>
          )}

          {/* AI INSIGHTS — UX V3, Part 19. The AI's own PROS/CONS
              observations, parsed verbatim (no new AI call, no
              rewording beyond the existing shortenReason-style trim
              already used for Smart Lead Prioritization). Never repeats
              MAO/profit/strategy — those bullets are about the property/
              market itself. */}
          {aiInsights.length > 0 && (
            <div className="pt-3 border-t border-[color:var(--color-line)]">
              <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">AI Insights</div>
              <ul className="space-y-1">
                {aiInsights.map((insight, i) => (
                  <li key={i} className="text-[11.5px] text-[color:var(--color-text-muted)] flex items-start gap-1.5">
                    <span className={insight.tone === 'risk' ? 'text-[color:var(--color-warn-text)]' : 'text-[color:var(--color-success-text)]'}>{insight.tone === 'risk' ? '⚠' : '✓'}</span>
                    <span>{insight.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* HAT MARKET HISTORY — genuinely unique evidence (HAT's own past
              activity in this ZIP), but kept visually secondary: one line
              when empty, collapsed behind a disclosure when present. */}
          <div className="pt-3 border-t border-[color:var(--color-line)]">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">HAT Market History</div>
            {evidenceLoading ? (
              <div className="text-[11.5px] text-[color:var(--color-text-dim)]">Checking HAT's records for prior activity in this ZIP…</div>
            ) : evidenceError ? (
              <div className="text-[11.5px] text-[color:var(--color-danger-text)]">{evidenceError}</div>
            ) : !evidence.available ? (
              <div className="text-[11.5px] text-[color:var(--color-text-dim)]">No HAT market history available for ZIP {lead.zip_code || 'this area'}.</div>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setHistoryOpen(o => !o)}
                  className="text-[11.5px] text-left text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]"
                >
                  {historyOpen ? '▾' : '▸'} {evidence.count} prior HAT propert{evidence.count === 1 ? 'y' : 'ies'} in ZIP {lead.zip_code}
                </button>
                {historyOpen && (
                  <>
                    {evidence.matches.map(m => (
                      <div key={m.id} className="flex items-center justify-between gap-3 text-[11.5px] border border-[color:var(--color-line)] rounded-md px-2.5 py-1.5">
                        <div>
                          <div className="font-semibold">{m.address}</div>
                          <div className="text-[10.5px] text-[color:var(--color-text-dim)]">
                            {[m.bedrooms && `${m.bedrooms}/${m.bathrooms ?? '?'}`, m.sqft && `${m.sqft} sqft`].filter(Boolean).join(' · ') || '—'}
                          </div>
                        </div>
                        <div className="text-right">
                          <EvidenceTypeBadge type={m.evidenceType} />
                          <div className="text-[11px] font-bold tabular-nums mt-0.5">
                            {m.evidenceType === 'ACTUAL_SALE' ? fc(m.actualSalePrice) : fc(m.priorArv)}
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className="text-[10px] text-[color:var(--color-text-dim)]">Internal market context — prior estimates are HAT's own past analysis, not verified closed-sale comps.</div>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
