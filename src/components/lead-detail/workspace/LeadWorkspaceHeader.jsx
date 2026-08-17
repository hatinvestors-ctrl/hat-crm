// src/components/lead-detail/workspace/LeadWorkspaceHeader.jsx
// HAT Premium Visual Pass, Part 6 — "Property Context, Not Decision
// Center." Opportunity/Confidence/Urgency/Preliminary/MAO all moved to
// DecisionHero.jsx (Overview's own dominant decision surface) — this
// sticky strip now answers ONE question, "what property am I looking
// at," across every tab. SAME ENGINE: reads lead fields + getMarketType()
// directly, no new calculation, nothing recomputed.
import { getMarketType } from '../../../lib/sellerStrategy'
import { STATUS_MAP } from '../../../lib/constants'

export default function LeadWorkspaceHeader({ lead, onLogOutcome, onOpenLiveCopilot }) {
  const marketType = getMarketType(lead)
  const isOffMarket = marketType === 'OFF_MARKET'
  const cityLine = [lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ')
  const bedsBaths = (lead.bedrooms || lead.bathrooms) ? `${lead.bedrooms ?? '—'}/${lead.bathrooms ?? '—'}` : null
  const sqft = lead.sqft ? `${Number(lead.sqft).toLocaleString()} sqft` : null

  return (
    <div className="sticky top-0 z-30 -mx-6 px-6 py-2.5 border-b border-[color:var(--color-line)] bg-[color:var(--color-bg)]/95 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[16px] font-extrabold text-[color:var(--color-text)] truncate max-w-[320px]">{lead.address}</span>
            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0"
              style={{ background: isOffMarket ? 'rgba(217,119,6,0.15)' : 'var(--color-accent-soft)', color: isOffMarket ? 'rgb(180,95,6)' : 'var(--color-accent-text)' }}>
              {isOffMarket ? 'OFF-MARKET' : 'ON-MARKET'}
            </span>
            <span className="text-[9px] font-semibold uppercase tracking-wide text-[color:var(--color-text-dim)]">
              {STATUS_MAP?.[lead.status]?.label || lead.status?.replace(/_/g, ' ')}
            </span>
          </div>
          <div className="text-[11px] text-[color:var(--color-text-dim)] mt-0.5">
            {[cityLine, bedsBaths, sqft].filter(Boolean).join(' · ')}
          </div>
        </div>

        {/* Quick actions — restrained, no new business logic */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isOffMarket && (
            <button type="button" onClick={onOpenLiveCopilot}
              className="text-[11px] font-bold px-2.5 py-1.5 rounded-md text-white" style={{ background: 'var(--color-danger)' }}>
              🎙 Live Copilot
            </button>
          )}
          <button type="button" onClick={onLogOutcome}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]">
            Log Outcome
          </button>
        </div>
      </div>
    </div>
  )
}
