// src/lib/followUpTiming.js
// Capability #17 — business-timezone-consistent follow-up due-state.
//
// AUTHORITATIVE TIMEZONE: America/New_York (Jacksonville, FL — HAT's real
// operating timezone; the daily Redfin import script's "10am Israel time"
// schedule is an operator-convenience cron time, not the business
// timezone). Comparisons are DATE-ONLY (YYYY-MM-DD), never time-of-day —
// a follow_up_date of "2026-09-03" is due on Sep 3 in Jacksonville
// regardless of what UTC offset the browser or server happens to be in,
// which is exactly the class of bug Section 12 asks to guard against.
export const BUSINESS_TIMEZONE = 'America/New_York'

export function todayInBusinessTz() {
  // en-CA locale formats as YYYY-MM-DD directly — no manual string surgery.
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIMEZONE }).format(new Date())
}

/** @returns {'OVERDUE'|'TODAY'|'UPCOMING'|'UNSCHEDULED'} */
export function classifyFollowUpDate(followUpDate) {
  if (!followUpDate) return 'UNSCHEDULED' // no date set — never guessed as overdue
  const today = todayInBusinessTz()
  const d = String(followUpDate).slice(0, 10)
  if (d < today) return 'OVERDUE'
  if (d === today) return 'TODAY'
  return 'UPCOMING'
}

// ── Capability #22.2, Section 16 — resolve a spoken follow-up phrase
// ("Thursday afternoon", "next week", "tomorrow") into an actual date, in
// the same authoritative business timezone as every other follow-up
// calculation. Deterministic (day-of-week/relative-day lookup table), not
// an LLM guess — the LLM only extracts the seller's raw phrase
// (extract-seller-facts.mjs's follow_up_phrase), this resolves it.
// Returns null (never a guessed date) when the phrase doesn't match a
// recognized pattern — the caller must show "date uncertain, please set
// manually" rather than silently schedule something wrong.
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

export function resolveFollowUpPhrase(phrase, anchorDateStr = todayInBusinessTz()) {
  if (!phrase) return null
  const p = phrase.toLowerCase()
  // Pure date-string arithmetic, deliberately never touching a
  // timezone-sensitive Date object — the exact class of bug #17's own
  // followUpTiming.js was written to avoid (local machine TZ vs. business
  // TZ mismatch). UTC-noon anchors every Date instance used here purely
  // as a calendar calculator, never reformatted through a timezone.
  const [y, m, d] = anchorDateStr.split('-').map(Number)
  const anchorUtcNoon = new Date(Date.UTC(y, m - 1, d, 12))

  const addDays = (n) => {
    const dt = new Date(anchorUtcNoon)
    dt.setUTCDate(dt.getUTCDate() + n)
    const yy = dt.getUTCFullYear(), mm = String(dt.getUTCMonth() + 1).padStart(2, '0'), dd = String(dt.getUTCDate()).padStart(2, '0')
    return `${yy}-${mm}-${dd}`
  }

  if (/\btomorrow\b/.test(p)) return addDays(1)
  if (/\btoday\b/.test(p)) return addDays(0)

  const weekdayMatch = WEEKDAYS.findIndex(w => p.includes(w))
  if (weekdayMatch !== -1) {
    const anchorDow = anchorUtcNoon.getUTCDay()
    let delta = weekdayMatch - anchorDow
    if (delta <= 0) delta += 7 // always the NEXT occurrence, never today/past
    if (/\bnext\b/.test(p)) delta += 7 // "next Thursday" explicitly skips this week's
    return addDays(delta)
  }

  if (/\bnext week\b/.test(p)) return addDays(7)
  const inDaysMatch = p.match(/\bin (\d{1,2}) days?\b/)
  if (inDaysMatch) return addDays(parseInt(inDaysMatch[1], 10))

  return null // unrecognized phrase — do not guess
}

export function daysOverdue(followUpDate) {
  if (!followUpDate) return 0
  const today = new Date(todayInBusinessTz() + 'T00:00:00')
  const due = new Date(String(followUpDate).slice(0, 10) + 'T00:00:00')
  return Math.max(0, Math.round((today - due) / 86400000))
}
