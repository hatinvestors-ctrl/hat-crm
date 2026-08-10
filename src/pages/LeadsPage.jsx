import { useEffect, useMemo, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import Topbar from '../components/Topbar'
import LeadsTable from '../components/leads/LeadsTable'
import LeadFilters from '../components/leads/LeadFilters'
import SavedViewsSidebar from '../components/leads/SavedViewsSidebar'
import LeadForm from '../components/leads/LeadForm'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Button from '../components/ui/Button'
import { supabase } from '../lib/supabase'
import { SYSTEM_VIEWS, LEAD_STATUSES, STATUS_MAP } from '../lib/constants'
import { todayISO, endOfWeekISO } from '../lib/calculations'
import { escapeLike, safeOrIlikeValue } from '../lib/safeQuery'
import { applyLeadVisibility } from '../lib/leadVisibility'

function resolveFilters(viewFilters, userId) {
  const f = { ...viewFilters }
  const today = todayISO()
  if (f.follow_up_date === 'today') f.follow_up_date_eq = today
  if (f.follow_up_date === 'this_week') {
    f.follow_up_date_from = today
    f.follow_up_date_to = endOfWeekISO()
  }
  if (f.follow_up_date === 'past') f.follow_up_date_lt = today
  if (f.follow_up_date === 'future') f.follow_up_date_gt = today
  delete f.follow_up_date

  // created_at date buckets — used by New Lead sub-views
  if (f.created_at) {
    const d = new Date()
    const todayMid = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const yest = new Date(todayMid); yest.setDate(yest.getDate() - 1)
    const sevenAgo = new Date(todayMid); sevenAgo.setDate(sevenAgo.getDate() - 7)
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1)
    const thirtyAgo = new Date(todayMid); thirtyAgo.setDate(thirtyAgo.getDate() - 30)

    if (f.created_at === 'today') {
      f.created_at_from = todayMid.toISOString()
    }
    if (f.created_at === 'yesterday') {
      f.created_at_from = yest.toISOString()
      f.created_at_to   = todayMid.toISOString()
    }
    if (f.created_at === 'last_7') {
      f.created_at_from = sevenAgo.toISOString()
    }
    if (f.created_at === 'this_month') {
      f.created_at_from = monthStart.toISOString()
    }
    if (f.created_at === 'older') {
      f.created_at_to = thirtyAgo.toISOString()
    }
    delete f.created_at
  }

  if (f.assigned_to === 'me') f.assigned_to = userId
  return f
}

// Filter keys persisted to URL (besides view/sort/order)
const URL_FILTER_KEYS = [
  'status', 'is_hot', 'assigned_to', 'lead_source', 'redfin_trigger_type',
  'city', 'zip_code', 'arv_min', 'arv_max', 'search',
]

function filtersFromParams(params) {
  const f = {}
  for (const k of URL_FILTER_KEYS) {
    const v = params.get(k)
    if (v === null || v === '') continue
    if (k === 'is_hot') f[k] = v === 'true'
    else if (k === 'arv_min' || k === 'arv_max') {
      const n = Number(v); if (!Number.isNaN(n)) f[k] = n
    } else f[k] = v
  }
  return f
}

