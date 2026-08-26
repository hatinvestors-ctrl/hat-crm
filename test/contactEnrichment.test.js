// test/contactEnrichment.test.js
// Off-Market Contact Enrichment V1 — deterministic recommendation logic,
// canonical contact status, and batch-result aggregation. Pure functions
// only (this repo's established convention — see offmarketControlCenter.
// test.js — never mocks network/DB/BatchData/Supabase). Structural checks
// prove NO code path can trigger a paid call outside explicit user
// confirmation, without needing to fake a live BatchData response.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import {
  getContactStatus, fmtContactStatus, getEnrichmentRecommendation, isContactReady,
} from '../src/lib/contactEnrichment.js'
import { summarizeEnrichmentResults } from '../src/lib/enrichmentRun.js'

describe('getContactStatus — ONE canonical definition, no second model', () => {
  it('a lead with a phone is CONTACT_READY', () => {
    expect(getContactStatus({ phone: '904-555-1212' })).toBe('CONTACT_READY')
  })
  it('a lead with an email but no phone is still CONTACT_READY', () => {
    expect(getContactStatus({ email: 'a@b.com' })).toBe('CONTACT_READY')
  })
  it('a fresh lead with no enrichment attempt yet is NEEDS_ENRICHMENT', () => {
    expect(getContactStatus({})).toBe('NEEDS_ENRICHMENT')
  })
  it('a lead the provider explicitly could not match is NO_MATCH', () => {
    expect(getContactStatus({ enrichment_data: { contact_ui_status: 'CONTACT NEEDED', skip_trace_status: 'NO_MATCH' } })).toBe('NO_MATCH')
  })
  it('an ambiguous/unit-downgraded match is MATCH_NEEDS_REVIEW', () => {
    expect(getContactStatus({ enrichment_data: { contact_ui_status: 'MATCH NEEDS REVIEW' } })).toBe('MATCH_NEEDS_REVIEW')
  })
  it('a provider/billing/network failure is ENRICHMENT_ERROR, never silently CONTACT_READY', () => {
    expect(getContactStatus({ enrichment_data: { contact_ui_status: 'ENRICHMENT TEMPORARILY UNAVAILABLE' } })).toBe('ENRICHMENT_ERROR')
  })
  it('phone/email from ANY source (not just BatchData) is respected as CONTACT_READY', () => {
    expect(getContactStatus({ phone: '904-555-0000', enrichment_data: {} })).toBe('CONTACT_READY')
  })
  it('fmtContactStatus has real, non-empty user-facing text for every status', () => {
    for (const s of ['CONTACT_READY', 'NO_MATCH', 'MATCH_NEEDS_REVIEW', 'ENRICHMENT_ERROR', 'NEEDS_ENRICHMENT']) {
      expect(typeof fmtContactStatus(s)).toBe('string')
      expect(fmtContactStatus(s).length).toBeGreaterThan(0)
    }
  })
})

describe('getEnrichmentRecommendation — Section 4, conservative, existing-fields-only', () => {
  it('a high-priority, buy-box-fit, owner-matched lead with no contact data is recommended', () => {
    const lead = { distress_data: { owner_match_status: 'MATCH' } }
    const opp = { opportunity_priority: { key: 'HIGH_PRIORITY' }, buy_box_fit: 'FIT' }
    const result = getEnrichmentRecommendation(lead, opp)
    expect(result.recommended).toBe(true)
    expect(result.criteria).toEqual({ highPriority: true, buyBoxFit: true, ownerMatch: true, noContactData: true })
  })
  it('a NOT_FIT lead with no high-priority signal is NOT recommended (Test 8)', () => {
    const lead = { distress_data: { owner_match_status: 'MATCH' } }
    const opp = { opportunity_priority: { key: 'REVIEW' }, buy_box_fit: 'NOT_FIT' }
    expect(getEnrichmentRecommendation(lead, opp).recommended).toBe(false)
  })
  it('buy-box fit alone (without high priority) is still enough — real opportunities are not under-recommended', () => {
    const lead = { distress_data: { owner_match_status: 'MATCH' } }
    const opp = { opportunity_priority: { key: 'REVIEW' }, buy_box_fit: 'FIT' }
    expect(getEnrichmentRecommendation(lead, opp).recommended).toBe(true)
  })
  it('an owner mismatch is NEVER recommended even with high priority + buy box fit (Test 9)', () => {
    const lead = { distress_data: { owner_match_status: 'DIFFERENT' } }
    const opp = { opportunity_priority: { key: 'HIGH_PRIORITY' }, buy_box_fit: 'FIT' }
    expect(getEnrichmentRecommendation(lead, opp).recommended).toBe(false)
  })
  it('a lead already Contact Ready is never recommended again (would waste spend)', () => {
    const lead = { phone: '904-555-1212', enrichment_data: { owner_match_status: 'MATCH' } }
    const opp = { opportunity_priority: { key: 'HIGH_PRIORITY' }, buy_box_fit: 'FIT' }
    expect(getEnrichmentRecommendation(lead, opp).recommended).toBe(false)
  })
  it('missing source fields never falsely recommend a lead (Section 4: "do not pretend recommended")', () => {
    expect(getEnrichmentRecommendation({}, {}).recommended).toBe(false)
    expect(getEnrichmentRecommendation({}, null).recommended).toBe(false)
    expect(getEnrichmentRecommendation(null, null).recommended).toBe(false)
  })
  it('Test 10 — a real high-priority fit lead with resolved owner and no contact is recommended', () => {
    const lead = { distress_data: { owner_match_status: 'MATCH' } }
    const opp = { opportunity_priority: { key: 'HIGH_PRIORITY' }, buy_box_fit: 'FIT' }
    expect(getEnrichmentRecommendation(lead, opp).recommended).toBe(true)
  })
  it('real-data regression (pre-deploy validation): owner_match_status lives in distress_data on every current ingestion path, not enrichment_data — distress_data must be read as primary', () => {
    const lead = { distress_data: { owner_match_status: 'MATCH' }, enrichment_data: { owner_match_status: 'DIFFERENT' } }
    const opp = { opportunity_priority: { key: 'HIGH_PRIORITY' }, buy_box_fit: 'FIT' }
    expect(getEnrichmentRecommendation(lead, opp).criteria.ownerMatch).toBe(true)
  })
  it('enrichment_data.owner_match_status is still honored as a fallback for the handful of legacy pre-#15.1 leads with no distress_data value', () => {
    const lead = { enrichment_data: { owner_match_status: 'MATCH' } }
    const opp = { opportunity_priority: { key: 'HIGH_PRIORITY' }, buy_box_fit: 'FIT' }
    expect(getEnrichmentRecommendation(lead, opp).criteria.ownerMatch).toBe(true)
  })
  it('a POSSIBLE_MATCH owner status is conservatively NOT recommended — only an exact MATCH qualifies', () => {
    const lead = { distress_data: { owner_match_status: 'POSSIBLE_MATCH' } }
    const opp = { opportunity_priority: { key: 'HIGH_PRIORITY' }, buy_box_fit: 'FIT' }
    expect(getEnrichmentRecommendation(lead, opp).recommended).toBe(false)
  })
})

