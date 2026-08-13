// src/pages/ActionCenterPage.jsx
// Capability #5, Cycle 2 — HAT Action Center (MVP).
//
// Answers "what should I work on first today?" automatically, by reading
// data every earlier capability already computed — nothing new is
// calculated here:
//   - derivePriority() (Capability #1/#2, src/lib/leadPriority.js) — Decision,
//     Next Action, Expected Profit, Maximum Offer, Reason
//   - properties.last_rediscovery_status/reason (Capability #3/#4,
//     src/lib/propertyIntelligence.js) — Rediscovered / Improved flags
//   - lead.status (existing field) — Follow Up bucket
// No AI call, no new scoring, no new database table.

import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import Topbar from '../components/Topbar'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import EmptyState from '../components/ui/EmptyState'
import { supabase } from '../lib/supabase'
import { formatCurrency } from '../lib/calculations'
import { applyLeadVisibility } from '../lib/leadVisibility'
import { TERMINAL_STATUSES, STATUS_MAP } from '../lib/constants'
import { derivePriority, PRIORITY_DISPLAY, PRIORITY_THEME } from '../lib/leadPriority'
import { isDistressedLead, getDistressInfo, getNextAction, fmtDistressType, getOpportunityInfo } from '../lib/distressInfo'
import { isContactReady } from '../lib/contactEnrichment'
import { isV2ActionCenter } from '../lib/featureFlags'
import { classifyFollowUpDate, daysOverdue } from '../lib/followUpTiming'
import LogOutcomeModal from '../components/action-center/LogOutcomeModal'

// Capability #17 — order matches the mission's explicit Today-queue
// priority (Section 3): OVERDUE, RE-ENGAGE, ACT NOW, FOLLOW UP TODAY,
// REVIEW TODAY, RESEARCH/VERIFY. UPCOMING is deliberately NOT in this map
// — it never renders as a Today section; it's reachable only via the
// "Upcoming" quick filter (Section 2/10), so it can never clutter Today.
const CATEGORY_META = {
  OVERDUE:           { icon: '⏰', label: 'Overdue',             theme: { bg: 'var(--color-danger-soft)', border: 'var(--color-danger)', text: 'var(--color-danger-text)' } },
  RE_ENGAGE:         { icon: '🔥', label: 'Re-Engage',           theme: { bg: 'var(--color-danger-soft)', border: 'var(--color-danger)', text: 'var(--color-danger-text)' } },
  ACT_NOW:           { icon: '🔥', label: 'Act Now',            theme: PRIORITY_THEME.HOT },
  FOLLOW_UP_TODAY:   { icon: '🟡', label: 'Follow Up Today',    theme: { bg: 'var(--color-accent-soft)', border: 'var(--color-accent)', text: 'var(--color-accent-text)' } },
  REVIEW_TODAY:      { icon: '🟠', label: 'Review Today',       theme: PRIORITY_THEME.TODAY },
  RECENTLY_IMPROVED: { icon: '⚪', label: 'Recently Improved',  theme: PRIORITY_THEME.WATCH },
  // Capability #10.1 — own bucket, deliberately NOT folded into ACT_NOW.
  // A Lis Pendens filing alone never overrides the existing priority
  // engine; this only catches leads that engine has no opinion on yet
  // (no AI analysis run — true for every off-market lead today).
  OFF_MARKET:        { icon: '⚠', label: 'Off-Market',          theme: { bg: 'rgba(217,119,6,0.12)', border: 'rgb(217,119,6)', text: 'rgb(180,95,6)' } },
}

// #5.1 — Quick filters. Client-side only, filters the already-loaded
// `items` array — no new query, no backend change. FLIP/BRRRR reuse the
// existing deal_analysis.strategy field; ACT_NOW/REVIEW_TODAY just narrow
// to that one category (Follow Up / Recently Improved stay reachable via
// "All").
const QUICK_FILTERS = [
  { key: 'ALL', label: 'Today' },
  { key: 'OVERDUE', label: 'Overdue' },
  { key: 'RE_ENGAGE', label: 'Re-Engage' },
  { key: 'UPCOMING', label: 'Upcoming' }, // Capability #17 — the ONLY place future follow-ups are reachable; never a Today section.
  { key: 'FLIP', label: 'Flip' },
  { key: 'BRRRR', label: 'BRRRR' },
  { key: 'ACT_NOW', label: 'Act Now' },
  { key: 'REVIEW_TODAY', label: 'Review Today' },
  { key: 'OFF_MARKET', label: '⚠ Off-Market' },
]

