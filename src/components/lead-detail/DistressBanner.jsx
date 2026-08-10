// src/components/lead-detail/DistressBanner.jsx
// Capability #10 (initial) / #10.1 (UX polish) — Real Distressed Leads Pilot.
//
// Structured "⚠ OFF-MARKET OPPORTUNITY" card: within 5 seconds Kevin should
// see why the property is here, the distress signal, owner, absentee
// status, filing date, and a conservative next action — no fabricated
// financials. Reads through getDistressInfo() (src/lib/distressInfo.js),
// which prefers structured `distress_data` and falls back to parsing the
// pilot's own fixed-format notes block when the #10 migration hasn't been
// applied yet — same information either way, this component doesn't care
// which path supplied it.

import {
  getDistressInfo, getWhyHereReasons, getNextAction,
  fmtOwnerMatch, fmtAbsentee, fmtDistressType, fmtDistressSource, fmtParcel, fmtFilingDate,
} from '../../lib/distressInfo'

export default function DistressBanner({ lead }) {
  if (!lead) return null
  const info = getDistressInfo(lead)
  if (!info) return null

  const owner = lead.owner_name || info.current_owner
  const whyHere = getWhyHereReasons(lead, info)
  const nextAction = getNextAction(lead, info)
  const parcel = fmtParcel(info.parcel_id || lead.enrichment_data?.parcel_id)

  return (
    <div className="rounded-lg border border-amber-300/70 bg-amber-50 dark:bg-amber-950/25 dark:border-amber-800/70 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-amber-300/50 dark:border-amber-800/50 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[13px] font-bold text-amber-800 dark:text-amber-300">⚠ OFF-MARKET OPPORTUNITY</div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700/80 dark:text-amber-400/80">
            {fmtDistressType(info.distress_type)}
          </div>
        </div>
        {nextAction && (
          <div className="text-right shrink-0">
            <div className="text-[9px] uppercase tracking-widest text-amber-700/70 dark:text-amber-400/70 font-semibold">Next Action</div>
            <div className="text-[13px] font-bold text-amber-800 dark:text-amber-300">{nextAction}</div>
          </div>
        )}
      </div>

      {/* Fact grid */}
      <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-[12.5px]">
        <Fact label="Filed" value={fmtFilingDate(info.distress_filing_date)} />
        <Fact label="Owner" value={owner} />
        <Fact label="Owner Match" value={info.owner_match_status ? fmtOwnerMatch(info.owner_match_status) : null} />
        <Fact label="Absentee Owner" value={fmtAbsentee(info.absentee_owner)} />
        <Fact label="Parcel" value={parcel} />
        <Fact label="Source" value={fmtDistressSource(info.distress_source)} />
        {info.distress_case_or_instrument && (
          <Fact label="Case / Instrument" value={info.distress_case_or_instrument} />
        )}
      </div>

      {/* Why this property is here */}
      {whyHere.length > 0 && (
        <div className="px-4 pb-3 pt-1 border-t border-amber-300/40 dark:border-amber-800/40">
          <div className="text-[9.5px] uppercase tracking-widest text-amber-700/70 dark:text-amber-400/70 font-semibold mb-1">
            Why This Property Is Here
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {whyHere.map(reason => (
              <span key={reason} className="text-[12px] text-amber-800 dark:text-amber-300">✓ {reason}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Fact({ label, value }) {
  if (!value) return null
  return (
    <div className="min-w-0">
      <div className="text-[9.5px] uppercase tracking-widest text-amber-700/70 dark:text-amber-400/70 font-semibold">{label}</div>
      <div className="text-amber-900 dark:text-amber-200 font-medium truncate" title={String(value)}>{value}</div>
    </div>
  )
}

// Small badge for Inbox/Leads/Action Center cards.
export function DistressBadge({ lead }) {
  const info = getDistressInfo(lead)
  if (!info) return null
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
      ⚠ Off Market
    </span>
  )
}

export function PreForeclosureBadge({ lead }) {
  const info = getDistressInfo(lead)
  if (info?.distress_type !== 'lis_pendens') return null
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
      Pre-Foreclosure
    </span>
  )
}
