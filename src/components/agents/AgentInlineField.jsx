// src/components/agents/AgentInlineField.jsx
import { useState, useRef, useEffect } from 'react'

const inputCls = 'w-full px-2 py-0.5 text-[12px] rounded bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] border border-[color:var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--color-accent)]'

export default function AgentInlineField({ value, onSave, placeholder, multiline = false, label, canEdit = true }) {
  const [editing, setEditing]   = useState(false)
  const [draft, setDraft]       = useState(value || '')
  const inputRef                = useRef(null)
  const escapedRef              = useRef(false)

  useEffect(() => { setDraft(value || '') }, [value])

  const startEdit = () => {
    if (!canEdit) return
    setDraft(value || '')
    setEditing(true)
  }

  const commit = () => {
    if (escapedRef.current) { escapedRef.current = false; return }
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed !== (value || '').trim()) onSave?.(trimmed)
  }

  const cancel = () => {
    escapedRef.current = true
    setDraft(value || '')
    setEditing(false)
  }

  const handleKeyDown = (e) => {
    if (!multiline && e.key === 'Enter') { e.preventDefault(); commit() }
    if (e.key === 'Escape') cancel()
  }

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  return (
    <div className="group">
      {label && (
        <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">{label}</div>
      )}
      {editing ? (
        multiline ? (
          <textarea
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            rows={3}
            className={`${inputCls} resize-y leading-relaxed`}
          />
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            className={inputCls}
          />
        )
      ) : (
        <div
          onClick={startEdit}
          className={`text-[12px] leading-snug min-h-[20px] rounded px-2 py-0.5 -mx-2 flex items-center justify-between gap-1 ${canEdit ? 'cursor-pointer hover:bg-[color:var(--color-bg-elev-2)]' : ''} transition-colors`}
        >
          {value ? (
            <span className="text-[color:var(--color-text)] whitespace-pre-wrap break-words">{value}</span>
          ) : (
            <span className="text-[color:var(--color-text-faint)] italic">{placeholder}</span>
          )}
          {canEdit && (
            <svg className="opacity-0 group-hover:opacity-40 shrink-0" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13H3v-2L11.5 2.5z"/>
            </svg>
          )}
        </div>
      )}
    </div>
  )
}
