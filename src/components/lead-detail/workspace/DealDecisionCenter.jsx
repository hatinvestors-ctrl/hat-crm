// src/components/lead-detail/workspace/DealDecisionCenter.jsx
// Lead Workspace redesign, Phase 2.1, Section 6 — "Does this deal work and
// what can we pay?" ANSWER FIRST, inputs second, details last.
//
// Every number here comes from the SAME canonical functions DealAnalysisCard
// and FinancialSection already call (computeFlipResult/computeBrrrrResult/
// computeStrategyRecommendation — src/lib/dealExplanation.js). This file
// formats and arranges those results; it never recomputes a formula.
import { formatCurrency as fc } from '../../../lib/calculations'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../../../lib/dealExplanation'
import { FlipMarginOfSafety, FlipRealityCheck, BrrrrRealityCheck } from '../DealAnalysisCard'

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
const VERDICT_LABEL = { STRONG: 'STRONG', PASS: 'SOLID', WATCH: 'WATCH', 'NO DEAL': 'NO DEAL' }

export default function DealDecisionCenter({ lead }) {
  const flip = computeFlipResult(lead)
  const brrrr = computeBrrrrResult(lead)
  const strategyRec = computeStrategyRecommendation(flip, brrrr)

  // Section 6A — decision strip. Only ever labels concepts that actually
  // exist in the system: Asking Price (raw field), Starting Offer (raw
  // stored value, distinct from the live-computed "current offer"),
  // Current Offer (getEffectiveOffer's result — what flip/brrrr math is
  // actually evaluated at), and canonical Flip MAO. No invented "target"
  // price.
  const ask = lead.asking_price != null ? Number(lead.asking_price) : null
  const startingOffer = lead.starting_offer != null ? Number(lead.starting_offer) : null

  // Section 6C — recommendation reason, built from numbers the SAME
  // computeFlipResult/computeBrrrrResult calls already produced (never a
  // new calculation) — mirrors the mission's own example phrasing.
  let recReason = strategyRec.reason
  if (!recReason && strategyRec.preferredStrategy === 'BRRRR' && brrrr.available) {
    recReason = `Leaves about ${fc(brrrr.cashLeftIn)} in the deal${brrrr.monthlyCashFlow > 0 ? ` and stays cash-flow positive at ${fc(brrrr.monthlyCashFlow)}/mo` : ''}.`
  } else if (!recReason && strategyRec.preferredStrategy === 'FLIP' && flip.available) {
    recReason = `Projects ${fc(flip.projectedProfit)} profit at the current offer, ${flip.marginOfSafety?.title?.toLowerCase() || ''}.`
  }

  return (
    <div className="space-y-4">
      {/* 6A — Decision strip */}
      {(ask != null || startingOffer != null || flip.available) && (
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-4 py-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Asking Price" value={ask != null ? fc(ask) : 'Not available'} />
            <Stat label="Starting Offer" value={startingOffer != null ? fc(startingOffer) : 'Not set'} />
            <Stat label="Current Offer" value={flip.available && flip.currentOffer != null ? fc(flip.currentOffer) : 'Not available'} />
            <Stat label="Flip MAO (Max)" value={flip.available && flip.mao != null ? fc(Math.round(flip.mao / 100) * 100) : 'Not available'} tone="var(--color-accent-text)" />
          </div>
        </div>
      )}

      {/* 6B/6C — Strategy comparison + recommendation */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-[color:var(--color-line)] px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wider font-bold text-[color:var(--color-text-dim)]">Flip</span>
            {flip.available && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: VERDICT_TONE[flip.verdict], background: 'var(--color-bg-elev-2)' }}>
                {VERDICT_LABEL[flip.verdict]}
              </span>
            )}
          </div>
          {flip.available ? (
            <div className="grid grid-cols-2 gap-2.5">
              <Stat label="Flip MAO" value={fc(Math.round(flip.mao / 100) * 100)} />
              <Stat label="Profit" value={fc(flip.projectedProfit)} tone={flip.projectedProfit >= 30000 ? 'var(--color-success-text)' : 'var(--color-danger-text)'} />
            </div>
          ) : (
            <div className="text-[12px] text-[color:var(--color-text-dim)]">{flip.reason}</div>
          )}
        </div>
        <div className="rounded-lg border border-[color:var(--color-line)] px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wider font-bold text-[color:var(--color-text-dim)]">BRRRR</span>
            {brrrr.available && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: VERDICT_TONE[brrrr.verdict], background: 'var(--color-bg-elev-2)' }}>
                {VERDICT_LABEL[brrrr.verdict]}
              </span>
            )}
          </div>
          {brrrr.available ? (
            <div className="grid grid-cols-2 gap-2.5">
              <Stat label="Cash Left In" value={fc(brrrr.cashLeftIn)} tone={brrrr.cashLeftIn < 30000 ? 'var(--color-success-text)' : 'var(--color-warn-text)'} />
              <Stat label="Cash Flow" value={brrrr.monthlyCashFlow != null ? `${fc(brrrr.monthlyCashFlow)}/mo` : 'Not available'} tone={brrrr.monthlyCashFlow > 0 ? 'var(--color-success-text)' : 'var(--color-danger-text)'} />
            </div>
          ) : (
            <div className="text-[12px] text-[color:var(--color-text-dim)]">
              {brrrr.missingField === 'rent estimate' ? 'Needs Rent Estimate' : brrrr.reason}
            </div>
          )}
        </div>
      </div>

      {strategyRec.preferredStrategy !== 'NONE' && (
        <div className="rounded-lg border px-4 py-2.5" style={{ borderColor: 'var(--color-accent)', background: 'var(--color-accent-soft)' }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] uppercase tracking-wider font-bold text-[color:var(--color-accent-text)]">Best Fit</span>
            <span className="text-[13px] font-extrabold text-[color:var(--color-accent-text)]">{strategyRec.summary}</span>
          </div>
          {recReason && <div className="text-[11.5px] text-[color:var(--color-text-muted)] mt-1">{recReason}</div>}
        </div>
      )}
      {strategyRec.preferredStrategy === 'NONE' && (
        <div className="rounded-lg border border-[color:var(--color-line)] px-4 py-2.5 text-[12px] text-[color:var(--color-text-dim)]">
          Strategy recommendation not ready — {!flip.available ? flip.reason : (!brrrr.available ? brrrr.reason : 'neither strategy currently meets HAT\'s targets at this price.')}
        </div>
      )}

      {/* 6D/6E — Margin of Safety + Path to a Deal (moved from AI & Comps,
          not duplicated — DealAnalysisCard hides these via
          hideDecisionSummary when mounted in AI & Comps). Both
          FlipRealityCheck/BrrrrRealityCheck silently render nothing when
          ARV/reno/rent are missing (Section 10 — meaningful empty state
          instead of a blank gap). */}
      {flip.available && <FlipMarginOfSafety lead={lead} flipResult={flip} />}
      {(!lead.arv || lead.renovation_cost == null) ? (
        <div className="rounded-lg border border-dashed border-[color:var(--color-line)] px-4 py-3 text-[12px] text-[color:var(--color-text-dim)]">
          {!lead.arv ? 'ARV is needed before Flip MAO can be calculated.' : 'Renovation cost is needed before Flip MAO can be calculated.'}
        </div>
      ) : (
        <FlipRealityCheck lead={lead} />
      )}
      {lead.rent_estimate == null && lead.arv && lead.renovation_cost != null ? (
        <div className="rounded-lg border border-dashed border-[color:var(--color-line)] px-4 py-3 text-[12px] text-[color:var(--color-text-dim)]">
          Rent estimate is needed before BRRRR can be evaluated.
        </div>
      ) : (
        <BrrrrRealityCheck lead={lead} />
      )}
    </div>
  )
}