// Statuses that mean "waiting on someone else to respond" — the existing
// lead.status values that match the mission's own Follow Up examples
// (waiting on agent / waiting on seller). Reuses LEAD_STATUSES values
// as-is (src/lib/constants.js) — no new status invented. Grouped into
// distinct sub-sections within Follow Up so different waiting reasons
// aren't dumped into one undifferentiated pile.
const FOLLOW_UP_STATUSES = ['follow_up', 'offer_sent', 'negotiating', 'offer_pending_hat_signing', 'offer_signed']

function isToday(isoString) {
  if (!isoString) return false
  return new Date(isoString).toDateString() === new Date().toDateString()
}

// Reuses derivePriority + rediscovery status already persisted per lead —
// no recalculation. Classifies each lead into exactly one bucket (or none,
// if it isn't actionable), per the priority order in the spec.
function classifyLead(lead, rediscovery) {
  const priorityInfo = derivePriority(lead.ai_notes)
  const isFollowUpStatus = FOLLOW_UP_STATUSES.includes(lead.status)
  const distressed = isDistressedLead(lead)
  if (!priorityInfo && !rediscovery && !isFollowUpStatus && !distressed) return null

  const priceImproved = rediscovery?.status === 'IMPROVED' && /price dropped/i.test(rediscovery.reason || '')

  let category = null
  if (priorityInfo?.priority === 'HOT' || rediscovery?.status === 'REVIEW AGAIN' || priceImproved) {
    category = 'ACT_NOW'
  } else if (priorityInfo?.priority === 'TODAY') {
    category = 'REVIEW_TODAY'
  } else if (isFollowUpStatus) {
    // A status change that happened today means Kevin just acted on it
    // (e.g. sent an offer moments ago) — give it a day before nagging him
    // to follow up on his own same-day action. Reuses updated_at, the
    // existing timestamp that changes when status changes; no new field.
    if (isToday(lead.updated_at)) return null
    // Capability #17 — V1 fallback gets the same Today/Overdue/Upcoming
    // split as V2 (Section 2), just without V2's Re-Engage signal (V1 has
    // no urgency concept to reuse). UPCOMING is intentionally excluded
    // from the Today queue by never being in CATEGORY_META.
    const due = classifyFollowUpDate(lead.follow_up_date)
    category = due === 'OVERDUE' ? 'OVERDUE' : due === 'TODAY' ? 'FOLLOW_UP_TODAY' : 'UPCOMING'
  } else if (rediscovery?.status === 'IMPROVED') {
    category = 'RECENTLY_IMPROVED'
  } else if (distressed) {
    // Capability #10.1 — conservative catch-all: a distressed lead the
    // existing priority engine has no opinion on (no AI analysis run yet,
    // true for every off-market lead today) still deserves to be visible,
    // but never as ACT_NOW just because a filing exists.
    category = 'OFF_MARKET'
  }
  if (!category) return null

  const distressInfo = distressed ? getDistressInfo(lead) : null
  // Capability #10.2 — once a lead has been through the pilot quality
  // review (scripts/cap10_2_reprocess.mjs), prefer its evidence-based
  // decision label over the plain distress-type fallback; a lead not yet
  // reprocessed still shows the #10.1 fallback exactly as before.
  const opportunity = distressed ? getOpportunityInfo(lead) : null
  const decision = priorityInfo ? (PRIORITY_DISPLAY[priorityInfo.priority] || priorityInfo.priority)
    : (category === 'OFF_MARKET' ? (opportunity?.opportunity_priority?.label || fmtDistressType(distressInfo?.distress_type)) : null)
  const nextAction = priorityInfo?.nextAction || (isFollowUpStatus ? 'FOLLOW UP' : null)
    || (category === 'OFF_MARKET' ? getNextAction(lead, distressInfo) : null)
  const reason = rediscovery?.reason || priorityInfo?.reasons?.[0] || null

  return {
    category,
    lead,
    decision,
    nextAction,
    distressed,
    opportunity,
    // Never fabricated for an off-market lead — both stay null unless the
    // existing engine already computed them (e.g. Kevin later ran an
    // analysis on it), per the mission's explicit instruction.
    expectedProfit: lead.deal_analysis?.profit ?? null,
    maxOffer: lead.mao ?? null,
    reason,
    score: priorityInfo?.confidence ?? null,
    rediscoveredAt: rediscovery?.updatedAt || null,
    // Which specific status put this in Follow Up — used to render
    // sub-sections (Offer Sent / Negotiating / etc.) instead of one pile.
    followUpStatus: category === 'FOLLOW_UP' ? lead.status : null,
    // #5.1 quick filters — existing field, passed through as-is, not recalculated.
    strategy: lead.deal_analysis?.strategy ?? null,
  }
}

