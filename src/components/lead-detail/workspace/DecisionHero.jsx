// src/components/lead-detail/workspace/DecisionHero.jsx
// HAT Premium Visual Pass, Part 7/9/10 — the ONE dominant decision surface
// on Overview. Consolidates what used to be two separately-rendered
// voices (AcquisitionCopilot's header + LeadWorkspaceHeader's chips) into
// one hero, and makes the OVERALL DECISION (V2 recommendation — "should
// we prioritize this") explicitly distinct from DEAL SAFETY (the Flip
// tier — "does the math have room"), per Part 9's exact instruction.
//
// ZERO new business logic: OVERALL DECISION reads decision_v2 +
// classifyLeadV2()/getActionReason() (Capability #17.1) + getDecisionMaturity
// (#16.1) exactly as AcquisitionCopilot already did. DEAL SAFETY + the
// economics row read computeFlipResult() (dealExplanation.js) exactly as
// DealAnalysisCard/DealDecisionCenter already do. This file only arranges
// and labels already-computed values.
import { classifyLeadV2 } from '../../../pages/ActionCenterPage'
import { getActionReason } from '../../../lib/actionReason'
import { getDecisionMaturity, getArvProvenance } from '../../../lib/arvProvenance'
import { computeFlipResult } from '../../../lib/dealExplanation'
import { formatCurrency as fc } from '../../../lib/calculations'
import { VERDICT_DISPLAY_LABEL } from '../DealAnalysisCard'

const REC_THEME = {
  ACT_NOW:      { text: 'var(--color-danger-text)',  border: 'var(--color-danger)' },
  REVIEW_TODAY: { text: 'var(--color-warn-text)',     border: 'var(--color-warn)' },
  RESEARCH:     { text: 'var(--color-text)',          border: 'var(--color-line)' },
  FOLLOW_UP:    { text: 'var(--color-accent-text)',   border: 'var(--color-accent)' },
  MONITOR:      { text: 'var(--color-text-dim)',      border: 'var(--color-line)' },
  PASS:         { text: 'var(--color-text-dim)',      border: 'var(--color-line)' },
}
const DEAL_SAFETY_TONE = {
  STRONG: 'var(--color-success-text)', PASS: 'var(--color-success-text)',
  WATCH: 'var(--color-warn-text)', 'NO DEAL': 'var(--color-danger-text)',
}

function Metric({ label, value, tone }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{label}</div>
      <div className="text-[19px] font-extrabold tabular-nums truncate" style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  )
}

export default function DecisionHero({ lead }) {
  const d = lead.decision_v2
  if (!d) return null

  const theme = REC_THEME[d.recommendation] || REC_THEME.MONITOR
  const isOverridden = d.next_best_action === 'HUMAN_OVERRIDE'
  const classified = classifyLeadV2(lead)
  const actionReason = classified ? getActionReason(lead, classified) : (isOverridden ? getActionReason(lead, { category: 'ACT_NOW' }) : null)
  const maturity = !lead.is_distressed ? getDecisionMaturity(lead) : null
  const isPreliminary = maturity === 'PRELIMINARY'
  const prov = getArvProvenance(lead)

  // Deal Safety — a DIFFERENT question than Overall Decision (Part 9).
  // Only computed/shown for on-market leads with enough data; never
  // recalculated, straight from computeFlipResult.
  const flip = !lead.is_distressed ? computeFlipResult(lead) : { available: false }

  return (
    <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] overflow-hidden">
      <div className="px-4 py-3.5 border-l-[3px]" style={{ borderLeftColor: isPreliminary ? 'var(--color-warn)' : theme.border }}>
        {/* OVERALL DECISION */}
        {isPreliminary ? (
          <>
            <div className="text-[20px] font-extrabold text-[color:var(--color-warn-text)]">Preliminary Review</div>
            <div className="text-[12.5px] text-[color:var(--color-text-muted)] mt-0.5">Not enough information to evaluate the deal yet.</div>
          </>
        ) : (
          <div className="text-[20px] font-extrabold" style={{ color: theme.text }}>
            {isOverridden ? 'Pass — Human Override' : d.recommendation.replace(/_/g, ' ')}
          </div>
        )}

        {actionReason?.reason && (
          <p className="text-[12.5px] text-[color:var(--color-text)] mt-1 leading-snug">{actionReason.reason}</p>
        )}

        {/* DEAL SAFETY — explicitly separate line from Overall Decision. */}
        {flip.available && (
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Deal Safety</span>
            <span className="text-[12px] font-bold" style={{ color: DEAL_SAFETY_TONE[flip.verdict] }}>
              {VERDICT_DISPLAY_LABEL[flip.verdict]} — {flip.marginOfSafety?.title}
            </span>
          </div>
        )}
      </div>

      {/* Economics row — only what's actually computable, never invented. */}
      {flip.available && (
        <div className="px-4 py-3 border-t border-[color:var(--color-line)] grid grid-cols-3 gap-3">
          <Metric label="Projected Profit" value={fc(flip.projectedProfit)} tone={flip.projectedProfit >= 30000 ? 'var(--color-success-text)' : 'var(--color-danger-text)'} />
          <Metric label="Room Below MAO" value={flip.marginOfSafety?.priceCushion != null ? `${flip.marginOfSafety.priceCushion < 0 ? '−' : '+'}${fc(Math.round(Math.abs(flip.marginOfSafety.priceCushion)))}` : '—'} tone={flip.marginOfSafety?.priceCushion >= 0 ? undefined : 'var(--color-danger-text)'} />
          <Metric label="Max Buy" value={fc(Math.round(flip.mao / 100) * 100)} tone="var(--color-accent-text)" />
        </div>
      )}

      {/* Opportunity/Confidence/Urgency + maturity — moved here from the
          global header (Part 6) so the header stays purely property
          identity; this is where "decision context" belongs. */}
      <div className="px-4 py-2.5 border-t border-[color:var(--color-line)] flex items-center gap-4 flex-wrap">
        <span className="text-[11px] text-[color:var(--color-text-dim)]">Opportunity <b className="text-[color:var(--color-text)]">{d.opportunity?.score ?? '—'}</b></span>
        <span className="text-[11px] text-[color:var(--color-text-dim)]">Confidence <b className="text-[color:var(--color-text)]">{d.confidence?.score ?? '—'}</b></span>
        <span className="text-[11px] text-[color:var(--color-text-dim)]">Urgency <b className="text-[color:var(--color-text)]">{d.urgency?.level ?? '—'}</b></span>
        {maturity && (
          <span className="text-[10px] font-bold uppercase tracking-wide ml-auto" style={{ color: isPreliminary ? 'var(--color-warn-text)' : 'var(--color-success-text)' }}>
            {isPreliminary
              ? `Preliminary — Missing: ${(d.confidence?.missing || []).slice(0, 2).join(' · ') || 'more data'}`
              : `Refined${prov.comps_available ? ` · ${prov.comps_count} comp${prov.comps_count === 1 ? '' : 's'}` : ''} · Confidence ${d.confidence.score}`}
          </span>
        )}
      </div>

      {isOverridden && d.human_override?.reason && (
        <div className="px-4 pb-2.5 text-[11.5px] text-[color:var(--color-text-dim)]">⚠ {d.human_override.reason}</div>
      )}
    </div>
  )
}
