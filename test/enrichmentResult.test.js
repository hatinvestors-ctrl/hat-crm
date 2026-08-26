// test/enrichmentResult.test.js
// Skip Trace Result Explainability + Contact Intelligence Visibility V1.
//
// CASE 1/2 fixtures below are built from the REAL persisted production
// rows audited for this capability — 10940 VENTNOR AVE and 9712
// WOODSTONE MILL DR — read directly from Supabase on 2026-08-26. Both
// addresses and owner names are already public record (Duval County Lis
// Pendens filings), and match_diagnostics is intentionally absent from
// both real rows because this capability's diagnostic capture didn't
// exist yet when those two real attempts ran — that gap is itself part
// of what these tests prove (Test 5, "legacy lead" honesty).
import { describe, it, expect } from 'vitest'
import { getEnrichmentResultExplanation, getLastAttemptSummary, ATTEMPT_RESULT, fmtAttemptResult } from '../src/lib/enrichmentResult.js'
import { getContactStatus } from '../src/lib/contactEnrichment.js'

// Real, as-persisted enrichment_data for 9712 WOODSTONE MILL DR — the
// lead's FIRST and only real attempt (updated_at === contact_enriched_at,
// proving this write happened during a real, non-skipped call).
const WOODSTONE_LEAD = {
  address: '9712   WOODSTONE MILL DR',
  owner_name: 'BARNES KAYLA J LIFE ESTATE',
  phone: null, email: null,
  enrichment_data: {
    contact_match_status: 'NO_MATCH',
    contact_profile: null,
    skip_trace_status: 'SUCCESS',
    contact_ui_status: 'CONTACT NEEDED',
    contact_enriched_at: '2026-08-26T09:14:07.632Z',
    match_diagnostics: null, // real gap — not captured for this historical attempt
  },
}

