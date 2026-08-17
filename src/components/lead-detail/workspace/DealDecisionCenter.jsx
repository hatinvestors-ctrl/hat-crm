// src/components/lead-detail/workspace/DealDecisionCenter.jsx
// Lead Workspace redesign, Final UX Polish, Section 6 — "Does this deal
// work and what can we pay?" ANSWER FIRST, inputs second, details last.
// DATA-AWARE, not status-dependent: readiness is judged purely from
// whether ARV/reno/rent are present, never from lead.status.
//
// Every number here comes from the SAME canonical functions DealAnalysisCard
// and FinancialSection already call (computeFlipResult/computeBrrrrResult/
// computeStrategyRecommendation — src/lib/dealExplanation.js). This file
// formats and arranges those results; it never recomputes a formula.
import { formatCurrency as fc } from '../../../lib/calculations'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../../../lib/dealExplanation'
import { FlipMarginOfSafety, FlipRealityCheck, BrrrrRealityCheck, VERDICT_DISPLAY_LABEL } from '../DealAnalysisCard'
import { getDealReadiness } from './readiness'
import EmptyState from './EmptyState'

function Stat({ label, value, tone }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{label}</div>
      <div className="text-[15px] font-bold tabular-nums truncate" style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  )
}

const VERDICT_TONE = {
  STRONG: 'var(--color-success-text)', PASS: 'var(--color-success-text)',
  WATCH: 'var(--color-warn-text)', 'NO DEAL': 'var(--color-danger-text)',
}

