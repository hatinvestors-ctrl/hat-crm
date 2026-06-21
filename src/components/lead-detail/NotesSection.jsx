import { useState, useEffect } from 'react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import { supabase } from '../../lib/supabase'

export default function NotesSection({ lead, canEdit, onUpdated }) {
  const [editing,   setEditing]  = useState(false)
  const [draft,     setDraft]    = useState(lead.notes || '')
  const [saving,    setSaving]   = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    setDraft(lead.notes || '')
  }, [lead.notes])

  const save = async () => {
    setSaving(true)
    const { data } = await supabase
      .from('leads')
      .update({ notes: draft.trim() || null })
      .eq('id', lead.id)
      .select()
      .single()
    if (data) onUpdated?.(data)
    setSaving(false)
    setEditing(false)
  }

  const cancel = () => {
    setDraft(lead.notes || '')
    setEditing(false)
  }

  return (
    <Card
      title="Notes"
      action={
        <div className="flex items-center gap-2">
          {canEdit && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="text-[12px] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] transition-colors"
            >
              {lead.notes ? 'Edit' : '+ Add'}
            </button>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand notes' : 'Collapse notes'}
            className="flex items-center justify-center w-6 h-6 rounded text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className="w-3.5 h-3.5 transition-transform duration-200"
              style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      }
    >
      {collapsed ? null : (
        editing ? (
          <div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={6}
              autoFocus
              placeholder="General notes about this property, condition, owner motivation, anything worth remembering…"
              className="w-full px-3 py-2 text-[13px] rounded-md bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-faint)] border border-[color:var(--color-line)] focus:outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)] resize-y leading-relaxed"
            />
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="secondary" size="sm" onClick={cancel} disabled={saving}>Cancel</Button>
              <Button size="sm" onClick={save} loading={saving}>Save</Button>
            </div>
          </div>
        ) : lead.notes ? (
          <p className="text-[13px] text-[color:var(--color-text)] leading-relaxed whitespace-pre-wrap">{lead.notes}</p>
        ) : (
          <p className="text-[12.5px] text-[color:var(--color-text-dim)] italic">No notes yet.</p>
        )
      )}
    </Card>
  )
}
