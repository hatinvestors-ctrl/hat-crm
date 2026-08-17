import React from 'react'
import { Link } from 'react-router-dom'
import Badge from '../ui/Badge'
import EmptyState from '../ui/EmptyState'
import { formatCurrency, formatDate, calculateFlipMAO } from '../../lib/calculations'
import { safeTelHref, safeMailtoHref } from '../../lib/urlSafety'
import { MLS_STATUS_MAP, LEAD_SOURCE_MAP } from '../../lib/constants'
import { isDistressedLead } from '../../lib/distressInfo'

const MLS_TONE = {
  success: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]',
  warn:    'bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)]',
  danger:  'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)]',
  accent:  'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]',
  neutral: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)]',
}

function MlsPill({ status, dom }) {
  if (!status) return <span className="text-[color:var(--color-text-dim)]">—</span>
  const meta = MLS_STATUS_MAP[status]
  if (!meta) return <span className="text-[color:var(--color-text-dim)]">{status}</span>
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-medium ${MLS_TONE[meta.tone]}`} title={meta.hint}>
        {meta.label}
      </span>
      {typeof dom === 'number' && (
        <span className="text-[10.5px] text-[color:var(--color-text-dim)] tabular-nums" title={`${dom} days on market`}>{dom}d</span>
      )}
    </span>
  )
}

function dateBucketLabel(iso) {
  if (!iso) return 'No date'
  const d = new Date(iso)
  const today = new Date(); today.setHours(0,0,0,0)
  const dDay = new Date(d); dDay.setHours(0,0,0,0)
  const diff = Math.round((today - dDay) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff > 1 && diff < 7) return `${diff} days ago`
  if (diff >= 7 && diff < 30) return `${Math.floor(diff / 7)} week${Math.floor(diff / 7) === 1 ? '' : 's'} ago`
  if (diff >= 30 && diff < 365) return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  if (diff < 0) {
    const future = Math.abs(diff)
    if (future === 1) return 'Tomorrow'
    if (future < 7) return `In ${future} days`
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  }
  return d.toLocaleDateString('en-US', { year: 'numeric' })
}

export default function LeadsTable({ leads, members = [], workspaceId, sortBy, sortOrder, onSort, groupByDate = null, selectable = false, selected, onToggle, onToggleAllVisible }) {
  const memberMap = Object.fromEntries(members.map(m => [m.user_id, m.profiles]))
  const selSet = selected instanceof Set ? selected : new Set(selected || [])

  if (!leads || leads.length === 0) {
    return (
      <EmptyState
        icon="○"
        title="No leads match these filters"
        description="Try clearing filters, or add your first lead to get started."
      />
    )
  }

  const SortHeader = ({ field, children, align = 'left' }) => {
    const active = sortBy === field
    return (
      <th
        onClick={() => onSort?.(field)}
        className={`px-3 h-9 text-${align} text-[10.5px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)] cursor-pointer hover:text-[color:var(--color-text-muted)] transition-colors select-none`}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          {active && <span className="text-[color:var(--color-text-muted)]">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
        </span>
      </th>
    )
  }

  // Group leads by date bucket when groupByDate is set ("created_at" or "follow_up_date")
  let groups = null
  if (groupByDate) {
    const map = new Map()
    for (const l of leads) {
      const bucket = dateBucketLabel(l[groupByDate])
      if (!map.has(bucket)) map.set(bucket, [])
      map.get(bucket).push(l)
    }
    groups = Array.from(map.entries())
  }

  const renderRow = (lead) => {
    const assignee = memberMap[lead.assigned_to]
    const isSel = selSet.has(lead.id)
    // Product Decision — Canonical Deal Values (Defect D2, see
    // RELEASE-READINESS.md). This column used to show the stored
    // lead.mao (the legacy 0.75xARV-Reno-2450 formula, auto-recalculated
    // by FinancialSection's own ARV/Reno handlers, sometimes stale/
    // manually overridden) — a different number than the canonical Flip
    // Max Buy the Lead Workspace Deal tab shows for the exact same lead.
    // Computed fresh here, same as the Deal tab, never persisted.
    const canonicalMao = calculateFlipMAO(lead.arv, lead.renovation_cost)
    return (
      <tr key={lead.id} className={`hover:bg-[color:var(--color-bg-elev-2)] transition-colors group ${lead.is_hot ? 'bg-[oklch(0.22_0.04_25/0.4)]' : ''} ${isSel ? 'bg-[color:var(--color-accent-soft)]' : ''}`}>
        {selectable && (
          <td className="px-2 py-2.5 w-8 align-middle" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={isSel}
              onChange={() => onToggle?.(lead.id)}
              className="accent-[color:var(--color-accent)] cursor-pointer"
              aria-label={`Select ${lead.address}`}
            />
          </td>
        )}
        <td className={`px-3 py-2.5 relative ${lead.is_hot ? 'border-l-2 border-l-[oklch(0.65_0.22_25)]' : ''}`}>
          <div className="flex items-center gap-1.5">
            {lead.is_hot && <span className="text-[13px]" title="Hot lead">🔥</span>}
            {lead.auto_imported && (
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[oklch(0.32_0.12_25/0.6)] text-[oklch(0.85_0.16_25)] uppercase tracking-wider"
                title={
                  // Capability #6.1 — source-neutral: only names the source
                  // when we actually know a friendly one, otherwise stays generic.
                  LEAD_SOURCE_MAP[lead.lead_source]
                    ? `Auto-imported from ${LEAD_SOURCE_MAP[lead.lead_source].label.replace(/^🤖\s*/, '')} — not yet human-vetted`
                    : 'Auto-imported — not yet human-vetted'
                }
              >
                🤖 auto
              </span>
            )}
            <Link to={`/w/${workspaceId}/leads/${lead.id}`} className="text-[color:var(--color-text)] hover:text-[color:var(--color-accent-text)] font-medium">
              {lead.address || <span className="text-[color:var(--color-text-dim)]">(no address)</span>}
            </Link>
          </div>
        </td>
        <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">{lead.city || '—'}</td>
        <td className="px-3 py-2.5"><Badge status={lead.status} /></td>
        <td className="px-3 py-2.5"><MlsPill status={lead.mls_status} dom={lead.days_on_market} /></td>
        <td className="px-3 py-2.5 text-right text-[color:var(--color-text)] tabular-nums">{formatCurrency(lead.list_price || lead.asking_price)}</td>
        <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">
          {lead.visible_to_all
            ? <span className="inline-flex items-center px-1.5 h-[18px] rounded text-[10.5px] font-semibold bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]">ALL</span>
            : assignee?.full_name || <span className="text-[color:var(--color-text-dim)]">—</span>
          }
        </td>
        <td className="px-3 py-2.5 text-[color:var(--color-text-muted)] capitalize">
          {isDistressedLead(lead)
            ? <span className="text-amber-700 dark:text-amber-400 font-semibold normal-case">⚠ Off-Market</span>
            : (lead.lead_source || '').replace(/_/g, ' ') || '—'}
        </td>
        <td className="px-3 py-2.5 text-right text-[color:var(--color-text)] tabular-nums">{formatCurrency(lead.arv)}</td>
        <td className="px-3 py-2.5 text-right text-[color:var(--color-text)] tabular-nums font-medium">{formatCurrency(canonicalMao)}</td>
        <td className="px-3 py-2.5 text-right text-[color:var(--color-text)] tabular-nums">{formatCurrency(lead.offer_price)}</td>
        <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">{lead.follow_up_date ? formatDate(lead.follow_up_date) : '—'}</td>
        <td className="px-3 py-2.5 text-[color:var(--color-text-dim)] text-[11.5px]">{formatDate(lead.created_at)}</td>
        <td className="px-2 py-2.5 text-right whitespace-nowrap">
          <div className="inline-flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            {safeTelHref(lead.phone) && (
              <a
                href={safeTelHref(lead.phone)}
                onClick={(e) => e.stopPropagation()}
                title={`Call ${lead.phone}`}
                className="w-7 h-7 inline-flex items-center justify-center rounded hover:bg-[color:var(--color-accent-soft)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent-text)] transition-colors"
              >
                📞
              </a>
            )}
            {safeMailtoHref(lead.email) && (
              <a
                href={safeMailtoHref(lead.email)}
                onClick={(e) => e.stopPropagation()}
                title={`Email ${lead.email}`}
                className="w-7 h-7 inline-flex items-center justify-center rounded hover:bg-[color:var(--color-accent-soft)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent-text)] transition-colors"
              >
                ✉
              </a>
            )}
            {lead.address && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([lead.address, lead.city, lead.state].filter(Boolean).join(', '))}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title="View on Google Maps"
                className="w-7 h-7 inline-flex items-center justify-center rounded hover:bg-[color:var(--color-accent-soft)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent-text)] transition-colors"
              >
                🏠
              </a>
            )}
          </div>
        </td>
      </tr>
    )
  }

  return (
    <div className="bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="border-b border-[color:var(--color-line)]">
            <tr>
              {selectable && (
                <th className="px-2 h-9 w-8 align-middle">
                  <input
                    type="checkbox"
                    checked={leads.length > 0 && leads.every(l => selSet.has(l.id))}
                    onChange={(e) => onToggleAllVisible?.(e.target.checked)}
                    className="accent-[color:var(--color-accent)] cursor-pointer"
                    aria-label="Select all"
                  />
                </th>
              )}
              <SortHeader field="address">Address</SortHeader>
              <SortHeader field="city">City</SortHeader>
              <SortHeader field="status">Status</SortHeader>
              <SortHeader field="mls_status">MLS</SortHeader>
              <SortHeader field="list_price" align="right">List $</SortHeader>
              <th className="px-3 h-9 text-left text-[10.5px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">Assigned</th>
              <SortHeader field="lead_source">Source</SortHeader>
              <SortHeader field="arv" align="right">ARV</SortHeader>
              <SortHeader field="mao" align="right">MAO</SortHeader>
              <SortHeader field="offer_price" align="right">Offer</SortHeader>
              <SortHeader field="follow_up_date">Follow-up</SortHeader>
              <SortHeader field="created_at">Created</SortHeader>
              <th className="px-2 h-9 w-px" aria-label="Quick actions" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--color-line)]">
            {groups
              ? groups.map(([bucket, items]) => (
                  <React.Fragment key={bucket}>
                    <tr className="bg-[color:var(--color-bg)]">
                      <td colSpan={selectable ? 14 : 13} className="px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[color:var(--color-text-dim)]">
                        {bucket} <span className="font-normal text-[color:var(--color-text-faint)] ml-1">· {items.length}</span>
                      </td>
                    </tr>
                    {items.map(renderRow)}
                  </React.Fragment>
                ))
              : leads.map(renderRow)}
          </tbody>
        </table>
      </div>
    </div>
  )
}
