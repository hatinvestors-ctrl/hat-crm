import { useState } from 'react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import { supabase } from '../../lib/supabase'
import { LEAD_NOTIFICATIONS } from '../../lib/leadNotifications'

// Human-readable labels for each notification event
const EVENT_LABELS = {
  offer_signed: {
    label: 'Contract Signed — Notify Agent',
    description: 'Sends an email to the assigned agent when a lead status changes to "Offer Signed", asking them to send the offer to the listing agent immediately.',
  },
}

export default function NotificationTriggersForm({ workspace, canEdit, onUpdated }) {
  const initial = workspace?.settings?.notifications || {}
  const [enabled, setEnabled] = useState(
    () => Object.fromEntries(LEAD_NOTIFICATIONS.map(r => [r.event, initial[r.event] !== false]))
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [dirty, setDirty] = useState(false)

  const toggle = (event) => {
    setEnabled(prev => ({ ...prev, [event]: !prev[event] }))
    setDirty(true)
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const currentSettings = workspace?.settings || {}
      const { error: err } = await supabase
        .from('workspaces')
        .update({ settings: { ...currentSettings, notifications: enabled } })
        .eq('id', workspace.id)
      if (err) throw err
      setSaved(true)
      setDirty(false)
      onUpdated?.({ ...workspace, settings: { ...currentSettings, notifications: enabled } })
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="Notification Triggers">
      <div className="space-y-4">
        <p className="text-[12px] text-[color:var(--color-text-muted)]">
          Control which automated email notifications are sent when lead events occur.
          Emails are sent via the configured mail server to the assigned agent.
        </p>

        {LEAD_NOTIFICATIONS.map(rule => {
          const meta = EVENT_LABELS[rule.event] || { label: rule.event, description: '' }
          return (
            <div key={rule.event} className="flex items-start gap-3 p-3 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)]">
              <input
                type="checkbox"
                id={`notif-${rule.event}`}
                checked={enabled[rule.event] ?? true}
                onChange={() => toggle(rule.event)}
                disabled={!canEdit}
                className="mt-0.5 accent-[color:var(--color-accent)]"
              />
              <label htmlFor={`notif-${rule.event}`} className="flex-1 cursor-pointer">
                <div className="text-[13px] font-medium text-[color:var(--color-text)]">{meta.label}</div>
                <div className="text-[11.5px] text-[color:var(--color-text-muted)] mt-0.5">{meta.description}</div>
                <div className="text-[11px] text-[color:var(--color-text-dim)] mt-1 font-mono">
                  Trigger: status → {rule.trigger.value} · Recipient: {rule.recipient}
                </div>
              </label>
            </div>
          )
        })}

        {error && (
          <div className="text-[12px] text-[color:var(--color-danger-text)] bg-[color:var(--color-danger-soft)] px-3 py-2 rounded">
            {error}
          </div>
        )}

        {canEdit && (
          <div className="flex items-center gap-3">
            <Button onClick={handleSave} loading={saving} disabled={!dirty}>
              Save
            </Button>
            {saved && <span className="text-[12px] text-[color:var(--color-success-text)]">Saved</span>}
          </div>
        )}
      </div>
    </Card>
  )
}
