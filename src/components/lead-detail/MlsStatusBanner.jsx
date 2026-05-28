import { MLS_STATUS_MAP } from '../../lib/constants'
import { enrichLead } from '../../lib/enrichment'
import { useState } from 'react'

const TONE_BG = {
  success: 'from-[oklch(0.35_0.15_150)] to-[oklch(0.28_0.10_150)] border-[color:var(--color-success)]',
  warn:    'from-[oklch(0.42_0.15_75)]  to-[oklch(0.32_0.10_75)]  border-[color:var(--color-warn)]',
  danger:  'from-[oklch(0.40_0.18_25)]  to-[oklch(0.30_0.12_25)]  border-[color:var(--color-danger)]',
  accent:  'from-[oklch(0.40_0.15_230)] to-[oklch(0.30_0.10_230)] border-[color:var(--color-accent)]',
  neutral: 'from-[color:var(--color-bg-elev-2)] to-[color:var(--color-bg-elev)] border-[color:var(--color-line)]',
}

function timeAgo(iso) {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export default function MlsStatusBanner({ lead, onUpdated, paused = false }) {
  const [refreshing, setRefreshing] = useState(false)
  const [err, setErr] = useState(null)

  // Paused state — show a clear notice instead of the rich banner.
  if (paused) {
    return (
      <div className="bg-[color:var(--color-warn-soft)] border border-[color:var(--color-warn)] rounded-lg px-4 py-2.5 flex items-center gap-2 text-[color:var(--color-warn-text)]">
        <span>⏸</span>
        <span className="text-[12.5px]">
          <strong>MLS auto-enrichment paused.</strong> No RentCast calls are being made.
          Toggle in <span className="underline">Settings → MLS Auto-Refresh</span> when you're ready to resume.
        </span>
      </div>
    )
  }

  // Don't show until the lead has been enriched at least once
  if (!lead.mls_last_checked && !lead.mls_status) return null

  const meta = lead.mls_status ? MLS_STATUS_MAP[lead.mls_status] : null
  const toneCls = TONE_BG[meta?.tone || 'neutral']
  const checkedAgo = timeAgo(lead.mls_last_checked)
  const isStale = lead.mls_last_checked
    ? (Date.now() - new Date(lead.mls_last_checked).getTime()) > 24 * 3600 * 1000
    : true

  // If the MLS feed itself hasn't seen this listing recently, the data may be outdated.
  const listing = lead.enrichment_data?.listing
  const lastSeenDate = listing?.lastSeenDate || null
  const lastSeenAgeDays = lastSeenDate
    ? Math.floor((Date.now() - new Date(lastSeenDate).getTime()) / 86400000)
    : null
  const dataMayBeStale = lastSeenAgeDays !== null && lastSeenAgeDays > 30

  // RentCast collapses MLS state to Active/Inactive. If raw was Inactive but we
  // mapped to a more specific status (pending/withdrawn/sold), flag it as inferred.
  const rawStatus = (listing?.status || '').toLowerCase()
  const isInferred = rawStatus === 'inactive' && lead.mls_status && lead.mls_status !== 'off_market'

  const handleRefresh = async () => {
    setRefreshing(true); setErr(null)
    try {
      const r = await enrichLead(lead.id, { force: true })
      if (!r.ok) setErr(r.error || 'Refresh failed')
      else if (r.lead) onUpdated?.(r.lead)
    } catch (e) { setErr(e.message) }
    finally { setRefreshing(false) }
  }

  return (
    <div className={`bg-gradient-to-r ${toneCls} border rounded-lg px-4 py-3 flex items-center gap-4 flex-wrap`}>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {meta ? (
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-white/60 font-semibold">MLS Status</span>
            <span className="text-[18px] font-semibold text-white tracking-tight leading-none">
              {meta.label}
              {isInferred && <span className="text-[10.5px] font-normal text-white/70 ml-1">(inferred)</span>}
              {dataMayBeStale && <span className="text-[10.5px] font-normal text-[oklch(0.85_0.15_75)] ml-1">⚠ stale data</span>}
            </span>
            {meta.hint && !dataMayBeStale && <span className="text-[11px] text-white/70 mt-0.5">{meta.hint}</span>}
            {dataMayBeStale && <span className="text-[11px] text-white/80 mt-0.5">RentCast data is {lastSeenAgeDays}d old — verify on Zillow ↗</span>}
          </div>
        ) : (
          <div className="text-[13px] text-[color:var(--color-text-muted)] italic">No MLS data yet — click Refresh.</div>
        )}

        <div className="hidden sm:block w-px h-10 bg-white/15" />

        {typeof lead.days_on_market === 'number' && (
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-white/60 font-semibold">Days on market</span>
            <span className="text-[18px] font-semibold text-white tabular-nums leading-none">{lead.days_on_market}</span>
          </div>
        )}

        {lead.list_price && (
          <>
            <div className="hidden sm:block w-px h-10 bg-white/15" />
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-white/60 font-semibold">List Price</span>
              <span className="text-[18px] font-semibold text-white tabular-nums leading-none">
                ${Number(lead.list_price).toLocaleString()}
              </span>
              {lead.list_date && <span className="text-[10.5px] text-white/60 mt-0.5">since {lead.list_date}</span>}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span className={`text-[11px] ${isStale ? 'text-[color:var(--color-warn-text)]' : 'text-white/60'}`}>
          {checkedAgo ? `checked ${checkedAgo}` : 'never checked'}
          {isStale && lead.mls_last_checked && ' · stale'}
        </span>
        {lead.zillow_url && (
          <a
            href={lead.zillow_url}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] px-2.5 h-7 inline-flex items-center rounded bg-white/15 hover:bg-white/25 text-white border border-white/20 transition-colors"
            title="Open this listing on Zillow to verify current status"
          >
            Zillow ↗
          </a>
        )}
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-[11px] px-2.5 h-7 rounded bg-white/15 hover:bg-white/25 text-white border border-white/20 disabled:opacity-50 transition-colors"
        >
          {refreshing ? '⟳ Refreshing…' : '✨ Refresh'}
        </button>
      </div>
      {err && <div className="w-full text-[11px] text-[color:var(--color-danger-text)] bg-black/30 px-2 py-1 rounded">{err}</div>}
      {dataMayBeStale && (
        <div className="w-full text-[11px] text-white/80 bg-black/30 px-2 py-1.5 rounded flex items-start gap-1.5">
          <span>⚠️</span>
          <span>
            MLS feed last saw this listing <strong>{lastSeenAgeDays} days ago</strong> ({lastSeenDate?.slice(0, 10)}).
            The seller may have re-listed since then — verify on Zillow or directly with the agent.
          </span>
        </div>
      )}
    </div>
  )
}
