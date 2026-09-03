// src/components/lead-detail/workspace/DealSnapshotCompact.jsx
// Lead Workspace redesign, Final UX Polish, Sections 4C/5 — Overview's
// compact deal snapshot. DATA-AWARE, not status-dependent: this always
// renders the same way for every lead, adapting only to what data exists
// (never branching on lead.status/'triage'/etc).
//
// UX V2.5, Part 9/10 — this card used to repeat Ask/Suggested Offer/Max
// Buy/Profit/Strategy, all of which DecisionHero (the Overview hero,
// directly above this card) already shows as the primary decision. Worse,
// this component independently called computeFlipResult(lead)/
// computeBrrrrResult(lead) with NO underwritingSettings — a second,
// separate wiring gap from the one already fixed in DecisionHero (V2.4)
// and DealDecisionCenter, capable of showing a THIRD disagreeing Max
// Buy/strategy on the same page. Per the mission's explicit "prefer the
// simpler solution": rather than thread settings through a fourth
// consumer of the same facts, this card no longer recomputes deal
// economics at all — it shows only the property inputs (ARV/Rehab/Rent)
// that don't change based on strategy or settings, plus a link to the
// Deal tab for the full, single-sourced economics. No data lost — full
// Flip/BRRRR/strategy detail remains on the Deal tab, unchanged.
import { formatCurrency as fc } from '../../../lib/calculations'
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

  // UX V2.5, Part 10 — only the raw property inputs that feed the
  // economics (not the economics themselves, which now live solely on
  // DecisionHero + the Deal tab, single-sourced against the real
  // underwritingSettings).
  return (
    <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9.5px] uppercase tracking-widest font-bold text-[color:var(--color-text-dim)]">Deal Snapshot</span>
        <button type="button" onClick={onOpenDeal} className="text-[10.5px] font-semibold underline text-[color:var(--color-accent-text)]">Open Deal Analysis →</button>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <Cell label="ARV" value={fc(lead.arv)} />
        <Cell label="Rehab" value={fc(lead.renovation_cost)} />
        <Cell label="Rent" value={lead.rent_estimate != null ? fc(lead.rent_estimate) : 'Not set'} />
      </div>
    </div>
  )
}
