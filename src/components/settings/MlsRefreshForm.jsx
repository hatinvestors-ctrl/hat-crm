import { useState } from 'react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import { supabase } from '../../lib/supabase'

// Common timezones for the dropdown (extend if needed)
const TIMEZONES = [
  { value: 'Asia/Jerusalem',    label: 'Israel (Asia/Jerusalem)' },
  { value: 'America/New_York',  label: 'US Eastern (New York)' },
  { value: 'America/Chicago',   label: 'US Central (Chicago)' },
  { value: 'America/Denver',    label: 'US Mountain (Denver)' },
  { value: 'America/Los_Angeles', label: 'US Pacific (Los Angeles)' },
  { value: 'UTC',               label: 'UTC' },
]

export default function MlsRefreshForm({ workspace, canEdit, onUpdated }) {
  const initialSettings = workspace?.settings || {}
  const [paused, setPaused] = useState(!!initialSettings.mls_paused)
  const [enabled, setEnabled] = useState(!!initialSettings.mls_sweep_enabled)
  const [hour, setHour] = useState(Number(initialSettings.mls_sweep_hour ?? 5))
  const [timezone, setTimezone] = useState(initialSettings.mls_sweep_timezone || 'Asia/Jerusalem')
  const [maxLeads, setMaxLeads] = useState(Number(initialSettings.mls_sweep_max_leads ?? 100))
  const [autoEnrichImports, setAutoEnrichImports] = useState(initialSettings.mls_auto_enrich_imports !== false) // default ON
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [dirty, setDirty] = useState(false)

  const mark = () => { setDirty(true); setSaved(false) }

  const reset = () => {
    setPaused(!!initialSettings.mls_paused)
    setEnabled(!!initialSettings.mls_sweep_enabled)
    setHour(Number(initialSettings.mls_sweep_hour ?? 5))
    setTimezone(initialSettings.mls_sweep_timezone || 'Asia/Jerusalem')
    setMaxLeads(Number(initialSettings.mls_sweep_max_leads ?? 100))
    setAutoEnrichImports(initialSettings.mls_auto_enrich_imports !== false)
    setDirty(false); setSaved(false)
  }

  const save = async () => {
    setSaving(true); setError(null); setSaved(false)
    const nextSettings = {
      ...(workspace.settings || {}),
      mls_paused: paused,
      mls_sweep_enabled: enabled,
      mls_sweep_hour: Math.max(0, Math.min(23, hour)),
      mls_sweep_timezone: timezone,
      mls_sweep_max_leads: Math.max(1, Math.min(500, maxLeads)),
      mls_auto_enrich_imports: autoEnrichImports,
    }
    const { data, error: e } = await supabase
      .from('workspaces')
      .update({ settings: nextSettings })
      .eq('id', workspace.id)
      .select()
      .single()
    setSaving(false)
    if (e) setError(e.message)
    else { setSaved(true); setDirty(false); onUpdated?.(data) }
  }

  const inputCls = 'h-8 px-2 text-[12.5px] tabular-nums rounded-md bg-[color:var(--color-bg-input)] border border-[color:var(--color-line)] text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)] disabled:opacity-50'

  // Convert hour (0-23) to a friendly label like "5:00 AM"
  const hourLabel = (h) => {
    const ampm = h < 12 ? 'AM' : 'PM'
    const display = h === 0 ? 12 : h <= 12 ? h : h - 12
    return `${display}:00 ${ampm}`
  }

  return (
    <Card
      title="MLS Auto-Refresh"
      action={canEdit && dirty && (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={reset}>Discard</Button>
          <Button size="sm" onClick={save} loading={saving}>Save changes</Button>
        </div>
      )}
    >
      <p className="text-[12.5px] text-[color:var(--color-text-muted)] leading-relaxed mb-4">
        Configure when and how the system automatically pulls fresh MLS status, days-on-market,
        and listing-agent info from RentCast for your leads.
      </p>

      {error && <div className="p-2 bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] text-[12px] rounded mb-3">{error}</div>}
      {saved && <div className="p-2 bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)] text-[12px] rounded mb-3">Saved.</div>}

      {/* Kill switch — pauses ALL RentCast usage at the workspace level */}
      <div className={`mb-4 p-3 rounded-md border-2 ${paused ? 'border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)]' : 'border-[color:var(--color-line)] bg-[color:var(--color-bg)]'}`}>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={paused}
            disabled={!canEdit}
            onChange={(e) => { setPaused(e.target.checked); mark() }}
            className="mt-0.5 accent-[color:var(--color-warn)]"
          />
          <div className="flex-1">
            <div className={`text-[13px] font-semibold ${paused ? 'text-[color:var(--color-warn-text)]' : 'text-[color:var(--color-text)]'}`}>
              ⏸ Pause all RentCast usage
            </div>
            <div className="text-[11.5px] text-[color:var(--color-text-dim)] mt-0.5 leading-relaxed">
              When ON, no RentCast API calls are made anywhere in the app — Enrich buttons,
              Look-up, auto-refresh on lead open, daily sweep, and auto-enrich on import are all suspended.
              Use this if you want to avoid hitting your API quota / extra charges. All other features keep working.
            </div>
          </div>
        </label>
      </div>

      <div className={`space-y-4 ${paused ? 'opacity-40 pointer-events-none' : ''}`}>
        {/* Auto-enrich on import */}
        <div className="flex items-start gap-3 p-3 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded-md">
          <input
            type="checkbox"
            id="auto-enrich-imports"
            checked={autoEnrichImports}
            disabled={!canEdit}
            onChange={(e) => { setAutoEnrichImports(e.target.checked); mark() }}
            className="mt-0.5 accent-[color:var(--color-accent)]"
          />
          <label htmlFor="auto-enrich-imports" className="flex-1 cursor-pointer">
            <div className="text-[13px] font-medium text-[color:var(--color-text)]">Auto-enrich newly-imported leads</div>
            <div className="text-[11.5px] text-[color:var(--color-text-dim)] mt-0.5">
              When the Redfin scanner imports a new lead, immediately pull MLS status, agent contact, and owner info.
              Costs 1–2 RentCast calls per new lead.
            </div>
          </label>
        </div>

        {/* Daily sweep toggle */}
        <div className="flex items-start gap-3 p-3 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded-md">
          <input
            type="checkbox"
            id="mls-sweep-enabled"
            checked={enabled}
            disabled={!canEdit}
            onChange={(e) => { setEnabled(e.target.checked); mark() }}
            className="mt-0.5 accent-[color:var(--color-accent)]"
          />
          <label htmlFor="mls-sweep-enabled" className="flex-1 cursor-pointer">
            <div className="text-[13px] font-medium text-[color:var(--color-text)]">Daily MLS status sweep</div>
            <div className="text-[11.5px] text-[color:var(--color-text-dim)] mt-0.5">
              Once a day, refresh MLS status for every active lead so you catch status changes
              (active → pending → sold) before you start your day.
            </div>
          </label>
        </div>

        {/* Sweep timing controls — disabled when sweep is off */}
        <div className={`grid grid-cols-1 sm:grid-cols-3 gap-3 ${!enabled ? 'opacity-50' : ''}`}>
          <div>
            <label className="text-[10.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] block mb-1">Run at</label>
            <select
              value={hour}
              disabled={!canEdit || !enabled}
              onChange={(e) => { setHour(Number(e.target.value)); mark() }}
              className={inputCls + ' w-full'}
            >
              {Array.from({ length: 24 }).map((_, h) => (
                <option key={h} value={h}>{hourLabel(h)}</option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="text-[10.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] block mb-1">Timezone</label>
            <select
              value={timezone}
              disabled={!canEdit || !enabled}
              onChange={(e) => { setTimezone(e.target.value); mark() }}
              className={inputCls + ' w-full'}
            >
              {TIMEZONES.map(tz => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-3">
            <label className="text-[10.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] block mb-1">Max leads per sweep</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="500"
                value={maxLeads}
                disabled={!canEdit || !enabled}
                onChange={(e) => { setMaxLeads(Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 1))); mark() }}
                className={inputCls + ' w-24 text-right'}
              />
              <span className="text-[11.5px] text-[color:var(--color-text-dim)]">
                Cap on API calls per daily run. Default 100. Set lower to save credits.
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-[color:var(--color-line)] text-[11px] text-[color:var(--color-text-dim)] leading-relaxed">
        <strong className="text-[color:var(--color-text-muted)]">Note:</strong> The sweep runs against the production deploy — local-only changes won't sweep. Each lead also auto-refreshes when you open its detail page if its status is older than 1 hour.
      </div>
    </Card>
  )
}
