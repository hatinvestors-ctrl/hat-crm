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

const NOTES_MARKER = '⚠ DISTRESSED OPPORTUNITY'

function parseNotesBlock(notes) {
  if (typeof notes !== 'string' || !notes.startsWith(NOTES_MARKER)) return null
  const lines = notes.split('\n')
  const get = (label) => {
    const line = lines.find(l => l.startsWith(label + ':'))
    return line ? line.slice(label.length + 1).trim() : null
  }
  const signalLine = lines[0] || ''
  const distressType = signalLine.toLowerCase().includes('lis pendens') ? 'lis_pendens' : null

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
  return 'Distress Signal'
}

export function fmtDistressSource(source) {
  if (source === 'duval_clerk' || source === 'lispendens_duval_clerk') return 'Duval County Public Records'
  return source || 'Public Record'
}

// ── Section 3: "Why This Property Is Here" — derived only from real fields ──
export function getWhyHereReasons(lead, info) {
  const reasons = []
  if (info?.distress_type === 'lis_pendens') reasons.push('Lis Pendens filed')
  if (lead?.owner_name || info?.current_owner) reasons.push('Property successfully identified')
  if (lead?.owner_name) reasons.push('Current owner identified')
  if (info?.absentee_owner === true) reasons.push('Absentee owner')
  return reasons.slice(0, 4)
}

// ── Section 4: Next Action — conservative, no outreach ever recommended ──
export function getNextAction(lead, info) {
  if (!lead?.owner_name) return 'Verify Property'
  if (info?.owner_match_status && info.owner_match_status !== 'MATCH') return 'Verify Owner'
  return 'Research Owner'
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
  return {
    distress_category: e.distress_category,
    distress_category_label: DISTRESS_CATEGORY_LABELS[e.distress_category] || e.distress_category,
    distress_category_confidence: e.distress_category_confidence,
    buy_box_fit: e.buy_box_fit,
    opportunity_score: e.opportunity_score,
    opportunity_priority: e.opportunity_priority,
    opportunity_why: e.opportunity_why || [],
    opportunity_missing: e.opportunity_missing || [],
    excluded: e.excluded,
    excluded_reason: e.excluded_reason,
  }
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
