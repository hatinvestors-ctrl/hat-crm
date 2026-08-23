// src/components/lead-detail/workspace/ComplsIntelligenceCard.jsx
// Comps Intelligence — SCOPED V1 + pre-demo consistency & AI-authority fix.
// See src/lib/arvConfidence.js for the full audit finding this scope is
// built on: there is no structured, real per-comp dataset in this system
// today, so this card does NOT show a fabricated numeric "ARV Confidence"
// score. It shows three things, all real, and kept deliberately SEPARATE
// (Part 3): ARV Confidence (comp evidence quality — not scoreable yet) is
// NOT the same concept as ARV Stress/Decision Sensitivity (does the
// acquisition conclusion change across a tested ARV range) — never infer
// one from the other.
//   1. ARV Stress Test — the EXISTING canonical ARV stress-tested through
//      the EXISTING canonical financial engine.
//   2. HAT Market History — real past HAT leads/deal_financials rows,
//      explicitly NOT presented as verified comps unless they genuinely are.
//   3. Comparable Sales Evidence — an honest "not yet available" state.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { formatCurrency as fc } from '../../../lib/calculations'
import {
  computeDecisionSensitivity, getHatInternalEvidence, getExternalCompConfidenceState, getValuationRecommendation,
  STRESS_CLASSIFICATION,
} from '../../../lib/arvConfidence'

const SENSITIVITY_TONE = {
  [STRESS_CLASSIFICATION.ROBUST_DEAL]: 'var(--color-success-text)',
  [STRESS_CLASSIFICATION.ARV_SENSITIVE]: 'var(--color-warn-text)',
  [STRESS_CLASSIFICATION.UPSIDE_DEPENDENT]: 'var(--color-warn-text)',
  [STRESS_CLASSIFICATION.NO_DEAL_ACROSS_RANGE]: 'var(--color-danger-text)',
}

// Part 18 — BASE is visually distinguished (bold + accent left-border) as
// "the current underwriting assumption," not just another row.
const TIER_LABEL = { conservative: 'Conservative', base: 'Base (current ARV)', upside: 'Upside' }

function EvidenceTypeBadge({ type }) {
  // Part 12 — a two-tier hierarchy. VERIFIED OUTCOME EVIDENCE (an actual
  // completed sale) is visually distinct from INTERNAL MARKET HISTORY (a
  // prior HAT estimate) — the latter never reads as strong/verified.
  if (type === 'ACTUAL_SALE') {
    return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">VERIFIED — ACTUAL SALE</span>
  }
  return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]">PRIOR HAT ARV ESTIMATE</span>
}

