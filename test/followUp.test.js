// test/followUp.test.js
// Release Readiness — Follow-Up / Action Center Certification (Section 7).
// Uses fixed, deterministic date math (no reliance on wall-clock "today"
// except to anchor offsets, exactly like followUpTiming.js's own design).
import { describe, it, expect } from 'vitest'
import { classifyFollowUpDate, daysOverdue, todayInBusinessTz, resolveFollowUpPhrase, BUSINESS_TIMEZONE } from '../src/lib/followUpTiming.js'
import { getGoldenLead, resolveFollowUpDates } from './fixtures/goldenLeads.js'

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12))
  dt.setUTCDate(dt.getUTCDate() + n)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

describe('classifyFollowUpDate (America/New_York, date-only comparison)', () => {
  it('uses America/New_York as the authoritative timezone', () => {
    expect(BUSINESS_TIMEZONE).toBe('America/New_York')
  })

  it('FOLLOW UP TODAY: due exactly today', () => {
    const today = todayInBusinessTz()
    expect(classifyFollowUpDate(today)).toBe('TODAY')
  })

  it('OVERDUE: yesterday, 7 days ago, and 30 days ago all classify OVERDUE', () => {
    const today = todayInBusinessTz()
    expect(classifyFollowUpDate(addDays(today, -1))).toBe('OVERDUE')
    expect(classifyFollowUpDate(addDays(today, -7))).toBe('OVERDUE')
    expect(classifyFollowUpDate(addDays(today, -30))).toBe('OVERDUE')
  })

  it('OVERDUE day-count is exact for 1, 7, and 30 days', () => {
    const today = todayInBusinessTz()
    expect(daysOverdue(addDays(today, -1))).toBe(1)
    expect(daysOverdue(addDays(today, -7))).toBe(7)
    expect(daysOverdue(addDays(today, -30))).toBe(30)
  })

  it('UPCOMING: tomorrow, +7 days, +30 days all classify UPCOMING', () => {
    const today = todayInBusinessTz()
    expect(classifyFollowUpDate(addDays(today, 1))).toBe('UPCOMING')
    expect(classifyFollowUpDate(addDays(today, 7))).toBe('UPCOMING')
    expect(classifyFollowUpDate(addDays(today, 30))).toBe('UPCOMING')
  })

  it('UNSCHEDULED: no date set never guesses OVERDUE', () => {
    expect(classifyFollowUpDate(null)).toBe('UNSCHEDULED')
    expect(classifyFollowUpDate(undefined)).toBe('UNSCHEDULED')
    expect(classifyFollowUpDate('')).toBe('UNSCHEDULED')
  })

  it('daysOverdue on a non-overdue date returns 0, never negative', () => {
    const today = todayInBusinessTz()
    expect(daysOverdue(addDays(today, 5))).toBe(0)
    expect(daysOverdue(today)).toBe(0)
  })
})

describe('Golden Lead follow-up fixtures resolve to the expected bucket', () => {
  it('G20 Follow-Up Today classifies TODAY', () => {
    resolveFollowUpDates(todayInBusinessTz())
    const lead = getGoldenLead('G20_FOLLOW_UP_TODAY')
    expect(classifyFollowUpDate(lead.follow_up_date)).toBe('TODAY')
  })

  it('G21 Overdue (7 days ago) classifies OVERDUE with exact day count 7', () => {
    resolveFollowUpDates(todayInBusinessTz())
    const lead = getGoldenLead('G21_OVERDUE')
    expect(classifyFollowUpDate(lead.follow_up_date)).toBe('OVERDUE')
    expect(daysOverdue(lead.follow_up_date)).toBe(7)
  })

  it('G22 Upcoming (+7 days) classifies UPCOMING, never appears as OVERDUE/TODAY', () => {
    resolveFollowUpDates(todayInBusinessTz())
    const lead = getGoldenLead('G22_UPCOMING')
    expect(classifyFollowUpDate(lead.follow_up_date)).toBe('UPCOMING')
  })
})

describe('resolveFollowUpPhrase (spoken-phrase -> date, deterministic, never guesses)', () => {
  const anchor = '2026-08-17' // a Monday-anchored fixed date for deterministic weekday math

  it('"tomorrow" resolves to anchor+1', () => {
    expect(resolveFollowUpPhrase('tomorrow', anchor)).toBe(addDays(anchor, 1))
  })

  it('unrecognized phrases return null rather than guessing a date', () => {
    expect(resolveFollowUpPhrase('sometime maybe next quarter', anchor)).toBeNull()
    expect(resolveFollowUpPhrase('', anchor)).toBeNull()
    expect(resolveFollowUpPhrase(null, anchor)).toBeNull()
  })

  it('"in N days" resolves exactly', () => {
    expect(resolveFollowUpPhrase('in 5 days', anchor)).toBe(addDays(anchor, 5))
  })
})
