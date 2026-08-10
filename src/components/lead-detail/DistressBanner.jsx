// src/components/lead-detail/DistressBanner.jsx
// Capability #10 — Real Distressed Leads Pilot (Duval Lis Pendens V1).
//
// Minimal, additive UI: renders only when a lead's notes begin with the
// marker the pilot pipeline (scripts/lispendens-pilot.mjs) writes. Reads
// straight from the existing `notes` column — no dependency on the new
// leads.distress_data/is_distressed columns, so this works even before
// that migration is applied. If those columns are present and populated,
// they're used instead (cleaner structured render); notes is always the
// fallback so nothing breaks either way.
//
// Deliberately does NOT show MAO / Starting Offer / Expected Profit — see
// mission Section 7: off-market discovery has no asking price/ARV/reno
// estimate to base those on, and fabricating them would mislead Kevin.

const MARKER = '⚠ DISTRESSED OPPORTUNITY'

export default function DistressBanner({ lead }) {
  if (!lead) return null

  const structured = lead.distress_data
  const fromNotes = !structured && typeof lead.notes === 'string' && lead.notes.startsWith(MARKER)
  if (!structured && !fromNotes) return null

  // Structured path (once the migration is applied and future distress
  // sources populate distress_data directly).
  if (structured) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4 space-y-1.5 text-sm">
        <div className="font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
          <span>⚠</span> DISTRESSED OPPORTUNITY
        </div>
        <Row label="Signal" value={structured.distress_type === 'lis_pendens' ? 'Lis Pendens / Pre-Foreclosure' : structured.distress_type} />
        <Row label="Filed" value={structured.distress_filing_date} />
        <Row label="Owner" value={structured.current_owner || lead.owner_name} />
        <Row label="Source Party" value={structured.source_party} />
        <Row label="Owner Match" value={structured.owner_match_status} />
        <Row label="Absentee Owner" value={fmtBool(structured.absentee_owner)} />
        <Row label="Parcel" value={lead.enrichment_data?.parcel_id} />
        <Row label="Source" value="Duval County Public Record" />
        <Row label="Case / Instrument" value={structured.distress_case_or_instrument} />
        <div className="pt-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
          Recommended Next Step: {structured.owner_match_status === 'MATCH' ? 'REVIEW OPPORTUNITY' : 'RESEARCH OWNER'}
        </div>
      </div>
    )
  }

  // Fallback: raw notes block the pilot wrote — same information, less
  // structured, but shows the moment a lead exists, no migration required.
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4 text-sm whitespace-pre-line text-amber-800 dark:text-amber-300">
      {lead.notes}
    </div>
  )
}

function Row({ label, value }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex gap-2">
      <span className="text-amber-700/70 dark:text-amber-400/70 shrink-0">{label}:</span>
      <span className="text-amber-900 dark:text-amber-200 font-medium">{String(value)}</span>
    </div>
  )
}

function fmtBool(v) {
  if (v === true) return 'Yes'
  if (v === false) return 'No'
  return 'Unknown'
}

// Small badge for Action Center / lead cards — exported separately so card
// components can opt in without pulling in the full banner.
export function DistressBadge({ lead }) {
  if (!lead) return null
  const isDistressed = lead.is_distressed || (typeof lead.notes === 'string' && lead.notes.startsWith(MARKER))
  if (!isDistressed) return null
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
      ⚠ Off Market
    </span>
  )
}
