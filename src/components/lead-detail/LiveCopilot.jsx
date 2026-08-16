// src/components/lead-detail/LiveCopilot.jsx
// Capability #22 + #22.1 — Live Acquisition Copilot workspace.
//
// #22.1 closes the "Kevin has to type" gap: Web Speech API microphone
// capture (src/hooks/useSpeechRecognition.js) feeds the SAME
// addSegment()/transcript session #22 already built — no second
// pipeline. Manual typing still works as a fallback (mic unsupported,
// mic error, or Kevin just prefers it).
//
// HONEST LIMITATIONS (documented, not hidden): Web Speech API has NO
// speaker diarization — every result is one undifferentiated stream, sent
// downstream as speaker=UNKNOWN. Kevin-vs-seller fact protection is
// handled by extract-seller-facts.mjs reasoning over conversational role
// (who's asking vs. who's answering), not a speaker label that doesn't
// exist. Chrome/Edge only.
import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useLeadUpdate } from '../../hooks/useLeadUpdate'
import { logOutcome } from '../../lib/activityLogger'
import { resolveFollowUpPhrase } from '../../lib/followUpTiming'
import { useSpeechRecognition, isSpeechRecognitionSupported } from '../../hooks/useSpeechRecognition'
import {
  createSession, addSegment, getUnprocessedSegments, markExtracted, getDurationSeconds,
  formatDuration, inferConversationStage, detectFastSignals,
} from '../../lib/conversationSession'
import {
  getSellerIntelligence, mergeSellerIntelligence, getSellerSnapshot, getCallObjective,
  getRealTimeEconomics, getNextBestMove, getCallMemory, getWhatChanged, PAIN_POINT_OPTIONS,
} from '../../lib/sellerStrategy'

const fc = (n) => n == null ? '—' : `$${Math.round(n).toLocaleString()}`
// Capability #22.2, Section 4/5 — two-speed debounce. A FAST-path event
// (price/decision-maker/objection/follow-up — Layer A's detectFastSignals)
// gets a short debounce so guidance updates within a couple seconds of a
// meaningful statement, matching the mission's explicit complaint that
// "today guidance is still too dependent on larger debounced cycles."
// Everything else still batches on the slower cycle so a live mic (which
// produces far more utterances than manual typing ever did) doesn't
// trigger an LLM call on every "okay"/"yeah".
const FAST_DEBOUNCE_MS = 600
const NORMAL_DEBOUNCE_MS = 1800
// Safety valve: even without a keyword hit, don't let unanalyzed segments
// pile up forever during a quiet stretch of small talk.
const MAX_UNPROCESSED_BEFORE_FORCE = 6

function StatChip({ label, value, tone }) {
  const toneColor = tone === 'good' ? 'var(--color-success-text)' : tone === 'warn' ? 'var(--color-warn-text)' : 'var(--color-text)'
  return (
    <div className="flex flex-col items-center px-2">
      <div className="text-[8.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{label}</div>
      <div className="text-[12.5px] font-bold" style={{ color: toneColor }}>{value}</div>
    </div>
  )
}

function MicButton({ status, supported, onStart, onPause, onResume, onStop }) {
  if (!supported) {
    return <span className="text-[10.5px] text-[color:var(--color-warn-text)]">🎙 Mic not supported in this browser (Chrome/Edge only) — type below instead.</span>
  }
  if (status === 'OFF' || status === 'ERROR') {
    return (
      <button onClick={onStart} className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-[color:var(--color-accent)] text-white">
        🎙 Start Listening
      </button>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${status === 'LISTENING' ? 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]' : 'bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)]'}`}>
        {status === 'LISTENING' ? '● Listening…' : '⏸ Paused'}
      </span>
      {status === 'LISTENING' ? (
        <button onClick={onPause} className="text-[11px] font-semibold px-2 py-1 rounded border border-[color:var(--color-line)] text-[color:var(--color-text-muted)]">Pause</button>
      ) : (
        <button onClick={onResume} className="text-[11px] font-semibold px-2 py-1 rounded border border-[color:var(--color-line)] text-[color:var(--color-text-muted)]">Resume</button>
      )}
      <button onClick={onStop} className="text-[11px] font-semibold px-2 py-1 rounded border border-[color:var(--color-danger)] text-[color:var(--color-danger-text)]">Stop</button>
    </div>
  )
}

