import { useState, useEffect, useRef } from 'react'
import Card from '../ui/Card'
import NotesRenderer from './NotesRenderer'
import WhatIfPanel from './WhatIfPanel'
import DealQA from './DealQA'

export default function AINotesSection({ lead, canEdit, onUpdated }) {
  const [localNotes,  setLocalNotes] = useState(lead.ai_notes || '')
  const [generating,  setGenerating] = useState(false)
  const [genError,    setGenError]   = useState(null)
  const [confirm,     setConfirm]    = useState(false)
  const [collapsed,   setCollapsed]  = useState(false)
  const cancelRef = useRef(null)

  useEffect(() => {
    setLocalNotes(lead.ai_notes || '')
  }, [lead.ai_notes])

  const runGenerate = async () => {
    setConfirm(false)
    setGenerating(true)
    setGenError(null)
    let cancelled = false
    cancelRef.current = () => { cancelled = true }

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
        if (data.error === 'NO_ASKING_PRICE') throw new Error("Please fill in the Seller's Asking Price before generating AI analysis — the analysis is based on what the seller is asking.")
        throw new Error(data.error || `Generation failed (${res.status}).`)
      }

      setLocalNotes(data.notes)
      setGenerating(false)
      onUpdated?.({ ...lead, ai_notes: data.notes })
    } catch (err) {
      if (!cancelled) {
        setGenError(err.message || 'Something went wrong.')
        setGenerating(false)
      }
    }
  }

  const cancelGenerate = () => {
    cancelRef.current?.()
    setGenerating(false)
    setGenError(null)
  }

  const handleGenerate = () => {
    if (localNotes) {
      setConfirm(true)
    } else {
      runGenerate()
    }
  }

  return (
    <Card
      title="AI Analysis"
      action={
        <div className="flex items-center gap-2">
          {canEdit && (
            <>
              {generating ? (
                <span className="flex items-center gap-1 text-[12px] text-[color:var(--color-accent-text)]">
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
                </span>
              ) : (
                <button
                  onClick={handleGenerate}
                  className="flex items-center gap-1 text-[12px] text-[color:var(--color-accent-text)] hover:opacity-80 transition-opacity"
                >
                  ✦ {localNotes ? 'Regenerate' : 'Generate AI Analysis'}
                </button>
              )}
            </>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand' : 'Collapse'}
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

      {confirm && (
        <div className="mb-3 flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-[color:var(--color-warn-soft)] border border-[color:var(--color-warn)]">
          <span className="text-[12px] text-[color:var(--color-warn-text)]">
            Replace existing AI analysis with a fresh generation?
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
              Regenerate
            </button>
          </div>
        </div>
      )}

      {genError && (
        <p className="mb-3 text-[11.5px] text-[color:var(--color-danger-text)]">⚠ {genError}</p>
      )}

      {localNotes ? (<>
        <NotesRenderer notes={localNotes} />
        <WhatIfPanel lead={lead} />
        <DealQA lead={lead} aiNotes={localNotes} />
      </>) : generating ? (
        <p className="text-[12.5px] text-[color:var(--color-text-dim)] italic">Generating AI analysis… this takes 20–40 seconds.</p>
      ) : (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-[13px] text-[color:var(--color-text-dim)]">No AI analysis yet.</p>
          {canEdit && (
            <p className="text-[12px] text-[color:var(--color-text-faint)]">Click <strong>✦ Generate AI Analysis</strong> above to run a full investor analysis at the seller's asking price.</p>
          )}
        </div>
      )}

      </>)}
    </Card>
  )
}
