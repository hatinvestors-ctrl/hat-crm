import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import Topbar from '../components/Topbar'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import EmptyState from '../components/ui/EmptyState'
import Button from '../components/ui/Button'
import { supabase } from '../lib/supabase'
import { REDFIN_TRIGGER_TYPES, REDFIN_TRIGGER_MAP, GENERIC_AUTO_ALERT, LEAD_SOURCE_MAP } from '../lib/constants'
import { DistressBadge } from '../components/lead-detail/DistressBanner'

// Capability #6.1 — source-neutral trigger badge. Redfin leads keep their
// exact existing "📨 Redfin Alert" fallback (REDFIN_TRIGGER_MAP, unchanged,
// per "do not redesign redfin_trigger_type yet"); any other automated
// source with no redfin_trigger_type gets the neutral GENERIC_AUTO_ALERT
// instead of being mislabeled "Redfin Alert".
function triggerBadgeFor(lead) {
  if (lead.redfin_trigger_type && REDFIN_TRIGGER_MAP[lead.redfin_trigger_type]) {
    return REDFIN_TRIGGER_MAP[lead.redfin_trigger_type]
  }
  return lead.lead_source === 'redfin_auto' ? REDFIN_TRIGGER_MAP.generic_alert : GENERIC_AUTO_ALERT
}
import { formatCurrency, formatDateTime, formatPhone } from '../lib/calculations'
import { safeTelHref, safeMailtoHref } from '../lib/urlSafety'

const TONE_PILL = {
  warn:    'bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)] ring-[color:var(--color-warn)]',
  accent:  'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)] ring-[color:var(--color-accent)]',
  success: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)] ring-[color:var(--color-success)]',
  danger:  'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] ring-[color:var(--color-danger)]',
  neutral: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] ring-[color:var(--color-line)]',
}

function timeAgo(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const ms = Date.now() - d.getTime()
  const h = Math.floor(ms / 3600000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'price_high', label: 'Highest price' },
  { value: 'price_low', label: 'Lowest price' },
]

