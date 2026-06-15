import { useState, useEffect } from 'react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import { supabase } from '../../lib/supabase'

export default function NotesSection({ lead, canEdit, onUpdated }) {
  const [editing,    setEditing]    = useState(false)
  const [draft,      setDraft]      = useState(lead.notes || '')
  const [saving,     setSaving]     = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genError,   setGenError]   = useState(null)
  const [confirm,    setConfirm]    = useState(false)  // true = show overwrite confirm

  useEffect(() => { setDraft(lead.notes || '') }, [lead.notes])

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

  const runGenerate = async () => {
    setConfirm(false)
    setGenerating(true)
    setGenError(null)
    try {
      const res = await fetch('/.netlify/functions/generate-ai-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: lead.id, lead }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Generation failed.')
      onUpdated?.({ ...lead, notes: data.notes })
    } catch (err) {
      setGenError(err.message || 'Something went wrong.')
    } finally {
      setGenerating(false)
    }
  }

  const handleGenerate = () => {
    if (lead.notes) {
      setConfirm(true)  // existing notes → ask before overwriting
    } else {
      runGenerate()
    }
  }

  return (
    <Card
      title="Notes"
      action={canEdit && !editing && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-1 text-[12px] text-[color:var(--color-accent-text)] hover:opacity-80 transition-opacity disabled:opacity-40"
          >
            {generating ? (
              <>
                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
                Generating…
              </>
            ) : '✦ AI Notes'}
          </button>
          <button
            onClick={() => setEditing(true)}
            className="text-[12px] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] transition-colors"
          >
            {lead.notes ? 'Edit' : '+ Add notes'}
          </button>
        </div>
      )}
    >
      {/* Overwrite confirm banner */}
      {confirm && (
        <div className="mb-3 flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-[color:var(--color-warn-soft)] border border-[color:var(--color-warn)]">
          <span className="text-[12px] text-[color:var(--color-warn-text)]">
            Replace existing notes with AI-generated analysis?
          </span>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => setConfirm(false)}
              className="text-[11.5px] px-2.5 py-1 rounded bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={runGenerate}
              className="text-[11.5px] px-2.5 py-1 rounded bg-[color:var(--color-warn)] text-white hover:opacity-90 transition-opacity"
            >
              Replace
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {genError && (
        <p className="mb-3 text-[11.5px] text-[color:var(--color-danger-text)]">⚠ {genError}</p>
      )}

      {editing ? (
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
        <p className="text-[13px] text-[color:var(--color-text)] whitespace-pre-wrap leading-relaxed">{lead.notes}</p>
      ) : generating ? (
        <p className="text-[12.5px] text-[color:var(--color-text-dim)] italic">Generating AI analysis…</p>
      ) : (
        <p className="text-[12.5px] text-[color:var(--color-text-dim)] italic">No notes yet.</p>
      )}
    </Card>
  )
}