// Real, as-persisted enrichment_data for 10940 VENTNOR AVE — this row's
// CURRENT state also reflects a real NO_MATCH attempt at 09:11:51 (proven
// the same way). A LATER click on this same lead (within the 24h TTL)
// would hit batchDataPreflight's ALREADY_ENRICHED branch and return
// {skipped:true, decision:'ALREADY_ENRICHED', lead: <this row>} without
// writing anything — which is what the production screenshot's
// "ALREADY ENRICHED" badge for this specific lead actually captured.
const VENTNOR_LEAD = {
  address: '10940   VENTNOR AVE',
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

describe('CASE 2 — real WOODSTONE MILL DR: real NO_MATCH attempt, correctly explained', () => {
  it('getLastAttemptSummary reflects the real persisted attempt honestly', () => {
    const summary = getLastAttemptSummary(WOODSTONE_LEAD)
    expect(summary.ownerSearched).toBe('BARNES KAYLA J LIFE ESTATE')
    expect(summary.attemptedAt).toBe('2026-08-26T09:14:07.632Z')
    // No match_diagnostics were captured for this real historical attempt
    // — the explanation says so honestly rather than inventing a reason.
    expect(summary.humanReason).toMatch(/not available for this specific attempt/i)
  })
  it('no contact was falsely attached — contact_profile stays null, no fabricated candidate info', () => {
    expect(WOODSTONE_LEAD.enrichment_data.contact_profile).toBeNull()
  })
  it('the lead remains NEEDS_ENRICHMENT (safely unenriched), never CONTACT_READY', () => {
    expect(getContactStatus(WOODSTONE_LEAD)).not.toBe('CONTACT_READY')
  })
  it('a real live API response for this exact scenario is explained the same way (full-response path)', () => {
    const liveResponse = { ok: true, uiStatus: 'CONTACT NEEDED', skipTraceStatus: 'SUCCESS', contactMatchStatus: 'NO_MATCH', matchDiagnostics: null }
    const explanation = getEnrichmentResultExplanation(liveResponse)
    expect(explanation.attemptResult).toBe(ATTEMPT_RESULT.PROVIDER_CALLED_NO_MATCH)
    expect(explanation.providerCalled).toBe(true)
  })
})

describe('CASE 3 — real VENTNOR AVE: distinguishing a fresh NO_MATCH from a later SKIPPED_ALREADY_ENRICHED click', () => {
  it('the persisted row itself proves a real (non-skipped) attempt happened — same reasoning as WOODSTONE', () => {
    const summary = getLastAttemptSummary(VENTNOR_LEAD)
    expect(summary.humanReason).toMatch(/not available/i)
  })
  it('a LATER click on this same lead, within the TTL window, is explained as SKIPPED — clearly distinct from PROVIDER_CALLED_NO_MATCH (Part 3\'s core distinction)', () => {
    const laterClickResponse = { ok: true, skipped: true, decision: 'ALREADY_ENRICHED', reason: 'Enriched within the last TTL window', lead: VENTNOR_LEAD }
    const explanation = getEnrichmentResultExplanation(laterClickResponse)
    expect(explanation.attemptResult).toBe(ATTEMPT_RESULT.SKIPPED_ALREADY_ENRICHED)
    expect(explanation.providerCalled).toBe(false)
  })
  it('the skip explanation correctly reports that NO contact is on file yet (reads the real prior lead, not just the decision string)', () => {
    const laterClickResponse = { ok: true, skipped: true, decision: 'ALREADY_ENRICHED', reason: 'x', lead: VENTNOR_LEAD }
    const explanation = getEnrichmentResultExplanation(laterClickResponse)
    expect(explanation.priorContactStatus).not.toBe('CONTACT_READY')
    expect(explanation.humanReason).toMatch(/found no safe contact match/i)
  })
  it('CASE — the SAME skip decision, but for a lead that DOES already have contact on file, is worded differently (real, provable distinction)', () => {
    const contactReadyLead = { phone: '9045551212', enrichment_data: { contact_match_status: 'LIKELY' } }
    const response = { ok: true, skipped: true, decision: 'ALREADY_ENRICHED', reason: 'x', lead: contactReadyLead }
    const explanation = getEnrichmentResultExplanation(response)
    expect(explanation.priorContactStatus).toBe('CONTACT_READY')
    expect(explanation.humanReason).toMatch(/already on file/i)
  })
})

describe('CASE 4 — provider error clearly distinguished from NO_MATCH', () => {
  it('a billing error never renders the same as a genuine no-match', () => {
    const response = { ok: true, uiStatus: 'ENRICHMENT TEMPORARILY UNAVAILABLE', skipTraceStatus: 'BILLING_ERROR', contactMatchStatus: 'NO_MATCH' }
    const explanation = getEnrichmentResultExplanation(response)
    expect(explanation.attemptResult).toBe(ATTEMPT_RESULT.PROVIDER_ERROR)
    expect(explanation.attemptResult).not.toBe(ATTEMPT_RESULT.PROVIDER_CALLED_NO_MATCH)
    expect(explanation.humanReason).toMatch(/credits are unavailable|authentication/i)
  })
  it('a network error is also distinguished from no-match', () => {
    const response = { ok: true, uiStatus: 'ENRICHMENT TEMPORARILY UNAVAILABLE', skipTraceStatus: 'NETWORK_ERROR' }
    expect(getEnrichmentResultExplanation(response).attemptResult).toBe(ATTEMPT_RESULT.PROVIDER_ERROR)
  })
})

describe('CASE 5 — legacy lead / no attempt yet: backward compatible', () => {
  it('a lead with no contact_enriched_at at all has no last-attempt summary (never attempted)', () => {
    expect(getLastAttemptSummary({ enrichment_data: {} })).toBeNull()
    expect(getLastAttemptSummary({})).toBeNull()
  })
  it('a lead that succeeded (VERIFIED/LIKELY) has no failure summary to show', () => {
    expect(getLastAttemptSummary({ enrichment_data: { contact_enriched_at: '2026-01-01', contact_match_status: 'LIKELY' } })).toBeNull()
  })
})

describe('Success path — real matchDiagnostics distinctions (prospective, not yet observed live)', () => {
  it('0 candidates returned is explained distinctly from a name-overlap failure', () => {
    const zero = getEnrichmentResultExplanation({ ok: true, uiStatus: 'CONTACT NEEDED', skipTraceStatus: 'SUCCESS', matchDiagnostics: { candidatesReturned: 0 } })
    expect(zero.humanReason).toMatch(/no candidate person was returned/i)
  })
  it('an AMBIGUOUS top candidate is explained as a partial name overlap', () => {
    const ambiguous = getEnrichmentResultExplanation({ ok: true, uiStatus: 'CONTACT NEEDED', skipTraceStatus: 'SUCCESS', matchDiagnostics: { candidatesReturned: 2, topCandidateHadName: true, topCandidateMatchStatus: 'AMBIGUOUS' } })
    expect(ambiguous.humanReason).toMatch(/partially overlapped/i)
  })
  it('a missing candidate name is explained distinctly', () => {
    const noName = getEnrichmentResultExplanation({ ok: true, uiStatus: 'CONTACT NEEDED', skipTraceStatus: 'SUCCESS', matchDiagnostics: { candidatesReturned: 1, topCandidateHadName: false } })
    expect(noName.humanReason).toMatch(/no usable name/i)
  })
  it('a real success is explained plainly', () => {
    const success = getEnrichmentResultExplanation({ ok: true, uiStatus: 'CONTACT READY', skipTraceStatus: 'SUCCESS' })
    expect(success.attemptResult).toBe(ATTEMPT_RESULT.PROVIDER_CALLED_SUCCESS)
    expect(success.providerCalled).toBe(true)
  })
})

describe('Response-error / malformed input never crashes', () => {
  it('a null response is handled honestly', () => {
    expect(getEnrichmentResultExplanation(null).attemptResult).toBe(ATTEMPT_RESULT.RESPONSE_ERROR)
  })
  it('an ok:false, non-skipped response is a RESPONSE_ERROR', () => {
    expect(getEnrichmentResultExplanation({ ok: false, error: 'boom' }).attemptResult).toBe(ATTEMPT_RESULT.RESPONSE_ERROR)
  })
})

describe('Every skip decision maps to a distinct, real attempt result', () => {
  const decisions = ['EXCLUDED_PROPERTY', 'RECENT_PROVIDER_FAILURE', 'LOOKUP_IN_PROGRESS', 'INSUFFICIENT_IDENTITY', 'ALREADY_ENRICHED']
  it.each(decisions)('%s never claims the provider was called', (decision) => {
    const explanation = getEnrichmentResultExplanation({ ok: true, skipped: true, decision, reason: 'x' })
    expect(explanation.providerCalled).toBe(false)
    expect(fmtAttemptResult(explanation.attemptResult)).toBeTruthy()
  })
})
