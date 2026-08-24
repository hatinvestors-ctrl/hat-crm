// src/components/lead-detail/CallReview.jsx
// Capability #24 — HAT Acquisition Coach: post-call "Call Review".
// Capability #25.1 — now persists the validated review to call_reviews
// (one immutable row per call_session_id) once generated. Optional,
// best-effort at every step (Part 22/30 principles applied post-call too):
// a failed/unavailable AI call, or a failed DB save, never blocks Save &
// Schedule, and a DB-save failure never silently loses the already-
// generated review — it stays visible with a Retry that re-attempts ONLY
// the save, never a second LLM call.
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getFullTranscriptText } from '../../lib/conversationSession'
import { getCallCoverage, getDealGuardrail, getRealTimeEconomics } from '../../lib/sellerStrategy'
import { COACHING_DIMENSIONS, validateScorecard, computeOverallScore, verifyCoachingMoments, verifyStrongMoves } from '../../lib/callCoaching'
import { buildCallReviewRecord } from '../../lib/callSessions'
import {
  validateCoachingFocusSuggestion, validateAdherenceEvaluation, computeAdoptionRate, computeTrend,
  computeMasteryEligibility, decideFocusAction, pickNextFocusSkill, TREND_WINDOW_SIZE,
} from '../../lib/coachingMemory'

const fc = (n) => n == null ? '—' : `$${Math.round(n).toLocaleString()}`

function ScoreRow({ dim, score }) {
  const [open, setOpen] = useState(false)
  if (!score) return null
  return (
    <div className="border-b border-[color:var(--color-line)] last:border-0 py-1.5">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between text-left">
        <span className="text-[11.5px] font-semibold text-[color:var(--color-text)]">{dim.label}</span>
        <span className="text-[12px] font-bold tabular-nums text-[color:var(--color-text)]">{score.score}/10</span>
      </button>
      {open && (
        <div className="mt-1 text-[10.5px] text-[color:var(--color-text-dim)]">
          <div className="font-semibold uppercase tracking-wide text-[9px] mb-0.5">Why this score</div>
          {score.why}
        </div>
      )}
    </div>
  )
}

