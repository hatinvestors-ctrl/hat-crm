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
  getDistressInfo, getWhyHereReasons, getNextAction, getOpportunityInfo, fmtBuyBoxFit,
  fmtOwnerMatch, fmtAbsentee, fmtDistressType, fmtDistressSource, fmtParcel, fmtFilingDate,
  fmtLienAmount, fmtLienStatus,
} from '../../lib/distressInfo'
import { fmtContactMatch } from '../../lib/contactEnrichment'

export default function DistressBanner({ lead }) {
  if (!lead) return null
  const info = getDistressInfo(lead)
  const opp = getOpportunityInfo(lead)
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
        {/* Capability #14 — recorded lien only; both are no-ops (Fact
            returns null) for every other distress type. */}
        {info.distress_type === 'recorded_lien' && (
          <>
            <Fact label="Amount" value={fmtLienAmount(info.lien_amount)} />
            <Fact label="Status" value={fmtLienStatus(info.lien_status)} />
          </>
        )}
      </div>

      {/* Capability #10.2 — Distress Type / Property Fit / Opportunity Score,
          only once the pilot quality review has actually scored this lead
          (opp is null for anything not yet reprocessed — degrades cleanly
          to the #10.1 layout below). */}
      {opp && (
        <div className="px-4 py-2.5 border-t border-amber-300/40 dark:border-amber-800/40 grid grid-cols-3 gap-3">
          <Fact label="Distress Type" value={opp.distress_category_label} />
          <Fact label="Property Fit" value={fmtBuyBoxFit(opp.buy_box_fit)} />
          <div>
            <div className="text-[9.5px] uppercase tracking-widest text-amber-700/70 dark:text-amber-400/70 font-semibold">Opportunity</div>
            <div className="text-amber-900 dark:text-amber-200 font-bold">
              {opp.opportunity_score}/100 — {opp.opportunity_priority?.label}
            </div>
          </div>
        </div>
      )}

      {/* Why / Missing — Capability #10.2's evidence-based reasons take over
          from #10.1's simpler "why here" list once a lead has been scored,
          so nothing is shown twice. */}
      {opp ? (
        <div className="px-4 pb-3 pt-1 border-t border-amber-300/40 dark:border-amber-800/40 space-y-1.5">
          {opp.opportunity_why.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {opp.opportunity_why.map(reason => (
                <span key={reason} className="text-[12px] text-amber-800 dark:text-amber-300">✓ {reason}</span>
              ))}
            </div>
          )}
          {opp.opportunity_missing.length > 0 && (
            <div className="text-[11px] text-amber-700/80 dark:text-amber-400/80">
              <span className="font-semibold uppercase tracking-wide text-[9.5px] mr-1">Missing:</span>
              {opp.opportunity_missing.join(' • ')}
            </div>
          )}
        </div>
      ) : whyHere.length > 0 && (
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

      {/* Capability #10.3 — Owner Contact. Never invented: shows real
          phone/email only when a legitimate source actually returned one
          (leads.phone/leads.email — the same existing columns every other
          lead type already uses, reused rather than a new contact table).
          "Not found yet" is the honest, expected state today — no paid
          skip-trace provider is connected (see delivery report). */}
      <div className="px-4 py-2.5 border-t border-amber-300/40 dark:border-amber-800/40">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[9.5px] uppercase tracking-widest text-amber-700/70 dark:text-amber-400/70 font-semibold">
            Owner Contact
          </div>
          {/* Capability #10.5 — compact, honest status. Never shows a raw
              HTTP/provider error to Kevin (mission Section 15). */}
          {lead.enrichment_data?.contact_ui_status === 'ENRICHMENT TEMPORARILY UNAVAILABLE' && (
            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]">
              Enrichment Temporarily Unavailable
            </span>
          )}
          {lead.enrichment_data?.contact_ui_status === 'MATCH NEEDS REVIEW' && (
            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
              Match Needs Review
            </span>
          )}
        </div>
        {(lead.phone || lead.email) ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[12.5px]">
            <Fact label="Phone" value={lead.phone} />
            <Fact label="Email" value={lead.email} />
            <Fact label="Contact Match" value={fmtContactMatch(lead.enrichment_data?.contact_match_status)} />
            <Fact label="Contact Source" value={lead.enrichment_data?.contact_source} />
            {/* Capability #10.4 — DNC preserved for visibility only; never
                used anywhere to decide or gate outreach (no outreach exists
                in this codebase at all). */}
            {lead.enrichment_data?.contact_dnc != null && (
              <Fact label="DNC" value={lead.enrichment_data.contact_dnc ? 'Yes — Do Not Call' : 'No'} />
            )}
          </div>
        ) : (
          <div className="text-[12px] text-amber-700/70 dark:text-amber-400/70 italic">Not found yet</div>
        )}
      </div>
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
