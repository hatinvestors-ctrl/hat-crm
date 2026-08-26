// src/lib/contactEnrichment.js
// Capability #10.3 — Owner contact data model + the ONE currently-connected
// property-data provider (RentCast, already integrated for Capability #6/
// enrich-lead.mjs). No paid skip-trace provider is connected yet — see the
// Capability #10.3 delivery report "Provider Decision" for the researched
// options (BatchData/REISkip/PropertyRadar) and recommendation. This
// module does NOT call any of those; it only documents the gap and wires
// the minimal contact fields so a real provider integration later has
// somewhere real to write to.
//
// STRICT — this module NEVER sends outreach (no SMS/call/email) and NEVER
// infers a phone/email from a name. If no reliable source provides
// contact data, every field stays null and contact_match_status is
// NO_MATCH — never guessed.

/**
 * @typedef {'VERIFIED'|'LIKELY'|'AMBIGUOUS'|'NO_MATCH'} ContactMatchStatus
 */

/**
 * Real, honest finding (Capability #10.3): RentCast's Property Records API
 * — the only property-data provider currently wired into HatCRM
 * (netlify/functions/enrich-lead.mjs) — has NEVER returned an owner phone
 * or email field in this codebase's existing field mapping (only
 * listingAgent.phone/email, which is the LISTING AGENT, not the owner —
 * meaningless for an off-market/FSBO distressed property with no listing
 * agent at all). Confirmed again live in #10.3: the RentCast property
 * response shape has no owner.phone/owner.email field to read even if the
 * API key were valid.
 *
 * @returns {{owner_phone: null, owner_email: null, contact_source: string, contact_match_status: ContactMatchStatus}}
 */
export function attemptContactEnrichment() {
  return {
    owner_phone: null,
    owner_email: null,
    contact_source: 'none_connected', // no paid skip-trace provider integrated yet — see delivery report
    contact_match_status: 'NO_MATCH',
  }
}

export function fmtContactMatch(status) {
  switch (status) {
    case 'VERIFIED': return 'Verified'
    case 'LIKELY': return 'Likely'
    case 'AMBIGUOUS': return 'Ambiguous'
    default: return null
  }
}

/**
 * Section 10 — contactability signal for Action Center. Deliberately does
 * NOT feed into the Opportunity Score's priority tier by itself (mission:
 * "Do NOT allow contact availability alone to create HIGH PRIORITY") — it
 * is a separate, additive badge only.
 */
export function isContactReady(lead) {
  return !!(lead?.phone || lead?.email)
}

// ── Off-Market Contact Enrichment V1 ─────────────────────────────────────
// One canonical CONTACT STATUS derived entirely from fields
// netlify/functions/batchdata-enrich.mjs already writes (contact_ui_status,
// skip_trace_status) plus isContactReady() above — never a second,
// competing definition of "Contact Ready".
/**
 * @typedef {'CONTACT_READY'|'NEEDS_ENRICHMENT'|'NO_MATCH'|'MATCH_NEEDS_REVIEW'|'ENRICHMENT_ERROR'} ContactStatus
 */
// Fix (Lead Intelligence Explainability pass) — real bug found auditing
// 10940 Ventnor Ave: this previously required BOTH contact_ui_status ===
// 'CONTACT NEEDED' AND skip_trace_status === 'NO_MATCH' to report
// NO_MATCH. But skip_trace_status only ever becomes 'NO_MATCH' when the
// provider returned ZERO candidate people at all
// (netlify/functions/batchdata-enrich.mjs) — when the provider DOES
// return people but none can be safely matched to the owner (Ventnor's
// real case), skip_trace_status stays 'SUCCESS' and contact_ui_status
// becomes 'CONTACT NEEDED' (the function's own else-branch, set whenever
// contactMatchStatus isn't VERIFIED/LIKELY/AMBIGUOUS). The old extra
// condition silently failed for that real, common case and fell through
// to NEEDS_ENRICHMENT ("NOT ENRICHED") even though a real attempt had
// already happened — exactly backwards. contact_ui_status === 'CONTACT
// NEEDED' is already the correct, complete signal on its own; the
// redundant check is removed, no new field/model introduced.
export function getContactStatus(lead) {
  if (isContactReady(lead)) return 'CONTACT_READY'
  const uiStatus = lead?.enrichment_data?.contact_ui_status
  if (uiStatus === 'ENRICHMENT TEMPORARILY UNAVAILABLE') return 'ENRICHMENT_ERROR'
  if (uiStatus === 'MATCH NEEDS REVIEW') return 'MATCH_NEEDS_REVIEW'
  if (uiStatus === 'CONTACT NEEDED') return 'NO_MATCH'
  return 'NEEDS_ENRICHMENT'
}

export function fmtContactStatus(status) {
  switch (status) {
    case 'CONTACT_READY': return 'Contact Ready'
    case 'NO_MATCH': return 'No Match'
    case 'MATCH_NEEDS_REVIEW': return 'Match Needs Review'
    case 'ENRICHMENT_ERROR': return 'Enrichment Error'
    default: return 'Needs Enrichment'
  }
}

// Deterministic "Recommended for Enrichment" — Section 4. Uses ONLY
// fields the existing pipeline already computes (opp.opportunity_priority,
// opp.buy_box_fit from src/lib/offMarketMetrics.js's annotate(), and
// owner_match_status from the existing distress enrichment). Real-data
// validation (pre-deploy) found owner_match_status is written to
// lead.distress_data by every current ingestion path (lispendens-pilot.mjs,
// cap14_lien_pipeline.mjs, offmarket-find-leads.mjs) — the SAME
// distress_data-is-canonical split getOpportunityInfo() already documents
// for distress_category (see its own comment: enrichment_data only ever
// got a one-off historical backfill for the original Lis Pendens batch).
// enrichment_data is kept as a fallback for that same handful of
// pre-#15.1 legacy leads, never as the primary source. No new opaque
// score — every criterion is a real, named, already-existing field, and
// the caller can render each ✓/— directly from the returned `criteria`
// object (mission's exact "✓ High Priority / ✓ Buy Box Fit / ✓ Owner
// Match / ✓ No Contact Data" example).
export function getEnrichmentRecommendation(lead, opp) {
  const ownerMatchStatus = lead?.distress_data?.owner_match_status || lead?.enrichment_data?.owner_match_status
  const criteria = {
    highPriority: opp?.opportunity_priority?.key === 'HIGH_PRIORITY',
    buyBoxFit: opp?.buy_box_fit === 'FIT',
    ownerMatch: ownerMatchStatus === 'MATCH',
    noContactData: !isContactReady(lead),
  }
  // Conservative (Section 4): must not already be contact-ready, must have
  // a resolved owner match, and must clear EITHER buy-box fit or high
  // priority (a lead can be genuinely worth enriching on either signal
  // alone — requiring both would under-recommend real opportunities the
  // existing scoring already flagged).
  const recommended = criteria.noContactData && criteria.ownerMatch && (criteria.buyBoxFit || criteria.highPriority)
  return { recommended, criteria }
}
