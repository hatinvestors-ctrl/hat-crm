// src/components/lead-detail/workspace/DealSnapshotCompact.jsx
// Lead Workspace redesign, Phase 2.1, Section 4C — Overview's compact deal
// snapshot. Only the most decision-useful metrics, using the SAME
// computeFlipResult/computeBrrrrResult/computeStrategyRecommendation
// (src/lib/dealExplanation.js) the Deal tab and DealAnalysisCard already
// call — no independent calculation.
import { formatCurrency as fc } from '../../../lib/calculations'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../../../lib/dealExplanation'

function Cell({ label, value }) {
  return (
    <div className="min-w-0">
      <div className="text-[8.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{label}</div>
      <div className="text-[13px] font-bold truncate">{value ?? 'Not available'}</div>
    </div>
  )
}

export default function DealSnapshotCompact({ lead, onOpenDeal }) {
  const flip = computeFlipResult(lead)
  const brrrr = computeBrrrrResult(lead)
  const strategyRec = computeStrategyRecommendation(flip, brrrr)
  const preferBrrrr = strategyRec.preferredStrategy === 'BRRRR'

  if (!flip.available && !brrrr.available && lead.asking_price == null) return null

  return (
    <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9.5px] uppercase tracking-widest font-bold text-[color:var(--color-text-dim)]">Deal Snapshot</span>
        <button type="button" onClick={onOpenDeal} className="text-[10.5px] font-semibold underline text-[color:var(--color-accent-text)]">Open Deal →</button>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
        <Cell label="Ask" value={lead.asking_price != null ? fc(lead.asking_price) : null} />
        <Cell label="ARV" value={lead.arv != null ? fc(lead.arv) : 'Needs analysis'} />
        <Cell label="Current Offer" value={flip.available && flip.currentOffer != null ? fc(flip.currentOffer) : null} />
        <Cell label={preferBrrrr ? 'BRRRR MAO' : 'Flip MAO'}
          value={preferBrrrr ? (brrrr.available ? fc(Math.round(brrrr.mao / 100) * 100) : null) : (flip.available ? fc(Math.round(flip.mao / 100) * 100) : null)} />
        <Cell label={preferBrrrr ? 'Cash Flow' : 'Expected Profit'}
          value={preferBrrrr ? (brrrr.available && brrrr.monthlyCashFlow != null ? `${fc(brrrr.monthlyCashFlow)}/mo` : null) : (flip.available ? fc(flip.projectedProfit) : null)} />
        <Cell label="Strategy" value={strategyRec.preferredStrategy !== 'NONE' ? strategyRec.preferredStrategy.replace('BOTH', 'Flip + BRRRR') : 'Not ready'} />
      </div>
    </div>
  )
}
