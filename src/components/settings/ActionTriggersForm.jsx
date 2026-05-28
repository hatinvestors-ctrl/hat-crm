import { useState } from 'react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import { supabase } from '../../lib/supabase'
import { BUCKETS, effectiveBucketConfig } from '../../lib/staleness'

const TONE_DOT = {
  neutral: 'bg-[color:var(--color-text-dim)]',
  accent:  'bg-[color:var(--color-accent)]',
  warn:    'bg-[color:var(--color-warn)]',
  success: 'bg-[color:var(--color-success)]',
  danger:  'bg-[color:var(--color-danger)]',
}

export default function ActionTriggersForm({ workspace, canEdit, onUpdated }) {
  const [cfg, setCfg] = useState(() => effectiveBucketConfig(workspace.settings))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [dirty, setDirty] = useState(false)

  const updateBucket = (id, patch) => {
    setCfg(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
    setDirty(true); setSaved(false)
  }

  const reset = () => {
    setCfg(effectiveBucketConfig(workspace.settings))
    setDirty(false); setSaved(false)
  }

  const save = async () => {
    setSaving(true); setError(null); setSaved(false)
    // Only persist configurable buckets
    const today_thresholds = {}
    for (const b of BUCKETS) {
      if (!b.configurable) continue
      const c = cfg[b.id]
      today_thresholds[b.id] = { enabled: c.enabled, days: c.days }
    }
    const nextSettings = { ...(workspace.settings || {}), today_thresholds }
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

  return (
    <Card
      title="Action Triggers"
      action={canEdit && dirty && (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={reset}>Discard</Button>
          <Button size="sm" onClick={save} loading={saving}>Save changes</Button>
        </div>
      )}
    >
      <p className="text-[12.5px] text-[color:var(--color-text-muted)] leading-relaxed mb-4">
        These rules decide when a lead appears in the <span className="font-medium text-[color:var(--color-text)]">Today</span> view.
        For each rule, set how many days a lead can sit idle in that status before it's flagged.
        Turn a rule off to never flag it.
      </p>

      {error && <div className="p-2 bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] text-[12px] rounded mb-3">{error}</div>}
      {saved && <div className="p-2 bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)] text-[12px] rounded mb-3">Triggers saved.</div>}

      <div className="border border-[color:var(--color-line)] rounded-md overflow-hidden">
        {BUCKETS.filter(b => b.configurable).map((b, idx) => {
          const c = cfg[b.id]
          return (
            <div
              key={b.id}
              className={`flex items-center gap-3 px-3 py-3 ${idx > 0 ? 'border-t border-[color:var(--color-line)]' : ''} ${!c.enabled ? 'opacity-50' : ''}`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${TONE_DOT[b.tone]}`} />

              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-[color:var(--color-text)] truncate">{b.label}</div>
                <div className="text-[11.5px] text-[color:var(--color-text-dim)]">{b.description}</div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <label className="text-[11px] text-[color:var(--color-text-muted)]">Flag after</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={c.days}
                  disabled={!canEdit || !c.enabled}
                  onChange={(e) => updateBucket(b.id, { days: e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0) })}
                  className="h-7 w-14 px-2 text-[12.5px] text-right tabular-nums rounded-md bg-[color:var(--color-bg-input)] border border-[color:var(--color-line)] text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)] disabled:opacity-50"
                />
                <span className="text-[11px] text-[color:var(--color-text-muted)]">day{c.days === 1 ? '' : 's'}</span>

                <label className="inline-flex items-center gap-1.5 ml-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={c.enabled}
                    disabled={!canEdit}
                    onChange={(e) => updateBucket(b.id, { enabled: e.target.checked })}
                    className="accent-[color:var(--color-accent)]"
                  />
                  <span className="text-[11px] text-[color:var(--color-text-muted)]">Enabled</span>
                </label>

                {c.days !== b.defaultDays && (
                  <button
                    type="button"
                    onClick={() => updateBucket(b.id, { days: b.defaultDays })}
                    title={`Reset to default (${b.defaultDays}d)`}
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

      <div className="mt-4 pt-3 border-t border-[color:var(--color-line)] text-[11px] text-[color:var(--color-text-dim)] leading-relaxed">
        <strong className="text-[color:var(--color-text-muted)]">Note:</strong> "Overdue Follow-Up" and "Follow-Up Today" always run — they're tied to the actual follow-up date, not idle time.
      </div>
    </Card>
  )
}
