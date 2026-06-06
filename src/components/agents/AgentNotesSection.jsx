// src/components/agents/AgentNotesSection.jsx
import { useState, useEffect } from 'react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import { supabase } from '../../lib/supabase'

export default function AgentNotesSection({ agent, canEdit, onUpdated }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(agent.notes || '')
  const [saving, setSaving] = useState(false)

  useEffect(() => { setDraft(agent.notes || '') }, [agent.notes])

  const save = async () => {
    setSaving(true)
    const { data, error: err } = await supabase
      .from('agents')
      .update({ notes: draft.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', agent.id)
      .select()
      .single()
    setSaving(false)
    if (err) return
    if (data) onUpdated?.(data)
    setEditing(false)
  }

  const cancel = () => {
    setDraft(agent.notes || '')
    setEditing(false)
  }

  return (
    <Card
      title="Notes"
      action={canEdit && !editing && (
        <button
          onClick={() => setEditing(true)}
          className="text-[12px] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] transition-colors"
        >
          {agent.notes ? 'Edit' : '+ Add notes'}
        </button>
      )}
    >
      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            autoFocus
            placeholder="Notes about this agent — preferred contact method, relationship history, anything worth remembering…"
            className="w-full px-3 py-2 text-[13px] rounded-md bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-faint)] border border-[color:var(--color-line)] focus:outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)] resize-y leading-relaxed"
          />
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="secondary" size="sm" onClick={cancel} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={save} loading={saving}>Save</Button>
          </div>
        </div>
      ) : agent.notes ? (
        <p className="text-[13px] text-[color:var(--color-text)] whitespace-pre-wrap leading-relaxed">{agent.notes}</p>
      ) : (
        <p className="text-[12.5px] text-[color:var(--color-text-dim)] italic">No notes yet.</p>
      )}
    </Card>
  )
}
