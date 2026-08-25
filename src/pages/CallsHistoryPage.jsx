// src/pages/CallsHistoryPage.jsx
// Capability #25.1 (Part 13/14), improved in #25.3 (Part 17). Reuses the
// SAME coaching data CoachingLayout already fetched (Part 24 — avoid a
// second competing query for rows the shell already has) rather than
// issuing its own call_sessions read. RLS still does all real scoping —
// this page never re-implements admin/member visibility.
import { useMemo, useState } from 'react'
import { useOutletContext, Link } from 'react-router-dom'
import LoadingSpinner from '../components/ui/LoadingSpinner'
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
const RESULT_TONE = { APPLIED: 'var(--color-success-text)', NOT_APPLIED: 'var(--color-danger-text)', PARTIALLY_APPLIED: 'var(--color-warn-text)', NOT_APPLICABLE: 'var(--color-text-dim)' }

export default function CallsHistoryPage() {
  const { user, userRole, members, coaching } = useOutletContext()
  const [repFilter, setRepFilter] = useState('ALL')
  const [reviewFilter, setReviewFilter] = useState('ALL') // ALL | REVIEWED | NOT_REVIEWED
  const [outcomeFilter, setOutcomeFilter] = useState('ALL')
  const [focusResultFilter, setFocusResultFilter] = useState('ALL')

  // Join the shell's already-fetched sessions/reviews/evaluations client-
  // side — a plain in-memory join, not a new query.
  const annotated = useMemo(() => (coaching.sessions || []).map(s => {
    const review = coaching.reviews.find(r => r.call_session_id === s.id) || null
    const evalRow = coaching.evaluations.find(e => e.call_session_id === s.id) || null
    return { ...s, review, hasReview: !!review, focusResult: evalRow?.result || null }
  }), [coaching.sessions, coaching.reviews, coaching.evaluations])

  const filtered = useMemo(() => {
    let rows = filterCallSessions(annotated, {
      repId: repFilter,
      reviewedOnly: reviewFilter === 'REVIEWED',
      notReviewedOnly: reviewFilter === 'NOT_REVIEWED',
      outcome: outcomeFilter,
    })
    if (focusResultFilter !== 'ALL') rows = rows.filter(r => r.focusResult === focusResultFilter)
    return rows
  }, [annotated, repFilter, reviewFilter, outcomeFilter, focusResultFilter])

  const repName = (repId) => members?.find(m => m.user_id === repId)?.profiles?.full_name || (repId === user.id ? 'You' : 'Unknown')
  const fmtMovement = (s) => (s.seller_price_initial != null && s.seller_price_final != null && s.seller_price_initial !== s.seller_price_final)
    ? `${fc(s.seller_price_initial)} → ${fc(s.seller_price_final)}`
    : (s.seller_price_final != null ? fc(s.seller_price_final) : '—')

  if (coaching.loading) return <LoadingSpinner label="Loading calls…" />

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[14px] font-bold text-[color:var(--color-text)]">Calls</div>
        <p className="text-[12px] text-[color:var(--color-text-dim)] mt-0.5">
          {userRole === 'admin' ? 'Every reviewed and unreviewed call in this workspace.' : 'Your calls in this workspace.'}
        </p>
      </div>

      {/* Filters (Part 17) — Agent, Reviewed state, Outcome, Coaching Result. */}
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
        <select value={outcomeFilter} onChange={e => setOutcomeFilter(e.target.value)} className="text-[12px] px-2 py-1.5 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)]">
          <option value="ALL">All Outcomes</option>
          {Object.entries(OUTCOME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={focusResultFilter} onChange={e => setFocusResultFilter(e.target.value)} className="text-[12px] px-2 py-1.5 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)]">
          <option value="ALL">Any Coaching Result</option>
          <option value="APPLIED">Applied</option>
          <option value="PARTIALLY_APPLIED">Partially Applied</option>
          <option value="NOT_APPLIED">Not Applied</option>
          <option value="NOT_APPLICABLE">Not Applicable</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-6 py-10 text-center">
          <div className="text-[14px] font-semibold mb-1">No calls match these filters</div>
          <p className="text-[12px] text-[color:var(--color-text-dim)]">Calls appear here automatically once a Live Copilot session reaches End Call.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="border-b border-[color:var(--color-line)]">
                <tr>
                  {['Date', 'Rep', 'Lead', 'Duration', 'Outcome', 'Score', 'Coverage', 'Coaching Result', 'Seller Movement', 'Review'].map(h => (
                    <th key={h} className="px-3 h-9 text-left text-[10.5px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">{h}</th>
                  ))}
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
                      <td className="px-3 py-2.5" style={{ color: s.focusResult ? RESULT_TONE[s.focusResult] : undefined }}>{s.focusResult ? s.focusResult.replace(/_/g, ' ') : '—'}</td>
                      <td className="px-3 py-2.5 text-[11px] text-[color:var(--color-text-muted)]">{fmtMovement(s)}</td>
                      <td className="px-3 py-2.5">
                        {s.hasReview ? (
                          <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">REVIEWED</span>
                        ) : (
                          <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]">NOT REVIEWED</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <Link to={`${s.id}`} className="text-[11px] font-semibold underline text-[color:var(--color-accent-text)]">Open →</Link>
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
  )
}
