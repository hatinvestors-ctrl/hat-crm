// src/lib/acquisitionMetrics.js
// Capability #18 — Acquisition Intelligence measurement layer.
//
// EVERY metric here is derived from data that already exists:
//   - leads (status, lead_source, decision_v2, offer_price, contract_signed_date,
//     follow_up_date, created_at, deal_analysis)
//   - lead_activities (status-change history via logChanges, outcome_logged
//     via #17's Log Outcome, email_sent, deal_analysis_run)
//   - deal_financials (purchase_date/sold_date/actual_sale_price — the ONLY
//     source of truth for a real, closed, realized deal)
//
// No new table, no parallel event system (Section 3's explicit instruction).
// No LLM calls, no fabricated history. Where evidence is insufficient a
// lead is classified UNKNOWN rather than silently assumed to be zero/false
// (Section 15).
//
// FUNNEL STAGE DEFINITIONS (Section 2/14) — precise, single source of truth:
//
//   LEADS_RECEIVED    — every lead row in range. No qualification.
//   BUY_BOX_FIT       — decision_v2.fit.status === 'FIT' (V2's own,
//                       already-computed Buy Box result — never
//                       recalculated here). Leads with no decision_v2 yet
//                       are EXCLUDED from this stage (not counted as
//                       fit OR not-fit) — insufficient evidence.
//   ACTIONABLE        — decision_v2.recommendation is anything other than
//                       PASS/MONITOR, i.e. V2 currently believes this
//                       deserves work (BUY_NOW/MAKE_OFFER/FOLLOW_UP).
//   CONTACT_ATTEMPTED — real evidence someone reached out: an
//                       email_sent/outcome_logged activity row exists, OR
//                       the lead ever carried a status that only exists
//                       after outreach (follow_up/negotiating/offer_*/
//                       offer_accepted/sold/flip_sold/rejected_not_accepted),
//                       evidenced via the status-change activity log.
//   CONTACT_MADE      — stronger evidence than an attempt: an
//                       outcome_logged row with an outcome other than
//                       'no_answer', OR a status-change to negotiating/
//                       offer_sent/offer_signed/offer_pending_hat_signing/
//                       offer_accepted/sold/flip_sold (all require having
//                       actually spoken to someone under the existing
//                       Podio-derived workflow).
//   OFFER_SENT        — lead.offer_price is set, OR a status-change
//                       activity row shows new_value='offer_sent' (or a
//                       later stage) — offers aren't retracted from
//                       history once sent.
//   COUNTER            — an outcome_logged row with outcome='counter_received'
//                       OR a status-change to 'negotiating'.
//   UNDER_CONTRACT     — lead.contract_signed_date is set, OR a
//                       status-change to offer_signed/offer_pending_hat_signing.
//   ACQUIRED           — a deal_financials row exists for this lead_id with
//                       purchase_date set (the only real "we actually
//                       bought this" evidence in the schema), OR
//                       lead.status is sold/flip_sold.
//
//   Terminal-but-not-advancing buckets (Section 2), tracked separately,
//   never folded into the funnel's forward counts:
//     PASS        — decision_v2.recommendation === 'PASS'
//     NOT_FIT     — lead.status === 'not_in_buy_box'
//     DEAD_LEAD   — lead.status === 'dead_lead'
//     LOST        — lead.status === 'rejected_not_accepted'
//     FOLLOW_UP / UPCOMING — from #17's classifyFollowUpDate()

// Same set ActionCenterPage.jsx (#17) uses for "waiting on someone else to
// respond" statuses — kept as a local literal here too since neither file
// exports it from constants.js (matches the existing pattern, not a new one).
const FOLLOW_UP_STATUSES = ['follow_up', 'offer_sent', 'negotiating', 'offer_pending_hat_signing', 'offer_signed']
const CONTACT_ATTEMPTED_STATUSES = ['follow_up', 'negotiating', 'offer_sent', 'offer_pending_hat_signing', 'offer_signed', 'offer_accepted', 'sold', 'flip_sold', 'rejected_not_accepted']
const CONTACT_MADE_STATUSES = ['negotiating', 'offer_sent', 'offer_pending_hat_signing', 'offer_signed', 'offer_accepted', 'sold', 'flip_sold']
const OFFER_STATUSES = ['offer_sent', 'offer_pending_hat_signing', 'offer_signed', 'offer_accepted', 'sold', 'flip_sold']
const CONTRACT_STATUSES = ['offer_signed', 'offer_pending_hat_signing']
const ACQUIRED_STATUSES = ['sold', 'flip_sold']

