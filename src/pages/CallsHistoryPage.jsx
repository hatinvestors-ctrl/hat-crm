// src/pages/CallsHistoryPage.jsx
// Capability #25.1, Part 13/14 — minimal Calls History. NOT the future
// Team Dashboard/Agent Profile (explicitly deferred) — this exists only to
// prove call_sessions/call_reviews are actually persisted and reviewable.
// All scoping (admin sees workspace, regular member sees own) is enforced
// by RLS on the query itself — this page never re-implements that check.
import { useEffect, useMemo, useState } from 'react'
import { useOutletContext, Link } from 'react-router-dom'
import Topbar from '../components/Topbar'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { supabase } from '../lib/supabase'
import { formatCurrency as fc, formatDate } from '../lib/calculations'
import { filterCallSessions } from '../lib/callSessions'

function formatDuration(seconds) {
  if (seconds == null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const OUTCOME_LABELS = {
  no_answer: 'No Answer', spoke_follow_up: 'Follow-Up', offer_sent: 'Offer Sent',
  offer_rejected: 'Offer Rejected', counter_received: 'Counter Received',
  need_more_info: 'Need Info', not_interested: 'Not Interested', dead_lead: 'Dead Lead',
}

export default function CallsHistoryPage() {
  const { workspace, workspaceId, user, userRole, members } = useOutletContext()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [repFilter, setRepFilter] = useState('ALL')
  const [reviewFilter, setReviewFilter] = useState('ALL') // ALL | REVIEWED | NOT_REVIEWED

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError(null)
      try {
        // RLS does the real scoping (admin: whole workspace, member: own
        // calls only) — this query never adds its own user filter.
        const { data, error } = await supabase
          .from('call_sessions')
          .select('id,lead_id,rep_id,started_at,ended_at,duration_seconds,outcome,follow_up_date,seller_price_initial,seller_price_final,seller_price_movement,coverage_snapshot,leads(address,city),call_reviews(overall_score,coverage)')
          .eq('workspace_id', workspaceId)
          .order('started_at', { ascending: false })
          .limit(100)
        if (error) throw error
        if (!cancelled) setSessions(data || [])
      } catch (err) {
        if (!cancelled) setLoadError(err.message || 'Could not load call history.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [workspaceId])

  const annotated = useMemo(() => sessions.map(s => ({
    ...s,
    hasReview: Array.isArray(s.call_reviews) ? s.call_reviews.length > 0 : !!s.call_reviews,
    review: Array.isArray(s.call_reviews) ? s.call_reviews[0] : s.call_reviews,
  })), [sessions])

  const filtered = useMemo(() => filterCallSessions(annotated, {
    repId: repFilter,
    reviewedOnly: reviewFilter === 'REVIEWED',
    notReviewedOnly: reviewFilter === 'NOT_REVIEWED',
  }), [annotated, repFilter, reviewFilter])

  const repName = (repId) => members?.find(m => m.user_id === repId)?.profiles?.full_name || (repId === user.id ? 'You' : 'Unknown')
  const fmtMovement = (s) => (s.seller_price_initial != null && s.seller_price_final != null && s.seller_price_initial !== s.seller_price_final)
    ? `${fc(s.seller_price_initial)} → ${fc(s.seller_price_final)}`
    : (s.seller_price_final != null ? fc(s.seller_price_final) : '—')

  return (
    <>
      <Topbar title="Coaching · Calls" breadcrumbs={[{ label: workspace.name }, { label: 'Coaching' }, { label: 'Calls' }]} />
      <div className="px-6 py-6 w-full flex-1 space-y-4">
        <div>
          <h1 className="text-[20px] font-bold text-[color:var(--color-text)]">Calls</h1>
          <p className="text-[12.5px] text-[color:var(--color-text-dim)] mt-0.5">
            {userRole === 'admin' ? 'Every reviewed and unreviewed call in this workspace.' : 'Your calls in this workspace.'}
          </p>
        </div>

        {/* Filters — V1 minimal (Part 14): Agent, Reviewed/Not Reviewed. No coaching-focus filter yet. */}
        <div className="flex flex-wrap gap-2 items-center">
          {userRole === 'admin' && (
            <select value={repFilter} onChange={e => setRepFilter(e.target.value)} className="text-[12px] px-2 py-1.5 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)]">
              <option value="ALL">All Agents</option>
              {members?.map(m => <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name || m.user_id}</option>)}
            </select>
          )}
          <select value={reviewFilter} onChange={e => setReviewFilter(e.target.value)} className="text-[12px] px-2 py-1.5 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)]">
            <option value="ALL">All Calls</option>
            <option value="REVIEWED">Reviewed</option>
            <option value="NOT_REVIEWED">Not Reviewed</option>
          </select>
        </div>

        {loadError && (
          <div className="rounded-lg border border-[color:var(--color-danger)] bg-[color:var(--color-danger-soft)] px-4 py-2.5 text-[12px] text-[color:var(--color-danger-text)]">
            Couldn't load call history. {loadError}
          </div>
        )}

        {loading ? <LoadingSpinner label="Loading calls…" /> : filtered.length === 0 ? (
          <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-6 py-10 text-center">
            <div className="text-[14px] font-semibold mb-1">No calls yet</div>
            <p className="text-[12px] text-[color:var(--color-text-dim)]">Calls appear here automatically once a Live Copilot session reaches End Call.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead className="border-b border-[color:var(--color-line)]">
                  <tr>
                    <th className="px-3 h-9 text-left text-[10.5px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">Date</th>
                    <th className="px-3 h-9 text-left text-[10.5px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">Rep</th>
                    <th className="px-3 h-9 text-left text-[10.5px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">Lead</th>
                    <th className="px-3 h-9 text-left text-[10.5px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">Duration</th>
                    <th className="px-3 h-9 text-left text-[10.5px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">Outcome</th>
                    <th className="px-3 h-9 text-left text-[10.5px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">Score</th>
                    <th className="px-3 h-9 text-left text-[10.5px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">Coverage</th>
                    <th className="px-3 h-9 text-left text-[10.5px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">Seller Movement</th>
                    <th className="px-3 h-9 text-left text-[10.5px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">Review</th>
                    <th className="px-3 h-9 w-px" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--color-line)]">
                  {filtered.map(s => {
                    const coverage = s.review?.coverage || s.coverage_snapshot
                    return (
                      <tr key={s.id} className="hover:bg-[color:var(--color-bg-elev-2)] transition-colors">
                        <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">{formatDate(s.started_at)}</td>
                        <td className="px-3 py-2.5">{repName(s.rep_id)}</td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium">{s.leads?.address || '—'}</div>
                          <div className="text-[10.5px] text-[color:var(--color-text-dim)]">{s.leads?.city}</div>
                        </td>
                        <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">{formatDuration(s.duration_seconds)}</td>
                        <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">{s.outcome ? (OUTCOME_LABELS[s.outcome] || s.outcome) : '—'}</td>
                        <td className="px-3 py-2.5 font-bold">{s.review?.overall_score != null ? `${s.review.overall_score}/100` : '—'}</td>
                        <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">{coverage ? `${coverage.capturedCount}/${coverage.total}` : '—'}</td>
                        <td className="px-3 py-2.5 text-[11px] text-[color:var(--color-text-muted)]">{fmtMovement(s)}</td>
                        <td className="px-3 py-2.5">
                          {s.hasReview ? (
                            <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">REVIEWED</span>
                          ) : (
                            <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]">NOT REVIEWED</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <Link to={`../coaching/calls/${s.id}`} className="text-[11px] font-semibold underline text-[color:var(--color-accent-text)]">Open →</Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
