// src/components/lead-detail/workspace/UnderwritingAssumptionsPanel.jsx
// Underwriting Configuration V1, Part 14 — compact, VIEW-ONLY transparency
// panel on the Deal page. No deal-specific override persistence in this
// V1 (Phase 2, per the mission) — this only shows the EFFECTIVE global
// values currently in use, collapsed by default, matching the established
// "Legacy data"/"Advanced" collapsed-toggle pattern already used elsewhere
// on this page.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { UNDERWRITING_FIELDS, DEFAULT_UNDERWRITING_SETTINGS } from '../../../lib/underwritingSettings'

const CATEGORY_LABEL = { shared: 'Shared', flip: 'Flip', brrrr: 'BRRRR' }

export default function UnderwritingAssumptionsPanel({ underwritingSettings, canEditSettings, workspaceId }) {
  const [open, setOpen] = useState(false)
  const isCustomized = UNDERWRITING_FIELDS.some(f => underwritingSettings[f.key] !== DEFAULT_UNDERWRITING_SETTINGS[f.key])

  const summary = `${isCustomized ? 'Customized' : 'HAT Defaults'} · ${underwritingSettings.default_holding_months} mo · ${underwritingSettings.flip_selling_cost_pct}% selling · ${underwritingSettings.refi_ltv_pct}% refi`

  return (
    <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-[color:var(--color-text-muted)]">
          <span className="uppercase tracking-wider font-bold text-[color:var(--color-text-dim)] mr-1.5">Underwriting Assumptions</span>
          {summary}
        </div>
        <button type="button" onClick={() => setOpen(o => !o)} className="text-[10.5px] font-semibold underline text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text-muted)] shrink-0">
          {open ? 'Hide' : 'View assumptions'}
        </button>
      </div>

      {open && (
        <div className="mt-2.5 pt-2.5 border-t border-[color:var(--color-line)] space-y-3">
          {['shared', 'flip', 'brrrr'].map(cat => (
            <div key={cat}>
              <div className="text-[9.5px] uppercase tracking-wider font-bold text-[color:var(--color-text-dim)] mb-1">{CATEGORY_LABEL[cat]}</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                {UNDERWRITING_FIELDS.filter(f => f.category === cat).map(f => (
                  <div key={f.key} className="flex items-center justify-between text-[11px]">
                    <span className="text-[color:var(--color-text-muted)]">{f.label}</span>
                    <span className="font-semibold tabular-nums text-[color:var(--color-text)]">
                      {f.type === 'currency' ? `$${Math.round(underwritingSettings[f.key]).toLocaleString()}` : underwritingSettings[f.key]}{f.type !== 'currency' ? f.unit.replace(/^\$?\/?/, '') : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[10px] text-[color:var(--color-text-dim)] pt-1">
            These are the workspace's global defaults — this property has no override yet (deal-specific overrides are a future capability).
          </p>
          {canEditSettings && (
            <Link to={`/w/${workspaceId}/settings`} className="text-[10.5px] font-semibold underline text-[color:var(--color-accent-text)]">
              Edit Underwriting Defaults
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