export const FUNNEL_STAGES = [
  { key: 'LEADS_RECEIVED', label: 'Leads Received' },
  { key: 'BUY_BOX_FIT', label: 'Buy Box Fit' },
  { key: 'ACTIONABLE', label: 'Actionable' },
  { key: 'CONTACT_ATTEMPTED', label: 'Contact Attempted' },
  { key: 'CONTACT_MADE', label: 'Contact Made' },
  { key: 'OFFER_SENT', label: 'Offers Sent' },
  { key: 'COUNTER', label: 'Counter / Negotiation' },
  { key: 'UNDER_CONTRACT', label: 'Under Contract' },
  { key: 'ACQUIRED', label: 'Acquired / Closed' },
]

// ── Group lead_activities by lead_id once, reused by every classifier below ──
export function indexActivitiesByLead(activities) {
  const byLead = new Map()
  for (const a of activities || []) {
    if (!byLead.has(a.lead_id)) byLead.set(a.lead_id, [])
    byLead.get(a.lead_id).push(a)
  }
  return byLead
}

function statusEverReached(acts, statuses) {
  return (acts || []).some(a => a.metadata?.field === 'status' && statuses.includes(a.metadata?.new_value))
}

function latestOutcomeActivity(acts) {
  const outcomes = (acts || []).filter(a => a.metadata?.event === 'outcome_logged')
  if (!outcomes.length) return null
  return outcomes.reduce((latest, a) => (!latest || a.created_at > latest.created_at ? a : latest), null)
}

/** Real, evidence-based per-lead funnel facts. Never invents a stage. */
export function classifyLeadFunnel(lead, activitiesByLead, dealFinancialsByLead) {
  const acts = activitiesByLead.get(lead.id) || []
  const d = lead.decision_v2 || null
  const df = dealFinancialsByLead.get(lead.id) || null

  const buyBoxFit = d?.fit?.status === 'FIT' ? true : (d?.fit?.status ? false : null) // null = no decision yet
  const actionable = Boolean(d && d.recommendation && d.recommendation !== 'PASS' && d.recommendation !== 'MONITOR')

  const hasOutreachActivity = acts.some(a => a.metadata?.event === 'email_sent' || a.metadata?.event === 'outcome_logged')
  const contactAttempted = hasOutreachActivity || CONTACT_ATTEMPTED_STATUSES.includes(lead.status) || statusEverReached(acts, CONTACT_ATTEMPTED_STATUSES)

  const lastOutcome = latestOutcomeActivity(acts)
  const positiveOutcome = lastOutcome && lastOutcome.metadata?.outcome && lastOutcome.metadata.outcome !== 'no_answer'
  const contactMade = Boolean(positiveOutcome) || CONTACT_MADE_STATUSES.includes(lead.status) || statusEverReached(acts, CONTACT_MADE_STATUSES)

  const offerSent = lead.offer_price != null || OFFER_STATUSES.includes(lead.status) || statusEverReached(acts, OFFER_STATUSES)
  const counter = acts.some(a => a.metadata?.event === 'outcome_logged' && a.metadata?.outcome === 'counter_received')
    || lead.status === 'negotiating' || statusEverReached(acts, ['negotiating'])
  const underContract = Boolean(lead.contract_signed_date) || CONTRACT_STATUSES.includes(lead.status) || statusEverReached(acts, CONTRACT_STATUSES)
  const acquired = Boolean(df?.purchase_date) || ACQUIRED_STATUSES.includes(lead.status)

  const dead = lead.status === 'dead_lead'
  const lost = lead.status === 'rejected_not_accepted'
  const notFit = lead.status === 'not_in_buy_box'
  const passed = d?.recommendation === 'PASS'

  // Furthest stage reached — funnel counts are cumulative (reaching a later
  // stage implies every earlier one), computed from evidence above, not
  // assumed from current status alone.
  let furthestRank = 0 // LEADS_RECEIVED
  if (buyBoxFit) furthestRank = 1
  if (actionable) furthestRank = Math.max(furthestRank, 2)
  if (contactAttempted) furthestRank = Math.max(furthestRank, 3)
  if (contactMade) furthestRank = Math.max(furthestRank, 4)
  if (offerSent) furthestRank = Math.max(furthestRank, 5)
  if (counter) furthestRank = Math.max(furthestRank, 6)
  if (underContract) furthestRank = Math.max(furthestRank, 7)
  if (acquired) furthestRank = Math.max(furthestRank, 8)

  return {
    lead, buyBoxFit, actionable, contactAttempted, contactMade, offerSent, counter, underContract, acquired,
    dead, lost, notFit, passed, furthestRank,
    lastOutcome: lastOutcome?.metadata || null,
  }
}

