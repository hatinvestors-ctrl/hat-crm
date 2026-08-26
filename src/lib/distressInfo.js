// src/lib/distressInfo.js
// Capability #10.1 — one shared normalizer for a lead's distress signal.
// Prefers structured `lead.distress_data` (once the Capability #10
// migration is applied); falls back to parsing the EXACT, self-authored
// notes block Capability #10's pilot pipeline writes today
// (scripts/lispendens-pilot.mjs) — a fixed line-format we control, not
// free-text NLP, so this is a safe fallback, not guessing.
//
// Every UI piece that shows distress info (DistressedOpportunityCard,
// DistressBadge, Inbox filter, Leads filter, Action Center) calls this ONE
// function so they never disagree with each other.

import { getContactStatus } from './contactEnrichment.js'
import { getLastAttemptSummary } from './enrichmentResult.js'
import { STATUS_MAP } from './constants.js'

const NOTES_MARKER = '⚠ DISTRESSED OPPORTUNITY'

function parseNotesBlock(notes) {
  if (typeof notes !== 'string' || !notes.startsWith(NOTES_MARKER)) return null
  const lines = notes.split('\n')
  const get = (label) => {
    const line = lines.find(l => l.startsWith(label + ':'))
    return line ? line.slice(label.length + 1).trim() : null
  }
  const signalLine = lines[0] || ''
  const distressType = signalLine.toLowerCase().includes('lis pendens')
    ? 'lis_pendens'
    : signalLine.toLowerCase().includes('lien')
      ? 'recorded_lien'
      : null

  return {
    distress_type: distressType,
    distress_source: 'duval_clerk',
    distress_filing_date: get('Filed'),
    distress_case_or_instrument: get('Case/Instrument'),
    source_party: get('Source Party'),
    current_owner: null, // notes don't repeat it separately from lead.owner_name
    owner_match_status: get('Owner Match'),
    absentee_owner: (() => {
      const v = get('Absentee Owner')
      if (v === 'true') return true
      if (v === 'false') return false
      return null
    })(),
    // Capability #14 — recorded lien only; null for every other distress type.
    lien_amount: get('Amount'),
    lien_status: get('Status'),
    source_reference: 'Duval County Public Record',
    enrichment_status: 'enriched',
  }
}

/**
 * @param {object} lead
 * @returns {null|object} normalized distress info, or null if this lead has none
 */
export function getDistressInfo(lead) {
  if (!lead) return null
  if (lead.distress_data && typeof lead.distress_data === 'object') return lead.distress_data
  return parseNotesBlock(lead.notes)
}

export function isDistressedLead(lead) {
  if (!lead) return false
  if (lead.is_distressed) return true
  return getDistressInfo(lead) !== null
}

// ── Human-readable translations (mission Section 2: no raw true/false/MATCH) ──
export function fmtOwnerMatch(status) {
  switch (status) {
    case 'MATCH': return '✓ Verified'
    case 'POSSIBLE_MATCH': return 'Possible Match'
    case 'DIFFERENT': return 'Different Owner'
    default: return 'Unknown'
  }
}

export function fmtAbsentee(value) {
  if (value === true) return '✓ Yes'
  if (value === false) return 'No'
  return 'Unknown'
}

export function fmtDistressType(type) {
  if (type === 'lis_pendens') return 'Pre-Foreclosure • Lis Pendens'
  if (type === 'recorded_lien') return 'Recorded Lien'
  return 'Distress Signal'
}