// Capability #15.5.1 closure — V2 read path. Produces the EXACT SAME item
// shape classifyLead() does (same field names) so every render/sort
// function below works completely unchanged — this is a read-source swap
// only, never a UI change. On-market and off-market both read
// lead.decision_v2 and land in the SAME buckets (Section: "source should
// not control priority") — the old OFF_MARKET-only bucket is retired
// under V2; a distressed lead with a strong decision now competes for
// ACT_NOW/REVIEW_TODAY/FOLLOW_UP exactly like an on-market one.
//
// MONITOR and PASS recommendations (including an active Human Override,
// which always resolves to PASS) are excluded from the active worklist
// entirely — consistent with V1's own behavior today (a WATCH-tier lead
// isn't shown as any bucket either). No stored decision yet (migration
// just applied, historical leads haven't been touched) falls back to null
// — never invents a decision.
const V2_RECOMMENDATION_TO_CATEGORY = {
  ACT_NOW: 'ACT_NOW',
  REVIEW_TODAY: 'REVIEW_TODAY',
  RESEARCH: 'REVIEW_TODAY', // folded in — no new bucket/UI section added
  FOLLOW_UP: 'FOLLOW_UP',
}
const NEXT_ACTION_LABELS = {
  SEND_OFFER: 'Send Offer', CALL_AGENT: 'Call Agent', CONTACT_OWNER: 'Contact Owner',
  VERIFY_ARV: 'Verify ARV', VERIFY_CONDITION: 'Verify Condition', RESEARCH_OWNER: 'Research Owner',
  VERIFY_OWNER: 'Verify Owner', FOLLOW_UP: 'Follow Up', WAIT_FOR_PRICE_DROP: 'Wait for Price Drop',
  MONITOR_PROPERTY: 'Monitor Property', VERIFY_FLOOD_RISK: 'Verify Flood Risk', VERIFY_TITLE: 'Verify Title',
  HUMAN_OVERRIDE: 'Human Override — Do Not Pursue', PASS: 'Pass',
}

function classifyLeadV2(lead) {
  const d = lead.decision_v2
  if (!d) return null
  const isFollowUpStatus = FOLLOW_UP_STATUSES.includes(lead.status)

  // Capability #17, Section 7 — RE-ENGAGE. Reuses V2's EXISTING urgency
  // signal (computeUrgency() in decisionEngineV2.js already detects a
  // real price reduction or a fresh distress filing — see that file) —
  // no new event-diff system, no change to V2 Opportunity. A follow-up-
  // status lead with genuine new timing evidence returns to Today
  // regardless of its scheduled follow_up_date. dead_lead and an active
  // Human Override are excluded so a timer/signal can never silently
  // resurrect either (Section 8) — dead_lead already can't reach here
  // (FOLLOW_UP_STATUSES doesn't include it), and Human Override always
  // forces recommendation=PASS upstream, so it never reaches this
  // function with a FOLLOW_UP-shaped decision in the first place; the
  // explicit checks below are defense-in-depth, not the only guardrail.
  // "Follow-up overdue" is computeUrgency()'s own HIGH-urgency reason for a
  // lead whose follow_up_date already passed (decisionEngineV2.js:360) — it
  // is NOT a new external event, it's the same information the OVERDUE
  // bucket already surfaces. Re-engagement (Section 7) means something
  // changed BEFORE the scheduled follow-up; excluding this reason keeps
  // RE_ENGAGE limited to genuine signals (price reduction, fresh distress
  // filing) and prevents every merely-overdue lead from double-counting as
  // both OVERDUE and RE_ENGAGE.
  const hasGenuineReEngageSignal = d.urgency?.level === 'HIGH' && (d.urgency?.reasons || []).some(r => r !== 'Follow-up overdue')
  if (isFollowUpStatus && hasGenuineReEngageSignal && d.next_best_action !== 'HUMAN_OVERRIDE' && lead.status !== 'dead_lead') {
    const reason = d.urgency?.reasons?.find(r => r !== 'Follow-up overdue') || d.why?.[0] || 'New timing signal detected'
    return {
      category: 'RE_ENGAGE',
      lead,
      decision: 'RE-ENGAGE',
      nextAction: NEXT_ACTION_LABELS[d.next_best_action] || d.next_best_action || null,
      distressed: false,
      opportunity: null,
      expectedProfit: lead.deal_analysis?.profit ?? null,
      maxOffer: lead.mao ?? null,
      reason, // always visible on the card — Section 7's explicit requirement
      score: d.opportunity?.score ?? null,
      rediscoveredAt: null,
      followUpStatus: lead.status,
      strategy: d.strategy ?? lead.deal_analysis?.strategy ?? null,
    }
  }

  const baseCategory = V2_RECOMMENDATION_TO_CATEGORY[d.recommendation]
  if (!baseCategory) return null // MONITOR / PASS / Human Override — not an active task

  // Capability #17, Section 2 — Today/Overdue/Upcoming split, replacing
  // the single undifferentiated FOLLOW_UP bucket every prior capability
  // used. This is the actual fix for "all follow_up leads appear
  // together today" (see audit in the delivery report).
  let category = baseCategory
  if (baseCategory === 'FOLLOW_UP') {
    const due = classifyFollowUpDate(lead.follow_up_date)
    category = due === 'OVERDUE' ? 'OVERDUE' : due === 'TODAY' ? 'FOLLOW_UP_TODAY' : 'UPCOMING'
  }

  return {
    category,
    lead,
    decision: d.recommendation.replace(/_/g, ' '),
    nextAction: NEXT_ACTION_LABELS[d.next_best_action] || d.next_best_action || null,
    distressed: false, // always renders the generic (non-OFF_MARKET) card layout — see ActionCard
    opportunity: null,
    expectedProfit: lead.deal_analysis?.profit ?? null,
    maxOffer: lead.mao ?? null,
    reason: d.why?.[0] || null,
    score: d.opportunity?.score ?? null,
    rediscoveredAt: null,
    followUpStatus: baseCategory === 'FOLLOW_UP' ? lead.status : null,
    strategy: d.strategy ?? lead.deal_analysis?.strategy ?? null,
  }
}

