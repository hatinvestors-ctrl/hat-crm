// src/pages/CallDetailPage.jsx
// Capability #25.1, Part 15 — minimal Call Detail. Read-only, database-only
// (Part 30: zero AI calls here — never auto-generates a review on open).
// No transcript section (Part 16 — only verified coaching snippets, never
// implying a full transcript exists when V1 deliberately doesn't persist one).
import { useEffect, useState } from 'react'
import { useParams, useOutletContext, Link } from 'react-router-dom'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { supabase } from '../lib/supabase'
import { formatCurrency as fc, formatDate } from '../lib/calculations'
import { COACHING_DIMENSIONS } from '../lib/callCoaching'

const NUANCE_LABEL = { GOOD_BUT_EARLY: 'Good execution, wrong timing (too early)', GOOD_BUT_LATE: 'Good execution, wrong timing (too late)', MIXED: 'Real positives, real problems' }

function formatDuration(seconds) {
  if (seconds == null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function CallDetailPage() {
  const { callId } = useParams()
  const { members } = useOutletContext()
  const [call, setCall] = useState(null)
  const [review, setReview] = useState(null)
  const [coachingEval, setCoachingEval] = useState(null) // this call's evaluation of the focus that was active going in
  const [currentFocus, setCurrentFocus] = useState(null) // the rep's active focus AS OF NOW (may differ from the one evaluated)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError(null)
      try {
        // Separate reads (not one giant join) — keeps this page simple and
        // makes "no review yet" / "no coaching evaluation yet" explicit,
        // honest nulls rather than join artifacts.
        const { data: session, error: sErr } = await supabase
          .from('call_sessions').select('*, leads(address,city,state,zip_code)').eq('id', callId).maybeSingle()
        if (sErr) throw sErr
        if (!session) throw new Error('Call not found, or you do not have access to it.')
        const { data: reviewRow, error: rErr } = await supabase
          .from('call_reviews').select('*').eq('call_session_id', callId).maybeSingle()
        if (rErr) throw rErr

        // Capability #25.2 — this call's adherence evaluation (if any focus
        // was active going into this call) + the join to that focus row so
        // the title/skill can be shown alongside the result.
        const { data: evalRow } = await supabase
          .from('coaching_focus_evaluations')
          .select('*, coaching_focuses(title,skill_key)')
          .eq('call_session_id', callId).maybeSingle()
        const { data: focusRow } = await supabase
          .from('coaching_focuses').select('title,skill_key,status')
          .eq('workspace_id', session.workspace_id).eq('rep_id', session.rep_id).eq('status', 'ACTIVE')
          .order('created_at', { ascending: false }).limit(1).maybeSingle()

        if (!cancelled) { setCall(session); setReview(reviewRow || null); setCoachingEval(evalRow || null); setCurrentFocus(focusRow || null) }
      } catch (err) {
        if (!cancelled) setLoadError(err.message || 'Could not load this call.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [callId])

  const repName = (repId) => members?.find(m => m.user_id === repId)?.profiles?.full_name || 'Unknown'

  if (loading) return <LoadingSpinner label="Loading call…" />
  if (loadError || !call) return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[color:var(--color-danger)] bg-[color:var(--color-danger-soft)] px-4 py-3 text-[12px] text-[color:var(--color-danger-text)]">{loadError || 'Call not found.'}</div>
      <Link to=".." className="text-[12px] font-semibold underline text-[color:var(--color-accent-text)] inline-block">← Back to Calls</Link>
    </div>
  )

  return (
    <div className="w-full max-w-2xl space-y-4">
      <Link to=".." className="text-[11.5px] font-semibold underline text-[color:var(--color-accent-text)]">← Back to Calls</Link>

        {/* CALL SUMMARY */}
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4">
          <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mb-1.5">Call Summary</div>
          <div className="text-[15px] font-bold">{call.leads?.address || 'Unknown property'}</div>
          <div className="text-[11px] text-[color:var(--color-text-dim)] mb-2">{call.leads?.city}, {call.leads?.state} {call.leads?.zip_code}</div>
          <div className="grid grid-cols-2 gap-2 text-[11.5px]">
            <div><span className="text-[color:var(--color-text-dim)]">Rep:</span> {repName(call.rep_id)}</div>
            <div><span className="text-[color:var(--color-text-dim)]">Date:</span> {formatDate(call.started_at)}</div>
            <div><span className="text-[color:var(--color-text-dim)]">Duration:</span> {formatDuration(call.duration_seconds)}</div>
            <div><span className="text-[color:var(--color-text-dim)]">Outcome:</span> {call.outcome ? call.outcome.replace(/_/g, ' ') : '—'}</div>
            {call.follow_up_date && <div><span className="text-[color:var(--color-text-dim)]">Follow-up:</span> {call.follow_up_date}</div>}
          </div>
          {call.summary && <p className="text-[11.5px] text-[color:var(--color-text-muted)] mt-2 pt-2 border-t border-[color:var(--color-line)]">{call.summary}</p>}
        </div>

        {/* SELLER MOVEMENT */}
        {(call.seller_price_initial != null || call.seller_price_final != null) && (
          <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4">
            <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mb-1.5">Seller Movement</div>
            <div className="text-[13px]">
              {call.seller_price_initial != null && call.seller_price_final != null && call.seller_price_initial !== call.seller_price_final
                ? <>{fc(call.seller_price_initial)} → <strong>{fc(call.seller_price_final)}</strong></>
                : <strong>{fc(call.seller_price_final ?? call.seller_price_initial)}</strong>}
            </div>
            {call.seller_price_movement != null && call.seller_price_movement !== 0 && (
              <div className="text-[10.5px] text-[color:var(--color-text-dim)] mt-0.5">Moved {call.seller_price_movement > 0 ? '+' : ''}{fc(call.seller_price_movement)}</div>
            )}
          </div>
        )}

        {/* EXECUTIVE COACHING SUMMARY (Capability #25.3B, Part 14) — mirrors
            CallReview.jsx's always-visible summary, reading from already-
            fetched review/currentFocus state rather than live component state. */}
        {review && (() => {
          const biggestWin = review.strengths?.[0] || null
          const biggestMiss = review.missed_opportunity?.summary || null
          const dealImpactMove = review.strong_moves?.find(m => m.nuance === 'GOOD_BUT_EARLY' || m.nuance === 'GOOD_BUT_LATE' || m.nuance === 'MIXED') || null
          return (
            <div className="rounded-lg border-2 border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] p-4 space-y-2">
              <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-accent-text)] font-bold">Executive Coaching Summary</div>
              {review.overall_score != null && (
                <div className="text-center pb-1">
                  <div className="text-[24px] font-extrabold tabular-nums">{review.overall_score} / 100</div>
                  <div className="text-[10.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{review.overall_score >= 80 ? 'Strong Call' : review.overall_score >= 60 ? 'Solid Call' : 'Needs Work'}</div>
                </div>
              )}
              {biggestWin && (
                <div className="text-[11.5px]"><span className="font-bold text-[color:var(--color-success-text)]">Biggest Win:</span> ✓ {biggestWin}</div>
              )}
              {biggestMiss && (
                <div className="text-[11.5px]"><span className="font-bold text-[color:var(--color-warn-text)]">Biggest Miss:</span> ⚠ {biggestMiss}</div>
              )}
              {dealImpactMove && (
                <div className="text-[11.5px]">
                  <span className="font-bold text-[color:var(--color-warn-text)]">Deal Impact:</span> ⚠ {dealImpactMove.why} <span className="text-[10px] text-[color:var(--color-text-dim)]">({NUANCE_LABEL[dealImpactMove.nuance]})</span>
                </div>
              )}
              {currentFocus && (
                <div className="text-[11.5px] pt-1.5 border-t border-[color:var(--color-accent)]">
                  <span className="font-bold">Current Coaching Focus:</span> 🎯 <strong>{currentFocus.title}</strong>
                </div>
              )}
            </div>
          )
        })()}

        {/* CALL REVIEW */}
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4">
          <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mb-2">Call Review</div>
          {!review ? (
            <p className="text-[12px] text-[color:var(--color-text-dim)]">Call Review was not generated for this call.</p>
          ) : (
            <div className="space-y-3">
              {review.overall_score != null && (
                <div className="text-center py-1">
                  <div className="text-[24px] font-extrabold tabular-nums">{review.overall_score} / 100</div>
                </div>
              )}
              {review.coverage && (
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {review.coverage.dimensions?.map(d => (
                    <span key={d.key} className={`text-[9.5px] font-semibold px-1.5 py-0.5 rounded ${d.status === 'CAPTURED' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]'}`}>
                      {d.status === 'CAPTURED' ? '✓' : '⚠'} {d.label}
                    </span>
                  ))}
                </div>
              )}
              {review.dimension_scores?.length > 0 && (
                <div className="border-t border-[color:var(--color-line)] pt-2 space-y-1">
                  {COACHING_DIMENSIONS.map(dim => {
                    const s = review.dimension_scores.find(x => x.key === dim.key)
                    if (!s) return null
                    return (
                      <div key={dim.key} className="flex items-center justify-between text-[11.5px]">
                        <span>{dim.label}</span><span className="font-bold tabular-nums">{s.score}/10</span>
                      </div>
                    )
                  })}
                </div>
              )}
              {review.strengths?.length > 0 && (
                <div className="border-t border-[color:var(--color-line)] pt-2">
                  <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mb-1">What You Did Well</div>
                  <ul className="space-y-0.5">
                    {review.strengths.map((s, i) => <li key={i} className="text-[11.5px] text-[color:var(--color-success-text)]">✓ {s}</li>)}
                  </ul>
                </div>
              )}
              {review.missed_opportunity && (
                <div className="border-t border-[color:var(--color-line)] pt-2">
                  <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-warn-text)] font-bold mb-1">Biggest Missed Opportunity</div>
                  <p className="text-[11.5px]">{review.missed_opportunity.summary}</p>
                </div>
              )}
              {review.coaching_moments?.length > 0 && (
                <div className="border-t border-[color:var(--color-line)] pt-2 space-y-1.5">
                  <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold">Coaching Moments <span className="normal-case font-normal">(evidence snippets, not a full transcript)</span></div>
                  {review.coaching_moments.map((m, i) => (
                    <div key={i} className="rounded border border-[color:var(--color-line)] px-2 py-1.5 text-[11px]">
                      {m.sellerQuote && <div><span className="font-semibold">Seller:</span> "{m.sellerQuote}"</div>}
                      {m.repQuote && <div><span className="font-semibold">Kevin:</span> "{m.repQuote}"</div>}
                      <div className="text-[color:var(--color-text-dim)]">{m.coach}</div>
                    </div>
                  ))}
                </div>
              )}
              {review.strong_moves?.length > 0 && (
                <div className="border-t border-[color:var(--color-line)] pt-2 space-y-1.5">
                  <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold">Strong Moves <span className="normal-case font-normal">(evidence snippets, not a full transcript)</span></div>
                  {review.strong_moves.map((m, i) => (
                    <div key={i} className="rounded border border-[color:var(--color-success)] px-2 py-1.5 text-[11px]">
                      {m.sellerQuote && <div><span className="font-semibold">Seller:</span> "{m.sellerQuote}"</div>}
                      <div className="text-[color:var(--color-success-text)]">{m.why}</div>
                    </div>
                  ))}
                </div>
              )}
              {(review.max_buy_snapshot != null || review.seller_price_snapshot != null) && (
                <div className="border-t border-[color:var(--color-line)] pt-2 space-y-0.5">
                  <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold">Deal Context (frozen at call time)</div>
                  {review.max_buy_snapshot != null && (
                    <div className="text-[10.5px] text-[color:var(--color-text-dim)]">Max Buy: <strong className="text-[color:var(--color-text)]">{fc(review.max_buy_snapshot)}</strong> — the lead's current Max Buy may differ today.</div>
                  )}
                  {review.seller_price_snapshot != null && (
                    <div className="text-[10.5px] text-[color:var(--color-text-dim)]">Seller Price: <strong className="text-[color:var(--color-text)]">{fc(review.seller_price_snapshot)}</strong></div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Capability #25.2, Part 22 — minimal, not a dashboard. */}
        {(coachingEval || currentFocus) && (
          <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4">
            <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mb-2">Coaching</div>
            <div className="space-y-1.5">
              {coachingEval?.coaching_focuses && (
                <>
                  <div className="text-[11.5px]"><span className="text-[color:var(--color-text-dim)]">Previous Focus:</span> {coachingEval.coaching_focuses.title}</div>
                  <div className="text-[11.5px]">
                    Adherence: <strong className={coachingEval.result === 'APPLIED' ? 'text-[color:var(--color-success-text)]' : coachingEval.result === 'NOT_APPLIED' ? 'text-[color:var(--color-danger-text)]' : ''}>
                      {coachingEval.result.replace(/_/g, ' ')}{coachingEval.result === 'APPLIED' ? ' ✓' : ''}
                    </strong>
                  </div>
                  {coachingEval.why && <div className="text-[11px] text-[color:var(--color-text-dim)]">Why: {coachingEval.why}</div>}
                </>
              )}
              {currentFocus && (
                <div className="text-[11.5px] pt-1.5 border-t border-[color:var(--color-line)]"><span className="text-[color:var(--color-text-dim)]">Current Coaching Focus:</span> <strong>{currentFocus.title}</strong></div>
              )}
            </div>
          </div>
        )}
      </div>
  )
}
