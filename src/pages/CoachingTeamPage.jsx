// src/pages/CoachingTeamPage.jsx
// Capability #25.3, Parts 4-8 — the manager's home page. Progressive
// density: Team Pulse (executive summary) -> Needs Attention (actionable)
// -> Agent Performance table (scannable detail). No chart wall, no
// gamified leaderboard feel.
import { useMemo, useState } from 'react'
import { useOutletContext, Link } from 'react-router-dom'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { groupByRep } from '../hooks/useCoachingData'
import { aggregateAgentRow, aggregateTeamPulse, MIN_CALLS_FOR_ASSESSMENT } from '../lib/coachingAnalytics'

const STATUS_TONE = { IMPROVING: 'var(--color-success-text)', DECLINING: 'var(--color-danger-text)', STABLE: 'var(--color-text-dim)', BUILDING_BASELINE: 'var(--color-text-dim)' }
const STATUS_ARROW = { IMPROVING: '↑', DECLINING: '↓', STABLE: '→', BUILDING_BASELINE: '' }
const ATTENTION_TONE = { ATTENTION: 'var(--color-danger-text)', WATCH: 'var(--color-warn-text)', ON_TRACK: 'var(--color-success-text)', BUILDING_BASELINE: 'var(--color-text-dim)' }

function TrendBadge({ status }) {
  if (status === 'BUILDING_BASELINE' || !status) return <span className="text-[11px] text-[color:var(--color-text-dim)]">Building baseline</span>
  return <span className="text-[12px] font-bold" style={{ color: STATUS_TONE[status] }}>{STATUS_ARROW[status]} {status.charAt(0) + status.slice(1).toLowerCase()}</span>
}

