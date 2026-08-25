// src/pages/CoachingAgentProfilePage.jsx
// Capability #25.3, Parts 10-16 — the detailed agent view. "I understand
// how this person is developing." One primary chart (Learning Curve), no
// competing visualizations, no transcript. Lightweight inline SVG line
// chart — no charting library exists anywhere in this codebase, and
// pulling one in for a single sparkline isn't worth the dependency.
import { useMemo } from 'react'
import { useOutletContext, useParams, Link } from 'react-router-dom'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { groupByRep } from '../hooks/useCoachingData'
import { aggregateAgentRow, interpretCoachingEffectiveness, computeAdoptionWindowComparison, interpretImprovement, deriveKeyConclusion } from '../lib/coachingAnalytics'
import { COACHING_DIMENSIONS } from '../lib/callCoaching'
import { formatCurrency as fc, formatDate } from '../lib/calculations'

const STATUS_TONE = { IMPROVING: 'var(--color-success-text)', DECLINING: 'var(--color-danger-text)', STABLE: 'var(--color-text-dim)', BUILDING_BASELINE: 'var(--color-text-dim)' }
const STATUS_ARROW = { IMPROVING: '↑', DECLINING: '↓', STABLE: '→' }
const RESULT_TONE = { APPLIED: 'var(--color-success-text)', NOT_APPLIED: 'var(--color-danger-text)', PARTIALLY_APPLIED: 'var(--color-warn-text)', NOT_APPLICABLE: 'var(--color-text-dim)' }
const ATTENTION_TONE = { ATTENTION: 'var(--color-danger-text)', WATCH: 'var(--color-warn-text)', ON_TRACK: 'var(--color-success-text)', BUILDING_BASELINE: 'var(--color-text-dim)' }

function LearningCurveChart({ points }) {
  if (points.length < 2) {
    return <div className="text-[11.5px] text-[color:var(--color-text-dim)] py-6 text-center">Building baseline — need at least 2 reviewed calls to draw a trend.</div>
  }
  const w = 600, h = 120, pad = 10
  const max = 10, min = 0
  const stepX = (w - pad * 2) / (points.length - 1)
  const y = (score) => h - pad - ((score - min) / (max - min)) * (h - pad * 2)
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${pad + i * stepX} ${y(p.score)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[120px]">
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="var(--color-line)" strokeWidth="1" />
      <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth="2" />
      {points.map((p, i) => (
        <circle key={i} cx={pad + i * stepX} cy={y(p.score)} r="3" fill="var(--color-accent)">
          <title>{`${formatDate(p.date)} · ${p.lead || 'Lead'} · Score ${p.score}`}</title>
        </circle>
      ))}
    </svg>
  )
}

