import { useEffect, useState } from 'react'
import Card from '../ui/Card'
import { supabase } from '../../lib/supabase'
import { formatDateTime } from '../../lib/calculations'

// Final Convergence Pass, Part 16/17 — "turn logs into deal history,"
// PRESENTATION ONLY. Every string here is matched against the EXACT
// formats activityLogger.js already writes (describeField()/logDealAnalysis()
// etc) — nothing is rewritten in the database, nothing invented for a
// pattern that doesn't already exist. Unmatched content (comments, free
// text) falls through to the original plain rendering unchanged.
const K = (n) => { const v = Number(n); return Number.isFinite(v) ? (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${v}`) : n }

function formatActivityEvent(content) {
  if (!content) return null
  let m
  if ((m = content.match(/^MAO changed from \$?([\d,]+|—) to \$?([\d,]+|—)$/))) {
    return { label: 'MAX BUY UPDATED', value: `${K(m[1].replace(/,/g, ''))} → ${K(m[2].replace(/,/g, ''))}` }
  }
  if ((m = content.match(/^Offer price changed from \$?([\d,]+|—) to \$?([\d,]+|—)$/))) {
    return { label: 'OFFER UPDATED', value: `${K(m[1].replace(/,/g, ''))} → ${K(m[2].replace(/,/g, ''))}` }
  }
  if ((m = content.match(/^Status changed from "(.+)" to "(.+)"$/))) {
    return { label: 'STATUS CHANGED', value: `${m[1]} → ${m[2]}` }
  }
  if ((m = content.match(/^Follow-up date changed from (.+) to (.+)$/))) {
    return { label: 'FOLLOW-UP SCHEDULED', value: m[2] }
  }
  if ((m = content.match(/^Contract sign date changed from (.+) to (.+)$/))) {
    return { label: 'CONTRACT SIGNED', value: m[2] }
  }
  if ((m = content.match(/^Deal analysis run — Verdict: (.+) \/ (.+) profit \/ (.+) ROI$/))) {
    return { label: 'ANALYSIS COMPLETED', value: `${m[1]} · ${m[2]} profit · ${m[3]} ROI` }
  }
  if ((m = content.match(/^Email sent to (.+) — Subject: "(.+)"$/))) {
    return { label: 'EMAIL SENT', value: `To ${m[1]} — "${m[2]}"` }
  }
  if (content === 'Lead created') return { label: 'LEAD CREATED', value: null }
  return null
}

// Phase 2.1 — `maxItems`/`title`/`emptyMessage` are additive, optional
// props (all default to prior behavior: show everything fetched, "Activity"
// title, "No activity yet.") so this can be reused as a compact recent-
// activity strip (e.g. Acquisition tab) without a second fetch/render
// implementation. No change to what's queried or how events are logged.
// Final UX Polish — `onCountLoaded` is an additive, optional callback
// (fires with items.length once loaded) so the Activity tab label can show
// "Activity · 12" without a second query; unused callers are unaffected.
export default function ActivityTimeline({ leadId, refreshKey, maxItems, title = 'Activity', emptyMessage = 'No activity recorded yet. Calls, notes, status changes and follow-ups will appear here.', onCountLoaded }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!leadId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('lead_activities')
        .select('*, profiles:user_id(full_name, avatar_url)')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
        .limit(100)
      if (!cancelled) { setItems(data || []); setLoading(false); onCountLoaded?.((data || []).length) }
    }
    load()
    return () => { cancelled = true }
  }, [leadId, refreshKey])

  if (loading) return <Card title={title}><div className="text-[13px] text-[color:var(--color-text-dim)]">Loading…</div></Card>

  const visible = maxItems ? items.slice(0, maxItems) : items

  return (
    <Card title={title}>
      {items.length === 0 ? (
        <div className="text-[13px] text-[color:var(--color-text-dim)] text-center py-4 leading-snug">{emptyMessage}</div>
      ) : (
        <ol className="relative border-l border-[color:var(--color-line)] ml-1.5 space-y-3">
          {visible.map(item => {
            const isComment = item.type === 'comment'
            const isEnrichment = item.type === 'enrichment'
            const isStatusChange = item.type === 'status_change'
            const initial = (item.profiles?.full_name || '?').charAt(0).toUpperCase()
            const dotCls = isComment
              ? 'bg-[color:var(--color-accent)] text-white'
              : isStatusChange
                ? 'bg-[color:var(--color-warn)] text-white'
                : isEnrichment
                  ? 'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)] border border-[color:var(--color-accent)]'
                  : 'bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] text-[color:var(--color-text-dim)]'
            const dotChar = isComment ? initial : isStatusChange ? '!' : isEnrichment ? '✨' : '·'
            const event = !isComment ? formatActivityEvent(item.content) : null
            return (
              <li key={item.id} className="ml-3.5 relative">
                <span className={`absolute -left-[19px] top-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-semibold ${dotCls}`}>
                  {dotChar}
                </span>
                <div className="text-[11px] text-[color:var(--color-text-dim)]">
                  <span className="font-medium text-[color:var(--color-text-muted)]">{item.profiles?.full_name || (isEnrichment || isStatusChange ? 'System' : 'Someone')}</span>
                  <span className="mx-1.5">·</span>
                  {formatDateTime(item.created_at)}
                </div>
                {event ? (
                  <div className="mt-0.5">
                    <div className="text-[9.5px] font-bold uppercase tracking-wide text-[color:var(--color-text-dim)]">{event.label}</div>
                    {event.value && <div className="text-[13px] font-semibold text-[color:var(--color-text)] tabular-nums">{event.value}</div>}
                  </div>
                ) : (
                  <div className={`mt-0.5 text-[13px] whitespace-pre-wrap leading-snug ${
                    isComment
                      ? 'text-[color:var(--color-text)]'
                      : isStatusChange
                        ? 'text-[color:var(--color-warn-text)] font-medium'
                        : isEnrichment
                          ? 'text-[color:var(--color-text-muted)]'
                          : 'text-[color:var(--color-text-muted)]'
                  }`}>
                    {item.content}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}
