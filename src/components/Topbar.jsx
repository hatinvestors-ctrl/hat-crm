import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Badge from './ui/Badge'
import { safeOrIlikeValue } from '../lib/safeQuery'

export default function Topbar({ title, breadcrumbs = [], actions }) {
  const { workspaceId } = useParams()
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)

  // Global keyboard shortcut: "/" focuses search
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
      if (e.key === 'Escape' && open) {
        setOpen(false)
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Debounced search
  useEffect(() => {
    if (!q.trim() || !workspaceId) { setResults([]); return }
    let cancel = false
    setLoading(true)
    const t = setTimeout(async () => {
      const s = safeOrIlikeValue(q)
      if (!s) { if (!cancel) { setResults([]); setLoading(false) } ; return }
      const { data } = await supabase
        .from('leads')
        .select('id, address, city, status, seller_name')
        .eq('workspace_id', workspaceId)
        .or(`address.ilike.%${s}%,seller_name.ilike.%${s}%,city.ilike.%${s}%`)
        .limit(10)
      if (!cancel) {
        setResults(data || [])
        setLoading(false)
      }
    }, 180)
    return () => { cancel = true; clearTimeout(t) }
  }, [q, workspaceId])

  const pickResult = (leadId) => {
    setOpen(false); setQ(''); setResults([])
    navigate(`/w/${workspaceId}/leads/${leadId}`)
  }

  // Hide back button on top-level pages where there's no history to go to
  const canGoBack = typeof window !== 'undefined' && window.history.length > 1

  return (
    <header className="h-12 bg-[color:var(--color-bg)] border-b border-[color:var(--color-line)] px-4 flex items-center gap-3 sticky top-0 z-10">
      {canGoBack && (
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-elev)] hover:text-[color:var(--color-text)] transition-colors"
          title="Back (Alt+←)"
          aria-label="Go back"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      <div className="min-w-0 flex-1">
        {breadcrumbs.length > 0 && (
          <nav className="text-[11px] text-[color:var(--color-text-dim)] flex items-center gap-1 mb-0.5" aria-label="Breadcrumb">
            {breadcrumbs.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {b.to ? (
                  <Link to={b.to} className="hover:text-[color:var(--color-text-muted)] transition-colors">{b.label}</Link>
                ) : (
                  <span className="text-[color:var(--color-text-muted)]">{b.label}</span>
                )}
                {i < breadcrumbs.length - 1 && <span className="text-[color:var(--color-text-faint)]">/</span>}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-[14px] font-semibold text-[color:var(--color-text)] truncate leading-tight">{title}</h1>
      </div>

      {/* Search */}
      {workspaceId && (
        <div className="relative w-72 max-w-[40vw]">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--color-text-dim)] pointer-events-none">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          </span>
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Search leads…"
            className="h-7 w-full pl-7 pr-10 text-[12.5px] rounded-md bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-faint)] focus:outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)]"
          />
          {!q && (
            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-[color:var(--color-text-dim)] border border-[color:var(--color-line)] rounded px-1 h-4 inline-flex items-center pointer-events-none">/</kbd>
          )}

          {open && q && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-md shadow-[0_12px_32px_oklch(0_0_0/0.5)] overflow-hidden z-20">
              {loading ? (
                <div className="px-3 py-2 text-[12px] text-[color:var(--color-text-dim)]">Searching…</div>
              ) : results.length === 0 ? (
                <div className="px-3 py-2 text-[12px] text-[color:var(--color-text-dim)]">No matches</div>
              ) : (
                <ul className="max-h-80 overflow-y-auto">
                  {results.map(r => (
                    <li key={r.id}>
                      <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickResult(r.id)}
                        className="w-full text-left px-3 py-2 hover:bg-[color:var(--color-bg-elev-2)] flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] text-[color:var(--color-text)] truncate">{r.address}</div>
                          <div className="text-[11px] text-[color:var(--color-text-dim)] truncate">
                            {[r.city, r.seller_name].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        <Badge status={r.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  )
}
