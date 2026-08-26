// test/distressNextAction.test.js
// Fix — Distress Next Action State. Regresses the real bug found during
// Visual QA (10940 Ventnor Ave: owner MATCH, enrichment attempted, no
// safe contact — showed "Research Owner", implying unfinished owner
// research that was actually complete). Covers every reachable state in
// the deterministic hierarchy, using ONLY getContactStatus/
// getLastAttemptSummary/STATUS_MAP — no new workflow model.
import { describe, it, expect } from 'vitest'
import { getNextAction } from '../src/lib/distressInfo.js'

// Real, as-persisted shape for 10940 VENTNOR AVE (see the prior
// capability's forensic audit) — owner known, MATCH, a real enrichment
// attempt happened, no safe contact was found.
const VENTNOR_LEAD = {
  status: 'triage',
  owner_name: 'MALONEY TIMOTHY JOSEPH ET AL',
  phone: null, email: null,
  enrichment_data: {
    contact_match_status: 'NO_MATCH',
    contact_profile: null,
    skip_trace_status: 'SUCCESS',
    contact_ui_status: 'CONTACT NEEDED',
    contact_enriched_at: '2026-08-26T09:11:51.604Z',
    match_diagnostics: null,
  },
}
const VENTNOR_INFO = { owner_match_status: 'MATCH' }

describe('State 1 — no owner_name', () => {
  it('returns Verify Property regardless of any other field', () => {
    expect(getNextAction({ status: 'triage' }, {})).toBe('Verify Property')
    expect(getNextAction({ status: 'triage', owner_name: '' }, { owner_match_status: 'MATCH' })).toBe('Verify Property')
  })
})

describe('State 2 — owner_match_status known and not MATCH', () => {
  it('returns Verify Owner for AMBIGUOUS/POSSIBLE_MATCH/DIFFERENT, even with owner_name present', () => {
    const lead = { status: 'triage', owner_name: 'JANE DOE' }
    expect(getNextAction(lead, { owner_match_status: 'AMBIGUOUS' })).toBe('Verify Owner')
    expect(getNextAction(lead, { owner_match_status: 'POSSIBLE_MATCH' })).toBe('Verify Owner')
    expect(getNextAction(lead, { owner_match_status: 'DIFFERENT' })).toBe('Verify Owner')
  })
  it('a missing owner_match_status does NOT trigger Verify Owner (unchanged semantics — proceeds to contact states)', () => {
    const lead = { status: 'triage', owner_name: 'JANE DOE' }
    expect(getNextAction(lead, {})).not.toBe('Verify Owner')
  })
})

describe('State 3/6 — a later acquisition workflow state already exists', () => {
  it('never sends the user backward into contact enrichment once the pipeline has moved on', () => {
    const lead = { status: 'negotiating', owner_name: 'JANE DOE' }
    const result = getNextAction(lead, { owner_match_status: 'MATCH' })
    expect(result).not.toMatch(/Enrich Contact|Retry Contact|Research Owner/)
    expect(result).toBe('Negotiating')
  })
  it('reuses the existing STATUS_MAP label exactly — no new status vocabulary invented', () => {
    const lead = { status: 'offer_sent', owner_name: 'JANE DOE' }
    expect(getNextAction(lead, { owner_match_status: 'MATCH' })).toBe('Offer Sent')
  })
  it('"monitor" is treated as pre-contact, same as triage (not a later state)', () => {
    const lead = { status: 'monitor', owner_name: 'JANE DOE' }
    expect(getNextAction(lead, { owner_match_status: 'MATCH' })).toBe('Enrich Contact')
  })
})

describe('State 4 — owner MATCH, Contact Ready', () => {
  it('returns Contact Seller when the lead already has a phone or email on file', () => {
    const lead = { status: 'triage', owner_name: 'JANE DOE', phone: '9045551212' }
    expect(getNextAction(lead, { owner_match_status: 'MATCH' })).toBe('Contact Seller')
  })
})

describe('State 5 — owner MATCH, enrichment attempted, no safe contact', () => {
  it('THE REAL BUG CASE — 10940 Ventnor Ave never shows "Research Owner"', () => {
    const result = getNextAction(VENTNOR_LEAD, VENTNOR_INFO)
    expect(result).not.toBe('Research Owner')
    expect(result).toBe('Retry Contact')
  })
})

describe('State 6 — owner MATCH, no attempt yet', () => {
  it('returns Enrich Contact for a fresh triage lead with a verified owner and no contact history', () => {
    const lead = { status: 'triage', owner_name: 'JANE DOE' }
    expect(getNextAction(lead, { owner_match_status: 'MATCH' })).toBe('Enrich Contact')
  })
})

describe('Regression — the literal string "Research Owner" is never produced by any reachable state', () => {
  const scenarios = [
    [{ status: 'triage' }, {}],
    [{ status: 'triage', owner_name: 'X' }, { owner_match_status: 'AMBIGUOUS' }],
    [{ status: 'triage', owner_name: 'X' }, { owner_match_status: 'MATCH' }],
    [{ status: 'triage', owner_name: 'X', phone: '1' }, { owner_match_status: 'MATCH' }],
    [{ status: 'negotiating', owner_name: 'X' }, { owner_match_status: 'MATCH' }],
    [VENTNOR_LEAD, VENTNOR_INFO],
  ]
  it.each(scenarios)('scenario %# never returns "Research Owner"', (lead, info) => {
    expect(getNextAction(lead, info)).not.toBe('Research Owner')
  })
})
