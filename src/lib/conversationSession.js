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

// Capability #25.1, Part 8 — the in-memory session now carries a durable
// identity from the moment the call starts: a client-generated callId
// (used as call_sessions.id — see src/lib/callSessions.js), the
// workspaceId, and repId (the AUTHENTICATED USER who started the call,
// never derived from lead.assigned_to). Everything else about the session
// object is unchanged.
export function createSession(lead, { workspaceId = null, repId = null } = {}) {
  return {
    callId: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `local-${Date.now()}-${++_idCounter}`,
    workspaceId,
    repId,
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

// ═══════════════════════════════════════════════════════════════════════
// Capability #22.2 — Layer A: FAST deterministic signal detection.
// Zero LLM cost, runs synchronously on every finalized utterance, near-
// instant. Its ONLY job is to decide "does this utterance deserve the
// SHORT debounce (fast path) or the normal batched one?" — it never
// decides the actual extracted value (that stays entirely with the LLM,
// which has full sentence context). This is what makes "seller says a
// price -> guidance updates in a few seconds" possible without calling AI
// on every single word.
//
// Real-call finding (Section 2): STT garbles numbers ("1:45" for $145K,
// "the wolf" for "the roof"). This layer is deliberately tolerant — a
// loose numeric-ish pattern or a fuzzy keyword is enough to trigger the
// FAST path; getting the exact VALUE right is Layer B's (the LLM's) job,
// which sees full sentence context a regex never will.
// ═══════════════════════════════════════════════════════════════════════

// Loose price-shaped patterns — $145,000 / 145K / 1:45 (garbled STT) / "one
// forty five thousand". Deliberately over-inclusive; a false positive here
// only costs one extra (cheap, fast) LLM call, never a wrong CRM fact.
const PRICE_PATTERN = /\$\s?\d[\d,]*|\b\d{1,3}[:.]\d{2,3}\b|\b\d{2,3}\s?(?:k\b|thousand)/i

const FAST_SIGNAL_PATTERNS = {
  PRICE: PRICE_PATTERN,
  DECISION_MAKER: /\b(wife|husband|spouse|partner|on title|my (mom|dad|brother|sister|kids?))\b/i,
  OBJECTION_TOO_LOW: /\btoo low\b|\bnot enough\b|\bcan'?t do that\b/i,
  OBJECTION_THINK: /\bthink about it\b|\bneed (some )?time\b|\bnot ready\b/i,
  OBJECTION_NOT_INTERESTED: /\bnot interested\b|\bno thank(s| you)\b|\bstop calling\b/i,
  FOLLOW_UP: /\bcall (me |back )?(on |this )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week)\b|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*\b(morning|afternoon|evening)\b/i,
  TENANT: /\btenants?\b|\brenters?\b|\beviction\b/i,
  REPAIRS: /\brepairs?\b|\broof\b|\bhvac\b|\bplumbing\b|\bfoundation\b|\bfix(ing)? up\b/i,
  VACANT: /\bvacant\b|\bempty\b|\bnobody living\b/i,
  TIMELINE: /\b(asap|as soon as possible)\b|\b\d{1,3}\s?days?\b|\b\d{1,2}\s?(weeks?|months?)\b/i,
}

/** @returns {{ signals: string[], isHighValue: boolean, isFast: boolean }} */
export function detectFastSignals(text) {
  const signals = Object.entries(FAST_SIGNAL_PATTERNS)
    .filter(([, re]) => re.test(text || ''))
    .map(([key]) => key)
  // "Fast" (accelerated debounce) events: the ones the mission explicitly
  // calls out as needing a quick reaction — price, decision maker,
  // objections, follow-up. Pain/timeline signals still count as
  // high-value (worth analyzing) but don't need the accelerated path.
  const FAST_KEYS = new Set(['PRICE', 'DECISION_MAKER', 'OBJECTION_TOO_LOW', 'OBJECTION_THINK', 'OBJECTION_NOT_INTERESTED', 'FOLLOW_UP'])
  return {
    signals,
    isHighValue: signals.length > 0 || hasHighValueSignal(text),
    isFast: signals.some(s => FAST_KEYS.has(s)),
  }
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
