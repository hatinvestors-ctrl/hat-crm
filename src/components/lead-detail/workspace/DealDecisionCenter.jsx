// src/components/lead-detail/workspace/DealDecisionCenter.jsx
// HAT Premium Visual Pass, Part 11-15 — "Does this deal work and what can
// we pay?" Progressive disclosure, four levels:
//   L1 DECISION — Deal Economics Hero (Strategy/Profit/MAO/Room) + Margin Visualization
//   L2 CONTEXT  — Ask/Offer/ARV/Reno (secondary line inside the hero)
//   L3 SAFETY   — Best Fit, Margin of Safety, Path to a Deal
//   L4 DETAIL   — Property & Assumptions (rendered by the caller, below this)
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
import MarginVisualization from './MarginVisualization'

function Metric({ label, value, tone }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{label}</div>
      <div className="text-[19px] font-extrabold tabular-nums truncate" style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  )
}

const VERDICT_TONE = {
  STRONG: 'var(--color-success-text)', PASS: 'var(--color-success-text)',
  WATCH: 'var(--color-warn-text)', 'NO DEAL': 'var(--color-danger-text)',
}

export default function DealDecisionCenter({ lead, onRunAnalysis }) {
  const readiness = getDealReadiness(lead)

  // L1 fallback — one consolidated readiness block instead of the
  // decision hero / strategy comparison / margin / path each separately
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
              {lead.asking_price != null && <Metric label="Ask" value={fc(lead.asking_price)} />}
              {(lead.bedrooms || lead.bathrooms) && <Metric label="Beds / Baths" value={`${lead.bedrooms ?? '—'} / ${lead.bathrooms ?? '—'}`} />}
              {lead.sqft != null && <Metric label="Sqft" value={Number(lead.sqft).toLocaleString()} />}
              {lead.renovation_cost != null && <Metric label="Rehab" value={fc(lead.renovation_cost)} />}
            </div>
          </div>
        )}
      </div>
    )
  }

  const flip = computeFlipResult(lead)
  const brrrr = computeBrrrrResult(lead)
  const strategyRec = computeStrategyRecommendation(flip, brrrr)
  const preferBrrrr = strategyRec.preferredStrategy === 'BRRRR' && brrrr.available
  const hero = preferBrrrr ? brrrr : flip

  let recReason = strategyRec.reason
  if (!recReason && strategyRec.preferredStrategy === 'BRRRR' && brrrr.available) {
    recReason = `Leaves about ${fc(brrrr.cashLeftIn)} in the deal${brrrr.monthlyCashFlow > 0 ? ` and stays cash-flow positive at ${fc(brrrr.monthlyCashFlow)}/mo` : ''}.`
  } else if (!recReason && strategyRec.preferredStrategy === 'FLIP' && flip.available) {
    recReason = `Projects ${fc(flip.projectedProfit)} profit at the current offer, ${flip.marginOfSafety?.title?.toLowerCase() || ''}.`
  }

  return (
    <div className="space-y-4">
      {/* L1 — Deal Economics Hero. Facts (money) dominate; judgment (tier
          badge) is the one place semantic color leads (Part 5/9). */}
      <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-2 border-b border-[color:var(--color-line)]">
          <span className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--color-text-dim)]">{preferBrrrr ? 'BRRRR' : 'Flip'}</span>
          <span className="text-[12px] font-extrabold" style={{ color: VERDICT_TONE[hero.verdict] }}>{VERDICT_DISPLAY_LABEL[hero.verdict]}</span>
        </div>
        <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric label="We Offer" value={flip.currentOffer != null ? fc(flip.currentOffer) : 'Not set'} />
          <Metric label="Max Buy" value={fc(Math.round(flip.mao / 100) * 100)} tone="var(--color-accent-text)" />
          <Metric label="Room" value={flip.marginOfSafety?.priceCushion != null ? `${flip.marginOfSafety.priceCushion < 0 ? '−' : '+'}${fc(Math.round(Math.abs(flip.marginOfSafety.priceCushion)))}` : '—'} tone={flip.marginOfSafety?.priceCushion >= 0 ? undefined : 'var(--color-danger-text)'} />
          <Metric label="Projected Profit" value={fc(flip.projectedProfit)} tone={flip.projectedProfit >= 30000 ? 'var(--color-success-text)' : 'var(--color-danger-text)'} />
        </div>
        {flip.marginOfSafety?.why && (
          <div className="px-4 pb-3 text-[12px] text-[color:var(--color-text-muted)]">{flip.marginOfSafety.why}</div>
        )}
        {/* Part 12 — margin visualization */}
        <div className="px-4 pb-3">
          <MarginVisualization currentOffer={flip.currentOffer} mao={flip.mao} />
        </div>
        {/* L2 — context, secondary line */}
        <div className="px-4 py-2 border-t border-[color:var(--color-line)] text-[11px] text-[color:var(--color-text-dim)]">
          Seller asks {lead.asking_price != null ? fc(lead.asking_price) : '—'} · ARV {fc(lead.arv)} · Reno {fc(lead.renovation_cost)}
          {lead.starting_offer != null && <> · Starting offer {fc(lead.starting_offer)}</>}
        </div>
      </div>

      {/* BRRRR — Part 14: never given equal visual weight to an
          unavailable analysis. Compact one-liner when not ready; a real
          comparison row only once it is. */}
      {!preferBrrrr && (
        brrrr.available ? (
          <div className="rounded-lg border border-[color:var(--color-line)] px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[color:var(--color-text-dim)]">BRRRR</span>
            <span className="text-[11.5px]" style={{ color: VERDICT_TONE[brrrr.verdict] }}>{VERDICT_DISPLAY_LABEL[brrrr.verdict]}</span>
            <span className="text-[11.5px] text-[color:var(--color-text)]">Cash left in {fc(brrrr.cashLeftIn)}</span>
            <span className="text-[11.5px] text-[color:var(--color-text)]">{brrrr.monthlyCashFlow != null ? `${fc(brrrr.monthlyCashFlow)}/mo` : '—'}</span>
          </div>
        ) : (
          <div className="text-[11px] text-[color:var(--color-text-dim)] px-1">BRRRR — Rent estimate needed to evaluate.</div>
        )
      )}

      {/* L3 — Best Fit: restrained accent, not a giant blue box (Part 15). */}
      {strategyRec.preferredStrategy !== 'NONE' ? (
        <div className="flex items-center gap-2 px-1 border-l-2 pl-3" style={{ borderLeftColor: 'var(--color-accent)' }}>
          <span className="text-[9px] uppercase tracking-wider font-bold text-[color:var(--color-text-dim)]">Best Fit</span>
          <span className="text-[12.5px] font-bold text-[color:var(--color-accent-text)]">{strategyRec.summary.replace(/^BEST EXIT: /, '')}</span>
          {recReason && <span className="text-[11px] text-[color:var(--color-text-dim)]">— {recReason}</span>}
        </div>
      ) : (
        <div className="text-[12px] text-[color:var(--color-text-dim)] px-1">
          Neither strategy meets HAT's targets at the current price.
        </div>
      )}

      {/* L3 — Margin of Safety detail + Path to a Deal (moved from AI &
          Comps, not duplicated — DealAnalysisCard hides these via
          hideDecisionSummary when mounted in AI & Comps). */}
      <FlipMarginOfSafety lead={lead} flipResult={flip} />
      <FlipRealityCheck lead={lead} flipResult={flip} />
      {readiness.brrrrReady && <BrrrrRealityCheck lead={lead} />}
    </div>
  )
}
