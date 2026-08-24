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
    try {
      const transcript = getFullTranscriptText(session)
      if (!transcript.trim()) throw new Error('No transcript captured — nothing to review.')
      const economics = getRealTimeEconomics(lead)
      const guardrail = getDealGuardrail(lead, si, economics)
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/generate-call-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authSession?.access_token || ''}` },
        body: JSON.stringify({
          transcript,
          sellerIntelligence: si,
          canonical: { maxBuy: guardrail.maxBuyReady ? guardrail.maxBuy : null, maxBuyStrategy: guardrail.maxBuyStrategy, currentOffer: guardrail.currentOffer, sellerPrice: guardrail.sellerPrice },
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
