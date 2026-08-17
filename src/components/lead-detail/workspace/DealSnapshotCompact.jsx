// src/components/lead-detail/workspace/DealSnapshotCompact.jsx
// Lead Workspace redesign, Final UX Polish, Sections 4C/5 — Overview's
// compact deal snapshot. DATA-AWARE, not status-dependent: this always
// renders the same way for every lead, adapting only to what data exists
// (never branching on lead.status/'triage'/etc). Uses the SAME
// computeFlipResult/computeBrrrrResult/computeStrategyRecommendation
// (src/lib/dealExplanation.js) the Deal tab and DealAnalysisCard already
// call — no independent calculation.
import { formatCurrency as fc } from '../../../lib/calculations'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../../../lib/dealExplanation'
import { getDealReadiness } from './readiness'

function Cell({ label, value }) {
  return (
    <div className="min-w-0">
      <div className="text-[8.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{label}</div>
      <div className="text-[13px] font-bold truncate">{value}</div>
    </div>
  )
}

export default function DealSnapshotCompact({ lead, onOpenDeal }) {
  const readiness = getDealReadiness(lead)

  // Section 5 — incomplete data: show what's known, what's missing, one
  // next action. Never a wall of "Not available."
  if (!readiness.flipReady) {
    const known = []
    if (lead.asking_price != null) known.push(['Ask', fc(lead.asking_price)])
    if (lead.bedrooms || lead.bathrooms) known.push(['Beds/Baths', `${lead.bedrooms ?? '—'}/${lead.bathrooms ?? '—'}`])
    if (lead.sqft) known.push(['Sqft', Number(lead.sqft).toLocaleString()])
    if (lead.renovation_cost != null) known.push(['Rehab', fc(lead.renovation_cost)])
    if (known.length === 0 && readiness.missing.length === 0) return null

    return (
      <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9.5px] uppercase tracking-widest font-bold text-[color:var(--color-text-dim)]">Deal Snapshot</span>
          <button type="button" onClick={onOpenDeal} className="text-[10.5px] font-semibold underline text-[color:var(--color-accent-text)]">Open Deal →</button>
        </div>
        {known.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 mb-2">
            {known.map(([label, value]) => <Cell key={label} label={label} value={value} />)}
          </div>
        )}
        <div className="text-[11.5px] text-[color:var(--color-warn-text)]">
          Needs {readiness.missing.map(m => m.label).join(' + ')}
        </div>
      </div>
    )
  }

  const flip = computeFlipResult(lead)
  const brrrr = computeBrrrrResult(lead)
  const strategyRec = computeStrategyRecommendation(flip, brrrr)
  const preferBrrrr = strategyRec.preferredStrategy === 'BRRRR'

  return (
    <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9.5px] uppercase tracking-widest font-bold text-[color:var(--color-text-dim)]">Deal Snapshot</span>
        <button type="button" onClick={onOpenDeal} className="text-[10.5px] font-semibold underline text-[color:var(--color-accent-text)]">Open Deal →</button>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
        <Cell label="Ask" value={lead.asking_price != null ? fc(lead.asking_price) : 'Not set'} />
        <Cell label="ARV" value={fc(lead.arv)} />
        <Cell label="Current Offer" value={flip.currentOffer != null ? fc(flip.currentOffer) : 'Not set'} />
        <Cell label={preferBrrrr ? 'Max Buy (BRRRR)' : 'Max Buy (Flip)'}
          value={preferBrrrr ? (brrrr.available ? fc(Math.round(brrrr.mao / 100) * 100) : 'Needs rent') : fc(Math.round(flip.mao / 100) * 100)} />
        <Cell label={preferBrrrr ? 'Cash Flow' : 'Profit'}
          value={preferBrrrr ? (brrrr.available && brrrr.monthlyCashFlow != null ? `${fc(brrrr.monthlyCashFlow)}/mo` : 'Needs rent') : fc(flip.projectedProfit)} />
        <Cell label="Strategy" value={strategyRec.preferredStrategy !== 'NONE' ? strategyRec.preferredStrategy.replace('BOTH', 'Flip + BRRRR') : 'Not ready'} />
      </div>
    </div>
  )
}
