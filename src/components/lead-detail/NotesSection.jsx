import { useState, useEffect, useRef } from 'react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import { supabase } from '../../lib/supabase'
import NotesRenderer from './NotesRenderer'

export default function NotesSection({ lead, canEdit, onUpdated }) {
  const [editing,     setEditing]    = useState(false)
  const [localNotes,  setLocalNotes] = useState(lead.notes || '')
  const [draft,       setDraft]      = useState(lead.notes || '')
  const [saving,      setSaving]     = useState(false)
  const [generating,  setGenerating] = useState(false)
  const [genError,    setGenError]   = useState(null)
  const [confirm,     setConfirm]    = useState(false)
  const [collapsed,   setCollapsed]  = useState(false)
  const generationCancelRef = useRef(null)

  useEffect(() => {
    setDraft(lead.notes || '')
    setLocalNotes(lead.notes || '')
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

  const runGenerate = async () => {
    setConfirm(false)
    setGenerating(true)
    setGenError(null)
    let cancelled = false
    generationCancelRef.current = () => { cancelled = true }

    try {
      const res = await fetch('/.netlify/functions/generate-ai-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: lead.id, lead }),
      })

      if (cancelled) return

      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        throw new Error(`Server error (${res.status}). Try again.`)
      }

      const data = await res.json()
      if (!res.ok || !data.ok) {
        if (data.error === 'NO_ASKING_PRICE') throw new Error('Please fill in the Seller\'s Asking Price before generating AI notes — the analysis is based on what the seller is asking.')
        throw new Error(data.error || `Generation failed (${res.status}).`)
      }

      setLocalNotes(data.notes)
      setGenerating(false)
      onUpdated?.({ ...lead, notes: data.notes })
    } catch (err) {
      if (!cancelled) {
        setGenError(err.message || 'Something went wrong.')
        setGenerating(false)
      }
    }
  }

  const cancelGenerate = () => {
    generationCancelRef.current?.()
    setGenerating(false)
    setGenError(null)
  }

  const handleGenerate = () => {
    if (localNotes) {
      setConfirm(true)  // existing notes → ask before overwriting
    } else {
      runGenerate()
    }
  }

  return (
    <Card
      title="Notes"
      action={
        <div className="flex items-center gap-2">
          {canEdit && !editing && (
            <>
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
                    <button
                      onClick={cancelGenerate}
                      className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] transition-colors"
                    >
                      Cancel
                    </button>
                  </>
                ) : '✦ AI Notes'}
              </button>
              <button
                onClick={() => setEditing(true)}
                className="text-[12px] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] transition-colors"
              >
                {lead.notes ? 'Edit' : '+ Add'}
              </button>
            </>
          )}
          {/* Collapse toggle */}
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
      {collapsed ? null : (<>

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
      ) : localNotes ? (
        <NotesRenderer notes={localNotes} />
      ) : generating ? (
        <p className="text-[12.5px] text-[color:var(--color-text-dim)] italic">Generating AI analysis… this takes 20–40 seconds.</p>
      ) : (
        <p className="text-[12.5px] text-[color:var(--color-text-dim)] italic">No notes yet.</p>
      )}

      </>)}
    </Card>
  )
}
