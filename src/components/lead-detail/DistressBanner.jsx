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
//
// Visual QA fix pass (Lead Essentials V1, Part 4/5) — CONTACT DUPLICATION
// REMOVED. Owner Contact / Contact Intelligence / NO SAFE MATCH / Enrich
// Contact all now live exclusively in LeadEssentialsBar.jsx (Level 1,
// visible on every tab) — showing them here too meant the same contact
// state appeared twice on one screen. This card now focuses on what's
// UNIQUE to distress/opportunity intelligence: distress type, filing
// date, owner identity, owner-match verification, source, property fit,
// opportunity score/priority, and next action — "why this lead matters,"
// not a repeat of the lead record.
//
// Final UX polish pass, Part 2/3 — Next Action is now CLICKABLE when the
// existing workflow already has a safe executable action for it (only
// 'Retry Contact'/'Enrich Contact' — both trigger onRequestEnrich, the
// SAME confirm-modal + runContactEnrichmentBatch() LeadEssentialsBar
// uses, lifted to LeadDetailPage so there is exactly one execution path).
// Every other Next Action stays informational — no invented behavior.
// Also compacted (~25% shorter): tighter padding, merged rows.

import { useState } from 'react'
import {
  getDistressInfo, getWhyHereReasons, getNextAction, getOpportunityInfo, fmtBuyBoxFit,
  fmtOwnerMatch, fmtAbsentee, fmtDistressType, fmtDistressSource, fmtParcel, fmtFilingDate,
  fmtLienAmount, fmtLienStatus,
} from '../../lib/distressInfo'
import InfoTooltip from '../ui/InfoTooltip'

const ACTIONABLE_NEXT_ACTIONS = new Set(['Retry Contact', 'Enrich Contact'])