export default function CallReview({ lead, session, si, ensureSessionPersisted }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [review, setReview] = useState(null)
  // Capability #25.1 — DB persistence status, separate from AI-generation
  // status. Retry only re-attempts the save, never regenerates (Part 30:
  // zero new AI calls from persistence).
  const [dbSaveStatus, setDbSaveStatus] = useState('idle') // idle | saving | saved | error
  const [dbSaveError, setDbSaveError] = useState(null)
  // Capability #25.2 — continuous coaching. `coaching` holds what's shown
  // in the minimal Part 22 UI: the PREVIOUS focus + this call's adherence
  // to it, and the CURRENT focus going forward (same one, or a freshly
  // resolved/promoted one). Never more than this — no dashboard here.
  const [coaching, setCoaching] = useState(null)
  const [coachingError, setCoachingError] = useState(null)

  // Fetches the rep's single active coaching focus, if any. A plain read
  // — RLS already scopes it to (workspace, rep) exactly like every other
  // query in this codebase.
  async function fetchActiveFocus() {
    if (!session?.workspaceId || !session?.repId) return null
    const { data, error } = await supabase
      .from('coaching_focuses')
      .select('id,skill_key,title,recommendation,example_questions,created_at')
      .eq('workspace_id', session.workspaceId)
      .eq('rep_id', session.repId)
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) return null
    return data
  }

  // Capability #25.2, Part 9-14 — the SYSTEM decides longitudinal
  // improvement/mastery from real persisted history; the AI's role here
  // is already over by this point (its raw claims were validated in
  // generate() below). This function only reads history, computes
  // deterministic trend/adoption/mastery, and writes the resulting rows.
  async function persistCoachingIntelligence({ activeFocusBefore, primaryFocusSuggestion, focusAdherence, dimensionScores }) {
    if (!session?.workspaceId || !session?.repId || !session?.callId) return null
    try {
      let evaluation = null
      if (activeFocusBefore) {
        // Evaluate adherence to the focus that was active BEFORE this call.
        if (focusAdherence) {
          const { data, error } = await supabase.from('coaching_focus_evaluations').insert({
            workspace_id: session.workspaceId, rep_id: session.repId,
            coaching_focus_id: activeFocusBefore.id, call_session_id: session.callId,
            opportunity_existed: focusAdherence.opportunityExisted, result: focusAdherence.result,
            why: focusAdherence.why, seller_quote: focusAdherence.sellerQuote, rep_quote: focusAdherence.repQuote,
          }).select().single()
          // Duplicate (retry) — not a real failure (Part 18: "retry must
          // not duplicate coaching records").
          if (!error || error.code === '23505') evaluation = data || focusAdherence
        }

        // Recompute adoption + skill trend from REAL historical rows —
        // never from the model's own opinion of "is this improving."
        const { data: allEvals } = await supabase
          .from('coaching_focus_evaluations')
          .select('result')
          .eq('coaching_focus_id', activeFocusBefore.id)
        const adoption = computeAdoptionRate(allEvals || [])

        const { data: pastReviews } = await supabase
          .from('call_reviews')
          .select('dimension_scores,created_at')
          .eq('workspace_id', session.workspaceId).eq('rep_id', session.repId)
          .order('created_at', { ascending: true })
          .limit(2 * TREND_WINDOW_SIZE)
        const skillHistory = (pastReviews || [])
          .map(r => r.dimension_scores?.find(s => s.key === activeFocusBefore.skill_key)?.score)
          .filter(v => v != null)
        const trend = computeTrend(skillHistory)

        const mastery = computeMasteryEligibility({ applicableCount: adoption.applicableCount, adoptionRate: adoption.rate, dimensionTrend: trend.status })
        const action = decideFocusAction({ masteryEligible: mastery.eligible })

        let currentFocus = activeFocusBefore
        if (action === 'RESOLVE_MASTERED') {
          await supabase.from('coaching_focuses').update({ status: 'RESOLVED', resolution: 'MASTERED', resolved_at: new Date().toISOString() }).eq('id', activeFocusBefore.id)
          const next = validateCoachingFocusSuggestion(primaryFocusSuggestion)
          if (next) {
            const { data: inserted } = await supabase.from('coaching_focuses').insert({
              workspace_id: session.workspaceId, rep_id: session.repId, source_call_id: session.callId,
              skill_key: next.skillKey, title: next.title, recommendation: next.recommendation, example_questions: next.exampleQuestions,
            }).select().single()
            currentFocus = inserted || null
          } else {
            currentFocus = null
          }
        }

        return { previousFocus: activeFocusBefore, evaluation, adoption, trend, mastery, currentFocus, resolved: action === 'RESOLVE_MASTERED' }
      }

      // No active focus existed yet — this is the rep's first reviewed
      // call. Adopt the AI's suggestion directly as their initial focus
      // (already skill-validated below, before this function is called).
      const first = validateCoachingFocusSuggestion(primaryFocusSuggestion)
      if (!first) return null
      const { data: inserted } = await supabase.from('coaching_focuses').insert({
        workspace_id: session.workspaceId, rep_id: session.repId, source_call_id: session.callId,
        skill_key: first.skillKey, title: first.title, recommendation: first.recommendation, example_questions: first.exampleQuestions,
      }).select().single()
      return { previousFocus: null, evaluation: null, adoption: null, trend: null, mastery: null, currentFocus: inserted || null, resolved: false }
    } catch (err) {
      // Part 18 — AI/coaching failure must never break call review or
      // session persistence, which have already succeeded by this point.
      setCoachingError(err.message || 'Coaching memory unavailable for this call.')
      return null
    }
  }

  async function persistReview(reviewToSave) {
    if (!session?.callId || !session?.workspaceId) {
      setDbSaveStatus('error')
      setDbSaveError('No call session context — review was not saved to history.')
      return
    }
    setDbSaveStatus('saving')
    setDbSaveError(null)
    try {
      if (ensureSessionPersisted) {
        const ok = await ensureSessionPersisted()
        if (!ok) throw new Error('The call itself could not be saved, so the review cannot be attached to it.')
      }
      const economics = getRealTimeEconomics(lead)
      const guardrail = getDealGuardrail(lead, si, economics)
      const record = buildCallReviewRecord({
        callSessionId: session.callId,
        workspaceId: session.workspaceId,
        leadId: lead.id,
        repId: session.repId,
        validatedReview: reviewToSave,
        maxBuySnapshot: guardrail.maxBuyReady ? guardrail.maxBuy : null,
        sellerPriceSnapshot: guardrail.sellerPrice,
      })
      const { error: insertError } = await supabase.from('call_reviews').insert(record)
      // Postgres unique_violation on call_session_id — a review already
      // exists for this call (retry after a prior successful save, or a
      // double-click) — treat as success, never a duplicate row (Part 11).
      if (insertError && insertError.code !== '23505') throw insertError
      setDbSaveStatus('saved')
    } catch (err) {
      setDbSaveStatus('error')
      setDbSaveError(err.message || "Call Review generated but couldn't be saved.")
    }
  }

  async function generate() {
    setLoading(true)
    setError(null)
    setCoachingError(null)
    try {
      const transcript = getFullTranscriptText(session)
      if (!transcript.trim()) throw new Error('No transcript captured — nothing to review.')
      const economics = getRealTimeEconomics(lead)
      const guardrail = getDealGuardrail(lead, si, economics)
      // Capability #25.2, Part 6 — the next call must know the active
      // focus; fetched here (once) and sent to the SAME single AI call
      // used for scoring — never a second LLM call.
      const activeFocusBefore = await fetchActiveFocus()
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/generate-call-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authSession?.access_token || ''}` },
        body: JSON.stringify({
          transcript,
          sellerIntelligence: si,
          canonical: { maxBuy: guardrail.maxBuyReady ? guardrail.maxBuy : null, maxBuyStrategy: guardrail.maxBuyStrategy, currentOffer: guardrail.currentOffer, sellerPrice: guardrail.sellerPrice },
          activeFocus: activeFocusBefore ? { skillKey: activeFocusBefore.skill_key, title: activeFocusBefore.title, recommendation: activeFocusBefore.recommendation } : null,
        }),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) throw new Error(body.error || 'Call review unavailable right now.')

      // Deterministic validation/verification gate — never trust the raw
      // model output directly (Part 21/24).
      const scores = validateScorecard(body.review?.scores)
      const coachingMoments = verifyCoachingMoments(body.review?.coachingMoments, transcript)
      const strongMoves = verifyStrongMoves(body.review?.strongMoves, transcript)
      const missedOpportunity = body.review?.missedOpportunity
      const missedOpportunityVerified = missedOpportunity && (
        (!missedOpportunity.sellerQuote && !missedOpportunity.repQuote) ||
        verifyCoachingMoments([missedOpportunity], transcript).length > 0
      ) ? missedOpportunity : null

      const validated = {
        scores,
        overallScore: computeOverallScore(scores),
        strengths: Array.isArray(body.review?.strengths) ? body.review.strengths.slice(0, 3) : [],
        missedOpportunity: missedOpportunityVerified,
        coachingMoments,
        strongMoves,
        sellerOutcomeSummary: body.review?.sellerOutcomeSummary || null,
      }
      setReview(validated)
      // Persist immediately (Part 11: "The UI and DB should refer to the
      // same review object") — the SAME validated object just rendered,
      // never re-derived.
      await persistReview(validated)

      // Capability #25.2 — validate the AI's coaching-focus/adherence
      // claims (untrusted input, same posture as scores/moments above),
      // then let the deterministic engine decide what happens next.
      const focusAdherence = activeFocusBefore ? validateAdherenceEvaluation(body.review?.focusAdherence, transcript) : null
      const coachingResult = await persistCoachingIntelligence({
        activeFocusBefore, primaryFocusSuggestion: body.review?.primaryCoachingFocus, focusAdherence, dimensionScores: scores,
      })
      setCoaching(coachingResult)
    } catch (err) {
      setError(err.message || 'Call review unavailable right now.')
    } finally {
      setLoading(false)
    }
  }

  const coverage = getCallCoverage(si)

  return (
    <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[9.5px] uppercase tracking-widest text-[color:var(--color-accent-text)] font-bold">HAT Acquisition Coach</div>
          <div className="text-[13px] font-bold text-[color:var(--color-text)]">Call Review</div>
        </div>
        {!review && (
          <button onClick={generate} disabled={loading} className="text-[11px] font-bold px-2.5 py-1.5 rounded bg-[color:var(--color-accent)] text-white disabled:opacity-50">
            {loading ? 'Scoring…' : 'Generate Call Review'}
          </button>
        )}
      </div>

      {/* Coverage — deterministic, always available, independent of the AI call. */}
      <div>
        <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mb-1">Call Coverage · {coverage.capturedCount}/{coverage.total}</div>
        <div className="flex flex-wrap gap-1.5">
          {coverage.dimensions.map(d => (
            <span key={d.key} className={`text-[9.5px] font-semibold px-1.5 py-0.5 rounded ${d.status === 'CAPTURED' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : d.status === 'PARTIAL' ? 'bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)]' : 'bg-[color:var(--color-bg-elev)] text-[color:var(--color-text-dim)]'}`}>
              {d.status === 'CAPTURED' ? '✓' : '⚠'} {d.label}
            </span>
          ))}
        </div>
      </div>

      {error && <p className="text-[11px] text-[color:var(--color-danger-text)]">{error} — coverage above and manually logged facts are still fully usable.</p>}

      {review && (
        <>
          {/* Capability #25.1, Part 22 — the review is never lost just
              because the DB write failed; Retry re-attempts ONLY the save. */}
          {dbSaveStatus === 'error' && (
            <div className="rounded border border-[color:var(--color-danger)] bg-[color:var(--color-danger-soft)] px-2.5 py-2 text-[11px] text-[color:var(--color-danger-text)] flex items-center justify-between gap-2">
              <span>Call Review generated but couldn't be saved: {dbSaveError}</span>
              <button onClick={() => persistReview(review)} className="underline font-semibold shrink-0">Retry</button>
            </div>
          )}
          {dbSaveStatus === 'saved' && (
            <div className="text-[10px] text-[color:var(--color-success-text)]">✓ Saved to Calls History</div>
          )}

          {review.overallScore != null && (
            <div className="text-center py-1">
              <div className="text-[24px] font-extrabold tabular-nums">{review.overallScore} / 100</div>
              <div className="text-[10.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{review.overallScore >= 80 ? 'Strong Call' : review.overallScore >= 60 ? 'Solid Call' : 'Needs Work'}</div>
            </div>
          )}

          {review.sellerOutcomeSummary && (
            <div className="text-[11.5px] text-[color:var(--color-text-muted)] border-t border-[color:var(--color-line)] pt-2">{review.sellerOutcomeSummary}</div>
          )}

          {/* Capability #25.2, Part 22 — minimal by design. Previous focus
              + this call's adherence + current focus + a one-line trend
              signal. No chart, no history table, no dashboard here. */}
          {coachingError && <p className="text-[10.5px] text-[color:var(--color-text-dim)] border-t border-[color:var(--color-line)] pt-2">Coaching memory unavailable for this call: {coachingError}</p>}
          {coaching && (
            <div className="border-t border-[color:var(--color-line)] pt-2 space-y-1.5">
              <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold">Coaching</div>
              {coaching.previousFocus && (
                <>
                  <div className="text-[11.5px]"><span className="text-[color:var(--color-text-dim)]">Previous Focus:</span> {coaching.previousFocus.title}</div>
                  {coaching.evaluation && (
                    <div className="text-[11.5px]">
                      Adherence: <strong className={coaching.evaluation.result === 'APPLIED' ? 'text-[color:var(--color-success-text)]' : coaching.evaluation.result === 'NOT_APPLIED' ? 'text-[color:var(--color-danger-text)]' : 'text-[color:var(--color-text)]'}>
                        {coaching.evaluation.result.replace(/_/g, ' ')}{coaching.evaluation.result === 'APPLIED' ? ' ✓' : ''}
                      </strong>
                      {coaching.evaluation.why && <div className="text-[10.5px] text-[color:var(--color-text-dim)]">Why: {coaching.evaluation.why}</div>}
                    </div>
                  )}
                </>
              )}
              {coaching.currentFocus && (
                <div className="text-[11.5px]"><span className="text-[color:var(--color-text-dim)]">{coaching.resolved ? 'New' : 'Current'} Coaching Focus:</span> <strong>{coaching.currentFocus.title}</strong></div>
              )}
              {coaching.resolved && <div className="text-[10.5px] text-[color:var(--color-success-text)]">✓ Previous focus mastered — promoted to a new focus.</div>}
              {coaching.trend && coaching.trend.status !== 'INSUFFICIENT_DATA' && (
                <div className="text-[10.5px] text-[color:var(--color-text-dim)]">Learning signal: {coaching.previousFocus.skill_key.replace(/_/g, ' ')} {coaching.trend.status.toLowerCase()}{coaching.mastery && !coaching.mastery.eligible ? ' · insufficient evidence for mastery' : ''}</div>
              )}
              {coaching.trend && coaching.trend.status === 'INSUFFICIENT_DATA' && (
                <div className="text-[10.5px] text-[color:var(--color-text-dim)]">Learning signal: not enough reviewed calls yet to show a trend.</div>
              )}
            </div>
          )}

          {review.scores.length > 0 && (
            <div className="border-t border-[color:var(--color-line)] pt-1">
              {COACHING_DIMENSIONS.map(dim => (
                <ScoreRow key={dim.key} dim={dim} score={review.scores.find(s => s.key === dim.key)} />
              ))}
            </div>
          )}

          {review.strengths.length > 0 && (
            <div className="border-t border-[color:var(--color-line)] pt-2">
              <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mb-1">What You Did Well</div>
              <ul className="space-y-0.5">
                {review.strengths.map((s, i) => <li key={i} className="text-[11.5px] text-[color:var(--color-success-text)]">✓ {s}</li>)}
              </ul>
            </div>
          )}

          {review.missedOpportunity && (
            <div className="border-t border-[color:var(--color-line)] pt-2">
              <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-warn-text)] font-bold mb-1">Biggest Missed Opportunity</div>
              <p className="text-[11.5px] text-[color:var(--color-text)]">{review.missedOpportunity.summary}</p>
              {review.missedOpportunity.betterQuestion && (
                <p className="text-[10.5px] text-[color:var(--color-text-dim)] mt-1">Better question: "{review.missedOpportunity.betterQuestion}"</p>
              )}
            </div>
          )}

          {review.coachingMoments.length > 0 && (
            <div className="border-t border-[color:var(--color-line)] pt-2 space-y-2">
              <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold">Coach This Moment</div>
              {review.coachingMoments.map((m, i) => (
                <div key={i} className="rounded border border-[color:var(--color-line)] px-2 py-1.5 text-[11px] space-y-0.5">
                  {m.sellerQuote && <div><span className="font-semibold">Seller:</span> "{m.sellerQuote}"</div>}
                  {m.repQuote && <div><span className="font-semibold">Kevin:</span> "{m.repQuote}"</div>}
                  <div className="text-[color:var(--color-text-dim)]">Coach: {m.coach}</div>
                  {m.betterQuestion && <div className="text-[color:var(--color-accent-text)]">Better: "{m.betterQuestion}"</div>}
                </div>
              ))}
            </div>
          )}

          {review.strongMoves.length > 0 && (
            <div className="border-t border-[color:var(--color-line)] pt-2 space-y-2">
              <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold">Strong Move</div>
              {review.strongMoves.map((m, i) => (
                <div key={i} className="rounded border border-[color:var(--color-success)] px-2 py-1.5 text-[11px] space-y-0.5">
                  {m.sellerQuote && <div><span className="font-semibold">Seller:</span> "{m.sellerQuote}"</div>}
                  {m.repQuote && <div><span className="font-semibold">Kevin:</span> "{m.repQuote}"</div>}
                  <div className="text-[color:var(--color-success-text)]">{m.why}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
