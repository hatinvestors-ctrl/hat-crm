// src/lib/aiValuation.js
// AI Valuation + Guided Lead Underwriting Flow V1 — pure, read-only
// parsing and lightweight sanity validation over the SAME ai_notes text
// generate-comps.mjs already writes (its new, conditional "VALUATION"
// section — see that file's SYSTEM_PROMPT). No AI call here, no new
// financial calculation, no canonical formula. This module only decides
// whether a parsed AI valuation is SAFE TO WRITE, never what it should be.
//
// Validation deliberately stays "lightweight" per the mission's explicit
// instruction (Part 22): numeric, positive, finite, and
// conservative <= recommended <= upside. No invented business thresholds,
// no comparison against asking price, no hidden caps.

const num = (v) => {
  if (v == null) return null
  const n = Number(String(v).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Parses the VALUATION section of ai_notes (only present when
 * generate-comps.mjs ran with no canonical ARV yet). Returns null when
 * the section genuinely isn't present, or when the three values don't
 * pass the lightweight sanity check — never fabricates a value.
 */
export function parseAiValuation(notesText) {
  if (!notesText) return null
  const conservative = num(notesText.match(/Conservative ARV:\s*\$?([0-9,]+)/i)?.[1])
  const recommended = num(notesText.match(/Recommended ARV:\s*\$?([0-9,]+)/i)?.[1])
  const upside = num(notesText.match(/Upside ARV:\s*\$?([0-9,]+)/i)?.[1])
  if (conservative == null || recommended == null || upside == null) return null
  // Part 22 — the ONE sanity check: ordering must make sense. No other
  // business threshold is invented here.
  if (!(conservative <= recommended && recommended <= upside)) return null
  const confidence = notesText.match(/Confidence:\s*(Low|Medium|High)/i)?.[1] || null
  const rationale = notesText.match(/Rationale:\s*([^\n]+)/i)?.[1]?.trim() || null
  return { conservative, recommended, upside, confidence, rationale }
}