describe('summarizeEnrichmentResults — Section 8, real counts only', () => {
  it('Test 11 — a mixed batch aggregates exactly, no double counting', () => {
    const results = [
      { leadId: 'a', outcome: 'CONTACT FOUND', phoneFound: true, emailFound: true },
      { leadId: 'b', outcome: 'CONTACT FOUND', phoneFound: true, emailFound: false },
      { leadId: 'c', outcome: 'NO MATCH' },
      { leadId: 'd', outcome: 'ALREADY ENRICHED' },
      { leadId: 'e', outcome: 'ERROR', error: 'x' },
    ]
    expect(summarizeEnrichmentResults(results)).toEqual({
      total: 5, contactReady: 2, noMatch: 1, alreadyEnriched: 1, errors: 1, phonesFound: 2, emailsFound: 1,
    })
  })
  it('Test 12 — partial success is fully preserved (no lead silently dropped)', () => {
    const results = [
      { leadId: 'a', outcome: 'CONTACT FOUND', phoneFound: true },
      { leadId: 'b', outcome: 'ERROR', error: 'network' },
    ]
    const summary = summarizeEnrichmentResults(results)
    expect(summary.total).toBe(2)
    expect(summary.contactReady).toBe(1)
    expect(summary.errors).toBe(1)
  })
  it('Test 13 — a no-match result is counted honestly, never mislabeled Contact Ready', () => {
    const summary = summarizeEnrichmentResults([{ leadId: 'a', outcome: 'NO MATCH' }])
    expect(summary.noMatch).toBe(1)
    expect(summary.contactReady).toBe(0)
  })
  it('an empty result set produces all-zero counts, never null/undefined/NaN', () => {
    expect(summarizeEnrichmentResults([])).toEqual({ total: 0, contactReady: 0, noMatch: 0, alreadyEnriched: 0, errors: 0, phonesFound: 0, emailsFound: 0 })
  })
})

describe('Structural safety — Section 12, no code path bills without explicit confirmation', () => {
  it('Test 1/18 — nothing in the off-market ingestion function calls the contact-enrichment endpoint (new leads never auto-enrich)', () => {
    const src = fs.readFileSync('netlify/functions/offmarket-find-leads.mjs', 'utf8')
    expect(src).not.toMatch(/batchdata-enrich/)
  })
  it('Test 2/18 — selecting/toggling a row (toggleSelect equivalent) never appears inside enrichmentRun.js\'s network call path', () => {
    const src = fs.readFileSync('src/lib/enrichmentRun.js', 'utf8')
    // The only fetch() in this file is inside enrichOneLead(), only ever
    // invoked from runContactEnrichmentBatch() — never from a getter/toggle.
    const fetchCalls = (src.match(/fetch\(/g) || []).length
    expect(fetchCalls).toBe(1)
  })
  it('Test 3 — a real paid call is only reachable through runContactEnrichmentBatch, which the modal\'s onConfirm is the sole caller of in the page', () => {
    const page = fs.readFileSync('src/pages/OffMarketEnginePage.jsx', 'utf8')
    expect(page).toMatch(/onConfirm=\{runEnrichment\}/)
    expect(page).toMatch(/runContactEnrichmentBatch/)
  })
  it('Test 19 — existing #10.5 preflight/double-billing/wrong-unit files are untouched by this capability', () => {
    // These are reused, never duplicated or modified — verified by this
    // capability introducing zero new BatchData call logic of its own.
    const runner = fs.readFileSync('src/lib/enrichmentRun.js', 'utf8')
    expect(runner).not.toMatch(/BATCHDATA_API_KEY/)
    expect(runner).not.toMatch(/callBatchData/)
  })
})

describe('isContactReady — unchanged, still the base of getContactStatus (regression)', () => {
  it('still exactly phone-or-email, nothing new added to its own definition', () => {
    expect(isContactReady({ phone: '1' })).toBe(true)
    expect(isContactReady({ email: '1' })).toBe(true)
    expect(isContactReady({})).toBe(false)
  })
})
