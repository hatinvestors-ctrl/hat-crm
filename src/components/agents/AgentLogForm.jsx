// src/components/agents/AgentLogForm.jsx
import { useState } from 'react'
import Button from '../ui/Button'
import { supabase } from '../../lib/supabase'

const TYPES = [
  { value: 'call',    label: '📞 Call' },
  { value: 'meeting', label: '🤝 Meeting' },
  { value: 'text',    label: '💬 Text' },
  { value: 'other',   label: '• Other' },
]

export default function AgentLogForm({ agentId, workspaceId, userId, onSaved, onCancel }) {
  const [type, setType]         = useState('call')
  const [note, setNote]         = useState('')
  const [showDate, setShowDate] = useState(false)
  const [date, setDate]         = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    const occurred_at = showDate
      ? new Date(date + 'T12:00:00').toISOString()
      : new Date().toISOString()

    const { error: err } = await supabase.from('agent_activities').insert({
      workspace_id: workspaceId,
      agent_id:     agentId,
      user_id:      userId,
      type,
      note:         note.trim() || null,
      occurred_at,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setNote('')
    setShowDate(false)
    setDate(new Date().toISOString().slice(0, 10))
    onSaved?.()
  }

  return (
    <div className="mx-3 mb-2 bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-accent-soft)] rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-accent-text)] mb-2">Log an interaction</div>

      {/* Type picker */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {TYPES.map(t => (
          <button
            key={t.value}
            onClick={() => setType(t.value)}
            className={`px-2.5 py-0.5 rounded-full text-[11px] transition-colors ${
              type === t.value
                ? 'bg-[color:var(--color-accent)] text-white'
                : 'bg-[color:var(--color-bg-elev)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Note */}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="Short note about this interaction…"
        className="w-full px-2.5 py-1.5 text-[12px] rounded-md bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-faint)] border border-[color:var(--color-line)] focus:outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)] resize-none mb-2"
      />

      {/* Optional date */}
      {showDate ? (
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mb-2 px-2.5 py-1 text-[12px] rounded-md bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] border border-[color:var(--color-line)] focus:outline-none focus:border-[color:var(--color-accent)]"
        />
      ) : (
        <button
          onClick={() => setShowDate(true)}
          className="text-[11px] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] mb-2 block"
        >
          📅 Add date (optional)
        </button>
      )}

      {error && (
        <div className="text-[11px] text-[color:var(--color-danger-text)] mb-2">{error}</div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button size="sm" onClick={handleSave} loading={saving}>Save</Button>
      </div>
    </div>
  )
}
