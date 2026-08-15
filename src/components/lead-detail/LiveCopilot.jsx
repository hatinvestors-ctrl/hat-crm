// src/components/lead-detail/LiveCopilot.jsx
// Capability #22 — Live Acquisition Copilot workspace.
//
// HONEST SCOPE: no microphone/audio capture. Kevin types or pastes what
// the seller said; a future STT/telephony integration would feed the
// same addSegment() call this UI makes, with nothing else here needing
// to change (src/lib/conversationSession.js documents this contract).
//
// Full-screen focused workspace, NOT the normal CRM page and NOT a chat
// window — one Seller State strip, one Economics strip, one large ASK
// NEXT/NEXT MOVE hero, everything else secondary (mission's explicit
// "1-second glance test").
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useLeadUpdate } from '../../hooks/useLeadUpdate'
import { logOutcome } from '../../lib/activityLogger'
import { createSession, addSegment, getUnprocessedSegments, markExtracted, getDurationSeconds, formatDuration, inferConversationStage } from '../../lib/conversationSession'
import {
  getSellerIntelligence, mergeSellerIntelligence, getSellerSnapshot, getCallObjective,
  getRealTimeEconomics, getNextBestMove, getCallMemory, getWhatChanged, PAIN_POINT_OPTIONS,
} from '../../lib/sellerStrategy'

const fc = (n) => n == null ? '—' : `$${Math.round(n).toLocaleString()}`

function StatChip({ label, value, tone }) {
  const toneColor = tone === 'good' ? 'var(--color-success-text)' : tone === 'warn' ? 'var(--color-warn-text)' : 'var(--color-text)'
  return (
    <div className="flex flex-col items-center px-2">
      <div className="text-[8.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{label}</div>
      <div className="text-[12.5px] font-bold" style={{ color: toneColor }}>{value}</div>
    </div>
  )
}

