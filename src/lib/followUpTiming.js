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

export function daysOverdue(followUpDate) {
  if (!followUpDate) return 0
  const today = new Date(todayInBusinessTz() + 'T00:00:00')
  const due = new Date(String(followUpDate).slice(0, 10) + 'T00:00:00')
  return Math.max(0, Math.round((today - due) / 86400000))
}
