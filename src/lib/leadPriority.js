// src/lib/leadPriority.js
// Smart Lead Prioritization (Capability #1) + Executive Decision Layer
// (Capability #2) parsing logic — extracted from DealAnalysisCard.jsx so
// Capability #5 (Action Center) can reuse the exact same computation
// instead of recalculating anything. No behavior change from extraction —
// same regexes, same thresholds, same output shape.
//
// Reuses the DEAL SCORE / CRM WORKFLOW / PROS / CONS sections the AI
// already writes into ai_notes (see netlify/functions/generate-core-analysis.mjs)
// — no new AI call, no new calculation anywhere in this file.

export const VERDICT_TO_PRIORITY = {
  'MAKE OFFER': 'HOT',
  'NEGOTIATE': 'TODAY',
  'LONG SHOT': 'WATCH',
  'WATCH': 'WATCH',
  'DEAD LEAD': 'IGNORE',
}
export const VERDICT_TO_ACTION = {
  'MAKE OFFER': 'SEND OFFER',
  'NEGOTIATE': 'CALL TODAY',
  'LONG SHOT': 'REQUEST INFORMATION',
  'WATCH': 'WAIT',
  'DEAD LEAD': 'IGNORE',
}
// v1.0.1 polish — Kevin-facing display text only. The underlying priority
// value (HOT/TODAY/WATCH/IGNORE) driving VERDICT_TO_PRIORITY above is
// unchanged; this is purely a label swap for readability.
export const PRIORITY_DISPLAY = {
  HOT: 'ACT NOW',
  TODAY: 'REVIEW TODAY',
  WATCH: 'WATCH',
  IGNORE: 'PASS',
}
export const PRIORITY_THEME = {
  HOT:    { bg: 'var(--color-danger-soft)',  border: 'var(--color-danger)',  text: 'var(--color-danger-text)' },
  TODAY:  { bg: 'var(--color-warn-soft)',    border: 'var(--color-warn)',    text: 'var(--color-warn-text)' },
  WATCH:  { bg: 'var(--color-bg-elev-2)',    border: 'var(--color-line)',    text: 'var(--color-text-muted)' },
  IGNORE: { bg: 'var(--color-bg-elev-2)',    border: 'var(--color-line)',    text: 'var(--color-text-dim)' },
}

// v1.0.1 polish — reduces a PROS/CONS bullet line to ~one short scannable
// line without inventing content. Strips the AI's own parenthetical/dash-
// clause padding and hard-caps length; never rewrites or adds facts. If
// nothing safe to trim is found, the original line is simply truncated
// with an ellipsis so meaning isn't altered.
export function shortenReason(text) {
  if (!text) return ''
  let short = text
    .split(/\s+[—–-]\s+/)[0]
    .replace(/\([^)]*\)/g, '')
    .trim()
  // Long enough that most AI-written bullets fit whole (fixes bullets being
  // cut off mid-sentence, e.g. "Prior sale at $269,900 in 2023 suggests
  // th…"). Only trims genuinely long outliers, and does so at the last
  // word boundary before the cap so it never severs a word mid-way.
  const MAX = 110
  if (short.length > MAX) {
    const cut = short.slice(0, MAX)
    const lastSpace = cut.lastIndexOf(' ')
    short = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim() + '…'
  }
  return short
}

export function derivePriority(notesText) {
  if (!notesText) return null
  const scoreMatch = notesText.match(/Total:\s*(\d+)\s*\/\s*100/i)
  const verdictMatch = notesText.match(/Verdict:\s*([A-Z][A-Z\s]*?)\s*(?:\n|$)/i)
  if (!scoreMatch && !verdictMatch) return null
  const verdict = (verdictMatch?.[1] || '').trim().toUpperCase()
  const confidence = scoreMatch ? parseInt(scoreMatch[1], 10) : null
  const priority = VERDICT_TO_PRIORITY[verdict] || 'WATCH'
  const nextAction = VERDICT_TO_ACTION[verdict] || 'WAIT'
  // PROS body sits between the section header and the next '=====' divider.
  // The header itself is immediately followed by a divider line before the
  // bullets start, so strip any leading '=' divider line the capture picks up.
  // \b word-boundaries — bare "PROS"/"CONS" (no boundary) also matches
  // mid-word inside prose like "conservative", "considering", "prospect",
  // grabbing the wrong section entirely. See Capability #2 verification notes.
  const prosMatch = notesText.match(/\bPROS\b[^\n]*\n=*\n?([\s\S]*?)(?=\n={5,}|$)/i)
  const rawReasons = prosMatch
    ? prosMatch[1]
        .split('\n')
        .map(l => l.replace(/^[\s\d.\-•*]+/, '').trim())
        .filter(l => Boolean(l) && !/^=+$/.test(l))
        .slice(0, 3)
    : []
  const reasons = rawReasons.map(shortenReason)
  // v1.0.1: Data Quality (already computed/written by the AI, DEAL SCORE
  // section) and Max Walk-Away (already computed, RECOMMENDED ACTION
  // section) — shown only when reliably parseable, never invented.
  const dataQualityMatch = notesText.match(/Data Quality:\s*(\d+)\s*\/\s*10/i)
  const dataQuality = dataQualityMatch ? parseInt(dataQualityMatch[1], 10) : null
  const walkAwayMatch = notesText.match(/Max Walk-Away:\s*\$([0-9,]+)/i)
  const walkAway = walkAwayMatch ? parseInt(walkAwayMatch[1].replace(/,/g, ''), 10) : null
  // Capability #2 — Executive Decision "Biggest Risk": reuses the existing
  // CONS section the AI already writes, same divider-stripping approach as
  // PROS above. Only the single first (highest-priority) risk is surfaced.
  const consMatch = notesText.match(/\bCONS\b[^\n]*\n=*\n?([\s\S]*?)(?=\n={5,}|$)/i)
  const firstCon = consMatch
    ? consMatch[1]
        .split('\n')
        .map(l => l.replace(/^[\s\d.\-•*]+/, '').trim())
        .find(l => Boolean(l) && !/^=+$/.test(l))
    : null
  const biggestRisk = firstCon ? shortenReason(firstCon) : null
  return { priority, confidence, verdict, nextAction, reasons, rawReasons, dataQuality, walkAway, biggestRisk }
}
