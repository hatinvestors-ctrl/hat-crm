// src/lib/callCoaching.js
// Capability #24 — HAT Acquisition Coach: post-call Call Review support.
// Deterministic helpers only. The qualitative score/coaching text itself
// comes from netlify/functions/generate-call-review.mjs (one LLM call,
// scored against docs/acquisition-coach/scoring-rubric.md) — everything
// here is what keeps that output honest: coverage (reused from
// sellerStrategy.js), and a hard verification gate that DROPS any
// "coaching moment" whose quoted lines don't actually appear in the real
// transcript (Part 24: "If exact transcript evidence is unavailable, do
// not create a fake coaching moment" — enforced here, not just prompted).

// Normalizes for substring comparison — case/whitespace/punctuation
// insensitive so STT artifacts (missing commas, etc.) don't cause a false
// rejection of a genuinely real quote.
function normalize(text) {
  return (text || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim()
}

// Returns true only if `quote` is a genuine substring of the real
// transcript text — never invented.
export function quoteAppearsInTranscript(quote, transcriptText) {
  if (!quote || !transcriptText) return false
  const q = normalize(quote)
  if (q.length < 3) return false
  return normalize(transcriptText).includes(q)
}

// Filters an AI-returned coaching-moments array down to only the ones
// whose seller/rep quotes are independently verifiable against the real
// transcript. This is the deterministic backstop for Part 24's "never
// invent a quote" rule — even if the model hallucinates a quote, it never
// reaches the UI.
export function verifyCoachingMoments(moments, transcriptText) {
  if (!Array.isArray(moments)) return []
  const verified = moments.filter(m => {
    const sellerOk = !m.sellerQuote || quoteAppearsInTranscript(m.sellerQuote, transcriptText)
    const repOk = !m.repQuote || quoteAppearsInTranscript(m.repQuote, transcriptText)
    // Require AT LEAST one real quote anchoring the moment — a coaching
    // moment with zero verifiable transcript evidence is dropped entirely.
    const hasAnyQuote = !!m.sellerQuote || !!m.repQuote
    return hasAnyQuote && sellerOk && repOk
  })
  // Capability #25.3A, Part 4 — tag each surviving moment with a
  // deterministic transcript-quality signal on its own evidence, so the UI
  // can visibly flag "low-confidence transcript segment" rather than
  // present a fragile fragment with the same confidence as a clean quote.
  const tagged = verified.map(m => ({
    ...m,
    evidenceQuality: worseQuality(assessTranscriptQuality(m.sellerQuote), assessTranscriptQuality(m.repQuote)),
  }))
  // Part 3 — distinct coaching insights only; near-identical moments
  // (same underlying quote pair) collapse to one, keeping the more
  // complete entry. Deterministic, no second AI call.
  return dedupeCoachingMoments(tagged).slice(0, 3) // Part 24 — up to 3, never a dump of criticisms
}

// Same verification for "strong move" recognition (Part 25) — reuses the
// identical rule, no second philosophy.
export function verifyStrongMoves(moves, transcriptText) {
  const verified = verifyCoachingMoments(moves, transcriptText)
  // Capability #25.3A, Part 7 — validate the AI's own nuance classification
  // (an untrusted claim, same posture as every other AI field here) and
  // default to the safest, most literal reading when absent/invalid.
  return verified.map(m => ({ ...m, nuance: VALID_NUANCE.has(m.nuance) ? m.nuance : 'STRONG' }))
}

// ── Deduplication (Part 2/3) — deterministic, no AI. ────────────────────
function normalizeQuote(q) { return q ? normalize(q) : null }

// Two moments are the "same insight" if they share a normalized seller
// quote OR a normalized rep quote — the real defect observed (same wife/
// decision-maker moment surfaced twice from slightly different framing
// text, but anchored to the identical underlying quote). Keeps whichever
// entry has more complete fields (both quotes > one quote; longer
// explanation as a tiebreaker) rather than arbitrarily the first.
export function dedupeCoachingMoments(moments) {
  if (!Array.isArray(moments)) return []
  const kept = []
  for (const m of moments) {
    const sq = normalizeQuote(m.sellerQuote)
    const rq = normalizeQuote(m.repQuote)
    const dupIndex = kept.findIndex(k => (sq && normalizeQuote(k.sellerQuote) === sq) || (rq && normalizeQuote(k.repQuote) === rq))
    if (dupIndex === -1) {
      kept.push(m)
    } else {
      const existing = kept[dupIndex]
      const completeness = (x) => (x.sellerQuote ? 1 : 0) + (x.repQuote ? 1 : 0) + ((x.coach || x.why || '').length > (existing.coach || existing.why || '').length ? 0.5 : 0)
      if (completeness(m) > completeness(existing)) kept[dupIndex] = m
    }
  }
  return kept
}

// Same-value dedup for a flat list of category codes (Part 2) — e.g.
// si.objections. Order-preserving, keeps first occurrence.
export function dedupeObjections(objections) {
  if (!Array.isArray(objections)) return []
  return [...new Set(objections)]
}

// ── Transcript quality (Part 4) — NO real per-segment STT confidence
// exists anywhere in this codebase today (audited: useSpeechRecognition.js
// never passes a `confidence` value into addSegment(), even though
// conversationSession.js's segment shape has always had the field). Per
// explicit instruction: do NOT fabricate a numeric confidence. This is a
// conservative, deliberately narrow heuristic over objective, defensible
// signals only — it flags UNCERTAIN more readily than it should ever
// claim RELIABLE with false confidence. A future capability that wires
// the Web Speech API's own `result[0].confidence` through addSegment()
// should replace this heuristic outright, not layer on top of it.
// (?<![$\d.,]) — excludes the "000" in "$175,000" from being independently
// matched as a bare number: without the comma in this exclusion set, the
// thousands group after the comma looked like its own unit-less number.
const BARE_NUMBER_NO_UNIT = /(?<![$\d.,])\b\d{1,3}\b(?!\s*(%|percent|days?|months?|years?|k\b|thousand|,\d{3}))/i
const MIN_WORDS_FOR_CONTEXT = 4

export function assessTranscriptQuality(text) {
  if (!text) return 'RELIABLE' // nothing to assess, never a false alarm
  const words = text.trim().split(/\s+/)
  // Signal A: a short fragment carrying a bare, unit-less number is the
  // exact shape of the real corruption observed ("my wife 14", "one 40")
  // — a real number would normally carry a unit/currency/date context.
  if (words.length <= 8 && BARE_NUMBER_NO_UNIT.test(text)) return 'UNCERTAIN'
  // Signal B: too short to carry real conversational context at all.
  if (words.length < MIN_WORDS_FOR_CONTEXT) return 'UNCERTAIN'
  return 'RELIABLE'
}

function worseQuality(a, b) {
  if (a === 'UNCERTAIN' || b === 'UNCERTAIN') return 'UNCERTAIN'
  return 'RELIABLE'
}

// ── Contradiction protection (Part 7) — deterministic, no AI call. A
// Strong Move is never allowed to silently praise the exact same quote a
// Missed Opportunity/coaching moment elsewhere criticizes — if that
// happens, the nuance is forced to MIXED so the UI can present it as
// "good execution, wrong timing" instead of two flatly contradictory
// verdicts on the same behavior. ─────────────────────────────────────────
const VALID_NUANCE = new Set(['GOOD', 'GOOD_BUT_EARLY', 'GOOD_BUT_LATE', 'MIXED', 'STRONG'])

export function resolveCoachingConsistency({ strongMoves = [], coachingMoments = [], missedOpportunity = null }) {
  const criticizedQuotes = new Set([
    ...coachingMoments.flatMap(m => [normalizeQuote(m.repQuote), normalizeQuote(m.sellerQuote)]),
    normalizeQuote(missedOpportunity?.repQuote), normalizeQuote(missedOpportunity?.sellerQuote),
  ].filter(Boolean))

  return strongMoves.map(move => {
    const repQ = normalizeQuote(move.repQuote)
    const sameQuoteCriticizedElsewhere = repQ && criticizedQuotes.has(repQ)
    if (sameQuoteCriticizedElsewhere && move.nuance === 'STRONG') {
      return { ...move, nuance: 'MIXED' }
    }
    return move
  })
}

// Scored dimensions (Part 19/20) — the exact 9 from the mission brief.
// Rubric text lives in docs/acquisition-coach/scoring-rubric.md; this list
// is only the stable set of keys/labels the UI and the AI prompt both key
// off of, so they can never drift apart.
export const COACHING_DIMENSIONS = [
  { key: 'OPENING_RAPPORT', label: 'Opening & Rapport' },
  { key: 'MOTIVATION_DISCOVERY', label: 'Motivation Discovery' },
  { key: 'PAIN_DEPTH', label: 'Pain Depth' },
  { key: 'PROPERTY_DISCOVERY', label: 'Property Discovery' },
  { key: 'TIMELINE', label: 'Timeline' },
  { key: 'PRICE_DISCOVERY', label: 'Price Discovery' },
  { key: 'DECISION_MAKERS', label: 'Decision Makers' },
  { key: 'NEGOTIATION', label: 'Negotiation' },
  { key: 'COMMITMENT', label: 'Commitment / Follow-Up' },
]

// Deterministic validation of the AI's scorecard response shape — this is
// the "safely prevent contradictory output" guardrail (same pattern as the
// Comps Intelligence AI-authority fix): every dimension must be a real key
// from COACHING_DIMENSIONS, every score 0-10, every score must have a
// non-empty `why` (Part 21 — "never a mysterious 6/10 with no
// explanation"). Anything that fails validation is dropped, not guessed.
export function validateScorecard(rawScores) {
  if (!Array.isArray(rawScores)) return []
  const validKeys = new Set(COACHING_DIMENSIONS.map(d => d.key))
  return rawScores
    .filter(s =>
      s && validKeys.has(s.key) &&
      Number.isFinite(s.score) && s.score >= 0 && s.score <= 10 &&
      typeof s.why === 'string' && s.why.trim().length > 0
    )
    // Capability #25.3A, Part 5/6 — optional, additive fields. A dimension
    // that was CAPTURED (per the separate, deterministic coverage engine)
    // but still scores low is not a contradiction — `captured`/`missing`
    // let the model say what was captured vs. what depth/execution was
    // missing, WITHOUT coverage ever influencing the score itself (they
    // remain two independent computations, per the mission's explicit
    // rule). Old reviews without these fields still render fine — both
    // are optional and the UI falls back to `why` alone.
    .map(s => ({
      key: s.key, score: s.score, why: s.why,
      captured: typeof s.captured === 'string' && s.captured.trim() ? s.captured.trim().slice(0, 200) : null,
      missing: typeof s.missing === 'string' && s.missing.trim() ? s.missing.trim().slice(0, 200) : null,
    }))
}

export function computeOverallScore(validatedScores) {
  if (!validatedScores.length) return null
  const totalPossible = validatedScores.length * 10
  const totalActual = validatedScores.reduce((sum, s) => sum + s.score, 0)
  return Math.round((totalActual / totalPossible) * 100)
}
