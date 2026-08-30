// src/components/settings/UnderwritingSettingsForm.jsx
// Underwriting Configuration V1 — Settings → Underwriting. Follows the
// same dirty-state/Save/Discard/reset pattern already established by
// ActionTriggersForm.jsx (workspaces.settings JSONB, no migration).
import { useState } from 'react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import { supabase } from '../../lib/supabase'
import { DEFAULT_UNDERWRITING_SETTINGS, UNDERWRITING_FIELDS, resolveUnderwritingSettings } from '../../lib/underwritingSettings'

const CATEGORY_LABEL = { shared: 'Shared / Acquisition', flip: 'Flip Defaults', brrrr: 'BRRRR Defaults' }
const CATEGORY_HELP = {
  shared: 'Used for both Flip and BRRRR underwriting — hard-money financing terms, taxes, insurance, and holding period.',
  flip: 'Assumptions specific to a Flip exit.',
  brrrr: 'Assumptions specific to a Buy-Rehab-Rent-Refinance-Repeat exit.',
}

function displayValue(field, value) {
  if (field.type === 'currency') return String(Math.round(value))
  return String(value)
}
function parseValue(field, raw) {
  const n = parseFloat(raw)
  if (!Number.isFinite(n)) return null
  if (n < field.min) return field.min
  if (field.max != null && n > field.max) return field.max
  return n
}