// UX V2.5, Part 7 — the deferred V2.4 progressive-disclosure redesign,
// implemented now. This card previously rendered ALL of its detail
// (filing date, parcel, case/instrument, source, absentee, raw
// verification list, opportunity score breakdown) expanded by default,
// visually competing with DecisionHero's Acquisition Decision directly
// above it. Default state is now a compact collapsed summary; every fact
// below is still shown, just behind "View Distress Details" — same data
// source (getDistressInfo/getOpportunityInfo), zero new fields, zero new
// scoring. NO DATA REMOVED.
export default function DistressBanner({ lead, onRequestEnrich }) {
  const [expanded, setExpanded] = useState(false)
  if (!lead) return null
  const info = getDistressInfo(lead)
  const opp = getOpportunityInfo(lead)
  if (!info) return null

  const owner = lead.owner_name || info.current_owner
  const whyHere = getWhyHereReasons(lead, info)
  const nextAction = getNextAction(lead, info)
  const parcel = fmtParcel(info.parcel_id || lead.enrichment_data?.parcel_id)
  const isActionable = ACTIONABLE_NEXT_ACTIONS.has(nextAction) && !!onRequestEnrich
  const ownerVerified = info.owner_match_status === 'verified' || info.owner_match_status === 'confirmed'

  return (
    <div className="rounded-lg border border-amber-300/70 bg-amber-50 dark:bg-amber-950/25 dark:border-amber-800/70 overflow-hidden">
      {/* Collapsed summary — always visible, compact. */}
      <div className="px-3.5 py-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11.5px] font-bold text-amber-800 dark:text-amber-300">SELLER OPPORTUNITY</div>
          <div className="text-[10.5px] text-amber-700/80 dark:text-amber-400/80 truncate">
            {fmtDistressType(info.distress_type)}
            {ownerVerified && <> · Owner verified</>}
            {opp?.buy_box_fit && <> · {fmtBuyBoxFit(opp.buy_box_fit)}</>}
            {opp && <> · Priority {opp.opportunity_score}/100 · {opp.opportunity_priority?.label}</>}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {nextAction && (
            isActionable ? (
              <button onClick={onRequestEnrich} className="text-[12px] font-bold text-amber-800 dark:text-amber-300 hover:underline">
                {nextAction} →
              </button>
            ) : (
              <span className="text-[12px] font-bold text-amber-800 dark:text-amber-300">{nextAction}</span>
            )
          )}
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="text-[10.5px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400 hover:underline"
          >
            {expanded ? 'Hide Details' : 'View Distress Details'}
          </button>
        </div>
      </div>

      {!expanded ? null : (
        <>
          {/* Fact grid */}
          <div className="px-3.5 py-2 border-t border-amber-300/50 dark:border-amber-800/50 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-[12px]">
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
            <div className="px-3.5 py-2 border-t border-amber-300/40 dark:border-amber-800/40 grid grid-cols-3 gap-3">
              <Fact label="Distress Type" value={opp.distress_category_label} />
              <Fact label="Property Fit" value={fmtBuyBoxFit(opp.buy_box_fit)} />
              <div>
                {/* Explainability V1, Part 10 — labeled distinctly from ACT
                    NOW's "Opportunity" (a different score, decisionEngineV2.js)
                    so the two never look contradictory. Same real
                    opportunity_why/opportunity_missing (computeOpportunityScore,
                    distressScoring.js) already computed for this lead —
                    nothing new derived. */}
                <div className="text-[9.5px] uppercase tracking-widest text-amber-700/70 dark:text-amber-400/70 font-semibold inline-flex items-center">
                  Off-Market Priority Score
                  <InfoTooltip
                    title="Off-Market Priority Score"
                    definition="How strongly this sourced off-market lead deserves acquisition attention — based on distress signal quality, property fit, owner verification, and available lead signals. Scale (this scoring function's real thresholds): 80–100 High Priority · 60–79 Review · 40–59 Research · below 40 Low Priority."
                    thisLead={`${opp.opportunity_score}/100 — ${opp.opportunity_priority?.label}`}
                    reasons={opp.opportunity_why}
                    missing={opp.opportunity_missing}
                    note="Different from ACT NOW's Opportunity score below: Priority ranks sourced leads for review; Opportunity evaluates the acquisition once you're looking at it. Two real, separate scores — not a contradiction."
                  />
                </div>
                <div className="text-amber-900 dark:text-amber-200 font-bold text-[12.5px]">
                  {opp.opportunity_score}/100 — {opp.opportunity_priority?.label}
                </div>
              </div>
            </div>
          )}

          {/* Why / Missing — Capability #10.2's evidence-based reasons take over
              from #10.1's simpler "why here" list once a lead has been scored,
              so nothing is shown twice. */}
          {opp ? (
            <div className="px-3.5 pb-2 pt-1 border-t border-amber-300/40 dark:border-amber-800/40 space-y-1">
              {opp.opportunity_why.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {opp.opportunity_why.map(reason => (
                    <span key={reason} className="text-[11.5px] text-amber-800 dark:text-amber-300">✓ {reason}</span>
                  ))}
                </div>
              )}
              {opp.opportunity_missing.length > 0 && (
                <div className="text-[10.5px] text-amber-700/80 dark:text-amber-400/80">
                  <span className="font-semibold uppercase tracking-wide text-[9px] mr-1">Missing:</span>
                  {opp.opportunity_missing.join(' • ')}
                </div>
              )}
            </div>
          ) : whyHere.length > 0 && (
            <div className="px-3.5 pb-2 pt-1 border-t border-amber-300/40 dark:border-amber-800/40">
              <div className="text-[9px] uppercase tracking-widest text-amber-700/70 dark:text-amber-400/70 font-semibold mb-0.5">
                Why This Property Is Here
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {whyHere.map(reason => (
                  <span key={reason} className="text-[11.5px] text-amber-800 dark:text-amber-300">✓ {reason}</span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Fact({ label, value }) {
  if (!value) return null
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-widest text-amber-700/70 dark:text-amber-400/70 font-semibold">{label}</div>
      <div className="text-amber-900 dark:text-amber-200 font-medium truncate text-[12px]" title={String(value)}>{value}</div>
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
