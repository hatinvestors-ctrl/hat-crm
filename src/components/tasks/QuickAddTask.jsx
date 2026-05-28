import { useState, useRef, useEffect } from 'react'

export default function QuickAddTask({ onAdd, placeholder = 'Add a task…' }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (open) ref.current?.focus()
  }, [open])

  const submit = async () => {
    const t = title.trim()
    if (!t) { setOpen(false); return }
    setSaving(true)
    try {
      await onAdd(t)
      setTitle('')
      // keep open for fast multi-add — refocus
      ref.current?.focus()
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left text-[12px] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-elev-2)] px-2 py-1.5 rounded transition-colors"
      >
        + Add a task
      </button>
    )
  }

  return (
    <div className="bg-[color:var(--color-bg)] border border-[color:var(--color-accent)] ring-1 ring-[color:var(--color-accent)] rounded-md p-2">
      <textarea
        ref={ref}
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
          if (e.key === 'Escape') { setOpen(false); setTitle('') }
        }}
        placeholder={placeholder}
        rows={2}
        disabled={saving}
        className="w-full text-[13px] text-[color:var(--color-text)] bg-transparent placeholder:text-[color:var(--color-text-faint)] resize-none focus:outline-none leading-snug"
      />
      <div className="flex items-center gap-1.5 mt-1">
        <button
          onClick={submit}
          disabled={!title.trim() || saving}
          className="text-[11.5px] px-2 h-6 rounded bg-[color:var(--color-accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          Add
        </button>
        <button
          onClick={() => { setOpen(false); setTitle('') }}
          className="text-[11.5px] px-2 h-6 rounded text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
        >
          Cancel
        </button>
        <span className="text-[10px] text-[color:var(--color-text-dim)] ml-auto">Enter to save</span>
      </div>
    </div>
  )
}