export default function CoachingTeamPage() {
  const { coaching, members, user } = useOutletContext()
  const [sortKey, setSortKey] = useState('attention')

  const byRep = useMemo(() => groupByRep(coaching.sessions, coaching.reviews, coaching.evaluations, coaching.activeFocuses), [coaching])
  const repName = (repId) => members?.find(m => m.user_id === repId)?.profiles?.full_name || (repId === user.id ? 'You' : 'Unknown')

  const agentRows = useMemo(() => Object.values(byRep).map(rep => ({
    repId: rep.repId,
    name: repName(rep.repId),
    ...aggregateAgentRow({ reviewsChronological: rep.reviews, evaluations: rep.evaluations, activeFocus: rep.activeFocus }),
  })), [byRep, members])

  const attentionByRep = useMemo(() => Object.fromEntries(agentRows.map(r => [r.repId, r.attention])), [agentRows])
  const performanceByRep = useMemo(() => Object.fromEntries(agentRows.map(r => [r.repId, r.performanceStatus])), [agentRows])
  const pulse = useMemo(() => aggregateTeamPulse(coaching.reviews, attentionByRep, coaching.evaluations, performanceByRep), [coaching.reviews, attentionByRep, coaching.evaluations, performanceByRep])

  const sortedRows = useMemo(() => {
    const rank = { ATTENTION: 0, WATCH: 1, ON_TRACK: 2, BUILDING_BASELINE: 3 }
    const rows = [...agentRows]
    if (sortKey === 'attention') rows.sort((a, b) => rank[a.attention.level] - rank[b.attention.level])
    else if (sortKey === 'score') rows.sort((a, b) => (b.overallScore.average ?? -1) - (a.overallScore.average ?? -1))
    else if (sortKey === 'calls') rows.sort((a, b) => b.callsReviewed - a.callsReviewed)
    return rows
  }, [agentRows, sortKey])

  const needsAttention = sortedRows.filter(r => r.attention.level === 'ATTENTION' || r.attention.level === 'WATCH').slice(0, 4)

  if (coaching.loading) return <LoadingSpinner label="Loading team coaching data…" />

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[14px] font-bold text-[color:var(--color-text)]">Team Coaching</div>
        <p className="text-[12px] text-[color:var(--color-text-dim)] mt-0.5">Understand who is improving, who needs attention, and whether coaching is being applied.</p>
      </div>

      {/* TEAM PULSE */}
      {pulse.callsReviewed === 0 ? (
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-6 py-8 text-center">
          <div className="text-[14px] font-bold mb-1">No reviewed calls yet</div>
          <p className="text-[12px] text-[color:var(--color-text-dim)]">Complete Call Reviews in Live Copilot to begin building coaching intelligence.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4">
          <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mb-3">Team Pulse</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <div>
              <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Calls Reviewed</div>
              <div className="text-[22px] font-extrabold tabular-nums">{pulse.callsReviewed}</div>
            </div>
            <div>
              <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Overall Call Score</div>
              <div className="text-[22px] font-extrabold tabular-nums">{pulse.overallScore.average != null ? pulse.overallScore.average.toFixed(1) : '—'}<span className="text-[12px] text-[color:var(--color-text-dim)]"> / 10</span></div>
              <TrendBadge status={pulse.overallScore.trend.status} />
            </div>
            <div>
              <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Conversation Coverage</div>
              <div className="text-[22px] font-extrabold tabular-nums">{pulse.coverage.average != null ? `${pulse.coverage.average}%` : '—'}</div>
              <TrendBadge status={pulse.coverage.trend.status} />
            </div>
            <div>
              <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Coaching Adoption</div>
              <div className="text-[22px] font-extrabold tabular-nums">{pulse.adoption.rate != null ? `${Math.round(pulse.adoption.rate * 100)}%` : '—'}</div>
            </div>
            <div>
              <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Improving Reps</div>
              <div className="text-[22px] font-extrabold tabular-nums" style={{ color: pulse.improvingRepsCount > 0 ? 'var(--color-success-text)' : undefined }}>{pulse.improvingRepsCount}</div>
            </div>
            <div>
              <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Needs Attention</div>
              <div className="text-[22px] font-extrabold tabular-nums" style={{ color: pulse.needsAttentionCount > 0 ? 'var(--color-danger-text)' : undefined }}>{pulse.needsAttentionCount} rep{pulse.needsAttentionCount === 1 ? '' : 's'}</div>
            </div>
          </div>
        </div>
      )}

      {/* NEEDS ATTENTION */}
      {needsAttention.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mb-2">Needs Attention</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {needsAttention.map(row => (
              <div key={row.repId} className="rounded-lg border px-3.5 py-3" style={{ borderColor: ATTENTION_TONE[row.attention.level] }}>
                <div className="flex items-center justify-between mb-1">
                  <div className="font-bold text-[13px]">{row.name}</div>
                  <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded" style={{ color: ATTENTION_TONE[row.attention.level], border: `1px solid ${ATTENTION_TONE[row.attention.level]}` }}>{row.attention.level.replace(/_/g, ' ')}</span>
                </div>
                <div className="text-[11.5px] text-[color:var(--color-text-muted)] mb-1">
                  Score {row.overallScore.average != null ? row.overallScore.average.toFixed(1) : '—'} ({row.performanceStatus === 'BUILDING_BASELINE' ? 'building baseline' : row.performanceStatus?.toLowerCase()}) · Coverage {row.coveragePercent != null ? `${row.coveragePercent}%` : '—'} · Adoption {row.adoption.rate != null ? `${Math.round(row.adoption.rate * 100)}%` : '—'} {row.activeFocus && `· Focus: ${row.activeFocus.title}`}
                </div>
                {row.attention.reasons.length > 0 && (
                  <div className="text-[10.5px] text-[color:var(--color-text-dim)] mb-1.5">Why: {row.attention.reasons[0]}</div>
                )}
                <Link to={`../agents/${row.repId}`} className="text-[11px] font-semibold underline text-[color:var(--color-accent-text)]">View Agent →</Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AGENT PERFORMANCE TABLE */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold">Agent Performance</div>
          <select value={sortKey} onChange={e => setSortKey(e.target.value)} className="text-[11px] px-2 py-1 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)]">
            <option value="attention">Sort: Needs Attention First</option>
            <option value="score">Sort: Score</option>
            <option value="calls">Sort: Calls Reviewed</option>
          </select>
        </div>
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="border-b border-[color:var(--color-line)]">
                <tr>
                  {['Agent', 'Calls', 'Avg Score', 'Score Trend', 'Coverage', 'Coverage Trend', 'Adoption', 'Current Focus', 'Agent Performance', 'Manager Attention'].map(h => (
                    <th key={h} className="px-3 h-9 text-left text-[10.5px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">{h}</th>
                  ))}
                  <th className="px-3 h-9 w-px" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--color-line)]">
                {sortedRows.map(row => (
                  <tr key={row.repId} className="hover:bg-[color:var(--color-bg-elev-2)] transition-colors">
                    <td className="px-3 py-2.5 font-semibold">{row.name}</td>
                    <td className="px-3 py-2.5 tabular-nums">{row.callsReviewed}</td>
                    <td className="px-3 py-2.5 tabular-nums font-bold">{row.overallScore.average != null ? row.overallScore.average.toFixed(1) : '—'}</td>
                    <td className="px-3 py-2.5"><TrendBadge status={row.overallScore.trend.status} /></td>
                    <td className="px-3 py-2.5 tabular-nums">{row.coveragePercent != null ? `${row.coveragePercent}%` : '—'}</td>
                    <td className="px-3 py-2.5"><TrendBadge status={row.coverageTrend.status} /></td>
                    <td className="px-3 py-2.5 tabular-nums">{row.adoption.rate != null ? `${Math.round(row.adoption.rate * 100)}%` : '—'}</td>
                    <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">{row.activeFocus?.title || '—'}</td>
                    <td className="px-3 py-2.5"><TrendBadge status={row.performanceStatus} /></td>
                    <td className="px-3 py-2.5">
                      <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded" style={{ color: ATTENTION_TONE[row.attention.level], border: `1px solid ${ATTENTION_TONE[row.attention.level]}` }}>{row.attention.level.replace(/_/g, ' ')}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right"><Link to={`../agents/${row.repId}`} className="text-[11px] font-semibold underline text-[color:var(--color-accent-text)]">View →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sortedRows.length === 0 && <div className="px-4 py-8 text-center text-[12px] text-[color:var(--color-text-dim)]">No acquisition reps with call activity yet.</div>}
        </div>
        <p className="text-[10px] text-[color:var(--color-text-dim)] mt-1.5">Trend/Status require at least {MIN_CALLS_FOR_ASSESSMENT} reviewed calls — fewer shows "Building baseline."</p>
      </div>
    </div>
  )
}