function sortCategory(category, items) {
  switch (category) {
    case 'ACT_NOW':
      return [...items].sort((a, b) => {
        const profitDiff = (b.expectedProfit ?? -Infinity) - (a.expectedProfit ?? -Infinity)
        if (profitDiff !== 0) return profitDiff
        return (b.rediscoveredAt ? new Date(b.rediscoveredAt).getTime() : 0) - (a.rediscoveredAt ? new Date(a.rediscoveredAt).getTime() : 0)
      })
    case 'REVIEW_TODAY':
      return [...items].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
    case 'RECENTLY_IMPROVED':
      return [...items].sort((a, b) => (b.rediscoveredAt ? new Date(b.rediscoveredAt).getTime() : 0) - (a.rediscoveredAt ? new Date(a.rediscoveredAt).getTime() : 0))
    case 'FOLLOW_UP':
    case 'FOLLOW_UP_TODAY':
    case 'UPCOMING':
      return [...items].sort((a, b) => {
        const ad = a.lead.follow_up_date, bd = b.lead.follow_up_date
        if (!ad && !bd) return 0
        if (!ad) return 1
        if (!bd) return -1
        return ad.localeCompare(bd)
      })
    case 'OVERDUE':
      // Longest-overdue first — the ones most likely to be forgotten.
      return [...items].sort((a, b) => {
        const ad = a.lead.follow_up_date, bd = b.lead.follow_up_date
        if (!ad || !bd) return 0
        return ad.localeCompare(bd)
      })
    case 'RE_ENGAGE':
      return [...items].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
    default:
      return items
  }
}

const NA = 'Not available' // #5.1 — replaces bare "—" so missing data reads as intentional, not broken