export default function CoachingAgentProfilePage() {
  const { repId } = useParams()
  const { coaching, members, user } = useOutletContext()

  const byRep = useMemo(() => groupByRep(coaching.sessions, coaching.reviews, coaching.evaluations, coaching.activeFocuses), [coaching])
  const rep = byRep[repId]
  const name = members?.find(m => m.user_id === repId)?.profiles?.full_name || (repId === user.id ? 'You' : 'This rep')

  const agent = useMemo(() => {
    if (!rep) return null
    return aggregateAgentRow({ reviewsChronological: rep.reviews, evaluations: rep.evaluations, activeFocus: rep.activeFocus })
  }, [rep])

  const learningCurvePoints = useMemo(() => {
    if (!rep) return []
    return rep.reviews.filter(r => r.overall_score != null).map(r => {
      const session = rep.sessions.find(s => s.id === r.call_session_id)
      return { date: r.created_at, score: r.overall_score, lead: session?.leads?.address }
    })
  }, [rep])

  // Coaching Journey (Part 14) — chronological evaluations for the
  // rep's CURRENT active focus only, straight from persisted rows, no AI
  // reconstruction.
  const journey = useMemo(() => {
    if (!rep?.activeFocus) return []
    return rep.evaluations
      .filter(e => e.coaching_focus_id === rep.activeFocus.id)
      .map(e => ({ ...e, session: rep.sessions.find(s => s.id === e.call_session_id) }))
  }, [rep])

  const focusSkillTrend = agent?.skillTrends.find(s => s.key === rep?.activeFocus?.skill_key)
  const effectiveness = rep?.activeFocus ? interpretCoachingEffectiveness({ adoption: agent.adoption, skillTrend: focusSkillTrend?.trend }) : null

  // Improvement Summary (Part 11) — deterministic, no AI call. Compares the
  // recent-vs-previous score trend window (already computed in agent.overallScore.trend)
  // against a before/after split of adoption evaluations.
  const adoptionWindow = useMemo(() => computeAdoptionWindowComparison(rep?.evaluations || []), [rep])
  const improvementSentence = agent ? interpretImprovement({ overallTrend: agent.overallScore.trend, adoptionWindow }) : null

  if (coaching.loading) return <LoadingSpinner label="Loading agent profile…" />
  if (!rep || !agent) {
    return (
      <div className="space-y-3">
        <Link to="../agents" className="text-[11.5px] font-semibold underline text-[color:var(--color-accent-text)]">← Back to Agents</Link>
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-6 py-8 text-center text-[12px] text-[color:var(--color-text-dim)]">No call activity found for this rep in this workspace.</div>
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <Link to="../agents" className="text-[11.5px] font-semibold underline text-[color:var(--color-accent-text)]">← Back to Agents</Link>

      {/* HEADER */}
      <div>
        <h2 className="text-[18px] font-bold">{name}</h2>
        <div className="text-[11.5px] text-[color:var(--color-text-dim)] mb-1">Acquisition Performance</div>
        <div className="flex items-center gap-3">
          <div className="text-[13px] font-bold" style={{ color: STATUS_TONE[agent.performanceStatus] }}>
            {agent.performanceStatus === 'BUILDING_BASELINE' ? 'Building Baseline' : `${STATUS_ARROW[agent.performanceStatus]} ${agent.performanceStatus.charAt(0) + agent.performanceStatus.slice(1).toLowerCase()}`}
          </div>
          <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded" style={{ color: ATTENTION_TONE[agent.attention.level], border: `1px solid ${ATTENTION_TONE[agent.attention.level]}` }}>
            {agent.attention.level.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {/* TOP METRICS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4">
        <div>
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Overall Score</div>
          <div className="text-[20px] font-extrabold tabular-nums">{agent.overallScore.average != null ? agent.overallScore.average.toFixed(1) : '—'}</div>
          {agent.overallScore.trend.status !== 'INSUFFICIENT_DATA' && <div className="text-[10.5px] text-[color:var(--color-text-dim)]">from {agent.overallScore.trend.previousAvg?.toFixed(1)}</div>}
        </div>
        <div>
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Coaching Adoption</div>
          <div className="text-[20px] font-extrabold tabular-nums">{agent.adoption.rate != null ? `${Math.round(agent.adoption.rate * 100)}%` : '—'}</div>
        </div>
        <div>
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Conversation Coverage</div>
          <div className="text-[20px] font-extrabold tabular-nums">{agent.coveragePercent != null ? `${agent.coveragePercent}%` : '—'}</div>
        </div>
        <div>
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Reviewed Calls</div>
          <div className="text-[20px] font-extrabold tabular-nums">{agent.callsReviewed}</div>
        </div>
      </div>

      {/* LEARNING CURVE */}
      <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4">
        <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mb-2">Call Performance</div>
        <LearningCurveChart points={learningCurvePoints} />
      </div>

      {/* SKILL DEVELOPMENT */}
      <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4">
        <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mb-2">Skill Development</div>
        <div className="space-y-1.5">
          {COACHING_DIMENSIONS.map(dim => {
            const s = agent.skillTrends.find(x => x.key === dim.key)
            return (
              <div key={dim.key} className="flex items-center justify-between text-[11.5px]">
                <span className="text-[color:var(--color-text-muted)]">{dim.label}</span>
                {s.hasData ? (
                  <span className="flex items-center gap-2">
                    <span className="font-bold tabular-nums">{s.current.toFixed(1)}</span>
                    <span style={{ color: STATUS_TONE[s.trend] || 'var(--color-text-dim)' }}>{s.trend === 'INSUFFICIENT_DATA' ? '' : STATUS_ARROW[s.trend]}</span>
                  </span>
                ) : <span className="text-[color:var(--color-text-dim)]">—</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* IMPROVEMENT SUMMARY (Part 11) — deterministic before/after, no AI call */}
      <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4">
        <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mb-2">Improvement Summary</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[11.5px] mb-2">
          <div>
            <div className="text-[color:var(--color-text-dim)]">Overall Score</div>
            {agent.overallScore.trend.status !== 'INSUFFICIENT_DATA' ? (
              <div className="font-bold tabular-nums">{agent.overallScore.trend.previousAvg?.toFixed(1)} → {agent.overallScore.trend.recentAvg?.toFixed(1)}</div>
            ) : <div className="text-[color:var(--color-text-dim)]">Building baseline</div>}
          </div>
          <div>
            <div className="text-[color:var(--color-text-dim)]">Coverage</div>
            {agent.coverageTrend.status !== 'INSUFFICIENT_DATA' ? (
              <div className="font-bold tabular-nums">{agent.coverageTrend.previousAvg?.toFixed(0)}% → {agent.coverageTrend.recentAvg?.toFixed(0)}%</div>
            ) : <div className="text-[color:var(--color-text-dim)]">Building baseline</div>}
          </div>
          <div>
            <div className="text-[color:var(--color-text-dim)]">Coaching Adoption</div>
            {adoptionWindow.before != null && adoptionWindow.after != null ? (
              <div className="font-bold tabular-nums">{Math.round(adoptionWindow.before * 100)}% → {Math.round(adoptionWindow.after * 100)}%</div>
            ) : <div className="text-[color:var(--color-text-dim)]">Building baseline</div>}
          </div>
        </div>
        <p className="text-[11.5px] text-[color:var(--color-text-muted)] pt-2 border-t border-[color:var(--color-line)]">{improvementSentence}</p>
      </div>

      {/* CURRENT COACHING FOCUS + EFFECTIVENESS + JOURNEY */}
      {rep.activeFocus ? (
        <div className="rounded-lg border-2 border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] p-4 space-y-2">
          <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-accent-text)] font-bold">Current Coaching Focus</div>
          <div className="text-[15px] font-extrabold">{rep.activeFocus.title.toUpperCase()}</div>
          <p className="text-[12px]">{rep.activeFocus.recommendation}</p>
          <div className="flex items-center gap-4 text-[11.5px] pt-1">
            <span>Adoption: <strong>{agent.adoption.rate != null ? `${Math.round(agent.adoption.rate * 100)}%` : '—'}</strong> ({agent.adoption.appliedCount} of {agent.adoption.applicableCount} applicable calls)</span>
          </div>
          <div className="flex gap-3 text-[11px]">
            <span style={{ color: RESULT_TONE.APPLIED }}>APPLIED {agent.adoption.appliedCount}</span>
            <span style={{ color: RESULT_TONE.PARTIALLY_APPLIED }}>PARTIAL {agent.adoption.partialCount}</span>
            <span style={{ color: RESULT_TONE.NOT_APPLIED }}>NOT APPLIED {agent.adoption.notAppliedCount}</span>
          </div>
          {effectiveness && (
            <div className="text-[11.5px] pt-1.5 border-t border-[color:var(--color-accent)]">
              <span className="font-bold">Coaching Effectiveness: </span>{effectiveness}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4 text-[12px] text-[color:var(--color-text-dim)]">No active coaching focus for this rep.</div>
      )}

      {journey.length > 0 && (
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4">
          <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mb-2">Coaching Journey</div>
          <div className="space-y-2">
            <div className="text-[11px] text-[color:var(--color-text-dim)]">{formatDate(rep.activeFocus.created_at)} · Focus created: {rep.activeFocus.recommendation}</div>
            {journey.map((j, i) => (
              <div key={i} className="text-[11.5px] border-l-2 pl-2.5" style={{ borderColor: RESULT_TONE[j.result] }}>
                <div className="text-[10.5px] text-[color:var(--color-text-dim)]">{formatDate(j.created_at)}</div>
                <div className="font-bold" style={{ color: RESULT_TONE[j.result] }}>{j.result.replace(/_/g, ' ')}</div>
                {j.seller_quote && <div>Seller: "{j.seller_quote}"</div>}
                {j.rep_quote && <div>Rep: "{j.rep_quote}"</div>}
                {j.why && <div className="text-[color:var(--color-text-dim)]">{j.why}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RECENT CALLS */}
      <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] overflow-hidden">
        <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold p-4 pb-2">Recent Calls</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="border-b border-[color:var(--color-line)]">
              <tr>
                {['Date', 'Lead', 'Score', 'Coverage', 'Focus Result', 'Outcome', 'Key Conclusion'].map(h => (
                  <th key={h} className="px-3 h-8 text-left text-[10px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">{h}</th>
                ))}
                <th className="px-3 h-8 w-px" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--color-line)]">
              {[...rep.reviews].reverse().slice(0, 10).map(r => {
                const session = rep.sessions.find(s => s.id === r.call_session_id)
                const evalRow = rep.evaluations.find(e => e.call_session_id === r.call_session_id)
                return (
                  <tr key={r.id} className="hover:bg-[color:var(--color-bg-elev-2)]">
                    <td className="px-3 py-2 text-[color:var(--color-text-muted)]">{formatDate(r.created_at)}</td>
                    <td className="px-3 py-2">{session?.leads?.address || '—'}</td>
                    <td className="px-3 py-2 font-bold">{r.overall_score ?? '—'}</td>
                    <td className="px-3 py-2">{r.coverage ? `${Math.round((r.coverage.capturedCount / r.coverage.total) * 100)}%` : '—'}</td>
                    <td className="px-3 py-2" style={{ color: evalRow ? RESULT_TONE[evalRow.result] : undefined }}>{evalRow?.result.replace(/_/g, ' ') || '—'}</td>
                    <td className="px-3 py-2 text-[color:var(--color-text-muted)]">{session?.outcome?.replace(/_/g, ' ') || '—'}</td>
                    <td className="px-3 py-2 text-[color:var(--color-text-muted)] max-w-[220px] truncate" title={deriveKeyConclusion({ review: r, evaluation: evalRow }) || ''}>{deriveKeyConclusion({ review: r, evaluation: evalRow }) || '—'}</td>
                    <td className="px-3 py-2 text-right"><Link to={`../calls/${r.call_session_id}`} className="text-[11px] font-semibold underline text-[color:var(--color-accent-text)]">View</Link></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {rep.reviews.length === 0 && <div className="px-4 py-6 text-center text-[12px] text-[color:var(--color-text-dim)]">No reviewed calls yet.</div>}
      </div>
    </div>
  )
}