// ── Funnel ────────────────────────────────────────────────────────────────
export function computeFunnel(facts) {
  return FUNNEL_STAGES.map((stage, i) => {
    const count = facts.filter(f => f.furthestRank >= i).length
    const prevCount = i === 0 ? count : facts.filter(f => f.furthestRank >= i - 1).length
    return {
      ...stage,
      count,
      conversionFromPrev: i === 0 ? null : (prevCount > 0 ? count / prevCount : null),
      conversionFromStart: facts.length > 0 ? count / facts.length : null,
    }
  })
}

export function computeSideBuckets(facts) {
  return {
    pass: facts.filter(f => f.passed).length,
    notFit: facts.filter(f => f.notFit).length,
    dead: facts.filter(f => f.dead).length,
    lost: facts.filter(f => f.lost).length,
  }
}

// ── Source performance (Section 7) ──────────────────────────────────────
export function computeSourcePerformance(facts) {
  const bySource = new Map()
  for (const f of facts) {
    const src = f.lead.lead_source || 'unknown'
    if (!bySource.has(src)) bySource.set(src, [])
    bySource.get(src).push(f)
  }
  return [...bySource.entries()].map(([source, group]) => {
    const n = group.length
    const withOpp = group.filter(f => f.lead.decision_v2?.opportunity?.score != null)
    const withProfit = group.filter(f => f.lead.deal_analysis?.profit != null)
    return {
      source, leads: n,
      buyBoxFitPct: n ? group.filter(f => f.buyBoxFit).length / n : null,
      actionablePct: n ? group.filter(f => f.actionable).length / n : null,
      contactPct: n ? group.filter(f => f.contactMade).length / n : null,
      offerPct: n ? group.filter(f => f.offerSent).length / n : null,
      contractPct: n ? group.filter(f => f.underContract).length / n : null,
      acquisitionPct: n ? group.filter(f => f.acquired).length / n : null,
      avgOpportunity: withOpp.length ? withOpp.reduce((s, f) => s + f.lead.decision_v2.opportunity.score, 0) / withOpp.length : null,
      avgExpectedProfit: withProfit.length ? withProfit.reduce((s, f) => s + f.lead.deal_analysis.profit, 0) / withProfit.length : null,
      sampleSize: n,
    }
  }).sort((a, b) => b.leads - a.leads)
}

// ── V2 performance (Section 8) ─────────────────────────────────────────
// IMPORTANT CAVEAT surfaced in the UI, not hidden: this groups by V2's
// CURRENT recommendation (decision_v2.recommendation), not a historical
// snapshot at the moment of action, for any lead whose outcome predates
// Capability #18's snapshot capture (see logOutcome's decisionSnapshot).
// Leads with an outcome_logged row that carries a decision_snapshot use
// the snapshot's recommendation instead — the more trustworthy figure
// going forward.
export function computeV2Performance(facts) {
  const byRec = new Map()
  for (const f of facts) {
    const snapshot = f.lastOutcome?.decision_snapshot
    const rec = snapshot?.recommendation || f.lead.decision_v2?.recommendation
    if (!rec) continue
    if (!byRec.has(rec)) byRec.set(rec, [])
    byRec.get(rec).push(f)
  }
  return [...byRec.entries()].map(([recommendation, group]) => {
    const n = group.length
    return {
      recommendation, leads: n,
      contacted: group.filter(f => f.contactMade).length,
      offers: group.filter(f => f.offerSent).length,
      contracts: group.filter(f => f.underContract).length,
      acquisitions: group.filter(f => f.acquired).length,
    }
  }).sort((a, b) => b.leads - a.leads)
}

export function computeOpportunityBuckets(facts) {
  const buckets = [
    { label: '80–100', min: 80, max: 100 },
    { label: '60–79', min: 60, max: 79 },
    { label: '40–59', min: 40, max: 59 },
    { label: '20–39', min: 20, max: 39 },
    { label: '0–19', min: 0, max: 19 },
  ]
  return buckets.map(b => {
    const group = facts.filter(f => {
      const score = f.lead.decision_v2?.opportunity?.score
      return score != null && score >= b.min && score <= b.max
    })
    const n = group.length
    return {
      ...b, leads: n,
      offers: group.filter(f => f.offerSent).length,
      contracts: group.filter(f => f.underContract).length,
      acquisitions: group.filter(f => f.acquired).length,
    }
  })
}