// #5.1 — Card hierarchy top to bottom: Address → Next Action → Expected
// Profit (emphasized — Kevin's primary decision metric) → Maximum Offer →
// Reason (clamped ~2 lines + "More…", opens the same lead — no new modal,
// the whole card is already a Link). No fields added or removed, no
// classification/business-logic change — presentation only.
function ActionCard({ item, workspaceId, userId, members, onLeadUpdated }) {
  const theme = CATEGORY_META[item.category].theme
  const [showOutcome, setShowOutcome] = useState(false)
  return (
    <Link
      to={`/w/${workspaceId}/leads/${item.lead.id}`}
      className="block rounded-lg border overflow-hidden hover:opacity-90 transition-opacity relative"
      style={{ borderColor: theme.border, background: theme.bg }}
    >
      <div className="px-3.5 py-3">
        {/* 1. Address */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[14px] font-bold text-[color:var(--color-text)] truncate">{item.lead.address}</div>
            {item.lead.city && <div className="text-[11px] text-[color:var(--color-text-dim)]">{item.lead.city}</div>}
          </div>
          {item.decision && (
            <span className="shrink-0 text-[10.5px] font-extrabold px-2 py-0.5 rounded-full" style={{ color: theme.text, background: 'var(--color-bg-elev)' }}>
              {item.decision}
            </span>
          )}
        </div>

        {/* 2. Next Action */}
        <div className="mt-2">
          <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Next Action</div>
          <div className="text-[12.5px] font-semibold text-[color:var(--color-text)]">{item.nextAction || NA}</div>
        </div>

        {/* 3/4. Off-market leads: no Expected Profit/MAO exist yet (no
             asking price/ARV) — showing them, even as "Not available",
             still reads as "something's missing" for a category where
             nothing SHOULD exist yet. Prioritize Owner/Absentee instead,
             per the mission's example card. Non-distressed categories are
             completely unchanged below. */}
        {item.category === 'OFF_MARKET' ? (
          <div className="mt-2 space-y-1.5">
            {/* Capability #10.2 — Opportunity Score, once scored, replaces
                the plain Owner/Absentee-only view with the same evidence
                the Lead Detail card shows, so the strongest opportunities
                are identifiable without opening every card. */}
            {item.opportunity ? (
              <div className="rounded-md px-2.5 py-1.5" style={{ background: 'var(--color-bg-elev)' }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Opportunity</div>
                  {/* Capability #10.3 — contactability signal only, never
                      a priority input by itself (mission: contact alone
                      must not create HIGH PRIORITY). */}
                  <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                    isContactReady(item.lead)
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                      : 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]'
                  }`}>
                    {isContactReady(item.lead) ? 'Contact Ready' : 'Contact Needed'}
                  </span>
                </div>
                <div className="text-[16px] font-extrabold tabular-nums text-amber-700 dark:text-amber-400">
                  {item.opportunity.opportunity_score}/100
                </div>
                <div className="text-[10.5px] text-[color:var(--color-text-muted)]">{item.opportunity.distress_category_label}</div>
              </div>
            ) : null}
            {item.lead.owner_name && (
              <div>
                <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Owner</div>
                <div className="text-[12.5px] font-semibold text-[color:var(--color-text)]">{item.lead.owner_name}</div>
              </div>
            )}
            <div>
              <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Absentee</div>
              <div className="text-[12.5px] font-semibold text-[color:var(--color-text)]">
                {(() => {
                  const info = getDistressInfo(item.lead)
                  if (info?.absentee_owner === true) return 'YES'
                  if (info?.absentee_owner === false) return 'No'
                  return NA
                })()}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* 3. Expected Profit — visually the loudest number on the card */}
            <div className="mt-2 rounded-md px-2.5 py-1.5" style={{ background: 'var(--color-bg-elev)' }}>
              <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Expected Profit</div>
              <div
                className="text-[18px] font-extrabold tabular-nums"
                style={{ color: item.expectedProfit != null ? 'var(--color-success-text)' : 'var(--color-text-dim)' }}
              >
                {item.expectedProfit != null ? formatCurrency(item.expectedProfit) : NA}
              </div>
            </div>

            {/* 4. Maximum Offer */}
            <div className="mt-2">
              <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Maximum Offer</div>
              <div className="text-[12.5px] font-semibold text-[color:var(--color-text)]">{item.maxOffer != null ? formatCurrency(item.maxOffer) : NA}</div>
            </div>
          </>
        )}

        {/* Capability #17 — "why today" is never hidden: overdue leads show
            exactly how overdue, re-engaged leads show the item.reason line
            below (already populated with the real urgency signal). */}
        {item.category === 'OVERDUE' && item.lead.follow_up_date && (
          <div className="text-[10.5px] font-bold text-[color:var(--color-danger-text)] mt-1.5">
            ⏰ {daysOverdue(item.lead.follow_up_date)} day{daysOverdue(item.lead.follow_up_date) === 1 ? '' : 's'} overdue
          </div>
        )}

        {/* 5. Reason — clamped to ~2 lines, "More…" just hints the full lead has more; clicking anywhere on the card (including here) opens it */}
        {item.reason && (
          <div className="text-[11px] text-[color:var(--color-text-muted)] mt-2 leading-snug">
            <span className="font-semibold text-[color:var(--color-text)]">Reason: </span>
            <span className="line-clamp-2">{item.reason}</span>
            <span className="text-[color:var(--color-accent-text)] font-medium"> More…</span>
          </div>
        )}

        {/* Capability #17, Section 4 — Fast Outcome Capture, reachable
            directly from the card (no need to open the lead first). */}
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowOutcome(true) }}
          className="mt-2.5 w-full text-[11px] font-semibold px-2 py-1.5 rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]"
        >
          Log Outcome
        </button>
      </div>

      {showOutcome && (
        <LogOutcomeModal
          lead={item.lead}
          userId={userId}
          members={members}
          onClose={() => setShowOutcome(false)}
          onSaved={(updated) => onLeadUpdated?.(updated)}
        />
      )}
    </Link>
  )
}

export default function ActionCenterPage() {
  const { workspace, workspaceId, user, userRole, members } = useOutletContext()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('ALL')
  // Capability #17, Section 4 — bump to refetch after Log Outcome saves,
  // so a status/follow_up_date change re-buckets the lead (e.g. out of
  // Today once a future follow-up is set) without a full page reload.
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false

    async function load() {
      setLoading(true)

      let leadsQ = supabase
        .from('leads')
        .select('id, address, city, status, ai_notes, mao, asking_price, deal_analysis, follow_up_date, updated_at, notes, owner_name, enrichment_data, phone, email, decision_v2, acquisition_override')
        .eq('workspace_id', workspaceId)
        .not('status', 'in', `(${TERMINAL_STATUSES.map(s => `"${s}"`).join(',')})`)
      leadsQ = applyLeadVisibility(leadsQ, user.id, userRole)
      const { data: leads } = await leadsQ
      if (cancelled) return

      // Rediscovery status per lead — Capability #3/#4's `properties` table.
      // Best-effort: if the table/columns aren't present yet (migration not
      // applied), this simply yields no rediscovery data — Action Center
      // still works from Smart Lead Prioritization alone.
      let rediscoveryByLead = {}
      const leadIds = (leads || []).map(l => l.id)
      if (leadIds.length > 0) {
        try {
          const { data: props, error } = await supabase
            .from('properties')
            .select('current_lead_id, last_rediscovery_status, last_rediscovery_reason, updated_at')
            .eq('workspace_id', workspaceId)
            .in('current_lead_id', leadIds)
          if (error) throw error
          rediscoveryByLead = Object.fromEntries(
            (props || [])
              .filter(p => p.current_lead_id)
              .map(p => [p.current_lead_id, { status: p.last_rediscovery_status, reason: p.last_rediscovery_reason, updatedAt: p.updated_at }])
          )
        } catch (err) {
          console.warn('[action-center] rediscovery data unavailable (non-fatal):', err)
        }
      }

      const classified = (leads || [])
        .map(lead => isV2ActionCenter ? classifyLeadV2(lead) : classifyLead(lead, rediscoveryByLead[lead.id]))
        .filter(Boolean)

      if (!cancelled) {
        setItems(classified)
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [workspaceId, user.id, userRole, refreshTick])

  // Capability #17, Section 11 — "Actions Today" deliberately EXCLUDES
  // UPCOMING (future follow-ups) from every headline count. `items` still
  // holds everything (including UPCOMING) so the Upcoming filter can find
  // them; `todayCount` is what Kevin actually sees as his workload.
  const totalCount = items.length
  const todayCount = useMemo(() => items.filter(i => i.category !== 'UPCOMING').length, [items])

  const filteredItems = useMemo(() => {
    if (filter === 'ALL') return items.filter(i => i.category !== 'UPCOMING') // "Today" — Section 2's core rule
    if (filter === 'FLIP' || filter === 'BRRRR') return items.filter(i => i.strategy === filter.toLowerCase())
    return items.filter(i => i.category === filter)
  }, [items, filter])

  const byCategory = useMemo(() => ({
    OVERDUE: sortCategory('OVERDUE', filteredItems.filter(i => i.category === 'OVERDUE')),
    RE_ENGAGE: sortCategory('RE_ENGAGE', filteredItems.filter(i => i.category === 'RE_ENGAGE')),
    ACT_NOW: sortCategory('ACT_NOW', filteredItems.filter(i => i.category === 'ACT_NOW')),
    FOLLOW_UP_TODAY: sortCategory('FOLLOW_UP_TODAY', filteredItems.filter(i => i.category === 'FOLLOW_UP_TODAY')),
    REVIEW_TODAY: sortCategory('REVIEW_TODAY', filteredItems.filter(i => i.category === 'REVIEW_TODAY')),
    RECENTLY_IMPROVED: sortCategory('RECENTLY_IMPROVED', filteredItems.filter(i => i.category === 'RECENTLY_IMPROVED')),
    OFF_MARKET: [...filteredItems.filter(i => i.category === 'OFF_MARKET')]
      .sort((a, b) => (b.opportunity?.opportunity_score ?? -1) - (a.opportunity?.opportunity_score ?? -1)),
    UPCOMING: sortCategory('UPCOMING', items.filter(i => i.category === 'UPCOMING')), // only ever populated when filter==='UPCOMING'
  }), [filteredItems, items])

  // #5.1 business value summary — simple sum/average over values that
  // already exist on each item (lead.mao, deal_analysis.profit). Omitted
  // entirely when no item has the underlying value, per spec ("if a value
  // is unavailable, omit it").
  const kpis = useMemo(() => {
    const withProfit = filteredItems.filter(i => i.expectedProfit != null)
    const withOffer = filteredItems.filter(i => i.maxOffer != null)
    const totalProfit = withProfit.reduce((sum, i) => sum + i.expectedProfit, 0)
    const pipelineValue = withOffer.reduce((sum, i) => sum + i.maxOffer, 0)
    return {
      pipelineValue: withOffer.length > 0 ? pipelineValue : null,
      totalProfit: withProfit.length > 0 ? totalProfit : null,
      avgProfit: withProfit.length > 0 ? totalProfit / withProfit.length : null,
    }
  }, [filteredItems])

  if (loading) return <LoadingSpinner fullPage label="Scanning for opportunities…" />

  const filteredCount = filteredItems.length

  return (
    <>
      <Topbar title="Action Center" breadcrumbs={[{ label: workspace.name }, { label: 'Action Center' }]} />

      <div className="px-6 py-6 w-full flex-1">
        {/* Capability #17, Section 11 — compact operational summary.
            Deliberately EXCLUDES Upcoming from "Actions Today" (todayCount)
            — a future follow-up is never counted as work Kevin owes today. */}
        <div className="pb-5 border-b border-[color:var(--color-line)] mb-5">
          <p className="text-[12px] text-[color:var(--color-text-dim)] uppercase tracking-wider font-semibold">Today</p>
          <h2 className="text-[22px] font-semibold text-[color:var(--color-text)] tracking-tight mt-1">
            {todayCount === 0 ? 'Nothing needs action right now.' : `${todayCount} Action${todayCount === 1 ? '' : 's'} Today`}
          </h2>
          {todayCount > 0 && (
            <p className="text-[12.5px] text-[color:var(--color-text-muted)] mt-1">
              {items.filter(i => i.category === 'OVERDUE').length > 0 && <>Overdue: <span className="font-semibold text-[color:var(--color-danger-text)]">{items.filter(i => i.category === 'OVERDUE').length}</span>{'  ·  '}</>}
              {items.filter(i => i.category === 'RE_ENGAGE').length > 0 && <>Re-Engage: <span className="font-semibold text-[color:var(--color-danger-text)]">{items.filter(i => i.category === 'RE_ENGAGE').length}</span>{'  ·  '}</>}
              Act Now: <span className="font-semibold text-[color:var(--color-text)]">{items.filter(i => i.category === 'ACT_NOW').length}</span>
              {'  ·  '}Follow-Up: <span className="font-semibold text-[color:var(--color-text)]">{items.filter(i => i.category === 'FOLLOW_UP_TODAY').length}</span>
              {'  ·  '}Review Today: <span className="font-semibold text-[color:var(--color-text)]">{items.filter(i => i.category === 'REVIEW_TODAY').length}</span>
              {items.filter(i => i.category === 'UPCOMING').length > 0 && <span className="text-[color:var(--color-text-faint)]">{'  ·  '}{items.filter(i => i.category === 'UPCOMING').length} upcoming (not counted)</span>}
            </p>
          )}
        </div>

        {/* #5.1 — business value KPI row, only for values that exist */}
        {(kpis.pipelineValue != null || kpis.totalProfit != null || kpis.avgProfit != null) && (
          <div className="flex flex-wrap gap-3 mb-5">
            {kpis.pipelineValue != null && (
              <div className="flex-1 min-w-[160px] rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-4 py-2.5">
                <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Potential Pipeline Value</div>
                <div className="text-[17px] font-bold text-[color:var(--color-text)] tabular-nums">{formatCurrency(kpis.pipelineValue)}</div>
              </div>
            )}
            {kpis.totalProfit != null && (
              <div className="flex-1 min-w-[160px] rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-4 py-2.5">
                <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Total Expected Profit</div>
                <div className="text-[17px] font-bold text-[color:var(--color-success-text)] tabular-nums">{formatCurrency(kpis.totalProfit)}</div>
              </div>
            )}
            {kpis.avgProfit != null && (
              <div className="flex-1 min-w-[160px] rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-4 py-2.5">
                <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Average Expected Profit</div>
                <div className="text-[17px] font-bold text-[color:var(--color-text)] tabular-nums">{formatCurrency(kpis.avgProfit)}</div>
              </div>
            )}
          </div>
        )}

        {/* Top summary — 4 numbers only (unaffected by quick filters, always the full picture) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {Object.entries(CATEGORY_META).map(([key, meta]) => (
            <div key={key} className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-4 py-3 text-center">
              <div className="text-[20px]">{meta.icon}</div>
              <div className="text-[22px] font-bold text-[color:var(--color-text)] tabular-nums mt-0.5">{items.filter(i => i.category === key).length}</div>
              <div className="text-[10.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mt-0.5">{meta.label}</div>
            </div>
          ))}
        </div>

        {/* #5.1 — quick filters, client-side only */}
        {totalCount > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-5">
            {QUICK_FILTERS.map(f => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`text-[11.5px] font-semibold px-2.5 h-7 rounded-full border transition-colors ${
                  filter === f.key
                    ? 'bg-[color:var(--color-accent)] border-[color:var(--color-accent)] text-white'
                    : 'bg-[color:var(--color-bg-elev)] border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {filteredCount === 0 ? (
          <EmptyState
            icon="✓"
            title={todayCount === 0 ? 'All clear.' : 'No matches for this filter.'}
            description={
              todayCount === 0
                ? 'No lead currently meets Overdue, Re-Engage, Act Now, Follow Up Today, or Review Today criteria.'
                : 'Nothing in the current view matches this filter. Try "Today" to see everything due.'
            }
          />
        ) : filter === 'UPCOMING' ? (
          // Capability #17, Section 2/10 — the ONLY place future follow-ups
          // render. Deliberately a flat, compact list (no sub-sections,
          // no KPIs) — this is a reference view, not part of Today's work.
          <section>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-[15px]">📅</span>
              <h3 className="text-[13.5px] font-bold uppercase tracking-wide text-[color:var(--color-text)]">Upcoming Follow-Ups</h3>
              <span className="text-[11px] text-[color:var(--color-text-dim)] tabular-nums">({byCategory.UPCOMING.length})</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {byCategory.UPCOMING.map(item => <ActionCard key={item.lead.id} item={item} workspaceId={workspaceId} userId={user.id} members={members} onLeadUpdated={() => setRefreshTick(t => t + 1)} />)}
            </div>
          </section>
        ) : (
          <div className="space-y-6">
            {Object.entries(CATEGORY_META).map(([key, meta]) => {
              const list = byCategory[key]
              if (list.length === 0) return null

              // Overdue/Follow-Up-Today get sub-sections per waiting-reason
              // status so "waiting on seller" and "waiting to sign" etc.
              // aren't all dumped in one pile — everything else renders as
              // one grid.
              const subGroups = (key === 'FOLLOW_UP_TODAY' || key === 'OVERDUE')
                ? FOLLOW_UP_STATUSES
                    .map(status => ({ status, items: list.filter(i => i.followUpStatus === status) }))
                    .filter(g => g.items.length > 0)
                : null

              return (
                <section key={key}>
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="text-[15px]">{meta.icon}</span>
                    <h3 className="text-[13.5px] font-bold uppercase tracking-wide text-[color:var(--color-text)]">{meta.label}</h3>
                    <span className="text-[11px] text-[color:var(--color-text-dim)] tabular-nums">({list.length})</span>
                  </div>

                  {subGroups ? (
                    <div className="space-y-4">
                      {subGroups.map(({ status, items: subItems }) => (
                        <div key={status}>
                          <div className="text-[11px] font-semibold text-[color:var(--color-text-muted)] mb-1.5">
                            {STATUS_MAP[status]?.label || status} <span className="text-[color:var(--color-text-dim)]">({subItems.length})</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                            {subItems.map(item => (
                              <ActionCard key={item.lead.id} item={item} workspaceId={workspaceId} userId={user.id} members={members} onLeadUpdated={() => setRefreshTick(t => t + 1)} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {list.map(item => (
                        <ActionCard key={item.lead.id} item={item} workspaceId={workspaceId} userId={user.id} members={members} onLeadUpdated={() => setRefreshTick(t => t + 1)} />
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
