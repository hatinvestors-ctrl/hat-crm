import { useState } from 'react'
import Button from '../ui/Button'
import { useLeadUpdate } from '../../hooks/useLeadUpdate'
import { PLAYBOOKS } from './ActionZone'

// Compact Triage Decision Bar V1 — presentation/placement only. Reuses
// PLAYBOOKS.triage (ActionZone.jsx) and useLeadUpdate verbatim, so the
// three actions (Promote to New Lead / Not In Buy Box / Dismiss) write the
// exact same status patch, through the exact same hook (activity logging,
// notifications, decision_v2 recalc), as before. No new workflow states,
// no status renaming, no scoring/Buy Box/opportunity logic touched.
//
// This answers ONE question only: "should this auto-imported lead enter
// the active pipeline?" — it is not a Next Best Action / coaching surface
// and must never be extended into one (ACT NOW and the Off-Market
// Opportunity Next Action remain the sole owners of "what should the rep
// do next").
export default function TriageDecisionBar({ lead, userId, members, canEdit, onUpdated }) {
  const update = useLeadUpdate(lead, userId, members, onUpdated)
  const [saving, setSaving] = useState(false)

  // Same visibility condition ActionZone used implicitly via
  // PLAYBOOKS[lead.status] — only the auto-imported triage gate. Once the
  // lead is promoted/rejected/dismissed, lead.status moves away from
  // 'triage' and this bar stops rendering automatically (no separate
  // "dismissed" flag to track).
  if (!canEdit || lead.status !== 'triage') return null

  const { hint, actions } = PLAYBOOKS.triage

  const runAction = async (action) => {
    setSaving(true)
    try { await update(action.patch) } finally { setSaving(false) }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-4 py-2.5">
      <div className="flex flex-col min-w-0">
        <span className="text-[10px] uppercase tracking-widest font-bold text-[color:var(--color-text-dim)]">
          Triage Decision
        </span>
        <span className="text-[12.5px] text-[color:var(--color-text-muted)] leading-snug truncate">
          {hint}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 ml-auto">
        {actions.map((action, idx) => (
          <Button
            key={idx}
            variant={action.label === 'Promote to New Lead' ? 'primary' : action.label === 'Dismiss' ? 'ghost' : 'secondary'}
            size="sm"
            className={action.label === 'Dismiss' ? 'text-[color:var(--color-danger)] hover:text-[color:var(--color-danger)]' : ''}
            onClick={() => runAction(action)}
            loading={saving}
          >
            <span>{action.emoji}</span>
            <span>{action.label}</span>
          </Button>
        ))}
      </div>
    </div>
  )
}
