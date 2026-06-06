// src/components/agents/AgentActivityFeed.jsx
import { useState, useEffect } from 'react'
import Button from '../ui/Button'
import AgentLogForm from './AgentLogForm'
import { supabase } from '../../lib/supabase'
import { formatDateTime } from '../../lib/calculations'

const TYPE_META = {
  email_sent: { icon: '📧', label: 'Email sent',  border: 'border-blue-600',   bg: 'bg-blue-950/40'   },
  call:       { icon: '📞', label: 'Call',         border: 'border-green-600',  bg: 'bg-green-950/40'  },
  meeting:    { icon: '🤝', label: 'Meeting',      border: 'border-amber-600',  bg: 'bg-amber-950/40'  },
  text:       { icon: '💬', label: 'Text',         border: 'border-purple-600', bg: 'bg-purple-950/40' },
  other:      { icon: '•',  label: 'Interaction',  border: 'border-[color:var(--color-line)]', bg: 'bg-[color:var(--color-bg-elev)]' },
}

export default function AgentActivityFeed({ agentId, workspaceId, userId }) {
  const [activities, setActivities]   = useState([])
  const [comments, setComments]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [showLogForm, setShowLogForm] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [posting, setPosting]         = useState(false)
  const [commentError, setCommentError] = useState('')
  const [refreshKey, setRefreshKey]   = useState(0)

  useEffect(() => {
    if (!agentId) return
    let cancelled = false
    setLoading(true)

    Promise.all([
      supabase
        .from('agent_activities')
        .select('*')
        .eq('agent_id', agentId)
        .order('occurred_at', { ascending: false })
        .limit(100),
      supabase
        .from('agent_comments')
        .select('*, profiles:user_id(full_name)')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false })
        .limit(100),
    ]).then(([{ data: acts }, { data: cmts }]) => {
      if (cancelled) return
      setActivities(acts || [])
      setComments(cmts || [])
      setLoading(false)
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [agentId, refreshKey])

  const refresh = () => setRefreshKey(k => k + 1)

  const postComment = async () => {
    if (!commentText.trim()) return
    setPosting(true)
    setCommentError('')
    const { error: err } = await supabase.from('agent_comments').insert({
      workspace_id: workspaceId,
      agent_id:     agentId,
      user_id:      userId,
      body:         commentText.trim(),
    })
    setPosting(false)
    if (err) { setCommentError(err.message); return }
    setCommentText('')
    refresh()
  }

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Section header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[color:var(--color-line)] shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">History & Comments</span>
        <button
          onClick={() => setShowLogForm(v => !v)}
          className="text-[11px] px-2 py-0.5 rounded bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] transition-colors"
        >
          {showLogForm ? 'Cancel' : '+ Log interaction'}
        </button>
      </div>

      {/* Inline log form */}
      {showLogForm && (
        <div className="shrink-0">
          <AgentLogForm
            agentId={agentId}
            workspaceId={workspaceId}
            userId={userId}
            onSaved={() => { setShowLogForm(false); refresh() }}
            onCancel={() => setShowLogForm(false)}
          />
        </div>
      )}

      {/* Scrollable feed */}
      <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2 min-h-0">
        {loading ? (
          <div className="text-[12px] text-[color:var(--color-text-dim)] py-4 text-center">Loading…</div>
        ) : (
          <>
            {activities.length === 0 && (
              <div className="text-[12px] text-[color:var(--color-text-dim)] italic py-2">No interactions yet.</div>
            )}
            {activities.map(act => {
              const meta = TYPE_META[act.type] || TYPE_META.other
              return (
                <div key={act.id} className={`border-l-2 pl-3 py-1.5 rounded-r ${meta.border} ${meta.bg}`}>
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-[color:var(--color-text-muted)]">{meta.icon} {meta.label}</span>
                    <span className="text-[10px] text-[color:var(--color-text-dim)]">{formatDateTime(act.occurred_at)}</span>
                  </div>
                  {act.note && (
                    <div className="text-[11px] text-[color:var(--color-text-dim)] mt-0.5 leading-snug">{act.note}</div>
                  )}
                </div>
              )
            })}

            {/* Comments divider */}
            <div className="flex items-center gap-2 my-1">
              <div className="flex-1 h-px bg-[color:var(--color-line)]" />
              <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Comments</span>
              <div className="flex-1 h-px bg-[color:var(--color-line)]" />
            </div>

            {comments.length === 0 && (
              <div className="text-[12px] text-[color:var(--color-text-dim)] italic py-1">No comments yet.</div>
            )}
            {comments.map(c => (
              <div key={c.id} className="bg-[color:var(--color-bg-elev-2)] rounded-md px-3 py-2">
                <div className="flex justify-between items-center mb-0.5">
                  <span className="text-[11px] font-medium text-[color:var(--color-text-muted)]">
                    {c.profiles?.full_name || 'Team member'}
                  </span>
                  <span className="text-[10px] text-[color:var(--color-text-dim)]">{formatDateTime(c.created_at)}</span>
                </div>
                <div className="text-[12px] text-[color:var(--color-text)] leading-snug whitespace-pre-wrap">{c.body}</div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Pinned comment input */}
      <div className="shrink-0 px-3 py-2 border-t border-[color:var(--color-line)] bg-[color:var(--color-bg)]">
        <div className="bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-lg px-3 py-2 focus-within:border-[color:var(--color-accent)] focus-within:ring-1 focus-within:ring-[color:var(--color-accent)] transition-colors">
          {commentError && (
            <div className="text-[11px] text-[color:var(--color-danger-text)] mb-1">{commentError}</div>
          )}
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Leave a comment…"
            rows={2}
            className="w-full text-[12px] text-[color:var(--color-text)] bg-transparent placeholder:text-[color:var(--color-text-faint)] resize-none focus:outline-none leading-relaxed"
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={postComment} loading={posting} disabled={!commentText.trim()}>Post</Button>
          </div>
        </div>
      </div>

    </div>
  )
}
