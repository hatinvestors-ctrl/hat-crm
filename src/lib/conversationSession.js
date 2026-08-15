// src/lib/conversationSession.js
// Capability #22 — Live Acquisition Copilot: conversation session abstraction.
//
// HONEST SCOPE (mission Section 0/36/46): there is no microphone, speech-
// to-text, telephony, or streaming integration anywhere in this codebase
// (audited — no WebSpeech/MediaRecorder/getUserMedia/WebSocket/Twilio/
// Deepgram/AssemblyAI reference exists). Building that is a real,
// separate infrastructure project with its own consent/privacy work,
// explicitly out of scope for "prove the product experience first."
//
// This module is the abstraction that a future audio/call integration
// would feed — TODAY, segments are added by Kevin typing/pasting what the
// seller said (or, later, could be handed in by a browser mic + STT
// pipeline, a call-provider webhook, or an uploaded transcript, without
// this module or anything downstream changing). Nothing here pretends to
// be "live" audio — it's transcript-driven, batched, and cost-controlled
// by design: the intelligence layer processes NEW segments since the
// last extraction, never the whole call every time (Section 5/35).

let _idCounter = 0

export function createSession(lead) {
  return {
    leadId: lead?.id ?? null,
    startedAt: new Date().toISOString(),
    segments: [],       // { id, speaker: 'SELLER'|'KEVIN'|'UNKNOWN', text, at, confidence }
    lastExtractedIndex: 0, // segments[0..lastExtractedIndex) already sent to extraction
  }
}

export function addSegment(session, { speaker, text, confidence = null }) {
  if (!text || !text.trim()) return session
  const segment = { id: ++_idCounter, speaker: speaker || 'UNKNOWN', text: text.trim(), at: new Date().toISOString(), confidence }
  return { ...session, segments: [...session.segments, segment] }
}

// Only the segments not yet sent to the extraction function — this is
// what keeps cost bounded (Section 5/35): incremental context, not the
// whole call, on every extraction pass.
export function getUnprocessedSegments(session) {
  return session.segments.slice(session.lastExtractedIndex)
}

export function markExtracted(session) {
  return { ...session, lastExtractedIndex: session.segments.length }
}

export function getFullTranscriptText(session) {
  return session.segments.map(s => `${s.speaker}: ${s.text}`).join('\n')
}

export function getDurationSeconds(session) {
  return Math.max(0, Math.round((Date.now() - new Date(session.startedAt).getTime()) / 1000))
}

export function formatDuration(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ── High-value keyword pre-filter (Capability #22.1, Section 20) ────────
// Deterministic, zero-cost gate BEFORE any LLM call. A live microphone
// produces far more utterances than the old manual-paste flow ("okay",
// "yeah", "mhm" included) — this decides whether an utterance is even
// worth sending to extraction, without an AI call to make that decision.
const HIGH_VALUE_KEYWORDS = [
  'price', 'sell', 'offer', 'timeline', 'tenant', 'repair', 'tax', 'lien',
  'spouse', 'wife', 'husband', 'think about it', 'too low', 'not interested',
  'vacant', 'inherit', 'probate', 'divorce', 'foreclosure', 'mortgage',
  'owe', 'behind', 'need', 'want', 'close', 'move', 'relocat', 'downsiz',
]

export function hasHighValueSignal(text) {
  const t = (text || '').toLowerCase()
  return HIGH_VALUE_KEYWORDS.some(kw => t.includes(kw))
}

// ── Lightweight conversation stage (Section 12) — heuristic, informational
// only, never gates functionality. Based on what's been captured, not a
// hard state machine.
export function inferConversationStage(si) {
  if (si.open_to_sell == null) return 'OPENING'
  if (si.open_to_sell === 'NO') return 'CLOSING'
  if (si.pain_points.length === 0) return 'DISCOVERY'
  if (!si.timeline) return 'MOTIVATION'
  if (si.seller_asking_price == null) return 'PRICE DISCOVERY'
  if (si.objections?.length) return 'OBJECTION'
  if (!si.decision_makers) return 'NEGOTIATION'
  return 'NEXT STEP'
}
