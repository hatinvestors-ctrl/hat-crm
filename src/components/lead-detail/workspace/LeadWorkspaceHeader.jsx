// src/components/lead-detail/workspace/LeadWorkspaceHeader.jsx
// Lead Workspace redesign, Phase 2, Section 4 — sticky orientation strip.
//
// SAME ENGINE, NEW HOME: every value here is read from lead.decision_v2,
// the existing classifyLeadV2()/getActionReason() (Capability #17/#17.1),
// getDecisionMaturity()/getArvProvenance() (#16.1), and the SAME canonical
// calculateFlipMAO/calculateBrrrrMAO FinancialSection/DealAnalysisCard
// already use — nothing here recomputes a number, this only arranges
// already-computed facts into a compact, always-visible strip.
import { classifyLeadV2 } from '../../../pages/ActionCenterPage'
import { getActionReason } from '../../../lib/actionReason'
import { getDecisionMaturity } from '../../../lib/arvProvenance'
import { calculateFlipMAO, calculateBrrrrMAO, formatCurrency } from '../../../lib/calculations'
import { getMarketType } from '../../../lib/sellerStrategy'
import { STATUS_MAP } from '../../../lib/constants'

const REC_THEME = {
  ACT_NOW:      { border: 'var(--color-danger)',  text: 'var(--color-danger-text)',  bg: 'var(--color-danger-soft)' },
  REVIEW_TODAY: { border: 'var(--color-warn)',     text: 'var(--color-warn-text)',    bg: 'var(--color-warn-soft)' },
  RESEARCH:     { border: 'var(--color-line)',     text: 'var(--color-text)',         bg: 'var(--color-bg-elev-2)' },
  FOLLOW_UP:    { border: 'var(--color-accent)',   text: 'var(--color-accent-text)',  bg: 'var(--color-accent-soft)' },
  MONITOR:      { border: 'var(--color-line)',     text: 'var(--color-text-dim)',     bg: 'var(--color-bg-elev-2)' },
  PASS:         { border: 'var(--color-line)',     text: 'var(--color-text-dim)',     bg: 'var(--color-bg-elev-2)' },
}

function Chip({ label, value, tone }) {
  if (value == null || value === '') return null
  return (
    <div className="flex items-baseline gap-1 shrink-0">
      <span className="text-[8.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{label}</span>
      <span className="text-[11.5px] font-bold tabular-nums" style={tone ? { color: tone } : undefined}>{value}</span>
    </div>
  )
}

export default function LeadWorkspaceHeader({ lead, dealStrategy, onLogOutcome, onOpenLiveCopilot, onScheduleFollowUp }) {
  const d = lead.decision_v2
  const theme = d ? (REC_THEME[d.recommendation] || REC_THEME.MONITOR) : REC_THEME.MONITOR
  const marketType = getMarketType(lead)
  const isOffMarket = marketType === 'OFF_MARKET'

  // Same classification the Action Center itself uses (Capability #17.1) —
  // never a second "is this worth pursuing" opinion.
  const classified = d ? classifyLeadV2(lead) : null
  const actionReason = classified ? getActionReason(lead, classified) : null
  const maturity = !lead.is_distressed ? getDecisionMaturity(lead) : null

  // Strategy-appropriate canonical MAO — identical read Financials/Deal
  // Analysis already perform; no new formula.
  const isBrrrr = dealStrategy === 'brrrr'
  let mao = null
  if (lead.arv != null && lead.renovation_cost != null) {
    mao = isBrrrr
      ? (calculateBrrrrMAO(lead.arv, lead.renovation_cost, lead.rent_estimate, lead.hold_months || 6)?.mao ?? null)
      : calculateFlipMAO(lead.arv, lead.renovation_cost, lead.hold_months || 6)
  }

  return (
    <div
      className="sticky top-0 z-30 -mx-6 px-6 py-2.5 border-b backdrop-blur-sm"
      style={{ borderColor: theme.border, background: `color-mix(in srgb, ${theme.bg} 85%, var(--color-bg))` }}
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Identity + decision signals — dominant */}
        <div className="min-w-0 flex items-center gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-extrabold text-[color:var(--color-text)] truncate max-w-[280px]">{lead.address}</span>
              <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0"
                style={{ background: isOffMarket ? 'rgba(217,119,6,0.15)' : 'var(--color-accent-soft)', color: isOffMarket ? 'rgb(180,95,6)' : 'var(--color-accent-text)' }}>
                {isOffMarket ? 'OFF-MARKET' : 'ON-MARKET'}
              </span>
              <span className="text-[9px] font-semibold uppercase tracking-wide text-[color:var(--color-text-dim)] shrink-0">
                {STATUS_MAP?.[lead.status]?.label || lead.status?.replace(/_/g, ' ')}
              </span>
            </div>
            {actionReason && (
              <div className="text-[11px] mt-0.5 truncate max-w-[520px]" style={{ color: theme.text }}>
                <span className="font-bold">{d.recommendation?.replace(/_/g, ' ')}: </span>{actionReason.reason}
              </div>
            )}
          </div>

          {d && (
            <div className="flex items-center gap-3 pl-3 border-l border-[color:var(--color-line)] flex-wrap">
              <Chip label="Opp" value={d.opportunity?.score} />
              <Chip label="Conf" value={d.confidence?.score} />
              <Chip label="Urg" value={d.urgency?.level} />
              {maturity && (
                <span className="text-[8.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                  style={{ background: maturity === 'PRELIMINARY' ? 'var(--color-warn-soft)' : 'var(--color-success-soft)', color: maturity === 'PRELIMINARY' ? 'var(--color-warn-text)' : 'var(--color-success-text)' }}>
                  {maturity === 'PRELIMINARY' ? '🟡 PRELIM' : '🟢 REFINED'}
                </span>
              )}
              {mao != null && (
                <Chip label={isBrrrr ? 'BRRRR MAO' : 'Flip MAO'} value={formatCurrency(Math.round(mao / 100) * 100)} />
              )}
            </div>
          )}
        </div>

        {/* Quick actions — restrained, no new business logic */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isOffMarket && (
            <button type="button" onClick={onOpenLiveCopilot}
              className="text-[11px] font-bold px-2.5 py-1.5 rounded-md text-white" style={{ background: 'var(--color-danger)' }}>
              🎙 Live Copilot
            </button>
          )}
          <button type="button" onClick={onScheduleFollowUp}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]">
            Schedule Follow-Up
          </button>
          <button type="button" onClick={onLogOutcome}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]">
            Log Outcome
          </button>
        </div>
      </div>
    </div>
  )
}
