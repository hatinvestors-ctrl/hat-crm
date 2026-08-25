// src/pages/CoachingAgentsPage.jsx
// Capability #25.3, Part 9 — the browse/search layer. Same aggregation as
// the Team table, presented as scannable cards with a name search.
import { useMemo, useState } from 'react'
import { useOutletContext, Link } from 'react-router-dom'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { groupByRep } from '../hooks/useCoachingData'
import { aggregateAgentRow } from '../lib/coachingAnalytics'
import { formatDate } from '../lib/calculations'

export default function CoachingAgentsPage() {
  const { coaching, members, user } = useOutletContext()
  const [search, setSearch] = useState('')

  const byRep = useMemo(() => groupByRep(coaching.sessions, coaching.reviews, coaching.evaluations, coaching.activeFocuses), [coaching])
  const repName = (repId) => members?.find(m => m.user_id === repId)?.profiles?.full_name || (repId === user.id ? 'You' : 'Unknown')

  const agentRows = useMemo(() => Object.values(byRep).map(rep => {
    const lastCall = rep.sessions[0] // sessions already ordered started_at desc from the fetch
    return {
      repId: rep.repId,
      name: repName(rep.repId),
      lastReviewedAt: rep.reviews.length ? rep.reviews[rep.reviews.length - 1].created_at : null,
      lastCallAddress: lastCall?.leads?.address || null,
      ...aggregateAgentRow({ reviewsChronological: rep.reviews, evaluations: rep.evaluations, activeFocus: rep.activeFocus }),
    }
  }), [byRep, members])

  const filtered = useMemo(() => {
    if (!search.trim()) return agentRows
    const q = search.trim().toLowerCase()
    return agentRows.filter(r => r.name.toLowerCase().includes(q))
  }, [agentRows, search])

  if (coaching.loading) return <LoadingSpinner label="Loading agents…" />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[14px] font-bold text-[color:var(--color-text)]">Agents</div>
          <p className="text-[12px] text-[color:var(--color-text-dim)] mt-0.5">All acquisition reps with call activity in this workspace.</p>
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name…" className="text-[12px] px-2.5 py-1.5 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] w-48" />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-6 py-8 text-center text-[12px] text-[color:var(--color-text-dim)]">
          {agentRows.length === 0 ? 'No acquisition reps with call activity yet.' : 'No agents match that search.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(row => (
            <Link key={row.repId} to={`agents/${row.repId}`} className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-3.5 hover:border-[color:var(--color-accent)] transition-colors block">
              <div className="font-bold text-[13.5px] mb-1.5">{row.name}</div>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-[color:var(--color-text-muted)]">
                <div>Calls Reviewed: <strong className="text-[color:var(--color-text)]">{row.callsReviewed}</strong></div>
                <div>Avg Score: <strong className="text-[color:var(--color-text)]">{row.overallScore.average != null ? row.overallScore.average.toFixed(1) : '—'}</strong></div>
                <div>Coverage: <strong className="text-[color:var(--color-text)]">{row.coveragePercent != null ? `${row.coveragePercent}%` : '—'}</strong></div>
                <div>Adoption: <strong className="text-[color:var(--color-text)]">{row.adoption.rate != null ? `${Math.round(row.adoption.rate * 100)}%` : '—'}</strong></div>
              </div>
              {row.activeFocus && <div className="text-[10.5px] text-[color:var(--color-text-dim)] mt-1.5 pt-1.5 border-t border-[color:var(--color-line)]">Focus: {row.activeFocus.title}</div>}
              {row.lastReviewedAt && <div className="text-[10px] text-[color:var(--color-text-dim)] mt-1">Last reviewed call: {formatDate(row.lastReviewedAt)}</div>}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
