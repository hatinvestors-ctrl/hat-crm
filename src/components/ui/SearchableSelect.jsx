import { useState, useEffect, useRef } from 'react'

export default function SearchableSelect({ value, onChange, options, placeholder = 'Select…', disabled = false }) {
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState('')
  const containerRef      = useRef(null)

  const selected = options.find(o => o.value === value)

  const filtered = query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  useEffect(() => {
    function onMouseDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  const triggerCls = 'w-full text-[13px] px-2 h-8 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)] cursor-pointer flex items-center justify-between gap-1 disabled:opacity-50'

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(v => !v)}
        className={triggerCls}
      >
        <span className={`truncate ${selected ? '' : 'text-[color:var(--color-text-dim)]'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <svg className="w-3 h-3 shrink-0 text-[color:var(--color-text-dim)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded shadow-lg">
          <div className="p-1.5 border-b border-[color:var(--color-line)]">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full text-[12px] px-2 h-7 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-dim)] focus:outline-none focus:border-[color:var(--color-accent)]"
            />
          </div>
          <div className="max-h-60 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-[color:var(--color-text-dim)]">No results</div>
            ) : filtered.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false) }}
                className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-[color:var(--color-bg-elev-2)] transition-colors ${o.value === value ? 'text-[color:var(--color-accent-text)] font-medium' : 'text-[color:var(--color-text)]'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