// Capability #14 — lien amount arrives as a real dollar figure only when
// the source Consideration field was actually populated; most HOA/tax
// liens on this source leave it at 0, which is NOT the same as "$0 owed"
// — so a zero/missing amount renders as "Not disclosed", never as $0.
export function fmtLienAmount(amount) {
  const n = Number(amount)
  if (!amount || !Number.isFinite(n) || n <= 0) return 'Not disclosed'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export function fmtLienStatus(status) {
  if (status === 'active' || status === 'Active') return 'Active'
  if (status === 'released' || status === 'Released') return 'Released'
  return 'Unknown'
}

export function fmtDistressSource(source) {
  if (source === 'duval_clerk' || source === 'lispendens_duval_clerk') return 'Duval County Public Records'
  return source || 'Public Record'
}

// ── Section 3: "Why This Property Is Here" — derived only from real fields ──
export function getWhyHereReasons(lead, info) {
  const reasons = []
  if (info?.distress_type === 'lis_pendens') reasons.push('Lis Pendens filed')
  if (info?.distress_type === 'recorded_lien') reasons.push('Recorded lien found')
  if (lead?.owner_name || info?.current_owner) reasons.push('Property successfully identified')
  if (lead?.owner_name) reasons.push('Current owner identified')
  if (info?.absentee_owner === true) reasons.push('Absentee owner')
  return reasons.slice(0, 4)
}

// ── Section 4: Next Action — conservative, no outreach ever recommended ──
//
// Fix (Visual QA pass) — the real bug: once owner_match_status === 'MATCH',
// EVERY lead fell through to the same literal 'Research Owner' fallback,
// even leads whose owner research was already done and only contact
// enrichment remained (10940 Ventnor Ave: owner MATCH, enrichment
// attempted, no safe contact — showed "Research Owner", implying
// unfinished work that was actually complete).
//
// Deterministic state hierarchy, using ONLY fields/functions that already
// exist — no new workflow model, no new query:
//   1. No owner_name                              -> 'Verify Property'
//   2. owner_match_status known and not MATCH      -> 'Verify Owner'
//   3. A later acquisition workflow state already exists (lead.status is
//      anything past the pre-contact triage/monitor stage) -> defer to
//      that EXISTING status label (STATUS_MAP) rather than sending the
//      user backward into contact enrichment they've already moved past.
//   4. Owner MATCH (or unknown-but-not-rejected), Contact Ready
//      (getContactStatus — canonical, unchanged)     -> 'Contact Seller'
//   5. Owner MATCH, an enrichment attempt exists but found no safe
//      contact (getLastAttemptSummary — canonical, unchanged) -> 'Retry Contact'
//   6. Owner MATCH, no attempt yet                  -> 'Enrich Contact'
const PRE_CONTACT_STATUSES = ['triage', 'monitor']

export function getNextAction(lead, info) {
  if (!lead?.owner_name) return 'Verify Property'
  if (info?.owner_match_status && info.owner_match_status !== 'MATCH') return 'Verify Owner'

  // Section 6 — a later acquisition state already exists; never send the
  // user backward into "go enrich/contact" once the pipeline has moved on.
  if (lead?.status && !PRE_CONTACT_STATUSES.includes(lead.status)) {
    return STATUS_MAP?.[lead.status]?.label || null
  }

  const contactStatus = getContactStatus(lead)
  if (contactStatus === 'CONTACT_READY') return 'Contact Seller'
  if (getLastAttemptSummary(lead)) return 'Retry Contact'
  return 'Enrich Contact'
}

export function fmtParcel(parcelId) {
  if (!parcelId) return null
  // Duval RE numbers arrive as "148633 2855" — display as "148633-2855"
  // to visually distinguish from a phone number/other digit string.
  return String(parcelId).trim().replace(/\s+/g, '-')
}

// ── Capability #10.2 additions ───────────────────────────────────────────
// Distress-category, buy-box fit, and Opportunity Score live in the
// EXISTING enrichment_data JSONB column (Capability #9) rather than the
// still-unapplied distress_data migration — see
// scripts/cap10_2_reprocess.mjs for exactly what's written there.
import { DISTRESS_CATEGORY_LABELS } from './distressScoring.js'

export function getOpportunityInfo(lead) {
  const e = lead?.enrichment_data
  if (!e || e.opportunity_score == null) return null
  // Capability #15.1 — Phase 1 fix. distress_category is WRITTEN to
  // lead.distress_data (see scripts/cap14_lien_pipeline.mjs and the
  // original Lis Pendens pilot), but this function historically only read
  // it from lead.enrichment_data — populated just once, for the original
  // Lis Pendens batch, by the one-off scripts/cap10_2_reprocess.mjs
  // backfill script. Every lead enriched since (all Recorded Liens,
  // Capability #14) never got that backfill, so "Distress Type" rendered
  // blank in DistressBanner despite the category being known. Canonical
  // source is now distress_data (where every current pipeline writes it);
  // enrichment_data is kept only as a fallback for any lead that predates
  // this fix and was never re-processed.
  const category = lead?.distress_data?.distress_category || e.distress_category
  const categoryConfidence = lead?.distress_data?.distress_category_confidence || e.distress_category_confidence
  return {
    distress_category: category,
    distress_category_label: DISTRESS_CATEGORY_LABELS[category] || category,
    distress_category_confidence: categoryConfidence,
    buy_box_fit: e.buy_box_fit,
    opportunity_score: e.opportunity_score,
    opportunity_priority: e.opportunity_priority,
    opportunity_why: e.opportunity_why || [],
    opportunity_missing: e.opportunity_missing || [],
    excluded: e.excluded,
    excluded_reason: e.excluded_reason,
  }
}

// Part 3 (wholesaler-demo final polish) — SINGLE canonical label for "what
// kind of distress is this", used by every UI surface that needs one line
// (table Signal column, Why This Lead? headline). Before this function
// existed, the table read opp.distress_category_label (the scoring
// category from enrichment_data/distress_data) while the detail panel
// independently read fmtDistressType(info.distress_type) (parsed from the
// notes fallback) — two real fields describing the same event, which can
// legitimately disagree (distress_category is a coarse scoring bucket;
// distress_type is the specific recorded instrument). Investigation found
// this actually happening on real leads (e.g. a Lis Pendens filing
// categorized HOA_CONDO_LIEN instead of MORTGAGE_FORECLOSURE) — a real
// data-quality gap in the categorization step, not a UI bug, and NOT
// something this function corrects. This function only picks ONE field as
// the presentation source of truth (distress_category — it's what scoring/
// buy-box/funnel already treat as canonical) so every screen agrees with
// itself, and callers can still show the notes-derived filing type as a
// clearly-labeled secondary "Filing:" line rather than a competing header.
export function getPrimaryDistressLabel(lead) {
  const opp = getOpportunityInfo(lead)
  if (opp?.distress_category_label) return opp.distress_category_label
  const info = getDistressInfo(lead)
  if (info?.distress_type) return fmtDistressType(info.distress_type)
  return null
}

export function fmtBuyBoxFit(fit) {
  switch (fit) {
    case 'FIT': return 'Fit'
    case 'POSSIBLE_FIT': return 'Possible Fit'
    case 'NOT_FIT': return 'Not Fit'
    default: return 'Insufficient Data'
  }
}

export function fmtFilingDate(iso) {
  if (!iso) return null
  const d = new Date(iso + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
