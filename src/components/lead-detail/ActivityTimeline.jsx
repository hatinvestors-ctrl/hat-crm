import { useEffect, useState } from 'react'
import Card from '../ui/Card'
import { supabase } from '../../lib/supabase'
import { formatDateTime } from '../../lib/calculations'

export default function ActivityTimeline({ leadId, refreshKey }) {
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
      if (!cancelled) { setItems(data || []); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [leadId, refreshKey])

  if (loading) return <Card title="Activity"><div className="text-[13px] text-[color:var(--color-text-dim)]">Loading…</div></Card>

  return (
    <Card title="Activity">
      {items.length === 0 ? (
        <div className="text-[13px] text-[color:var(--color-text-dim)] text-center py-4">No activity yet.</div>
      ) : (
        <ol className="relative border-l border-[color:var(--color-line)] ml-1.5 space-y-3">
          {items.map(item => {
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
                <div className={`mt-0.5 text-[13px] whitespace-pre-wrap leading-snug ${
                  isComment
                    ? 'text-[color:var(--color-text)]'
                    : isStatusChange
                      ? 'text-[color:var(--color-warn-text)] font-medium'
                      : isEnrichment
                        ? 'text-[color:var(--color-text-muted)]'
                        : 'text-[color:var(--color-text-muted)] italic'
                }`}>
                  {item.content}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}
