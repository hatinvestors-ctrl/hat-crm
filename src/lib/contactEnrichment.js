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
