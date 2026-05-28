import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { SYSTEM_VIEWS } from '../../lib/constants'
import Button from '../ui/Button'
import { todayISO, endOfWeekISO } from '../../lib/calculations'

export default function SavedViewsSidebar({ workspaceId, userId, activeViewId, onSelectView, currentFilters, onSaveView, refreshKey }) {
  const [views, setViews] = useState([])
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [newViewName, setNewViewName] = useState('')
  const [newViewShared, setNewViewShared] = useState(false)
  // All leads in workspace — used for view counts. Just the fields we filter on.
  const [allLeads, setAllLeads] = useState([])

  const triageCount = useMemo(
    () => allLeads.filter(l => l.status === 'triage').length,
    [allLeads]
  )

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    supabase
      .from('saved_views')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })
      .then(({ data }) => { if (!cancelled) setViews(data || []) })
    return () => { cancelled = true }
  }, [workspaceId, refreshKey])

  // Fetch lightweight lead snapshot for counts
  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    supabase
      .from('leads')
      .select('id, status, lead_source, assigned_to, is_hot, follow_up_date, redfin_trigger_type, created_at')
      .eq('workspace_id', workspaceId)
      .then(({ data }) => { if (!cancelled) setAllLeads(data || []) })
    return () => { cancelled = true }
  }, [workspaceId, refreshKey])

  // Compute a count for each system view based on its filter spec.
  // Mirrors the resolveFilters + query logic in LeadsPage.
  const viewCounts = useMemo(() => {
    const today = todayISO()
    const weekEnd = endOfWeekISO()
    const now = new Date()
    const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yestMid = new Date(todayMid); yestMid.setDate(yestMid.getDate() - 1)
    const sevenAgo = new Date(todayMid); sevenAgo.setDate(sevenAgo.getDate() - 7)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const thirtyAgo = new Date(todayMid); thirtyAgo.setDate(thirtyAgo.getDate() - 30)

    const counts = {}
    for (const view of SYSTEM_VIEWS) {
      const f = view.filters || {}
      const matches = allLeads.filter(l => {
        if (f.status && l.status !== f.status) return false
        if (f.is_hot === true && !l.is_hot) return false
        if (f.lead_source && l.lead_source !== f.lead_source) return false
        if (f.redfin_trigger_type && l.redfin_trigger_type !== f.redfin_trigger_type) return false
        if (f.assigned_to === 'me' && l.assigned_to !== userId) return false
        if (f.follow_up_date) {
          if (!l.follow_up_date) return false
          if (f.follow_up_date === 'today' && l.follow_up_date !== today) return false
          if (f.follow_up_date === 'past' && !(l.follow_up_date < today)) return false
          if (f.follow_up_date === 'future' && !(l.follow_up_date > today)) return false
          if (f.follow_up_date === 'this_week' && !(l.follow_up_date >= today && l.follow_up_date <= weekEnd)) return false
        }
        if (f.created_at) {
          const cd = l.created_at ? new Date(l.created_at) : null
          if (!cd) return false
          if (f.created_at === 'today'      && !(cd >= todayMid)) return false
          if (f.created_at === 'yesterday'  && !(cd >= yestMid && cd < todayMid)) return false
          if (f.created_at === 'last_7'     && !(cd >= sevenAgo)) return false
          if (f.created_at === 'this_month' && !(cd >= monthStart)) return false
          if (f.created_at === 'older'      && !(cd < thirtyAgo)) return false
        }
        return true
      })
      counts[view.id] = matches.length
    }
    return counts
  }, [allLeads, userId])

  const handleSave = async () => {
    if (!newViewName.trim()) return
    await supabase.from('saved_views').insert({
      workspace_id: workspaceId,
      user_id: userId,
      name: newViewName.trim(),
      filters: currentFilters || {},
      is_shared: newViewShared,
    })
    setNewViewName(''); setNewViewShared(false); setShowSaveDialog(false)
    onSaveView?.()
  }

  const handleDelete = async (viewId) => {
    if (!confirm('Delete this view?')) return
    await supabase.from('saved_views').delete().eq('id', viewId)
    onSaveView?.()
  }

  const myViews = views.filter(v => v.user_id === userId && !v.is_shared)
  const sharedViews = views.filter(v => v.is_shared)

  // Track which expandable parents are open
  const [expanded, setExpanded] = useState({})
  // Ref to the scrollable aside — used to preserve scroll position on expand/collapse + view clicks
  const asideRef = useRef(null)
  // Pending scroll-restore position. Gets re-applied across multiple renders
  // until the position sticks (handles data-fetch reflows that span >1 frame).
  const pendingScrollRef = useRef(null)
  // Deadline (perf.now ms) after which we give up trying to restore
  const restoreUntilRef = useRef(0)

  // Wrap any click handler so the sidebar's scroll position is preserved
  // across the resulting re-renders (including async data fetches in the parent).
  const withScrollLock = (fn) => (...args) => {
    if (asideRef.current) {
      pendingScrollRef.current = asideRef.current.scrollTop
      // Try to restore for up to ~600ms to cover async re-renders from data fetches
      restoreUntilRef.current = performance.now() + 600
    }
    fn(...args)
  }

  // Restore pending scroll on every render until it actually sticks or the deadline passes.
  useEffect(() => {
    if (pendingScrollRef.current == null || !asideRef.current) return
    const target = pendingScrollRef.current
    asideRef.current.scrollTop = target
    // Clear once we've reached the target OR the time budget expired
    if (asideRef.current.scrollTop === target || performance.now() > restoreUntilRef.current) {
      pendingScrollRef.current = null
    }
  })

  const toggleExpand = withScrollLock((id) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  })

  // Wrap the parent's onSelectView so clicks on view items also preserve scroll
  const handleSelectView = withScrollLock((id) => {
    onSelectView(id)
  })

  const ViewLink = ({ id, name, onDelete, count, hasChildren, isExpanded, isChild }) => {
    const active = activeViewId === id
    return (
      <div className={`group flex items-center gap-1 px-2 h-7 text-[12.5px] rounded transition-colors ${
        isChild ? 'pl-5' : ''
      } ${
        active
          ? 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text)] font-medium'
          : 'text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-elev)] hover:text-[color:var(--color-text)]'
      }`}>
        {hasChildren && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleExpand(id) }}
            className="w-4 h-4 flex items-center justify-center text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] -ml-1 shrink-0"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 120ms' }}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}
        <button type="button" onClick={() => handleSelectView(id)} className="flex-1 text-left truncate">{name}</button>
        {typeof count === 'number' && count > 0 && (
          <span className={`text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full ${
            active
              ? 'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]'
              : 'bg-[color:var(--color-bg)] text-[color:var(--color-text-dim)]'
          }`}>
            {count}
          </span>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(id)}
            className="opacity-0 group-hover:opacity-100 text-[color:var(--color-text-dim)] hover:text-[color:var(--color-danger-text)] px-1 transition-opacity"
            aria-label="Delete view"
          >×</button>
        )}
      </div>
    )
  }

  // Helper: render a view + its children (if any) recursively
  const renderViewWithChildren = (view, allViewsInSection) => {
    const children = allViewsInSection.filter(v => v.parent === view.id)
    const hasChildren = children.length > 0
    const isExpanded = !!expanded[view.id]
    return (
      <div key={view.id}>
        <ViewLink
          id={view.id}
          name={view.name}
          count={viewCounts[view.id]}
          hasChildren={hasChildren}
          isExpanded={isExpanded}
        />
        {hasChildren && isExpanded && (
          <div className="mt-0.5 space-y-0.5">
            {children.map(child => (
              <ViewLink
                key={child.id}
                id={child.id}
                name={child.name}
                count={viewCounts[child.id]}
                isChild
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  const Section = ({ label, children }) => (
    <div>
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1 px-2">{label}</h3>
      <div className="space-y-0.5">{children}</div>
    </div>
  )

  // Split system views into general + by-status (grouped by section)
  const generalViews = SYSTEM_VIEWS.filter(v => !v.section)
  const statusViewsBySection = SYSTEM_VIEWS
    .filter(v => v.section)
    .reduce((acc, v) => {
      ;(acc[v.section] ||= []).push(v)
      return acc
    }, {})
  const sectionOrder = ['Triage', 'Pipeline', 'Follow-Up', 'Outcome', 'Process', 'Other']

  // For each section, top-level entries are views WITHOUT a parent.
  // Children are rendered nested under their parent.
  const topLevelInSection = (section) => (statusViewsBySection[section] || []).filter(v => !v.parent)

  return (
    <aside
      ref={asideRef}
      className="w-56 shrink-0 bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-lg p-2.5 flex flex-col gap-3 self-start sticky top-16 max-h-[calc(100vh-5rem)] overflow-y-auto"
    >
      {triageCount > 0 && (
        <Link
          to={`/w/${workspaceId}/inbox`}
          className="flex items-center justify-between gap-2 px-2.5 h-9 rounded-md bg-[oklch(0.30_0.12_75/0.4)] border border-[oklch(0.55_0.18_75/0.5)] hover:bg-[oklch(0.32_0.14_75/0.5)] transition-colors"
        >
          <span className="text-[12.5px] font-medium text-[oklch(0.85_0.16_75)]">
            🤖 {triageCount} auto-import{triageCount === 1 ? '' : 's'} to triage
          </span>
          <span className="text-[11px] text-[oklch(0.85_0.16_75)]">→</span>
        </Link>
      )}

      <Section label="Views">
        {generalViews.map(v => (
          <ViewLink key={v.id} id={v.id} name={v.name} count={viewCounts[v.id]} />
        ))}
      </Section>

      {sectionOrder.map(name => statusViewsBySection[name] && (
        <Section key={name} label={name}>
          {topLevelInSection(name).map(v =>
            renderViewWithChildren(v, statusViewsBySection[name])
          )}
        </Section>
      ))}

      {myViews.length > 0 && (
        <Section label="My views">
          {myViews.map(v => <ViewLink key={v.id} id={v.id} name={v.name} onDelete={handleDelete} />)}
        </Section>
      )}

      {sharedViews.length > 0 && (
        <Section label="Shared">
          {sharedViews.map(v => (
            <ViewLink key={v.id} id={v.id} name={v.name} onDelete={v.user_id === userId ? handleDelete : null} />
          ))}
        </Section>
      )}

      <div className="border-t border-[color:var(--color-line)] pt-2">
        {showSaveDialog ? (
          <div className="space-y-2">
            <input
              type="text"
              placeholder="View name"
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              autoFocus
              className="w-full h-7 px-2 text-[12.5px] rounded bg-[color:var(--color-bg-input)] border border-[color:var(--color-line)] text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)]"
            />
            <label className="flex items-center gap-1.5 text-[11.5px] text-[color:var(--color-text-muted)]">
              <input type="checkbox" checked={newViewShared} onChange={(e) => setNewViewShared(e.target.checked)} className="accent-[color:var(--color-accent)]" />
              Share with workspace
            </label>
            <div className="flex gap-1">
              <Button size="sm" onClick={handleSave} className="flex-1">Save</Button>
              <Button size="sm" variant="secondary" onClick={() => setShowSaveDialog(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="ghost" className="w-full justify-start" onClick={() => setShowSaveDialog(true)}>
            + Save view
          </Button>
        )}
      </div>
    </aside>
  )
}