export default function UnderwritingSettingsForm({ workspace, canEdit, onUpdated }) {
  const [values, setValues] = useState(() => resolveUnderwritingSettings(workspace.settings))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [confirmResetAll, setConfirmResetAll] = useState(false)

  const setField = (key, raw) => {
    const field = UNDERWRITING_FIELDS.find(f => f.key === key)
    const parsed = parseValue(field, raw)
    if (parsed == null) return
    setValues(prev => ({ ...prev, [key]: parsed }))
    setDirty(true); setSaved(false)
  }
  const resetField = (key) => {
    setValues(prev => ({ ...prev, [key]: DEFAULT_UNDERWRITING_SETTINGS[key] }))
    setDirty(true); setSaved(false)
  }
  const discard = () => {
    setValues(resolveUnderwritingSettings(workspace.settings))
    setDirty(false); setSaved(false)
  }
  const resetAllToSystemDefaults = () => {
    setValues({ ...DEFAULT_UNDERWRITING_SETTINGS })
    setDirty(true); setSaved(false); setConfirmResetAll(false)
  }

  const save = async () => {
    setSaving(true); setError(null); setSaved(false)
    // Underwriting Configuration V1, Part 13 — lightweight traceability,
    // no separate audit-history table (frozen deal_analysis.inputs
    // already provides per-analysis history, see delivery report).
    const { data: { user } } = await supabase.auth.getUser()
    const nextSettings = {
      ...(workspace.settings || {}),
      underwriting: { ...values, updated_at: new Date().toISOString(), updated_by: user?.id || null },
    }
    const { data, error: e } = await supabase
      .from('workspaces')
      .update({ settings: nextSettings })
      .eq('id', workspace.id)
      .select()
      .single()
    setSaving(false)
    if (e) {
      setError(e.message)
    } else {
      setSaved(true); setDirty(false)
      onUpdated?.(data)
    }
  }

  const categories = ['shared', 'flip', 'brrrr']

  return (
    <Card
      title="Underwriting"
      action={canEdit && dirty && (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={discard}>Discard</Button>
          <Button size="sm" onClick={save} loading={saving}>Save changes</Button>
        </div>
      )}
    >
      <p className="text-[12.5px] text-[color:var(--color-text-muted)] leading-relaxed mb-4">
        These are the underwriting assumptions HAT's Flip and BRRRR calculations use for every deal in this
        workspace unless a specific property overrides them. Changing a default here updates the live Deal Page
        numbers for every lead immediately — any previously-generated AI analysis is marked <em>stale</em> rather
        than silently regenerated, so nothing is ever shown as "up to date" against outdated assumptions.
      </p>

      {error && <div className="p-2 bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] text-[12px] rounded mb-3">{error}</div>}
      {saved && <div className="p-2 bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)] text-[12px] rounded mb-3">Underwriting defaults saved.</div>}

      {categories.map(cat => (
        <div key={cat} className="mb-5">
          <div className="text-[11px] uppercase tracking-wider font-bold text-[color:var(--color-text-dim)] mb-0.5">{CATEGORY_LABEL[cat]}</div>
          <div className="text-[11px] text-[color:var(--color-text-dim)] mb-2">{CATEGORY_HELP[cat]}</div>
          <div className="border border-[color:var(--color-line)] rounded-md overflow-hidden">
            {UNDERWRITING_FIELDS.filter(f => f.category === cat).map((field, idx) => {
              const value = values[field.key]
              const isDefault = value === DEFAULT_UNDERWRITING_SETTINGS[field.key]
              return (
                <div key={field.key} className={`flex items-center gap-3 px-3 py-2.5 ${idx > 0 ? 'border-t border-[color:var(--color-line)]' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-[color:var(--color-text)]">{field.label}</div>
                    {field.key === 'default_holding_months' && <div className="text-[10.5px] text-[color:var(--color-text-dim)]">Used when a lead has no holding period of its own.</div>}
                    {field.key === 'monthly_taxes' && <div className="text-[10.5px] text-[color:var(--color-text-dim)]">${Math.round(value * 12).toLocaleString()}/year</div>}
                    {field.key === 'monthly_insurance' && <div className="text-[10.5px] text-[color:var(--color-text-dim)]">${Math.round(value * 12).toLocaleString()}/year</div>}
                    {field.key === 'hml_interest_monthly_pct' && <div className="text-[10.5px] text-[color:var(--color-text-dim)]">{(value * 12).toFixed(1)}% annual</div>}
                    {field.key === 'flip_selling_cost_pct' && <div className="text-[10.5px] text-[color:var(--color-text-dim)]">Bundled disposition assumption (realtor commission, title, closing) — not broken into components.</div>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {field.type === 'currency' && <span className="text-[12px] text-[color:var(--color-text-dim)]">$</span>}
                    <input
                      type="number"
                      value={displayValue(field, value)}
                      disabled={!canEdit}
                      min={field.min}
                      max={field.max ?? undefined}
                      step={field.type === 'percentage' ? 0.1 : 1}
                      onChange={(e) => setField(field.key, e.target.value)}
                      className="h-7 w-20 px-2 text-[12.5px] text-right tabular-nums rounded-md bg-[color:var(--color-bg-input)] border border-[color:var(--color-line)] text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)] disabled:opacity-50"
                    />
                    <span className="text-[11px] text-[color:var(--color-text-muted)] w-16">{field.unit}</span>
                    {!isDefault && canEdit && (
                      <button
                        type="button"
                        onClick={() => resetField(field.key)}
                        title={`Reset to system default (${DEFAULT_UNDERWRITING_SETTINGS[field.key]}${field.unit})`}
                        className="text-[10px] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text-muted)] underline"
                      >
                        reset
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* Part 7 — rental expense assumptions the current BRRRR cash-flow
          formula does not deduct. Read-only, transparent, never editable
          — an editable input with no formula effect would be dishonest. */}
      <div className="mb-5">
        <div className="text-[11px] uppercase tracking-wider font-bold text-[color:var(--color-text-dim)] mb-0.5">Rental Expense Assumptions</div>
        <div className="border border-[color:var(--color-line)] rounded-md overflow-hidden">
          {['Property Management', 'Vacancy Reserve', 'Maintenance / CapEx'].map((label, idx) => (
            <div key={label} className={`flex items-center justify-between px-3 py-2.5 ${idx > 0 ? 'border-t border-[color:var(--color-line)]' : ''}`}>
              <span className="text-[13px] font-medium text-[color:var(--color-text)]">{label}</span>
              <span className="text-[11.5px] text-[color:var(--color-text-dim)]">Not currently included</span>
            </div>
          ))}
        </div>
        <div className="text-[10.5px] text-[color:var(--color-text-dim)] mt-1">
          These expenses are not currently deducted from BRRRR cash flow. Activating them is a separate, future business decision.
        </div>
      </div>

      <div className="pt-3 border-t border-[color:var(--color-line)] flex items-center justify-between">
        <div className="text-[10.5px] text-[color:var(--color-text-dim)]">
          {workspace.settings?.underwriting?.updated_at
            ? `Last changed ${new Date(workspace.settings.underwriting.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
            : 'Using system defaults — never customized.'}
        </div>
        {canEdit && (
          confirmResetAll ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[color:var(--color-warn-text)]">Reset every value above?</span>
              <Button size="sm" variant="danger" onClick={resetAllToSystemDefaults}>Confirm Reset</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmResetAll(false)}>Cancel</Button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmResetAll(true)} className="text-[11px] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text-muted)] underline">
              Reset to Current System Defaults
            </button>
          )
        )}
      </div>
    </Card>
  )
}