export default function DealDecisionCenter({ lead, onRunAnalysis }) {
  const readiness = getDealReadiness(lead)

  // Section 6B — one consolidated readiness block instead of the
  // decision strip / strategy comparison / margin / path each separately
  // rendering their own "not available." Property basics already on file
  // are still shown under KNOWN, so nothing looks broken — just not yet
  // computed.
  if (!readiness.flipReady) {
    return (
      <div className="space-y-4">
        <EmptyState
          title="Deal Not Ready"
          explanation={`${readiness.missing.length} input${readiness.missing.length === 1 ? '' : 's'} needed before economics can be calculated.`}
          missing={readiness.missing}
          action={onRunAnalysis ? { label: 'Run Comps to Estimate ARV →', onClick: onRunAnalysis } : undefined}
        />
        {(lead.asking_price != null || lead.renovation_cost != null || lead.bedrooms) && (
          <div className="rounded-lg border border-[color:var(--color-line)] px-4 py-3">
            <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-2">Known</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {lead.asking_price != null && <Stat label="Ask" value={fc(lead.asking_price)} />}
              {(lead.bedrooms || lead.bathrooms) && <Stat label="Beds / Baths" value={`${lead.bedrooms ?? '—'} / ${lead.bathrooms ?? '—'}`} />}
              {lead.sqft != null && <Stat label="Sqft" value={Number(lead.sqft).toLocaleString()} />}
              {lead.renovation_cost != null && <Stat label="Rehab" value={fc(lead.renovation_cost)} />}
            </div>
          </div>
        )}
      </div>
    )
  }

  const flip = computeFlipResult(lead)
  const brrrr = computeBrrrrResult(lead)
  const strategyRec = computeStrategyRecommendation(flip, brrrr)

  // Section 6A — decision strip. Only ever labels concepts that actually
  // exist in the system: Asking Price (raw field), Starting Offer (raw
  // stored value, distinct from the live-computed "current offer"),
  // Current Offer (getEffectiveOffer's result — what flip/brrrr math is
  // actually evaluated at), and canonical Flip MAO. No invented "target"
  // price — the system has no such concept.
  const ask = lead.asking_price != null ? Number(lead.asking_price) : null
  const startingOffer = lead.starting_offer != null ? Number(lead.starting_offer) : null

  // Section 6C — recommendation reason, built from numbers the SAME
  // computeFlipResult/computeBrrrrResult calls already produced.
  let recReason = strategyRec.reason
  if (!recReason && strategyRec.preferredStrategy === 'BRRRR' && brrrr.available) {
    recReason = `Leaves about ${fc(brrrr.cashLeftIn)} in the deal${brrrr.monthlyCashFlow > 0 ? ` and stays cash-flow positive at ${fc(brrrr.monthlyCashFlow)}/mo` : ''}.`
  } else if (!recReason && strategyRec.preferredStrategy === 'FLIP' && flip.available) {
    recReason = `Projects ${fc(flip.projectedProfit)} profit at the current offer, ${flip.marginOfSafety?.title?.toLowerCase() || ''}.`
  }

  return (
    <div className="space-y-4">
      {/* 6A — Decision strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Asking Price" value={ask != null ? fc(ask) : 'Not set'} />
        <Stat label="Starting Offer" value={startingOffer != null ? fc(startingOffer) : 'Not set'} />
        <Stat label="Current Offer" value={flip.currentOffer != null ? fc(flip.currentOffer) : 'Not set'} />
        <Stat label="Flip MAO (Max)" value={fc(Math.round(flip.mao / 100) * 100)} tone="var(--color-accent-text)" />
      </div>

      {/* 6B/6C — Strategy comparison + recommendation */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-[color:var(--color-line)] px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wider font-bold text-[color:var(--color-text-dim)]">Flip</span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: VERDICT_TONE[flip.verdict], background: 'var(--color-bg-elev-2)' }}>
              {VERDICT_DISPLAY_LABEL[flip.verdict]}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Stat label="Flip MAO" value={fc(Math.round(flip.mao / 100) * 100)} />
            <Stat label="Profit" value={fc(flip.projectedProfit)} tone={flip.projectedProfit >= 30000 ? 'var(--color-success-text)' : 'var(--color-danger-text)'} />
          </div>
        </div>
        <div className="rounded-lg border border-[color:var(--color-line)] px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wider font-bold text-[color:var(--color-text-dim)]">BRRRR</span>
            {brrrr.available && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: VERDICT_TONE[brrrr.verdict], background: 'var(--color-bg-elev-2)' }}>
                {VERDICT_DISPLAY_LABEL[brrrr.verdict]}
              </span>
            )}
          </div>
          {brrrr.available ? (
            <div className="grid grid-cols-2 gap-2.5">
              <Stat label="Cash Left In" value={fc(brrrr.cashLeftIn)} tone={brrrr.cashLeftIn < 30000 ? 'var(--color-success-text)' : 'var(--color-warn-text)'} />
              <Stat label="Cash Flow" value={brrrr.monthlyCashFlow != null ? `${fc(brrrr.monthlyCashFlow)}/mo` : 'Not available'} tone={brrrr.monthlyCashFlow > 0 ? 'var(--color-success-text)' : 'var(--color-danger-text)'} />
            </div>
          ) : (
            <div className="text-[12px] text-[color:var(--color-warn-text)]">Rent needed for BRRRR</div>
          )}
        </div>
      </div>

      {strategyRec.preferredStrategy !== 'NONE' ? (
        <div className="rounded-lg border px-4 py-2.5" style={{ borderColor: 'var(--color-accent)', background: 'var(--color-accent-soft)' }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] uppercase tracking-wider font-bold text-[color:var(--color-accent-text)]">Best Fit</span>
            <span className="text-[13px] font-extrabold text-[color:var(--color-accent-text)]">{strategyRec.summary.replace(/^BEST EXIT: /, '')}</span>
          </div>
          {recReason && <div className="text-[11.5px] text-[color:var(--color-text-muted)] mt-1">{recReason}</div>}
        </div>
      ) : (
        <div className="text-[12px] text-[color:var(--color-text-dim)] px-1">
          Neither strategy meets HAT's targets at the current price.
        </div>
      )}

      {/* 6D/6E — Margin of Safety + Path to a Deal (moved from AI & Comps,
          not duplicated — DealAnalysisCard hides these via
          hideDecisionSummary when mounted in AI & Comps). */}
      <FlipMarginOfSafety lead={lead} flipResult={flip} />
      <FlipRealityCheck lead={lead} />
      {readiness.brrrrReady ? (
        <BrrrrRealityCheck lead={lead} />
      ) : (
        <div className="text-[11px] text-[color:var(--color-text-dim)] px-1">Add a Rent Estimate below to see the Path to a BRRRR Deal.</div>
      )}
    </div>
  )
}