export default function LiveCopilot({ lead, userId, members, canEdit, onUpdated, onClose }) {
  const update = useLeadUpdate(lead, userId, members, onUpdated)
  const [session, setSession] = useState(() => createSession(lead))
  const [input, setInput] = useState('')
  const [speaker, setSpeaker] = useState('SELLER')
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState(null)
  const [pendingFacts, setPendingFacts] = useState(null) // low-confidence facts awaiting Kevin confirm
  const [lastOutcomeActivity, setLastOutcomeActivity] = useState(null)
  const [ended, setEnded] = useState(false)
  const [tick, setTick] = useState(0)
  const scrollRef = useRef(null)

  const si = getSellerIntelligence(lead)
  const economics = getRealTimeEconomics(lead)
  const nextMove = getNextBestMove(lead, si, economics)
  const negotiation = economics.bestCeiling != null && economics.ourOffer != null
    ? { room: economics.bestCeiling - economics.ourOffer }
    : null
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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [session.segments.length])

  async function applyFacts(facts) {
    const patch = {}
    if (facts.open_to_sell) patch.open_to_sell = facts.open_to_sell
    if (facts.pain_points?.length) patch.pain_points = [...new Set([...si.pain_points, ...facts.pain_points])]
    if (facts.motivation_notes) patch.motivation_notes = si.motivation_notes ? `${si.motivation_notes}\n${facts.motivation_notes}` : facts.motivation_notes
    if (facts.timeline) patch.timeline = facts.timeline
    if (facts.condition_notes) patch.condition_notes = si.condition_notes ? `${si.condition_notes}\n${facts.condition_notes}` : facts.condition_notes
    if (facts.seller_asking_price != null) patch.seller_asking_price = facts.seller_asking_price
    if (facts.decision_makers) patch.decision_makers = facts.decision_makers
    if (facts.debt_notes) patch.debt_notes = facts.debt_notes
    if (facts.new_objection) patch.objections = [...si.objections, facts.new_objection]
    if (facts.last_response_summary) patch.last_response = facts.last_response_summary
    if (Object.keys(patch).length === 0) return
    await update({ distress_data: mergeSellerIntelligence(lead, patch) })
  }

  function addTranscriptSegment() {
    if (!input.trim()) return
    setSession(s => addSegment(s, { speaker, text: input }))
    setInput('')
  }

  async function analyzeTranscript() {
    const unprocessed = getUnprocessedSegments(session)
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
      // Confidence gate (Section 7) — low confidence needs a one-click confirm, never silently becomes CRM truth.
      if (body.facts.confidence === 'low') {
        setPendingFacts(body.facts)
      } else {
        await applyFacts(body.facts)
      }
    } catch (err) {
      // AI failure fallback (Section 37) — the call keeps going; existing
      // facts/economics/manual quick-capture remain fully usable.
      setAnalyzeError('Could not analyze that segment — you can still capture facts manually below.')
    } finally {
      setAnalyzing(false)
    }
  }

  function togglePainManual(key) {
    const has = si.pain_points.includes(key)
    update({ distress_data: mergeSellerIntelligence(lead, { pain_points: has ? si.pain_points.filter(p => p !== key) : [...si.pain_points, key] }) })
  }

  return (
    <div className="fixed inset-0 z-50 bg-[color:var(--color-bg)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[color:var(--color-line)] shrink-0">
        <div>
          <div className="text-[13px] font-bold text-[color:var(--color-text)]">{lead.owner_name || 'Owner'} · {lead.address}</div>
          <div className="text-[10.5px] text-[color:var(--color-text-dim)]">LIVE {formatDuration(getDurationSeconds(session))} · Stage: {stage}</div>
        </div>
        <button onClick={onClose} className="text-[12px] font-semibold px-2.5 py-1 rounded border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]">Close</button>
      </div>

      {!ended ? (
        <div className="flex-1 overflow-y-auto px-4 py-3 max-w-3xl mx-auto w-full space-y-3">
          {/* Before You Call / Call Memory */}
          {callMemory && (
            <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-3 py-2">
              <div className="text-[9px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-bold mb-1">Last Time ({callMemory.daysSince != null ? `${callMemory.daysSince}d ago` : 'unknown'})</div>
              <div className="text-[11.5px] text-[color:var(--color-text-muted)]">
                {callMemory.lastOutcome && <span>Outcome: {callMemory.lastOutcome.replace(/_/g, ' ')}. </span>}
                {callMemory.sellerExpectation != null && <span>Seller wanted {fc(callMemory.sellerExpectation)}. </span>}
                {callMemory.lastNote && <span>"{callMemory.lastNote}"</span>}
              </div>
              {whatChanged.length > 0 && (
                <div className="text-[10.5px] text-[color:var(--color-accent-text)] mt-1">What changed: {whatChanged.join(' ')}</div>
              )}
              <div className="text-[11px] font-semibold text-[color:var(--color-text)] mt-1">Today's objective: {getCallObjective(lead)}</div>
            </div>
          )}

          {/* Seller State + Economics strip */}
          <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] p-2.5">
            <div className="grid grid-cols-5 divide-x divide-[color:var(--color-line)] mb-2">
              <StatChip label="Open to Sell" value={si.open_to_sell || 'UNKNOWN'} tone={si.open_to_sell === 'YES' ? 'good' : undefined} />
              <StatChip label="Motivation" value={getSellerSnapshot(lead).motivation} />
              <StatChip label="Timeline" value={getSellerSnapshot(lead).timeline} />
              <StatChip label="Seller Price" value={fc(si.seller_asking_price)} />
              <StatChip label="Main Pain" value={si.pain_points[0] || '—'} />
            </div>
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

          {/* NEXT MOVE hero — the one thing Kevin should read */}
          <div className="rounded-xl border-2 border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] px-4 py-3.5 text-center">
            <div className="text-[9.5px] uppercase tracking-widest text-[color:var(--color-accent-text)] font-bold mb-1">{nextMove.move}</div>
            {nextMove.ask ? (
              <p className="text-[17px] font-bold text-[color:var(--color-accent-text)] leading-snug">"{nextMove.ask}"</p>
            ) : (
              <p className="text-[13px] text-[color:var(--color-accent-text)]">{nextMove.note}</p>
            )}
            {nextMove.note && nextMove.ask && <p className="text-[10.5px] text-[color:var(--color-accent-text)] opacity-80 mt-1">{nextMove.note}</p>}
          </div>

          {/* Low-confidence confirmation (Section 7) */}
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

          {/* Quick capture */}
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

          {/* Transcript */}
          <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] p-2.5">
            <div ref={scrollRef} className="max-h-32 overflow-y-auto space-y-1 mb-2">
              {session.segments.length === 0 ? (
                <p className="text-[10.5px] text-[color:var(--color-text-faint)] italic">Listening… type or paste what the seller says as the call happens.</p>
              ) : session.segments.map(seg => (
                <div key={seg.id} className="text-[11px]"><span className="font-semibold text-[color:var(--color-text-dim)]">{seg.speaker}: </span><span className="text-[color:var(--color-text-muted)]">{seg.text}</span></div>
              ))}
            </div>
            <div className="flex gap-1.5">
              <select value={speaker} onChange={e => setSpeaker(e.target.value)} className="text-[11px] px-1.5 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg)] text-[color:var(--color-text)]">
                <option value="SELLER">Seller</option>
                <option value="KEVIN">Kevin</option>
              </select>
              <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTranscriptSegment()}
                placeholder="What did they say?" className="flex-1 text-[12px] px-2 py-1.5 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg)] text-[color:var(--color-text)]" />
              <button onClick={addTranscriptSegment} className="text-[11px] font-semibold px-2.5 rounded bg-[color:var(--color-bg)] border border-[color:var(--color-line)] text-[color:var(--color-text-muted)]">Add</button>
              <button onClick={analyzeTranscript} disabled={analyzing || getUnprocessedSegments(session).length === 0}
                className="text-[11px] font-bold px-2.5 rounded bg-[color:var(--color-accent)] text-white disabled:opacity-40">
                {analyzing ? '…' : 'Analyze'}
              </button>
            </div>
            {analyzeError && <p className="text-[10.5px] text-[color:var(--color-danger-text)] mt-1">{analyzeError}</p>}
          </div>

          <button onClick={() => setEnded(true)} className="w-full text-[13px] font-bold py-2 rounded-lg bg-[color:var(--color-danger)] text-white">End Call</button>
        </div>
      ) : (
        <EndCallSummary lead={lead} si={si} userId={userId} onSaved={() => { onClose(); }} onDiscard={() => setEnded(false)} />
      )}
    </div>
  )
}

function EndCallSummary({ lead, si, userId, onSaved, onDiscard }) {
  const [outcome, setOutcome] = useState(si.open_to_sell === 'NO' ? 'not_interested' : 'spoke_follow_up')
  const [followUpDate, setFollowUpDate] = useState('')
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
