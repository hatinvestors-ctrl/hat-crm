// src/lib/actionReason.js
// Capability #17.1 — "Explain My Queue" / Action Reason.
//
// MISSION: make the EXISTING deterministic classification (ActionCenterPage's
// classifyLeadV2()/classifyLead(), themselves driven by
// decisionEngineV2.js's computeRecommendation()) explain itself in plain
// English. This file changes NOTHING about V2 scoring, Buy Box, MAO, or
// Action Center bucket rules — it only reads the SAME fields those
// functions already computed (lead.decision_v2.opportunity/confidence/
// urgency/fit, item.category, item.reason, lead.follow_up_date, lead.status,
// lead.acquisition_override) and turns them into a short, factual sentence.
//
// ONE SOURCE OF TRUTH (Section 2): every branch below is a direct, labeled
// re-statement of a branch that already exists in
// src/lib/decisionEngineV2.js's computeRecommendation() (lines ~375-429) or
// src/pages/ActionCenterPage.jsx's classifyLeadV2()/classifyFollowUpDate().
// The five numeric thresholds duplicated here (65/60/45/30/55) are NOT a
// second scoring system — they are read-only comparisons against the exact
// opportunity.score/confidence.score/urgency.level values decisionEngineV2.js
// already stored on the lead, used only to describe which branch fired.
// scripts/verify-action-reason.mjs cross-checks this file's derived category
// against the real lead.decision_v2.recommendation for a batch of production
// leads so any future drift between the two is caught, not assumed away.
//
// ZERO LLM CALLS — pure deterministic string templates over already-computed
// fields (Section 14). No network call, no AI SDK import, anywhere below.

import { daysOverdue } from './followUpTiming.js'

const money = (n) => (typeof n === 'number' && Number.isFinite(n) ? `$${Math.round(n).toLocaleString()}` : null)

// Mirrors decisionEngineV2.js computeRecommendation()'s exact thresholds —
// see file-header note above. Never used to CLASSIFY (classifyLeadV2 already
// did that); only used to describe WHICH branch of that already-computed
// classification fired.
function opportunityConfidenceBand(d) {
  const opp = d?.opportunity?.score
  const conf = d?.confidence?.score
  const urgency = d?.urgency?.level
  if (typeof opp !== 'number' || typeof conf !== 'number') return null
  const strong = opp >= 65 && conf >= 60
  const promising = opp >= 45
  return { opp, conf, urgency, strong, promising }
}

function topReasons(list, n = 2) {
  return (list || []).filter(Boolean).slice(0, n)
}

// Concrete "what changed" detail for RE_ENGAGE (Section 10) — reads the
// SAME urgency.reasons array classifyLeadV2() already used to decide
// RE_ENGAGE fired; never invents a price or a distress type not present in
// that array. Price-drop reasons already come out of computeUrgency() as
// plain sentences (e.g. "Price reduced $189,000 to $174,000"), so this just
// surfaces that exact sentence rather than re-deriving numbers from scratch.
function reEngageDetail(lead, d) {
  const reasons = (d?.urgency?.reasons || []).filter((r) => r !== 'Follow-up overdue')
  const signal = reasons[0] || null
  if (!signal) return { reason: 'A new timing signal was detected on this lead.', evidence: [] }
  // Safety rule (Section 10): unverified distress info is phrased as a
  // signal to verify, never as settled fact — matches the existing
  // convention in distressInfo.js or "reasons" strings, which describe
  // filings/records, not confirmed outcomes.
  const isDistressSignal = /foreclosure|lis pendens|lien|tax delinquen|probate|eviction|bankrupt/i.test(signal)
  const reason = isDistressSignal
    ? `New distress signal detected — ${signal}. Verify before acting.`
    : signal
  return { reason, evidence: [signal] }
}

/**
 * getActionReason(lead, item) → { bucket, label, reasonCode, reason, evidence, nextAction, dayCount }
 *
 * `item` is the object already returned by classifyLeadV2()/classifyLead()
 * in ActionCenterPage.jsx — this function NEVER re-classifies; it only
 * explains the classification already made. `item.category` and
 * `lead.decision_v2` are read, never overridden.
 */