export default function LeadsPage() {
  const { workspace, workspaceId, members, user, userRole } = useOutletContext()
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeViewId, setActiveViewId] = useState(searchParams.get('view') || 'all')

  useEffect(() => {
    const fromUrl = searchParams.get('view')
    if (fromUrl && fromUrl !== activeViewId) {
      setActiveViewId(fromUrl)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])
  const [savedViews, setSavedViews] = useState([])
  const [filters, setFilters] = useState(() => filtersFromParams(searchParams))
  const [sortBy, setSortBy] = useState(searchParams.get('sort') || 'created_at')
  const [sortOrder, setSortOrder] = useState(searchParams.get('order') || 'desc')
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [viewsRefresh, setViewsRefresh] = useState(0)
  const [selected, setSelected] = useState(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkErr, setBulkErr] = useState(null)
  const [bulkStatus, setBulkStatus] = useState('')

  useEffect(() => {
    if (!workspaceId) return
    supabase.from('saved_views').select('*').eq('workspace_id', workspaceId).then(({ data }) => {
      setSavedViews(data || [])
    })
  }, [workspaceId, viewsRefresh])

  const activeView = useMemo(() => {
    const sys = SYSTEM_VIEWS.find(v => v.id === activeViewId)
    if (sys) return sys
    return savedViews.find(v => v.id === activeViewId)
  }, [activeViewId, savedViews])

  const effectiveFilters = useMemo(() => {
    const base = activeView ? resolveFilters(activeView.filters || {}, user.id) : {}
    return { ...base, ...filters }
  }, [activeView, filters, user.id])

  const fetchLeads = async () => {
    setLoading(true)
    let q = supabase.from('leads').select('*').eq('workspace_id', workspaceId)
    q = applyLeadVisibility(q, user.id, userRole)

    if (effectiveFilters.status) q = q.eq('status', effectiveFilters.status)
    if (effectiveFilters.is_hot === true) q = q.eq('is_hot', true)
    if (effectiveFilters.screened === true) q = q.eq('screened', true)
    if (effectiveFilters.assigned_to === 'unassigned') q = q.is('assigned_to', null)
    else if (effectiveFilters.assigned_to) q = q.eq('assigned_to', effectiveFilters.assigned_to)
    if (effectiveFilters.lead_source === 'off_market') {
      // Capability #10.1 — bridges the gap until the #10.1 migration is
      // applied: today's pilot leads were inserted with lead_source='other'
      // (the migration adding 'off_market' as an allowed value isn't live
      // yet), so also match the pilot's own fixed-format notes marker.
      // Once the migration runs and future imports use lead_source=
      // 'off_market' directly, the notes half of this becomes redundant
      // but harmless — safe to leave as-is or remove later.
      q = q.or(`lead_source.eq.off_market,notes.ilike.⚠ DISTRESSED OPPORTUNITY%`)
    } else if (effectiveFilters.lead_source) {
      q = q.eq('lead_source', effectiveFilters.lead_source)
    }
    if (effectiveFilters.redfin_trigger_type) q = q.eq('redfin_trigger_type', effectiveFilters.redfin_trigger_type)
    if (effectiveFilters.city) q = q.ilike('city', `%${escapeLike(effectiveFilters.city)}%`)
    if (effectiveFilters.zip_code) q = q.ilike('zip_code', `%${escapeLike(effectiveFilters.zip_code)}%`)
    if (effectiveFilters.arv_min) q = q.gte('arv', effectiveFilters.arv_min)
    if (effectiveFilters.arv_max) q = q.lte('arv', effectiveFilters.arv_max)
    if (effectiveFilters.follow_up_date_eq) q = q.eq('follow_up_date', effectiveFilters.follow_up_date_eq)
    if (effectiveFilters.follow_up_date_from) q = q.gte('follow_up_date', effectiveFilters.follow_up_date_from)
    if (effectiveFilters.follow_up_date_to) q = q.lte('follow_up_date', effectiveFilters.follow_up_date_to)
    if (effectiveFilters.follow_up_date_lt) q = q.lt('follow_up_date', effectiveFilters.follow_up_date_lt)
    if (effectiveFilters.follow_up_date_gt) q = q.gt('follow_up_date', effectiveFilters.follow_up_date_gt)
    if (effectiveFilters.created_at_from) q = q.gte('created_at', effectiveFilters.created_at_from)
    if (effectiveFilters.created_at_to) q = q.lt('created_at', effectiveFilters.created_at_to)
    if (effectiveFilters.search) {
      const s = safeOrIlikeValue(effectiveFilters.search)
      if (s) q = q.or(`address.ilike.%${s}%,seller_name.ilike.%${s}%`)
    }

    q = q.order(sortBy, { ascending: sortOrder === 'asc' })

    const DEAD = new Set(['dead_lead','rejected_not_accepted','not_in_buy_box','sequence_completed'])
    const { data, error } = await q
    if (!error) {
      const sorted = (data || []).sort((a, b) => {
        const aD = DEAD.has(a.status) ? 1 : 0
        const bD = DEAD.has(b.status) ? 1 : 0
        return aD - bD
      })
      setLeads(sorted)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchLeads()
  }, [workspaceId, JSON.stringify(effectiveFilters), sortBy, sortOrder])

  // Persist filters + sort to URL (preserve `view` param)
  useEffect(() => {
    const next = new URLSearchParams()
    const view = searchParams.get('view')
    if (view) next.set('view', view)
    for (const k of URL_FILTER_KEYS) {
      const v = filters[k]
      if (v === undefined || v === null || v === '') continue
      next.set(k, String(v))
    }
    if (sortBy && sortBy !== 'created_at') next.set('sort', sortBy)
    if (sortOrder && sortOrder !== 'desc') next.set('order', sortOrder)
    const currentStr = searchParams.toString()
    const nextStr = next.toString()
    if (currentStr !== nextStr) setSearchParams(next, { replace: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sortBy, sortOrder])

  const handleSort = (field) => {
    if (sortBy === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortOrder('desc') }
  }

  const canEdit = userRole !== 'readonly'

  // ── Bulk selection ────────────────────────────────────────────────────
  const toggleOne = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const toggleAllVisible = (check) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (check) leads.forEach(l => next.add(l.id))
      else leads.forEach(l => next.delete(l.id))
      return next
    })
  }
  const clearSelection = () => setSelected(new Set())

  // Reset selection when the active view changes (so leads no longer visible
  // don't stay silently selected)
  useEffect(() => { clearSelection() }, [activeViewId])

  const bulkApplyStatus = async () => {
    if (!bulkStatus || selected.size === 0) return
    setBulkBusy(true); setBulkErr(null)
    const ids = [...selected]
    // Patch with status + timestamps appropriate for the new status
    const patch = { status: bulkStatus, updated_at: new Date().toISOString() }
    const { error } = await supabase
      .from('leads')
      .update(patch)
      .in('id', ids)
    if (error) {
      setBulkErr(error.message)
    } else {
      // Activity log entries for each lead
      try {
        const userLookup = Object.fromEntries((members || []).map(m => [m.user_id, m.profiles]))
        const oldByLead = Object.fromEntries(leads.map(l => [l.id, l]))
        const inserts = ids.map(id => {
          const before = oldByLead[id] || {}
          const oldLbl = STATUS_MAP[before.status]?.label || before.status || '—'
          const newLbl = STATUS_MAP[bulkStatus]?.label || bulkStatus
          return {
            lead_id: id,
            user_id: user.id,
            type: 'activity',
            content: `Status changed from "${oldLbl}" to "${newLbl}" (bulk action)`,
            metadata: { field: 'status', old_value: before.status, new_value: bulkStatus, bulk: true },
          }
        })
        if (inserts.length) await supabase.from('lead_activities').insert(inserts)
      } catch (_) { /* non-fatal */ }
      clearSelection()
      setBulkStatus('')
      fetchLeads()
    }
    setBulkBusy(false)
  }

  const bulkMarkHot = async (hot) => {
    if (selected.size === 0) return
    setBulkBusy(true); setBulkErr(null)
    const ids = [...selected]
    const { error } = await supabase.from('leads').update({ is_hot: hot }).in('id', ids)
    if (error) setBulkErr(error.message)
    else { clearSelection(); fetchLeads() }
    setBulkBusy(false)
  }

  const bulkDelete = async () => {
    if (selected.size === 0) return
    if (userRole !== 'admin') { setBulkErr('Only admins can bulk-delete.'); return }
    if (!confirm(`Permanently delete ${selected.size} lead${selected.size === 1 ? '' : 's'}? This cannot be undone.`)) return
    setBulkBusy(true); setBulkErr(null)
    const { error } = await supabase.from('leads').delete().in('id', [...selected])
    if (error) setBulkErr(error.message)
    else { clearSelection(); fetchLeads() }
    setBulkBusy(false)
  }

  return (
    <>
      <Topbar
        title="Leads"
        breadcrumbs={[{ label: workspace.name }, { label: 'Leads' }]}
        actions={canEdit && <Button onClick={() => setFormOpen(true)}>+ Add Lead</Button>}
      />
      <div className="px-6 py-4 flex gap-4 flex-1 min-w-0">
        <SavedViewsSidebar
          workspaceId={workspaceId}
          userId={user.id}
          userRole={userRole}
          activeViewId={activeViewId}
          onSelectView={(id) => {
            setActiveViewId(id)
            setFilters({})
            const next = new URLSearchParams()
            if (id && id !== 'all') next.set('view', id)
            setSearchParams(next, { replace: true })
          }}
          currentFilters={{ ...activeView?.filters, ...filters }}
          onSaveView={() => setViewsRefresh(v => v + 1)}
          refreshKey={viewsRefresh}
        />

        <div className="flex-1 min-w-0 space-y-3">
          <LeadFilters
            filters={filters}
            onChange={setFilters}
            onClear={() => setFilters({})}
            members={members}
            isAdmin={userRole === 'admin'}
          />

          {/* Bulk-action bar (sticky just below the topbar when leads are selected) */}
          {canEdit && selected.size > 0 && (
            <div className="sticky top-12 z-[5] bg-[color:var(--color-accent-soft)] border border-[color:var(--color-accent)] rounded-lg px-3 py-2 flex items-center justify-between gap-3 flex-wrap shadow-[0_4px_12px_oklch(0_0_0/0.4)]">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-[color:var(--color-accent-text)]">
                  {selected.size} selected
                </span>
                <button onClick={clearSelection} className="text-[11px] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] underline">
                  clear
                </button>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <label className="text-[11px] text-[color:var(--color-text-muted)]">Change status:</label>
                <select
                  value={bulkStatus}
                  onChange={e => setBulkStatus(e.target.value)}
                  disabled={bulkBusy}
                  className="h-7 px-2 text-[12px] bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)]"
                >
                  <option value="">— pick status —</option>
                  {LEAD_STATUSES.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <Button size="sm" onClick={bulkApplyStatus} loading={bulkBusy} disabled={!bulkStatus}>
                  Apply
                </Button>
                <span className="mx-1 text-[color:var(--color-text-dim)]">·</span>
                <Button size="sm" variant="secondary" onClick={() => bulkMarkHot(true)} disabled={bulkBusy}>🔥 Mark Hot</Button>
                <Button size="sm" variant="ghost" onClick={() => bulkMarkHot(false)} disabled={bulkBusy}>Unmark Hot</Button>
                {userRole === 'admin' && (
                  <>
                    <span className="mx-1 text-[color:var(--color-text-dim)]">·</span>
                    <Button size="sm" variant="danger" onClick={bulkDelete} disabled={bulkBusy}>Delete</Button>
                  </>
                )}
              </div>
              {bulkErr && (
                <div className="w-full text-[11.5px] text-[color:var(--color-danger-text)] bg-[color:var(--color-danger-soft)] px-2 py-1 rounded">{bulkErr}</div>
              )}
            </div>
          )}

          {loading ? (
            <LoadingSpinner label="Loading leads…" />
          ) : (
            <LeadsTable
              leads={leads}
              members={members}
              workspaceId={workspaceId}
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={handleSort}
              selectable={canEdit}
              selected={selected}
              onToggle={toggleOne}
              onToggleAllVisible={toggleAllVisible}
              groupByDate={
                activeViewId === 'status_new_lead' ? 'created_at'
                : ['follow_today','follow_week','follow_past','follow_future','status_follow_up'].includes(activeViewId)
                  ? 'follow_up_date'
                  : null
              }
            />
          )}

          <div className="text-[11.5px] text-[color:var(--color-text-dim)] text-right tabular-nums">
            {leads.length} lead{leads.length === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      <LeadForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); fetchLeads() }}
        workspaceId={workspaceId}
        userId={user.id}
        userRole={userRole}
        members={members}
        workspaceDefaults={workspace.settings}
      />
    </>
  )
}
