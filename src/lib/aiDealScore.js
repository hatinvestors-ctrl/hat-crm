// src/lib/aiDealScore.js
// UX V3, Part 3/4/5/19 — pure, read-only parsers over the SAME `ai_notes`
// text `generate-core-analysis.mjs` already writes (netlify/functions/
// generate-core-analysis.mjs, "DEAL SCORE"/"PROS"/"CONS" sections). No new
// AI call, no new scoring, no new criteria — every value here is parsed
// verbatim from the AI's own existing output. This module exists only so
// AI & Comps can display the genuinely-AI-generated Deal Score/insights
// without re-deriving them (mirrors the established pattern in
// arvConfidence.js's getCompEvidenceSummary, V2.8).
//
// The exact live rubric (verified against generate-core-analysis.mjs at
// audit time): Total/100 = Deal Return/30 + Price Gap/20 + Seller
// Signals/15 + Market & Exit/15 + Cash Flow/10 + Data Quality/10. Band
// semantics for the TOTAL score already exist in that file's own prompt
// (MAKE OFFER >=65 / NEGOTIATE 45-64 / LONG SHOT 30-44 / WATCH 15-29 /
// DEAD LEAD <15) but this module does not invent or display new band
// language beyond what's asked for — see ComplsIntelligenceCard.jsx for
// the neutral caption used instead.
const CATEGORY_DEFS = [
  { key: 'dealReturn', label: 'Deal Return', pattern: /Deal Return:\s*(\d+)\s*\/\s*(\d+)\s*-?\s*([^\n]*)/i },
  { key: 'priceGap', label: 'Price Gap', pattern: /Price Gap:\s*(\d+)\s*\/\s*(\d+)\s*-?\s*([^\n]*)/i },
  { key: 'sellerSignals', label: 'Seller Signals', pattern: /Seller Signals:\s*(\d+)\s*\/\s*(\d+)\s*-?\s*([^\n]*)/i },
  { key: 'marketExit', label: 'Market & Exit', pattern: /Market (?:&|and) Exit:\s*(\d+)\s*\/\s*(\d+)\s*-?\s*([^\n]*)/i },
  { key: 'cashFlow', label: 'Cash Flow', pattern: /Cash Flow:\s*(\d+)\s*\/\s*(\d+)\s*-?\s*([^\n]*)/i },
  { key: 'dataQuality', label: 'Data Quality', pattern: /Data Quality:\s*(\d+)\s*\/\s*(\d+)\s*-?\s*([^\n]*)/i },
]

// Trims a category's trailing explanation the same conservative way
// leadPriority.js's shortenReason() does for PROS/CONS bullets — never
// rewrites content, only shortens an over-long AI sentence at a word
// boundary.
function shorten(text, max = 130) {
  if (!text) return ''
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  const cut = trimmed.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim() + '…'
}

/**
 * Parses the DEAL SCORE section of ai_notes. Returns null when the
 * section genuinely isn't present (e.g. no analysis has run yet) — never
 * fabricates a score.
 */
export function parseAiDealScore(notesText) {
  if (!notesText) return null
  const totalMatch = notesText.match(/Total:\s*(\d+)\s*\/\s*100/i)
  if (!totalMatch) return null
  const total = parseInt(totalMatch[1], 10)
  const categories = CATEGORY_DEFS
    .map(def => {
      const m = notesText.match(def.pattern)
      if (!m) return null
      return { key: def.key, label: def.label, score: parseInt(m[1], 10), max: parseInt(m[2], 10), note: shorten(m[3]) }
    })
    .filter(Boolean)
  const verdictMatch = notesText.match(/Verdict:\s*([A-Z][A-Z\s]*?)\s*(?:\n|$)/i)
  const verdict = verdictMatch ? verdictMatch[1].trim().toUpperCase() : null
  return { total, categories, verdict }
}

/**
 * Extracts the AI's own PROS/CONS bullets as a compact "AI Insights" list
 * (Part 19) — the exact same section headers/regex shape leadPriority.js's
 * derivePriority() already parses for its own purposes, applied here only
 * to surface the raw observations, not to re-derive priority. Caps at 3
 * PROS + 2 CONS (5 total) per the mission's "3-5 concise bullets" request.
 */
export function getAiInsights(notesText) {
  if (!notesText) return []
  const extract = (header, limit) => {
    const re = new RegExp(`\\b${header}\\b[^\\n]*\\n=*\\n?([\\s\\S]*?)(?=\\n={5,}|$)`, 'i')
    const m = notesText.match(re)
    if (!m) return []
    return m[1]
      .split('\n')
      .map(l => l.replace(/^[\s\d.\-•*]+/, '').trim())
      .filter(l => Boolean(l) && !/^=+$/.test(l))
      .slice(0, limit)
      .map(l => shorten(l, 140))
  }
  const pros = extract('PROS', 3).map(text => ({ text, tone: 'positive' }))
  const cons = extract('CONS', 2).map(text => ({ text, tone: 'risk' }))
  return [...pros, ...cons].slice(0, 5)
}