export function getActionReason(lead, item) {
  if (!item || !item.category) return null
  const d = lead?.decision_v2 || null
  const category = item.category

  // ── Human Override (Section 12) — checked first: if an active
  // DO_NOT_PURSUE override exists, it always wins the explanation, and no
  // aggressive system recommendation is ever shown underneath it. Reads
  // lead.decision_v2.human_override, the exact object
  // applyHumanOverride() (decisionEngineV2.js) already writes — never a
  // second override concept.
  if (d?.human_override?.active) {
    return {
      bucket: category,
      label: 'Manually excluded',
      reasonCode: 'HUMAN_OVERRIDE',
      reason: d.human_override.reason ? `Manually excluded — ${d.human_override.reason}` : 'Manually excluded — no reason recorded',
      evidence: [],
      nextAction: null,
      dayCount: null,
    }
  }

  switch (category) {
    case 'RE_ENGAGE': {
      const { reason, evidence } = reEngageDetail(lead, d)
      return { bucket: category, label: 'Re-engage', reasonCode: 'RE_ENGAGE_SIGNAL', reason, evidence, nextAction: item.nextAction, dayCount: null }
    }

    case 'OVERDUE': {
      const days = daysOverdue(lead.follow_up_date)
      const dueStr = lead.follow_up_date ? String(lead.follow_up_date).slice(0, 10) : null
      return {
        bucket: category,
        label: `Overdue · ${days} day${days === 1 ? '' : 's'}`,
        reasonCode: 'FOLLOW_UP_OVERDUE',
        reason: dueStr
          ? `Follow-up scheduled for ${dueStr} has not been completed — ${days} day${days === 1 ? '' : 's'} overdue.`
          : 'Follow-up is overdue.',
        evidence: [],
        nextAction: item.nextAction,
        dayCount: days,
      }
    }

    case 'FOLLOW_UP_TODAY':
      return {
        bucket: category,
        label: 'Follow up today',
        reasonCode: 'FOLLOW_UP_DUE_TODAY',
        reason: 'A follow-up is scheduled for today.',
        evidence: [],
        nextAction: item.nextAction,
        dayCount: null,
      }

    case 'UPCOMING': {
      const dueStr = lead.follow_up_date ? String(lead.follow_up_date).slice(0, 10) : null
      return {
        bucket: category,
        label: 'Upcoming',
        reasonCode: 'FOLLOW_UP_SCHEDULED',
        reason: dueStr ? `Follow-up scheduled for ${dueStr} — not due yet.` : 'A future follow-up is scheduled.',
        evidence: [],
        nextAction: item.nextAction,
        dayCount: null,
      }
    }

    case 'ACT_NOW': {
      const band = opportunityConfidenceBand(d)
      const reasons = topReasons(d?.opportunity?.reasons)
      let reason = 'Strong opportunity with a real urgency trigger — worth acting on today.'
      if (band) {
        reason = `Opportunity ${band.opp} and Confidence ${band.conf} both clear the Act Now bar, and urgency is not low${reasons.length ? ` — ${reasons.join('; ')}` : ''}.`
      }
      return { bucket: category, label: 'Act now', reasonCode: 'STRONG_OPPORTUNITY_URGENT', reason, evidence: reasons, nextAction: item.nextAction, dayCount: null }
    }

    case 'REVIEW_TODAY': {
      const band = opportunityConfidenceBand(d)
      const reasons = topReasons(d?.opportunity?.reasons)
      let reason = 'Good enough opportunity to review today, but there is no urgent trigger yet.'
      if (band) {
        if (band.opp < 65) {
          reason = `Opportunity ${band.opp} is promising (≥45) but hasn't reached the Act Now bar (needs ≥65 Opportunity and ≥60 Confidence) — worth reviewing today, not urgent yet.`
        } else if (band.conf < 60) {
          reason = `Opportunity ${band.opp} is strong, but Confidence ${band.conf} is too low to act on yet (needs ≥60) — review and verify today.`
        } else if (band.urgency === 'LOW') {
          reason = `Opportunity ${band.opp} and Confidence ${band.conf} both clear the Act Now bar, but there is no urgency trigger yet — review today.`
        }
        if (band.conf < 55) reason += ' Confidence is still low — this review should focus on verifying the numbers.'
      }
      return { bucket: category, label: 'Review today', reasonCode: 'PROMISING_NOT_URGENT', reason, evidence: reasons, nextAction: item.nextAction, dayCount: null }
    }

    case 'RECENTLY_IMPROVED':
      return {
        bucket: category,
        label: 'Recently improved',
        reasonCode: 'REDISCOVERY_IMPROVED',
        reason: item.reason ? `This lead improved — ${item.reason}.` : 'This lead recently improved and is worth another look.',
        evidence: item.reason ? [item.reason] : [],
        nextAction: item.nextAction,
        dayCount: null,
      }

    case 'OFF_MARKET':
      return {
        bucket: category,
        label: 'Off-market signal',
        reasonCode: 'DISTRESS_SIGNAL_UNSCORED',
        reason: item.reason ? `Distress signal detected — ${item.reason}. Verify before acting.` : 'A distress signal was detected; verify before acting.',
        evidence: item.reason ? [item.reason] : [],
        nextAction: item.nextAction,
        dayCount: null,
      }

    default:
      return null
  }
}

// Section 11 — optional ONE-line follow-up context from real
// lead_activities, only when a real prior outcome comment exists. Never
// fabricated; returns null if there's nothing real to show.
export function getLastFollowUpOutcome(activities) {
  if (!Array.isArray(activities) || activities.length === 0) return null
  const comments = activities
    .filter((a) => a.type === 'comment' && a.comment && a.comment.trim())
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  return comments[0]?.comment?.trim() || null
}
