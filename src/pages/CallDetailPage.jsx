// src/pages/CallDetailPage.jsx
// Capability #25.1, Part 15 — minimal Call Detail. Read-only, database-only
// (Part 30: zero AI calls here — never auto-generates a review on open).
// No transcript section (Part 16 — only verified coaching snippets, never
// implying a full transcript exists when V1 deliberately doesn't persist one).
//
// Coaching Call Detail UX / Manager Scanability V1 — this pass is
// presentation/information-architecture ONLY. Every data source below
// (call_sessions, call_reviews, coaching_focus_evaluations, coaching_focuses)
// and every field read from them is UNCHANGED from the prior version — see
// the diff. No scoring/coaching/dedupe/quality logic was touched, no new
// query was added, and zero Anthropic calls happen on this page (same as
// before: it only ever reads rows already persisted by generate-call-review
// at call-review-generation time, never calls it itself).
//
// New hierarchy (mission Part 3):
//   LEVEL 1 — Manager Snapshot   (call context, score hero, win/miss/next-focus)
//   LEVEL 2 — Coaching Evidence  (skill breakdown, continuous coaching)
//   LEVEL 3 — Full Review        (progressive disclosure — everything else,
//                                 unchanged content, just collapsed by default)
import { useEffect, useState } from 'react'
import { useParams, useOutletContext, Link } from 'react-router-dom'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { supabase } from '../lib/supabase'
import { formatCurrency as fc, formatDate } from '../lib/calculations'
import { COACHING_DIMENSIONS } from '../lib/callCoaching'
import { buildCallContext, formatCallContextLabel } from '../lib/callContext'

const NUANCE_LABEL = { GOOD_BUT_EARLY: 'Good execution, wrong timing (too early)', GOOD_BUT_LATE: 'Good execution, wrong timing (too late)', MIXED: 'Real positives, real problems' }