export default function InboxPage() {
  const { workspace, workspaceId } = useOutletContext()
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTrigger, setActiveTrigger] = useState('all')
  const [sortBy, setSortBy] = useState('newest')
  const [selected, setSelected] = useState(new Set())
  const [busyIds, setBusyIds] = useState(new Set())
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!workspaceId) return
    let cancel = false
    setLoading(true)
    supabase
      .from('leads')
      .select('id, address, city, state, zip_code, asking_price, bedrooms, bathrooms, sqft, lot_size_sqft, seller_name, phone, email, redfin_trigger_type, lead_source, is_hot, created_at, updated_at, notes, owner_name')
      .eq('workspace_id', workspaceId)
      .eq('status', 'triage')
      .eq('auto_imported', true)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!cancel) {
          setLeads(data || [])
          setLoading(false)
          setSelected(new Set()) // clear selection on reload
        }
      })
    return () => { cancel = true }
  }, [workspaceId, refreshKey])

  // Live counts per trigger type
  const counts = useMemo(() => {
    const c = { all: leads.length }
    for (const t of REDFIN_TRIGGER_TYPES) c[t.value] = 0
    for (const l of leads) {
      const t = l.redfin_trigger_type || 'generic_alert'
      c[t] = (c[t] || 0) + 1
    }
    return c
  }, [leads])

  // Filtered + sorted view
  const visibleLeads = useMemo(() => {
    let rows = activeTrigger === 'all'
      ? leads
      : leads.filter(l => (l.redfin_trigger_type || 'generic_alert') === activeTrigger)
    rows = [...rows].sort((a, b) => {
      switch (sortBy) {
        case 'oldest':     return new Date(a.created_at) - new Date(b.created_at)
        case 'price_high': return (b.asking_price || 0) - (a.asking_price || 0)
        case 'price_low':  return (a.asking_price || 0) - (b.asking_price || 0)
        case 'newest':
        default:           return new Date(b.created_at) - new Date(a.created_at)
      }
    })
    return rows
  }, [leads, activeTrigger, sortBy])

  const updateStatus = async (ids, patch) => {
    setBusyIds(prev => new Set([...prev, ...ids]))
    const { error } = await supabase
      .from('leads')
      .update(patch)
      .in('id', ids)
    if (!error) {
      // Optimistic: remove from local state since they're no longer triage
      if (patch.status && patch.status !== 'triage') {
        setLeads(prev => prev.filter(l => !ids.includes(l.id)))
        setSelected(new Set())
      }
    }
    setBusyIds(prev => {
      const next = new Set(prev)
      ids.forEach(id => next.delete(id))
      return next
    })
  }

  const toggleHot = async (lead) => {
    setBusyIds(prev => new Set([...prev, lead.id]))
    const { data } = await supabase
      .from('leads')
      .update({ is_hot: !lead.is_hot })
      .eq('id', lead.id)
      .select()
      .single()
    if (data) setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, is_hot: data.is_hot } : l))
    setBusyIds(prev => { const n = new Set(prev); n.delete(lead.id); return n })
  }

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const selectAllVisible = () => {
    setSelected(new Set(visibleLeads.map(l => l.id)))
  }

  const clearSelection = () => setSelected(new Set())

  if (loading) return <LoadingSpinner fullPage label="Loading inbox…" />

  const total = leads.length
  const selectedArr = [...selected]
  const hasSelection = selectedArr.length > 0

  return (
    <>
      <Topbar title="Inbox" breadcrumbs={[{ label: workspace.name }, { label: 'Inbox' }]} />

      <div className="px-6 py-6 max-w-[1200px] w-full space-y-5 flex-1">
        <div className="pb-4 border-b border-[color:var(--color-line)]">
          <p className="text-[12px] text-[color:var(--color-text-dim)]">Auto-imports awaiting triage</p>
          <h2 className="text-[22px] font-semibold text-[color:var(--color-text)] tracking-tight mt-1">
            {total === 0
              ? "✓ Inbox zero."
              : `${total} lead${total === 1 ? '' : 's'} awaiting your review.`}
          </h2>
          <p className="text-[13px] text-[color:var(--color-text-muted)] mt-1 leading-relaxed">
            These came in automatically from your connected lead sources (Redfin and others). Promote good ones into your pipeline, or dismiss the rest.
          </p>
        </div>

        {total === 0 ? (
          <EmptyState
            icon="✓"
            title="No new auto-imports waiting."
            description="Connected sources are scanned automatically. Anything new will appear here."
            action={
              <Link to={`/w/${workspaceId}/today`}>
                <Button variant="secondary">Open Today →</Button>
              </Link>
            }
          />
        ) : (
          <>
            {/* Trigger-type segment tabs */}
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setActiveTrigger('all')}
                className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-[12.5px] font-medium transition-all ${
                  activeTrigger === 'all'
                    ? 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text)] ring-1 ring-[color:var(--color-text-dim)]'
                    : 'bg-[color:var(--color-bg-elev)] hover:bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] border border-[color:var(--color-line)]'
                }`}
              >
                All
                {counts.all > 0 && <span className="text-[10.5px] tabular-nums opacity-70">· {counts.all}</span>}
              </button>
              {REDFIN_TRIGGER_TYPES.map(t => {
                const active = activeTrigger === t.value
                const n = counts[t.value] || 0
                return (
                  <button
                    key={t.value}
                    onClick={() => setActiveTrigger(t.value)}
                    className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-[12.5px] font-medium transition-all ${
                      active
                        ? `${TONE_PILL[t.tone]} ring-1`
                        : 'bg-[color:var(--color-bg-elev)] hover:bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] border border-[color:var(--color-line)]'
                    }`}
                  >
                    {t.label}
                    {n > 0 && <span className="text-[10.5px] tabular-nums opacity-70">· {n}</span>}
                  </button>
                )
              })}
            </div>

            {/* Sort + select-all bar */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 text-[12px] text-[color:var(--color-text-muted)]">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={visibleLeads.length > 0 && visibleLeads.every(l => selected.has(l.id))}
                    onChange={(e) => e.target.checked ? selectAllVisible() : clearSelection()}
                    className="accent-[color:var(--color-accent)]"
                  />
                  Select all visible ({visibleLeads.length})
                </label>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-[color:var(--color-text-dim)]">Sort:</label>
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value)}
                  className="h-7 px-2 text-[12px] bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)]"
                >
                  {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            {/* Sticky bulk-action bar */}
            {hasSelection && (
              <div className="sticky top-14 z-10 bg-[color:var(--color-accent-soft)] border border-[color:var(--color-accent)] rounded-lg px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                <div className="text-[13px] font-medium text-[color:var(--color-accent-text)]">
                  {selectedArr.length} selected
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  <Button size="sm" variant="success" onClick={() => updateStatus(selectedArr, { status: 'new_lead' })}>
                    ✓ Promote to New Lead
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => updateStatus(selectedArr, { status: 'not_in_buy_box' })}>
                    📦 Not in Buy Box
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => updateStatus(selectedArr, { status: 'dead_lead' })}>
                    ✗ Dismiss
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
                </div>
              </div>
            )}

            {/* Lead cards */}
            {visibleLeads.length === 0 ? (
              <EmptyState
                icon="○"
                title="No leads in this category"
                description="Try a different filter tab above."
              />
            ) : (
              <div className="space-y-3">
                {visibleLeads.map(lead => {
                  const t = triggerBadgeFor(lead)
                  // "Where the actual source is available, display it" — a
                  // small neutral chip alongside the trigger badge. Redfin
                  // is already obvious from the trigger badge itself, so
                  // skip it there to avoid redundant labeling; every other
                  // source gets its friendly name shown.
                  const sourceLabel = lead.lead_source && lead.lead_source !== 'redfin_auto'
                    ? (LEAD_SOURCE_MAP[lead.lead_source]?.label || lead.lead_source)
                    : null
                  const isSel = selected.has(lead.id)
                  const isBusy = busyIds.has(lead.id)
                  return (
                    <div
                      key={lead.id}
                      className={`bg-[color:var(--color-bg-elev)] border rounded-lg overflow-hidden transition-all ${
                        isSel ? 'border-[color:var(--color-accent)] ring-1 ring-[color:var(--color-accent)]' : 'border-[color:var(--color-line)]'
                      } ${isBusy ? 'opacity-60' : ''}`}
                    >
                      <div className="px-4 py-3 flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggleSelect(lead.id)}
                          className="mt-1.5 accent-[color:var(--color-accent)] shrink-0"
                        />

                        <div className="flex-1 min-w-0">
                          {/* Top row: address + badges */}
                          <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Link
                                  to={`/w/${workspaceId}/leads/${lead.id}`}
                                  className="text-[15px] font-semibold text-[color:var(--color-text)] hover:text-[color:var(--color-accent-text)]"
                                >
                                  {lead.address}
                                </Link>
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ring-inset ${TONE_PILL[t.tone]}`}>
                                  {t.label}
                                </span>
                                {sourceLabel && (
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ring-inset ${TONE_PILL.neutral}`}>
                                    {sourceLabel}
                                  </span>
                                )}
                                {lead.is_hot && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[oklch(0.5_0.22_25)] text-white">
                                    🔥 HOT
                                  </span>
                                )}
                                <DistressBadge lead={lead} />
                              </div>
                              <div className="text-[12px] text-[color:var(--color-text-dim)] mt-0.5">
                                {[lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ')}
                                <span className="mx-1.5">·</span>
                                imported {timeAgo(lead.created_at)}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-[16px] font-bold text-[color:var(--color-accent-text)] tabular-nums leading-tight">
                                {formatCurrency(lead.asking_price)}
                              </div>
                              {lead.sqft && (
                                <div className="text-[11px] text-[color:var(--color-text-dim)] tabular-nums">
                                  {lead.bedrooms || '—'}bd · {lead.bathrooms || '—'}ba · {lead.sqft?.toLocaleString()}sqft
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Agent row */}
                          {(lead.seller_name || lead.phone || lead.email) && (
                            <div className="mt-2 text-[12px] flex flex-wrap items-center gap-x-3 gap-y-1">
                              {lead.seller_name && (
                                <span className="text-[color:var(--color-text-muted)]">
                                  <span className="text-[color:var(--color-text-dim)]">Agent:</span> {lead.seller_name}
                                </span>
                              )}
                              {safeTelHref(lead.phone) && (
                                <a href={safeTelHref(lead.phone)} className="text-[color:var(--color-accent-text)] hover:underline">
                                  📞 {formatPhone(lead.phone)}
                                </a>
                              )}
                              {safeMailtoHref(lead.email) && (
                                <a href={safeMailtoHref(lead.email)} className="text-[color:var(--color-accent-text)] hover:underline">
                                  ✉ {lead.email}
                                </a>
                              )}
                            </div>
                          )}

                          {/* Action row */}
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <Button
                              size="sm"
                              variant="success"
                              onClick={() => updateStatus([lead.id], { status: 'new_lead' })}
                              disabled={isBusy}
                            >
                              ✓ Promote
                            </Button>
                            <Button
                              size="sm"
                              variant={lead.is_hot ? 'danger' : 'secondary'}
                              onClick={() => toggleHot(lead)}
                              disabled={isBusy}
                            >
                              🔥 {lead.is_hot ? 'Unmark Hot' : 'Mark Hot'}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => updateStatus([lead.id], { status: 'not_in_buy_box' })}
                              disabled={isBusy}
                            >
                              📦 Not in Buy Box
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => updateStatus([lead.id], { status: 'dead_lead' })}
                              disabled={isBusy}
                            >
                              ✗ Dismiss
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
