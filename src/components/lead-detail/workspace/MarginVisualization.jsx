// src/components/lead-detail/workspace/MarginVisualization.jsx
// HAT Premium Visual Pass, Part 12 — a restrained horizontal visualization
// of Current Offer's position relative to Flip MAO. Pure CSS/layout, no
// chart library, no new thresholds: the bar's fill % is simply
// currentOffer / mao (clamped for display only when over 100%) — the same
// two canonical numbers (computeFlipResult's currentOffer/mao) Deal
// Economics Hero and Margin of Safety already show as text. This is only
// a second, faster-to-read PRESENTATION of the identical relationship.
import { formatCurrency as fc } from '../../../lib/calculations'

export default function MarginVisualization({ currentOffer, mao }) {
  if (currentOffer == null || mao == null || mao <= 0) return null
  const pct = currentOffer / mao
  const overMax = pct > 1
  const fillPct = Math.min(pct, 1) * 100
  const cushion = mao - currentOffer
  const color = overMax ? 'var(--color-danger)' : pct > 0.97 ? 'var(--color-warn)' : 'var(--color-success)'

  return (
    <div className="px-1">
      <div className="relative h-2 rounded-full bg-[color:var(--color-bg-elev-2)] overflow-visible">
        <div className="h-full rounded-full transition-all" style={{ width: `${fillPct}%`, background: color }} />
        {/* MAO ceiling marker */}
        <div className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 bg-[color:var(--color-text-dim)]" style={{ left: overMax ? '100%' : `${fillPct}%` }} />
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-[color:var(--color-text-dim)]">Offer {fc(currentOffer)}</span>
        <span className="text-[10px] font-semibold" style={{ color }}>
          {overMax ? `${fc(Math.abs(cushion))} over Max Buy` : `${fc(cushion)} room from our offer to Max Buy`}
        </span>
        <span className="text-[10px] text-[color:var(--color-text-dim)]">Max {fc(mao)}</span>
      </div>
    </div>
  )
}
