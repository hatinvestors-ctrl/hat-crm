// src/lib/rentalRange.js
// AI & Comps Recovery Pass — pure, read-only parser over the SAME RENTAL
// COMPS section generate-comps.mjs already writes into ai_notes
// (Conservative Rent / Realistic Rent / Optimistic Rent / Rent Verdict /
// 1% Rule / RENTAL: comp lines — see that file's SYSTEM_PROMPT template).
// No new AI call, no new rent methodology, no new values — this module
// only decides how to DISPLAY what already exists cleanly, tolerant of
// markdown emphasis markers (**bold**, leading bullets) the model
// sometimes wraps a line in — the same robustness NotesRenderer.jsx's
// DealScoreSection already uses for its own field extraction.
const MD_PREFIX = '[\\s*_#>-]*'

function stripMd(s) {
  if (!s) return s
  return s.replace(/\*+\s*$/, '').replace(/^\*+\s*/, '').trim()
}

function getLine(lines, prefix) {
  const re = new RegExp(`^${MD_PREFIX}${prefix}:`, 'i')
  const line = lines.find(l => re.test(l.trim()))
  if (!line) return null
  const stripped = line.trim().replace(new RegExp(`^${MD_PREFIX}${prefix}:\\s*`, 'i'), '')
  return stripMd(stripped) || null
}

/**
 * Parses the RENTAL COMPS section of ai_notes. Returns null when the
 * section genuinely isn't present — never fabricates a rent value.
 */
export function parseRentalRange(notesText) {
  if (!notesText) return null
  const lines = notesText.split('\n').filter(Boolean)
  const conservative = getLine(lines, 'Conservative Rent')
  const realistic = getLine(lines, 'Realistic Rent')
  const optimistic = getLine(lines, 'Optimistic Rent')
  if (!conservative && !realistic && !optimistic) return null
  const verdict = getLine(lines, 'Rent Verdict')
  const onePercentRule = getLine(lines, '1% Rule')
  const rentalComps = lines
    .filter(l => new RegExp(`^${MD_PREFIX}RENTAL:`, 'i').test(l.trim()))
    .map(l => stripMd(l.trim().replace(new RegExp(`^${MD_PREFIX}RENTAL:\\s*`, 'i'), '')))
    .slice(0, 3)
  return { conservative, realistic, optimistic, verdict, onePercentRule, rentalComps }
}