export default function LiveCopilot({ lead, userId, members, canEdit, onUpdated, onClose }) {
  const update = useLeadUpdate(lead, userId, members, onUpdated)
  const [session, setSession] = useState(() => createSession(lead))
  const [input, setInput] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState(null)
  const [pendingFacts, setPendingFacts] = useState(null)
  const [lastOutcomeActivity, setLastOutcomeActivity] = useState(null)
  const [ended, setEnded] = useState(false)
  const [tick, setTick] = useState(0)
  const [showTranscript, setShowTranscript] = useState(false)
  const [consentGiven, setConsentGiven] = useState(false)
  const [captureFlash, setCaptureFlash] = useState(null) // e.g. "PRICE CAPTURED $175K"
  const scrollRef = useRef(null)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const debounceTimerRef = useRef(null)

  const si = getSellerIntelligence(lead)
  const snapshot = getSellerSnapshot(lead)
  const economics = getRealTimeEconomics(lead)
  const nextMove = getNextBestMove(lead, si, economics)
  const callMemory = getCallMemory(lead, lastOutcomeActivity)
  const whatChanged = getWhatChanged(callMemory, economics)
  const stage = inferConversationStage(si)

  useEffect(() => {
    const t = setInterval(() => setTick(v => v + 1), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (lead?.id) {
      supabase.from('lead_activities').select('content, metadata, created_at')
        .eq('lead_id', lead.id).eq('metadata->>event', 'outcome_logged')
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
        .then(({ data }) => { if (!cancelled) setLastOutcomeActivity(data || null) })
    }
    return () => { cancelled = true }
  }, [lead?.id])

  useEffect(() => {
    if (showTranscript) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [session.segments.length, showTranscript])

  async function applyFacts(facts) {
    const patch = {}
    if (facts.open_to_sell) patch.open_to_sell = facts.open_to_sell
    if (facts.pain_points?.length) patch.pain_points = [...new Set([...si.pain_points, ...facts.pain_points])]
    if (facts.motivation_notes) patch.motivation_notes = si.motivation_notes ? `${si.motivation_notes}\n${facts.motivation_notes}` : facts.motivation_notes
    if (facts.timeline) patch.timeline = facts.timeline
    if (facts.condition_notes) patch.condition_notes = si.condition_notes ? `${si.condition_notes}\n${facts.condition_notes}` : facts.condition_notes
    // #22.1, Section 17 — changed-price handling: keep history instead of
    // silently overwriting, so "current" always drives guidance but
    // "previously stated" stays visible/auditable.
    if (facts.seller_asking_price != null && facts.seller_asking_price !== si.seller_asking_price) {
      patch.seller_asking_price = facts.seller_asking_price
      // #22.2, Section 12 — carry status so guidance/UI never implies a
      // conditional number ("I might consider $170K") is an accepted deal.
      patch.seller_price_status = facts.seller_price_status || null
      if (si.seller_asking_price != null) {
        patch.seller_asking_price_history = [...(si.seller_asking_price_history || []), { value: si.seller_asking_price, at: new Date().toISOString() }]
      }
      setCaptureFlash(`PRICE CAPTURED ${fc(facts.seller_asking_price)}${facts.seller_price_status === 'CONDITIONAL' ? ' (conditional)' : ''}`)
    }
    // #22.2, Section 11 — a rep-side number is never the seller's price;
    // kept separately, typed (range/formal offer/probe) for clarity.
    if (facts.hat_offer_mentioned != null) {
      patch.hat_offer_mentioned = facts.hat_offer_mentioned
      patch.hat_offer_type = facts.hat_offer_type || 'RANGE_MENTIONED'
    }
    if (facts.decision_makers) { patch.decision_makers = facts.decision_makers; setCaptureFlash('DECISION MAKER CAPTURED') }
    if (facts.debt_notes) patch.debt_notes = facts.debt_notes
    if (facts.new_objection) { patch.objections = [...si.objections, facts.new_objection]; setCaptureFlash(`OBJECTION: ${facts.new_objection.replace(/_/g, ' ')}`) }
    if (facts.last_response_summary) patch.last_response = facts.last_response_summary
    // #22.2, Section 14 — surface the moment a follow-up is mentioned,
    // resolved to a real date only at End Call (never silently scheduled
    // mid-call).
    if (facts.follow_up_phrase) { patch.follow_up_phrase = facts.follow_up_phrase; setCaptureFlash(`FOLLOW-UP: ${facts.follow_up_phrase}`) }
    if (facts.timeline && !facts.seller_asking_price && !facts.follow_up_phrase) setCaptureFlash(`TIMELINE ${facts.timeline.replace(/_/g, ' ')}`)
    if (Object.keys(patch).length === 0) return
    await update({ distress_data: mergeSellerIntelligence(lead, patch) })
    if (captureFlash) setTimeout(() => setCaptureFlash(null), 3000)
  }

  const analyzeTranscript = useCallback(async () => {
    const unprocessed = getUnprocessedSegments(sessionRef.current)
    if (unprocessed.length === 0) return
    setAnalyzing(true)
    setAnalyzeError(null)
    try {
      const text = unprocessed.map(s => `${s.speaker}: ${s.text}`).join('\n')
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/extract-seller-facts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authSession?.access_token || ''}` },
        body: JSON.stringify({ transcript: text, known: si }),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) throw new Error(body.error || 'Extraction failed')
      setSession(s => markExtracted(s))
      if (body.facts.confidence === 'low') {
        setPendingFacts(body.facts)
      } else {
        await applyFacts(body.facts)
      }
    } catch (err) {
      // AI failure fallback (Section 22/37) — call keeps going; manual
      // quick-capture and existing facts remain fully usable.
      setAnalyzeError('Transcription analysis unavailable right now — you can still capture facts manually below.')
    } finally {
      setAnalyzing(false)
    }
  }, [si])

  // #22.1/#22.2, Section 4/5/7/20 — two-speed automatic analysis. Every
  // finalized mic utterance is added as a segment; Layer A's
  // detectFastSignals() decides the debounce speed:
  //   - FAST signal (price/decision-maker/objection/follow-up) -> short
  //     debounce, so guidance updates within a couple seconds.
  //   - Other high-value content -> normal (still batched) debounce.
  //   - Nothing notable -> no trigger at all, unless the safety-valve
  //     count forces one so a quiet stretch never piles up unanalyzed.
  // A pending FAST call always wins over a pending NORMAL one — never the
  // other way around, so one urgent signal can't get stuck behind a
  // slower timer that was already ticking.
  const scheduleAnalyze = useCallback((ms) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => { analyzeTranscript() }, ms)
  }, [analyzeTranscript])

  const handleFinalUtterance = useCallback((text) => {
    setSession(s => addSegment(s, { speaker: 'UNKNOWN', text }))
    const unprocessedCount = getUnprocessedSegments(sessionRef.current).length + 1
    const { isHighValue, isFast } = detectFastSignals(text)
    if (isFast) {
      scheduleAnalyze(FAST_DEBOUNCE_MS)
    } else if (isHighValue || unprocessedCount >= MAX_UNPROCESSED_BEFORE_FORCE) {
      scheduleAnalyze(NORMAL_DEBOUNCE_MS)
    }
  }, [scheduleAnalyze])

  const mic = useSpeechRecognition(handleFinalUtterance)

  function startListening() {
    if (!consentGiven) return
    mic.start()
  }

  function addManualSegment() {
    if (!input.trim()) return
    setSession(s => addSegment(s, { speaker: 'UNKNOWN', text: input }))
    setInput('')
    const { isFast } = detectFastSignals(input)
    scheduleAnalyze(isFast ? FAST_DEBOUNCE_MS : NORMAL_DEBOUNCE_MS)
  }

  function togglePainManual(key) {
    const has = si.pain_points.includes(key)
    update({ distress_data: mergeSellerIntelligence(lead, { pain_points: has ? si.pain_points.filter(p => p !== key) : [...si.pain_points, key] }) })
  }

  return (
    <div className="fixed inset-0 z-50 bg-[color:var(--color-bg)] flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[color:var(--color-line)] shrink-0">
        <div>
          <div className="text-[13px] font-bold text-[color:var(--color-text)]">{lead.owner_name || 'Owner'} · {lead.address}</div>
          <div className="text-[10.5px] text-[color:var(--color-text-dim)]">LIVE {formatDuration(getDurationSeconds(session))} · Stage: {stage}</div>
        </div>
        <button onClick={() => { mic.stop(); onClose() }} className="text-[12px] font-semibold px-2.5 py-1 rounded border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]">Close</button>
      </div>

      {!ended ? (
        <div className="flex-1 overflow-y-auto px-4 py-3 max-w-3xl mx-auto w-full space-y-3">
          {/* Consent notice — Section 3, shown before mic activates */}
          {!consentGiven && (
            <div className="rounded-lg border border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)] px-3 py-2.5">
              <p className="text-[11.5px] text-[color:var(--color-warn-text)] leading-snug">
                Starting the microphone will transcribe live audio in this browser to text. You are responsible for complying with applicable call-consent/recording laws for your state and the seller's. No raw audio is stored — only the finalized text transcript, which is used to update this lead's records.
              </p>
              <button onClick={() => setConsentGiven(true)} className="mt-1.5 text-[11px] font-bold px-2.5 py-1 rounded bg-[color:var(--color-warn)] text-white">I Understand — Enable Microphone</button>
            </div>
          )}

          {/* Mic controls */}
          <div className="flex items-center justify-between rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-3 py-2">
            <MicButton status={mic.status} supported={isSpeechRecognitionSupported()} onStart={startListening} onPause={mic.pause} onResume={mic.resume} onStop={mic.stop} />
            {captureFlash && <span className="text-[10.5px] font-bold text-[color:var(--color-accent-text)] animate-pulse">{captureFlash}</span>}
          </div>
          {mic.status === 'ERROR' && mic.error && <p className="text-[10.5px] text-[color:var(--color-danger-text)]">🎙 {mic.error}</p>}

          {/* Call Memory */}
          {callMemory && (
            <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-3 py-2">
              <div className="text-[9px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-bold mb-1">Last Time ({callMemory.daysSince != null ? `${callMemory.daysSince}d ago` : 'unknown'})</div>
              <div className="text-[11.5px] text-[color:var(--color-text-muted)]">
                {callMemory.lastOutcome && <span>Outcome: {callMemory.lastOutcome.replace(/_/g, ' ')}. </span>}
                {callMemory.sellerExpectation != null && <span>Seller wanted {fc(callMemory.sellerExpectation)}. </span>}
                {callMemory.lastNote && <span>"{callMemory.lastNote}"</span>}
              </div>
              {whatChanged.length > 0 && <div className="text-[10.5px] text-[color:var(--color-accent-text)] mt-1">What changed: {whatChanged.join(' ')}</div>}
              <div className="text-[11px] font-semibold text-[color:var(--color-text)] mt-1">Today's objective: {getCallObjective(lead)}</div>
            </div>
          )}

          {/* Seller State + Economics */}
          <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] p-2.5">
            <div className="grid grid-cols-5 divide-x divide-[color:var(--color-line)] mb-2">
              <StatChip label="Open to Sell" value={si.open_to_sell || 'UNKNOWN'} tone={si.open_to_sell === 'YES' ? 'good' : undefined} />
              <StatChip label="Motivation" value={snapshot.motivation} />
              <StatChip label="Timeline" value={snapshot.timeline} />
              <StatChip label="Seller Price" value={snapshot.priceDisplay} tone={snapshot.priceStatus === 'CONDITIONAL' ? 'warn' : undefined} />
              <StatChip label="Main Pain" value={snapshot.mainPain?.label || '—'} />
            </div>
            {snapshot.mainPain?.supporting?.length > 1 && (
              <div className="text-[10px] text-[color:var(--color-text-dim)] text-center mb-1.5">Supporting: {snapshot.mainPain.supporting.join(', ')}</div>
            )}
            {si.seller_asking_price_history?.length > 0 && (
              <div className="text-[10px] text-[color:var(--color-text-dim)] text-center mb-1.5">Previously stated: {si.seller_asking_price_history.map(h => fc(h.value)).join(' → ')} → <strong>{fc(si.seller_asking_price)}</strong> (changed during call)</div>
            )}
            {si.hat_offer_mentioned != null && (
              <div className="text-[10px] text-[color:var(--color-text-dim)] text-center mb-1.5">
                HAT {si.hat_offer_type === 'FORMAL_OFFER' ? 'formal offer' : si.hat_offer_type === 'PROBE' ? 'probed' : 'range mentioned'}: {fc(si.hat_offer_mentioned)} (not the seller's ask)
              </div>
            )}
            <div className="grid grid-cols-4 divide-x divide-[color:var(--color-line)] border-t border-[color:var(--color-line)] pt-2">
              <StatChip label="Our Offer" value={fc(economics.ourOffer)} />
              <StatChip label="Flip Max" value={economics.flipReady ? fc(economics.flipMao) : 'NOT READY'} tone={economics.flipReady ? undefined : 'warn'} />
              <StatChip label="BRRRR Max" value={economics.brrrrReady ? fc(economics.brrrrMao) : 'NOT READY'} tone={economics.brrrrReady ? undefined : 'warn'} />
              <StatChip label="Best Ceiling" value={economics.bestCeiling != null ? `${fc(economics.bestCeiling)} (${economics.bestCeilingStrategy})` : '—'} tone="good" />
            </div>
            {economics.gap != null && (
              <div className="text-[10.5px] text-[color:var(--color-text-dim)] mt-1.5 text-center">Gap to best ceiling: {fc(Math.abs(economics.gap))} {economics.gap > 0 ? 'above' : 'within'}</div>
            )}
          </div>

          {/* NEXT MOVE hero */}
          <div className="rounded-xl border-2 border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] px-4 py-3.5 text-center">
            <div className="text-[9.5px] uppercase tracking-widest text-[color:var(--color-accent-text)] font-bold mb-1">{nextMove.move}</div>
            {nextMove.ask ? (
              <p className="text-[17px] font-bold text-[color:var(--color-accent-text)] leading-snug">"{nextMove.ask}"</p>
            ) : (
              <p className="text-[13px] text-[color:var(--color-accent-text)]">{nextMove.note}</p>
            )}
            {nextMove.note && nextMove.ask && <p className="text-[10.5px] text-[color:var(--color-accent-text)] opacity-80 mt-1">{nextMove.note}</p>}
          </div>

          {pendingFacts && (
            <div className="rounded-lg border border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)] px-3 py-2">
              <div className="text-[10.5px] font-bold text-[color:var(--color-warn-text)] mb-1">Low-confidence extraction — confirm before saving:</div>
              <div className="text-[11px] text-[color:var(--color-warn-text)] mb-1.5">{JSON.stringify(pendingFacts, null, 0).slice(0, 200)}</div>
              <div className="flex gap-2">
                <button onClick={() => { applyFacts(pendingFacts); setPendingFacts(null) }} className="text-[11px] font-semibold px-2 py-1 rounded bg-[color:var(--color-success)] text-white">Confirm</button>
                <button onClick={() => setPendingFacts(null)} className="text-[11px] font-semibold px-2 py-1 rounded border border-[color:var(--color-line)] text-[color:var(--color-text-muted)]">Discard</button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {PAIN_POINT_OPTIONS.map(p => (
              <button key={p.key} onClick={() => togglePainManual(p.key)}
                className={`text-[10.5px] font-semibold px-2 py-1 rounded-full border transition-colors ${
                  si.pain_points.includes(p.key) ? 'bg-[color:var(--color-accent)] border-[color:var(--color-accent)] text-white' : 'bg-[color:var(--color-bg-elev-2)] border-[color:var(--color-line)] text-[color:var(--color-text-muted)]'
                }`}>
                {p.label}
              </button>
            ))}
          </div>

          {/* Transcript — secondary, collapsed by default (Section 11) */}
          <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] p-2.5">
            <button onClick={() => setShowTranscript(v => !v)} className="text-[10.5px] font-semibold text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] mb-1.5">
              {showTranscript ? '▾ Hide Transcript' : '▸ Show Transcript'} ({session.segments.length})
              {mic.interimText && <span className="italic text-[color:var(--color-text-faint)]"> — "{mic.interimText}"</span>}
            </button>
            {showTranscript && (
              <>
                <div ref={scrollRef} className="max-h-32 overflow-y-auto space-y-1 mb-2">
                  {session.segments.length === 0 ? (
                    <p className="text-[10.5px] text-[color:var(--color-text-faint)] italic">Nothing yet — start listening or type below.</p>
                  ) : session.segments.map(seg => (
                    <div key={seg.id} className="text-[11px]"><span className="text-[color:var(--color-text-muted)]">{seg.text}</span></div>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addManualSegment()}
                    placeholder="Type manually (fallback)…" className="flex-1 text-[12px] px-2 py-1.5 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg)] text-[color:var(--color-text)]" />
                  <button onClick={addManualSegment} className="text-[11px] font-semibold px-2.5 rounded bg-[color:var(--color-bg)] border border-[color:var(--color-line)] text-[color:var(--color-text-muted)]">Add</button>
                  <button onClick={analyzeTranscript} disabled={analyzing || getUnprocessedSegments(session).length === 0}
                    className="text-[11px] font-bold px-2.5 rounded bg-[color:var(--color-accent)] text-white disabled:opacity-40">
                    {analyzing ? '…' : 'Analyze Now'}
                  </button>
                </div>
              </>
            )}
            {analyzeError && <p className="text-[10.5px] text-[color:var(--color-danger-text)] mt-1">{analyzeError}</p>}
          </div>

          <button onClick={() => { mic.stop(); setEnded(true) }} className="w-full text-[13px] font-bold py-2 rounded-lg bg-[color:var(--color-danger)] text-white">End Call</button>
        </div>
      ) : (
        <EndCallSummary lead={lead} si={si} userId={userId} onSaved={() => { onClose(); }} onDiscard={() => setEnded(false)} />
      )}
    </div>
  )
}

function EndCallSummary({ lead, si, userId, onSaved, onDiscard }) {
  const [outcome, setOutcome] = useState(si.open_to_sell === 'NO' ? 'not_interested' : 'spoke_follow_up')
  // #22.2, Section 16 — pre-fill from the seller's spoken follow-up
  // phrase, resolved deterministically (never LLM date math) in the
  // business timezone. If unresolved, leave blank and show why — never
  // silently schedule a guessed date.
  const resolvedFollowUp = si.follow_up_phrase ? resolveFollowUpPhrase(si.follow_up_phrase) : null
  const [followUpDate, setFollowUpDate] = useState(resolvedFollowUp || '')
  const [note, setNote] = useState(si.last_response || '')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await logOutcome(lead.id, userId, {
        outcome, note,
        followUpDate: followUpDate || null,
        sellerExpectation: si.seller_asking_price ?? null,
        lead,
      })
      if (followUpDate) {
        await supabase.from('leads').update({ status: 'follow_up', follow_up_date: followUpDate }).eq('id', lead.id)
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 max-w-md mx-auto w-full space-y-3">
      <div className="text-[15px] font-bold text-[color:var(--color-text)]">Call Complete</div>
      <div className="text-[12px] text-[color:var(--color-text-muted)] space-y-1">
        <div>Motivation: {si.pain_points.join(', ') || 'none captured'}</div>
        <div>Timeline: {si.timeline || 'unknown'}</div>
        <div>Seller price: {si.seller_asking_price != null ? `$${si.seller_asking_price.toLocaleString()}` : 'unknown'}</div>
        <div>Decision makers: {si.decision_makers || 'unknown'}</div>
        <div>Objections: {si.objections?.join(', ') || 'none'}</div>
      </div>
      <label className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Outcome</label>
      <select value={outcome} onChange={e => setOutcome(e.target.value)} className="w-full text-[12px] px-2 py-1.5 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)]">
        <option value="spoke_follow_up">Spoke — Follow Up</option>
        <option value="not_interested">Not Interested</option>
        <option value="dead_lead">Dead Lead</option>
        <option value="need_more_info">Need More Information</option>
      </select>
      <label className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Follow-Up Date</label>
      {si.follow_up_phrase && (
        <p className="text-[10.5px] text-[color:var(--color-text-dim)]">
          Seller said: "{si.follow_up_phrase}" {resolvedFollowUp ? `→ resolved to ${resolvedFollowUp}` : '— could not resolve to a specific date, please set manually'}
        </p>
      )}
      <input type="date" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)} className="w-full text-[12px] px-2 py-1.5 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)]" />
      <label className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Note</label>
      <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className="w-full text-[12px] px-2 py-1.5 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)]" />
      <div className="flex gap-2">
        <button onClick={onDiscard} className="text-[12px] font-semibold px-3 py-1.5 rounded border border-[color:var(--color-line)] text-[color:var(--color-text-muted)]">Back to Call</button>
        <button onClick={save} disabled={saving} className="flex-1 text-[12px] font-bold px-3 py-1.5 rounded bg-[color:var(--color-accent)] text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Save & Schedule'}
        </button>
      </div>
    </div>
  )
}