function formatDuration(seconds) {
  if (seconds == null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Pure presentation helper — score band label/tone. Thresholds (80/60)
// are the exact ones already used before this pass, just centralized so
// the hero and any other reference to "how good is this score" agree.
function scoreBand(score) {
  if (score >= 80) return { label: 'Strong Call', tone: 'success' }
  if (score >= 60) return { label: 'Solid Call', tone: 'accent' }
  return { label: 'Needs Work', tone: 'warn' }
}

// Presentation-only severity banding for an individual 0-10 dimension
// score, so a manager can spot the weak dimensions at a glance without
// re-reading every number. Does not alter the score itself.
function dimensionTone(score) {
  if (score >= 7) return 'text-[color:var(--color-success-text)]'
  if (score >= 4) return 'text-[color:var(--color-text)]'
  return 'text-[color:var(--color-danger-text)]'
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
  const [showFullReview, setShowFullReview] = useState(false) // Level 3 progressive disclosure — collapsed by default
  // Context-Aware Call Coaching V1 — re-derived, never persisted (Part 13:
  // no new column). Same buildCallContext() used at generation time,
  // fed the same shape of real prior call_sessions/call_reviews rows.
  const [callContext, setCallContext] = useState(null)

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
          .from('call_sessions').select('*, leads(address,city,state,zip_code,status)').eq('id', callId).maybeSingle()
        if (sErr) throw sErr
        if (!session) throw new Error('Call not found, or you do not have access to it.')
        const { data: reviewRow, error: rErr } = await supabase
          .from('call_reviews').select('*').eq('call_session_id', callId).maybeSingle()
        if (rErr) throw rErr

        // Context-Aware Coaching Hardening V1, Part 2 — PRIORITY: (1) the
        // FROZEN context persisted with the review at generation time
        // (call_reviews.call_context — exact context the AI actually
        // reasoned against, immune to a later lead.status change), (2)
        // only when absent (legacy review, or no review yet), fall back
        // to re-deriving from current call_sessions/lead.status — same
        // best-effort read CallReview.jsx uses at generation time.
        let derivedCallContext = reviewRow?.call_context
          ? { type: reviewRow.call_context.type, callNumber: reviewRow.call_context.callNumber, previous: null, frozen: true }
          : null
        if (!derivedCallContext) {
          const { data: priorSessions } = await supabase
            .from('call_sessions')
            .select('id,started_at,outcome,summary,seller_price_final,objections,follow_up_date')
            .eq('lead_id', session.lead_id)
            .lt('started_at', session.started_at)
            .order('started_at', { ascending: false })
            .limit(10)
          let priorReviews = []
          if (priorSessions?.length) {
            const { data } = await supabase
              .from('call_reviews')
              .select('call_session_id,strengths,missed_opportunity')
              .in('call_session_id', priorSessions.map(s => s.id))
            priorReviews = data || []
          }
          derivedCallContext = { ...buildCallContext(priorSessions || [], priorReviews, session.leads?.status ?? null), frozen: false }
        }

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

        if (!cancelled) { setCall(session); setReview(reviewRow || null); setCoachingEval(evalRow || null); setCurrentFocus(focusRow || null); setCallContext(derivedCallContext) }
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

  // Same derivations the old Executive Coaching Summary used — same
  // fields, same fallback order, just read once here instead of inline.
  const biggestWin = review?.strengths?.[0] || null
  const biggestMiss = review?.missed_opportunity?.summary || null
  const band = review?.overall_score != null ? scoreBand(review.overall_score) : null

  return (
    <div className="w-full max-w-2xl space-y-4">
      <Link to=".." className="text-[11.5px] font-semibold underline text-[color:var(--color-accent-text)]">← Back to Calls</Link>

      {/* ══════════════ LEVEL 1 — MANAGER SNAPSHOT ══════════════
          Understand the call in ~10-15s: who/what/when, the one score,
          the win, the miss, and the single most important management
          action — what the rep should work on next. */}

      {/* Compact call context — horizontal metadata, not a tall card. */}
      <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-4 py-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="text-[14px] font-bold truncate">{call.leads?.address || 'Unknown property'}</div>
          <div className="text-[10.5px] text-[color:var(--color-text-dim)] whitespace-nowrap">{call.leads?.city}, {call.leads?.state} {call.leads?.zip_code}</div>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[color:var(--color-text-dim)]">
          <span><span className="text-[color:var(--color-text)]">{repName(call.rep_id)}</span></span>
          <span>{formatDate(call.started_at)}</span>
          <span>{formatDuration(call.duration_seconds)}</span>
          <span>{call.outcome ? call.outcome.replace(/_/g, ' ') : '—'}</span>
          {(call.seller_price_initial != null || call.seller_price_final != null) && (
            <span>
              Seller Movement:{' '}
              {call.seller_price_initial != null && call.seller_price_final != null && call.seller_price_initial !== call.seller_price_final
                ? <>{fc(call.seller_price_initial)} → <strong className="text-[color:var(--color-text)]">{fc(call.seller_price_final)}</strong></>
                : <strong className="text-[color:var(--color-text)]">{fc(call.seller_price_final ?? call.seller_price_initial)}</strong>}
              {call.seller_price_movement != null && call.seller_price_movement !== 0 && (
                <> ({call.seller_price_movement > 0 ? '+' : ''}{fc(call.seller_price_movement)})</>
              )}
            </span>
          )}
          {call.follow_up_date && <span>Follow-up: {call.follow_up_date}</span>}
        </div>
        {call.summary && <p className="text-[11.5px] text-[color:var(--color-text-muted)] mt-2 pt-2 border-t border-[color:var(--color-line)] line-clamp-2">{call.summary}</p>}
      </div>

      {!review ? (
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4">
          <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mb-1">Call Review</div>
          <p className="text-[12px] text-[color:var(--color-text-dim)]">Call Review was not generated for this call.</p>
        </div>
      ) : (
        <>
          {/* Context-Aware Call Coaching V1 — compact, re-derived label
              (src/lib/callContext.js), never persisted. Absent for a first
              call with no prior call_sessions for this lead. */}
          {callContext && (
            <div className="text-[10px] uppercase tracking-wider font-bold text-[color:var(--color-text-dim)]">
              {formatCallContextLabel(callContext)}
            </div>
          )}

          {/* CALL RESULT — the ONE primary score on the page. Nothing else
              on this page repeats a giant score after this. */}
          {review.overall_score != null && (
            <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold">Call Result</div>
                <div className="text-[32px] font-extrabold tabular-nums leading-none mt-0.5">{review.overall_score} <span className="text-[15px] font-semibold text-[color:var(--color-text-dim)]">/ 100</span></div>
              </div>
              <span className={`text-[10.5px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-full ${
                band.tone === 'success' ? 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]'
                : band.tone === 'accent' ? 'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]'
                : 'bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)]'
              }`}>{band.label}</span>
            </div>
          )}

          {/* WIN / MISS / NEXT FOCUS — the three things a manager reads.
              Next Coaching Focus is visually the strongest of the three —
              it's the actual management action coming out of this review. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {biggestWin && (
              <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-3">
                <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-success-text)] font-bold mb-1">Biggest Win</div>
                <p className="text-[12px] leading-snug line-clamp-3">{biggestWin}</p>
              </div>
            )}
            {biggestMiss && (
              <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-3">
                <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-warn-text)] font-bold mb-1">Biggest Miss</div>
                <p className="text-[12px] leading-snug line-clamp-3">{biggestMiss}</p>
              </div>
            )}
          </div>

          {currentFocus && (
            <div className="rounded-lg border-2 border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] p-3.5">
              <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-accent-text)] font-bold mb-1">Next Coaching Focus</div>
              <div className="text-[15px] font-bold leading-snug">🎯 {currentFocus.title}</div>
            </div>
          )}

          {/* ══════════════ LEVEL 2 — COACHING EVIDENCE ══════════════
              Why did the system reach this conclusion, and is the
              continuous-coaching loop actually closing? */}

          {review.dimension_scores?.length > 0 && (
            <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4">
              <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mb-2">Skill Breakdown</div>
              <div className="space-y-1">
                {COACHING_DIMENSIONS.map(dim => {
                  const s = review.dimension_scores.find(x => x.key === dim.key)
                  if (!s) return null
                  // Context-Aware Call Coaching V1 — a not-applicable
                  // dimension never renders a fake score/bar; shown as N/A
                  // with its reason instead (never silently dropped).
                  if (s.applicable === false) {
                    return (
                      <div key={dim.key} className="flex items-center justify-between text-[11.5px] gap-3" title={s.reason || ''}>
                        <span className="text-[color:var(--color-text-muted)]">{dim.label}</span>
                        <span className="font-bold text-[color:var(--color-text-dim)]">N/A</span>
                      </div>
                    )
                  }
                  return (
                    <div key={dim.key} className="flex items-center justify-between text-[11.5px] gap-3">
                      <span className="text-[color:var(--color-text-muted)]">{dim.label}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="w-16 h-1.5 rounded-full bg-[color:var(--color-bg-elev-2)] overflow-hidden">
                          <span className={`block h-full rounded-full ${s.score >= 7 ? 'bg-[color:var(--color-success)]' : s.score >= 4 ? 'bg-[color:var(--color-text-dim)]' : 'bg-[color:var(--color-danger)]'}`} style={{ width: `${s.score * 10}%` }} />
                        </span>
                        <span className={`font-bold tabular-nums w-8 text-right ${dimensionTone(s.score)}`}>{s.score}/10</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* CONTINUOUS COACHING — the story that makes this a coaching
              platform, not just a call scorer: what were we coaching, did
              the rep apply it, what's next. Honest empty state when no
              prior-focus evaluation exists — never fabricated. */}
          <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4">
            <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mb-2">Continuous Coaching</div>
            {coachingEval?.coaching_focuses ? (
              <div className="space-y-1.5">
                <div className="text-[11.5px]"><span className="text-[color:var(--color-text-dim)]">Previous Focus:</span> {coachingEval.coaching_focuses.title}</div>
                <div className="text-[11.5px]">
                  Adherence: <strong className={coachingEval.result === 'APPLIED' ? 'text-[color:var(--color-success-text)]' : coachingEval.result === 'NOT_APPLIED' ? 'text-[color:var(--color-danger-text)]' : ''}>
                    {coachingEval.result.replace(/_/g, ' ')}{coachingEval.result === 'APPLIED' ? ' ✓' : ''}
                  </strong>
                </div>
                {coachingEval.why && <div className="text-[11px] text-[color:var(--color-text-dim)]">Why: {coachingEval.why}</div>}
              </div>
            ) : (
              <p className="text-[11.5px] text-[color:var(--color-text-dim)]">No previous coaching focus available for this call.</p>
            )}
            {currentFocus && (
              <div className="text-[11.5px] pt-1.5 mt-1.5 border-t border-[color:var(--color-line)]"><span className="text-[color:var(--color-text-dim)]">Current Focus:</span> <strong>{currentFocus.title}</strong></div>
            )}
          </div>

          {/* ══════════════ LEVEL 3 — FULL COACHING REVIEW ══════════════
              Progressive disclosure — same content that used to render
              unconditionally, now behind an explicit toggle. Nothing
              deleted. */}
          <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)]">
            <button
              type="button"
              onClick={() => setShowFullReview(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-[11.5px] font-semibold text-[color:var(--color-accent-text)]"
              aria-expanded={showFullReview}
            >
              <span>{showFullReview ? 'Hide' : 'View'} Full Coaching Review · Overall {review.overall_score} / 100</span>
              <span className="text-[10px]">{showFullReview ? '▾' : '▸'}</span>
            </button>

            {showFullReview && (
              <div className="px-4 pb-4 space-y-3">
                {review.coverage && (
                  <div className="flex flex-wrap gap-1.5 justify-center pt-1">
                    {review.coverage.dimensions?.map(d => (
                      <span key={d.key} className={`text-[9.5px] font-semibold px-1.5 py-0.5 rounded ${d.status === 'CAPTURED' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]'}`}>
                        {d.status === 'CAPTURED' ? '✓' : '⚠'} {d.label}
                      </span>
                    ))}
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
                    {review.missed_opportunity.betterQuestion && (
                      <p className="text-[10.5px] text-[color:var(--color-text-dim)] mt-1">Better question: "{review.missed_opportunity.betterQuestion}"</p>
                    )}
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
                        <div className="text-[color:var(--color-success-text)]">{m.why}{m.nuance && NUANCE_LABEL[m.nuance] && <span className="text-[10px] text-[color:var(--color-text-dim)]"> ({NUANCE_LABEL[m.nuance]})</span>}</div>
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
        </>
      )}
    </div>
  )
}
