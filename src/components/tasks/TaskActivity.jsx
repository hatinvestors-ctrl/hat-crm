import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDateTime } from '../../lib/calculations'

export default function TaskActivity({ taskId, refreshKey }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!taskId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('task_activities')
        .select('*, profiles:user_id(full_name)')
        .eq('task_id', taskId)
        .order('created_at', { ascending: false })
        .limit(100)
      if (!cancelled) { setItems(data || []); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [taskId, refreshKey])

  if (loading) return <div className="text-[12px] text-[color:var(--color-text-dim)] px-1">Loading activity…</div>

  if (items.length === 0) {
    return <div className="text-[12px] text-[color:var(--color-text-dim)] text-center py-3">No activity yet.</div>
  }

  return (
    <ol className="relative border-l border-[color:var(--color-line)] ml-1.5 space-y-3">
      {items.map(item => {
        const isComment = item.type === 'comment'
        const initial = (item.profiles?.full_name || '?').charAt(0).toUpperCase()
        return (
          <li key={item.id} className="ml-3.5 relative">
            <span className={`absolute -left-[19px] top-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-semibold text-white ${
              isComment ? 'bg-[color:var(--color-accent)]' : 'bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] text-[color:var(--color-text-dim)]'
            }`}>
              {isComment ? initial : '·'}
            </span>
            <div className="text-[11px] text-[color:var(--color-text-dim)]">
              <span className="font-medium text-[color:var(--color-text-muted)]">{item.profiles?.full_name || 'Someone'}</span>
              <span className="mx-1.5">·</span>
              {formatDateTime(item.created_at)}
            </div>
            <div className={`mt-0.5 text-[13px] whitespace-pre-wrap leading-snug ${
              isComment ? 'text-[color:var(--color-text)]' : 'text-[color:var(--color-text-muted)] italic'
            }`}>
              {item.content}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
