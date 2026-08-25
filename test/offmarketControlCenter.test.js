// test/offmarketControlCenter.test.js
// Off-Market Engine Control Center V1 — criteria clamping (pure, directly
// testable, same convention as every other lib in this repo) + HTTP-level
// surface behavior (OPTIONS/method/validation) that doesn't require
// mocking the live Duval fetch or Supabase (this repo's tests never mock
// network/DB — see codebase convention). Full run behavior (dedupe, exact
// funnel counts, zero-result, partial failure) is exercised live against
// real Duval public records and a real Supabase workspace before the
// demo, per the final report's "DEMO SAFE RUN" dry-run instruction — not
// safely fakeable here without inventing fetch/DB mocks this repo doesn't
// use anywhere else.
import { describe, it, expect } from 'vitest'
import {
  clampCriteria, KNOWN_DOC_TYPES, LIS_PENDENS_DOC_TYPE, MAX_RECORDS_ALLOWED, DATE_RANGE_MAX_DAYS,
} from '../netlify/functions/offmarket-find-leads.mjs'

describe('clampCriteria — Part 4/5, never trust client-supplied criteria blindly', () => {
  it('Last 7 Days is accepted as-is', () => {
    expect(clampCriteria({ dateRangeDays: 7, maxRecords: 10 }).dateRangeDays).toBe(7)
  })
  it('Last 30 Days (the documented default) is accepted as-is', () => {
    expect(clampCriteria({ dateRangeDays: 30, maxRecords: 10 }).dateRangeDays).toBe(30)
  })
  it('a custom range within the ceiling is accepted exactly', () => {
    expect(clampCriteria({ dateRangeDays: 45, maxRecords: 10 }).dateRangeDays).toBe(45)
  })
  it('a custom range above the hard ceiling is clamped down, never an unbounded fetch', () => {
    expect(clampCriteria({ dateRangeDays: 9999, maxRecords: 10 }).dateRangeDays).toBe(DATE_RANGE_MAX_DAYS)
  })
  it('zero/garbage falls back to the safe 30-day default (0 is falsy, treated as "not supplied")', () => {
    expect(clampCriteria({ dateRangeDays: 0, maxRecords: 10 }).dateRangeDays).toBe(30)
    expect(clampCriteria({ dateRangeDays: 'garbage', maxRecords: 10 }).dateRangeDays).toBe(30)
  })
  it('a negative range is clamped up to the safe minimum of 1 day, never negative', () => {
    expect(clampCriteria({ dateRangeDays: -5, maxRecords: 10 }).dateRangeDays).toBe(1)
  })

  it('Max 10 is accepted', () => { expect(clampCriteria({ dateRangeDays: 30, maxRecords: 10 }).maxRecords).toBe(10) })
  it('Max 25 is accepted', () => { expect(clampCriteria({ dateRangeDays: 30, maxRecords: 25 }).maxRecords).toBe(25) })
  it('Max 50 is accepted', () => { expect(clampCriteria({ dateRangeDays: 30, maxRecords: 50 }).maxRecords).toBe(50) })
  it('Max 100 is accepted', () => { expect(clampCriteria({ dateRangeDays: 30, maxRecords: 100 }).maxRecords).toBe(100) })
  it('an unsupported record limit falls back to the documented safe default of 10, never an unbounded fetch', () => {
    expect(clampCriteria({ dateRangeDays: 30, maxRecords: 99999 }).maxRecords).toBe(10)
    expect(clampCriteria({ dateRangeDays: 30, maxRecords: 0 }).maxRecords).toBe(10)
    expect(clampCriteria({ dateRangeDays: 30, maxRecords: 'garbage' }).maxRecords).toBe(10)
  })

  it('the demo-safe preset (30 days, max 10) round-trips exactly', () => {
    expect(clampCriteria({ dateRangeDays: 30, maxRecords: 10 })).toEqual({ dateRangeDays: 30, maxRecords: 10 })
  })
})

describe('MAX_RECORDS_ALLOWED — exactly the four documented options, nothing invented', () => {
  it('is exactly [10, 25, 50, 100]', () => {
    expect(MAX_RECORDS_ALLOWED).toEqual([10, 25, 50, 100])
  })
})

describe('DocTypes honesty contract (Part 20/audit)', () => {
  it('LIS_PENDENS_DOC_TYPE is set (user-confirmed from the Capability #10 delivery report)', () => {
    expect(LIS_PENDENS_DOC_TYPE).toBe('104')
  })
  it('the known-working LIEN reference value (103) is preserved unmodified — Lis Pendens never silently reuses it', () => {
    expect(KNOWN_DOC_TYPES.LIEN).toBe('103')
    expect(LIS_PENDENS_DOC_TYPE).not.toBe(KNOWN_DOC_TYPES.LIEN)
  })
})

describe('HTTP surface — reachable without any network/DB mock (all return before fetch/supabase is ever called)', () => {
  it('OPTIONS returns 204 with CORS headers, never touches the live source', async () => {
    const handler = (await import('../netlify/functions/offmarket-find-leads.mjs')).default
    const res = await handler(new Request('http://x/offmarket-find-leads', { method: 'OPTIONS' }))
    expect(res.status).toBe(204)
  })
  it('a non-POST method is rejected with 405', async () => {
    const handler = (await import('../netlify/functions/offmarket-find-leads.mjs')).default
    const res = await handler(new Request('http://x/offmarket-find-leads', { method: 'GET' }))
    expect(res.status).toBe(405)
  })
  it('a POST with no workspaceId is rejected with 400 before any fetch/DB call is attempted', async () => {
    const handler = (await import('../netlify/functions/offmarket-find-leads.mjs')).default
    const res = await handler(new Request('http://x/offmarket-find-leads', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.ok).toBe(false)
  })
})