export default function ComplsIntelligenceCard({ lead }) {
  const [candidates, setCandidates] = useState([])
  const [evidenceLoading, setEvidenceLoading] = useState(true)
  const [evidenceError, setEvidenceError] = useState(null)
  const [showScenarios, setShowScenarios] = useState(false)

  // Part 29 — ONE scoped query (same ZIP only, small column list, capped
  // rows), never a full-table scan, and never re-run per render. The
  // matching itself happens in getHatInternalEvidence (pure, no I/O).
  useEffect(() => {
    let cancelled = false
    async function loadCandidates() {
      if (!lead.zip_code) { setEvidenceLoading(false); return }
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
  }, [lead.zip_code, lead.id])

  const sensitivity = computeDecisionSensitivity(lead)
  const externalState = getExternalCompConfidenceState()
  const evidence = getHatInternalEvidence(lead, candidates)
  const recommendation = sensitivity.available ? getValuationRecommendation(sensitivity.sensitivity) : null

  // Part 6/7 — two DIFFERENT numbers, both straight from the canonical
  // breakdown, never sharing an ambiguous "gap"/"shortfall"/"room" label
  // without saying what each measures.
  const flip = sensitivity.available ? sensitivity.base.flip : null
  const sellerGapToMaxBuy = flip?.marginOfSafety?.priceCushion != null ? Math.round(flip.marginOfSafety.priceCushion) : null
  const profitShortfall = (flip?.targetProfit != null && flip?.projectedProfit != null) ? Math.round(flip.targetProfit - flip.projectedProfit) : null

  return (
    <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4 space-y-4">
      <div>
        <h3 className="text-[14px] font-bold">Comps Intelligence</h3>
        <p className="text-[11px] text-[color:var(--color-text-dim)] mt-0.5">How much does the acquisition decision depend on the current ARV?</p>
      </div>

      {/* Current ARV — the canonical value, never recomputed here. */}
      <div className="flex items-center gap-6 flex-wrap">
        <div>
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Current ARV</div>
          <div className="text-[20px] font-extrabold tabular-nums">{lead.arv != null ? fc(lead.arv) : '—'}</div>
        </div>
        {sensitivity.available && (
          <div>
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">ARV Stress Test</div>
            <div className="text-[15px] font-extrabold" style={{ color: SENSITIVITY_TONE[sensitivity.sensitivity] }}>{sensitivity.sensitivityLabel}</div>
          </div>
        )}
      </div>

      {!sensitivity.available ? (
        <div className="text-[11.5px] text-[color:var(--color-text-dim)]">{sensitivity.reason}</div>
      ) : (
        <>
          <p className="text-[11.5px] text-[color:var(--color-text-muted)]">{sensitivity.sensitivityReason}</p>

          <button
            type="button"
            onClick={() => setShowScenarios(o => !o)}
            className="text-[10.5px] font-semibold underline text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text-muted)]"
          >
            {showScenarios ? 'Hide ARV scenarios' : `How is this calculated? (±${Math.round(sensitivity.bandPct * 100)}% ARV stress test)`}
          </button>

          {showScenarios && (
            <div className="rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] overflow-x-auto">
              <table className="w-full text-[11.5px]">
                <thead className="border-b border-[color:var(--color-line)]">
                  <tr>
                    <th className="px-3 h-8 text-left text-[10px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">Scenario</th>
                    <th className="px-3 h-8 text-left text-[10px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">ARV</th>
                    <th className="px-3 h-8 text-left text-[10px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">Max Buy</th>
                    <th className="px-3 h-8 text-left text-[10px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">Projected Profit</th>
                    <th className="px-3 h-8 text-left text-[10px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">Verdict</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--color-line)]">
                  {['conservative', 'base', 'upside'].map(tier => {
                    const s = sensitivity[tier]
                    const isBase = tier === 'base'
                    return (
                      <tr key={tier} className={isBase ? 'bg-[color:var(--color-bg-elev)] border-l-2' : ''} style={isBase ? { borderLeftColor: 'var(--color-accent)' } : undefined}>
                        <td className={`px-3 py-2 ${isBase ? 'font-extrabold' : 'font-semibold'}`}>{TIER_LABEL[tier]}</td>
                        <td className="px-3 py-2 tabular-nums">{fc(s.arv)}</td>
                        <td className="px-3 py-2 tabular-nums">{s.flip.mao != null ? fc(Math.round(s.flip.mao / 100) * 100) : '—'}</td>
                        <td className="px-3 py-2 tabular-nums">{s.flip.projectedProfit != null ? fc(s.flip.projectedProfit) : '—'}</td>
                        <td className="px-3 py-2 font-bold" style={{ color: s.flip.verdict === 'NO DEAL' ? 'var(--color-danger-text)' : 'var(--color-success-text)' }}>{s.flip.verdict}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {/* Part 17 — never call this a "supported range"/"confidence
                  interval". It's a sensitivity test, nothing more. */}
              <div className="px-3 py-2 text-[10px] text-[color:var(--color-text-dim)] border-t border-[color:var(--color-line)]">
                Stress test: ±{Math.round(sensitivity.bandPct * 100)}% from current ARV. This measures deal sensitivity, using the same canonical Flip calculation for each row — it is not a comp-derived valuation range.
              </div>
            </div>
          )}

          {recommendation && (
            <div className="rounded-md border px-3 py-2.5 text-[11.5px]" style={{ borderColor: SENSITIVITY_TONE[sensitivity.sensitivity] }}>
              {recommendation}
            </div>
          )}

          {/* Part 6 — "What Makes This Deal Work?" derived entirely from
              canonical values already computed above; no new formula. */}
          {flip?.available && (sellerGapToMaxBuy != null || profitShortfall != null) && (
            <div className="rounded-md border border-[color:var(--color-line)] px-3 py-2.5 space-y-1.5">
              <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">What Makes This Deal Work?</div>
              <div className="text-[11.5px] flex justify-between"><span className="text-[color:var(--color-text-muted)]">Seller Asking</span><span className="font-bold tabular-nums">{fc(flip.evaluationPrice)}</span></div>
              <div className="text-[11.5px] flex justify-between"><span className="text-[color:var(--color-text-muted)]">HAT Max Buy</span><span className="font-bold tabular-nums">{fc(Math.round(flip.mao / 100) * 100)}</span></div>
              {sellerGapToMaxBuy != null && (
                <div className="text-[11.5px] flex justify-between"><span className="text-[color:var(--color-text-muted)]">Seller Gap to Max Buy</span><span className="font-bold tabular-nums" style={{ color: sellerGapToMaxBuy < 0 ? 'var(--color-danger-text)' : 'var(--color-success-text)' }}>{sellerGapToMaxBuy < 0 ? '−' : '+'}{fc(Math.abs(sellerGapToMaxBuy))}</span></div>
              )}
              {profitShortfall != null && profitShortfall > 0 && (
                <div className="text-[11.5px] flex justify-between"><span className="text-[color:var(--color-text-muted)]">Profit Shortfall to Target</span><span className="font-bold tabular-nums" style={{ color: 'var(--color-danger-text)' }}>{fc(profitShortfall)}</span></div>
              )}
              <div className="text-[10.5px] text-[color:var(--color-text-dim)] pt-1 border-t border-[color:var(--color-line)]">
                {sensitivity.sensitivity === STRESS_CLASSIFICATION.NO_DEAL_ACROSS_RANGE
                  ? 'Seller price needs to move materially toward Max Buy for the deal to meet HAT\'s Flip target. Primary constraint: acquisition price.'
                  : 'Seller Gap to Max Buy and Profit Shortfall measure different things — closing the price gap is what actually restores the target profit.'}
              </div>
            </div>
          )}
        </>
      )}

      {/* Part 12/13 — "HAT Market History", not "Internal Evidence" or
          "nearby"/"comp" language unless it's genuinely verified. */}
      <div className="pt-3 border-t border-[color:var(--color-line)]">
        <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1.5">HAT Market History</div>
        {evidenceLoading ? (
          <div className="text-[11.5px] text-[color:var(--color-text-dim)]">Checking HAT's records for prior activity in this ZIP…</div>
        ) : evidenceError ? (
          <div className="text-[11.5px] text-[color:var(--color-danger-text)]">{evidenceError}</div>
        ) : !evidence.available ? (
          <div className="text-[11.5px] text-[color:var(--color-text-dim)]">No HAT market history in ZIP {lead.zip_code || 'this area'}.</div>
        ) : (
          <div className="space-y-2">
            <div className="text-[11px] text-[color:var(--color-text-muted)]">Prior HAT activity in ZIP {lead.zip_code} ({evidence.count} propert{evidence.count === 1 ? 'y' : 'ies'})</div>
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
          </div>
        )}
      </div>

      {/* Comparable Sales Evidence — honest, product-safe copy (Part 16),
          never a fabricated score, never implementation language. */}
      <div className="pt-3 border-t border-[color:var(--color-line)]">
        <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Comparable Sales Evidence</div>
        <div className="text-[12.5px] font-bold text-[color:var(--color-text-dim)]">{externalState.label}</div>
        <div className="text-[11px] text-[color:var(--color-text-dim)] mt-0.5">{externalState.message}</div>
      </div>
    </div>
  )
}