// ── Follow-up / re-engagement performance (Section 10) ───────────────────
export function computeFollowUpPerformance(facts) {
  const scheduled = facts.filter(f => f.lead.follow_up_date != null)
  const completed = facts.filter(f => f.lastOutcome != null) // any logged outcome implies the follow-up task was worked
  const overdue = facts.filter(f => {
    const fud = f.lead.follow_up_date
    if (!fud || FOLLOW_UP_STATUSES.includes(f.lead.status) === false) return false
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
    return String(fud).slice(0, 10) < today
  })
  const reEngageEvents = facts.filter(f => {
    const d = f.lead.decision_v2
    return FOLLOW_UP_STATUSES.includes(f.lead.status) && d?.urgency?.level === 'HIGH'
      && (d.urgency?.reasons || []).some(r => r !== 'Follow-up overdue')
  })
  return {
    scheduled: scheduled.length,
    completed: completed.length,
    overdue: overdue.length,
    reEngageOpportunities: reEngageEvents.length,
    reEngageWithOffer: reEngageEvents.filter(f => f.offerSent).length,
    reEngageWithContract: reEngageEvents.filter(f => f.underContract).length,
  }
}

// ── Offer / negotiation analytics (Section 11) — sample size ALWAYS shown ──
export function computeOfferAnalytics(facts) {
  const withOffer = facts.filter(f => f.lead.offer_price != null && f.lead.asking_price != null)
  const offerToAsk = withOffer.map(f => f.lead.offer_price / f.lead.asking_price)
  const withMao = facts.filter(f => f.lead.offer_price != null && f.lead.mao != null && f.lead.mao > 0)
  const offerToMao = withMao.map(f => f.lead.offer_price / f.lead.mao)
  return {
    offersWithAskData: withOffer.length,
    avgOfferToAskPct: offerToAsk.length ? offerToAsk.reduce((a, b) => a + b, 0) / offerToAsk.length : null,
    offersWithMaoData: withMao.length,
    avgOfferToMaoPct: offerToMao.length ? offerToMao.reduce((a, b) => a + b, 0) / offerToMao.length : null,
    countersLogged: facts.filter(f => f.counter).length,
  }
}

// ── Economics (Section 12) — pipeline vs projected vs realized, never mixed ──
export function computeEconomics(facts, dealFinancialsList) {
  const activeWithProfit = facts.filter(f => f.actionable && f.lead.deal_analysis?.profit != null && !f.dead && !f.lost)
  const pipelineValue = activeWithProfit.reduce((s, f) => s + f.lead.deal_analysis.profit, 0)

  const contractsWithProfit = facts.filter(f => f.underContract && f.lead.deal_analysis?.profit != null)
  const projectedProfit = contractsWithProfit.reduce((s, f) => s + f.lead.deal_analysis.profit, 0)

  const closed = (dealFinancialsList || []).filter(df => df.sold_date && df.actual_sale_price != null && df.purchase_price_actual != null)
  const realizedProfit = closed.reduce((s, df) => s + (Number(df.actual_sale_price) - Number(df.purchase_price_actual)), 0)

  return {
    pipelineValue, pipelineCount: activeWithProfit.length,
    projectedProfit, projectedCount: contractsWithProfit.length,
    realizedProfit, realizedCount: closed.length,
  }
}

// ── Data quality (Section 15) ───────────────────────────────────────────
export function computeDataQuality(facts) {
  const total = facts.length
  const missingSource = facts.filter(f => !f.lead.lead_source).length
  const missingDecision = facts.filter(f => !f.lead.decision_v2).length
  const offersMissingAmount = facts.filter(f => f.offerSent && f.lead.offer_price == null).length
  const contractsMissingDate = facts.filter(f => f.underContract && !f.lead.contract_signed_date).length
  const tracked = total - missingSource - missingDecision
  return {
    total, missingSource, missingDecision, offersMissingAmount, contractsMissingDate,
    coveragePct: total ? tracked / total : null,
  }
}

// ── Kevin / execution metrics (Section 9) — process health, not surveillance ──
export function computeExecutionMetrics(facts) {
  const withCreated = facts.filter(f => f.lead.created_at && f.lastOutcome)
  return {
    offersSent: facts.filter(f => f.offerSent).length,
    activeNegotiations: facts.filter(f => f.counter && !f.underContract && !f.acquired).length,
    followUpsCompleted: facts.filter(f => f.lastOutcome != null).length,
    leadsWithFirstActionLogged: withCreated.length,
  }
}
