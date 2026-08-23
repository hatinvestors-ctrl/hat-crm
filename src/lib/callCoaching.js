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
  return moments.filter(m => {
    const sellerOk = !m.sellerQuote || quoteAppearsInTranscript(m.sellerQuote, transcriptText)
    const repOk = !m.repQuote || quoteAppearsInTranscript(m.repQuote, transcriptText)
    // Require AT LEAST one real quote anchoring the moment — a coaching
    // moment with zero verifiable transcript evidence is dropped entirely.
    const hasAnyQuote = !!m.sellerQuote || !!m.repQuote
    return hasAnyQuote && sellerOk && repOk
  }).slice(0, 3) // Part 24 — up to 3, never a dump of criticisms
}

// Same verification for "strong move" recognition (Part 25) — reuses the
// identical rule, no second philosophy.
export function verifyStrongMoves(moves, transcriptText) {
  return verifyCoachingMoments(moves, transcriptText)
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
  return rawScores.filter(s =>
    s && validKeys.has(s.key) &&
    Number.isFinite(s.score) && s.score >= 0 && s.score <= 10 &&
    typeof s.why === 'string' && s.why.trim().length > 0
  )
}

export function computeOverallScore(validatedScores) {
  if (!validatedScores.length) return null
  const totalPossible = validatedScores.length * 10
  const totalActual = validatedScores.reduce((sum, s) => sum + s.score, 0)
  return Math.round((totalActual / totalPossible) * 100)
}
