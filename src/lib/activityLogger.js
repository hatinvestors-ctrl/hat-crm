import { supabase } from './supabase'
import { ACTIVITY_TRACKED_FIELDS, STATUS_MAP } from './constants'

function describeField(field, oldVal, newVal, userLookup = {}) {
  switch (field) {
    case 'status':
      return `Status changed from "${STATUS_MAP[oldVal]?.label || oldVal || '—'}" to "${STATUS_MAP[newVal]?.label || newVal}"`
    case 'assigned_to': {
      const oldName = userLookup[oldVal]?.full_name || (oldVal ? 'a user' : 'Unassigned')
      const newName = userLookup[newVal]?.full_name || (newVal ? 'a user' : 'Unassigned')
      return `Assigned changed from ${oldName} to ${newName}`
    }
    case 'follow_up_date':
      return `Follow-up date changed from ${oldVal || '—'} to ${newVal || '—'}`
    case 'contract_signed_date':
      return `Contract sign date changed from ${oldVal || '—'} to ${newVal || '—'}`
    case 'offer_price':
      return `Offer price changed from $${oldVal ?? '—'} to $${newVal ?? '—'}`
    case 'mao':
      return `MAO changed from $${oldVal ?? '—'} to $${newVal ?? '—'}`
    default:
      return `${field} changed`
  }
}

export async function logLeadCreated(leadId, userId) {
  await supabase.from('lead_activities').insert({
    lead_id: leadId,
    user_id: userId,
    type: 'activity',
    content: 'Lead created',
    metadata: { event: 'created' },
  })
}

export async function logChanges(leadId, userId, before, after, userLookup = {}) {
  const inserts = []
  for (const field of ACTIVITY_TRACKED_FIELDS) {
    const oldVal = before?.[field] ?? null
    const newVal = after?.[field] ?? null
    if (String(oldVal) !== String(newVal)) {
      inserts.push({
        lead_id: leadId,
        user_id: userId,
        type: 'activity',
        content: describeField(field, oldVal, newVal, userLookup),
        metadata: { field, old_value: oldVal, new_value: newVal },
      })
    }
  }
  if (inserts.length) {
    await supabase.from('lead_activities').insert(inserts)
  }
  return inserts.length
}

export async function logComment(leadId, userId, content) {
  if (!content?.trim()) return
  await supabase.from('lead_activities').insert({
    lead_id: leadId,
    user_id: userId,
    type: 'comment',
    content: content.trim(),
  })
}

export async function logEmailSent(leadId, userId, { to, cc, subject }) {
  const ccPart = cc ? ` (CC: ${cc})` : ''
  await supabase.from('lead_activities').insert({
    lead_id: leadId,
    user_id: userId,
    type: 'activity',
    content: `Email sent to ${to}${ccPart} — Subject: "${subject}"`,
    metadata: { event: 'email_sent', to, cc: cc || null, subject },
  })
}

// Capability #17, Section 14 — lightweight outcome history. Reuses the
// existing lead_activities table (no new table); metadata carries the
// structured fields so a future Outcome Tracking/Learning Loop can query
// them without re-parsing free text, while `content` stays human-readable
// in the existing Activity Timeline.
const OUTCOME_LABELS = {
  no_answer: 'No Answer',
  spoke_follow_up: 'Spoke — Follow Up',
  offer_sent: 'Offer Sent',
  offer_rejected: 'Offer Rejected',
  counter_received: 'Counter Received',
  need_more_info: 'Need More Information',
  not_interested: 'Not Interested',
  dead_lead: 'Dead Lead',
}

// Capability #18, Section 4 — decision-at-time-of-action snapshot. V2's
// decision_v2 changes over time (recalculated on every meaningful edit);
// without freezing what it said AT THE MOMENT Kevin acted, "did ACT NOW
// leads actually convert?" becomes unanswerable retroactively once V2
// re-scores the lead later. Bounded to the exact fields the mission lists
// — never the full decision_v2 blob, never anything V2 didn't already
// compute (no recalculation happens here).
function snapshotDecision(lead) {
  const d = lead.decision_v2
  if (!d) return null
  return {
    opportunity: d.opportunity?.score ?? null,
    confidence: d.confidence?.score ?? null,
    urgency: d.urgency?.level ?? null,
    recommendation: d.recommendation ?? null,
    next_best_action: d.next_best_action ?? null,
    fit: d.fit?.status ?? null,
    strategy: d.strategy ?? null,
    asking_price: lead.asking_price ?? null,
    arv: lead.arv ?? null,
    renovation_cost: lead.renovation_cost ?? null,
    rent_estimate: lead.rent_estimate ?? null,
    mao: lead.mao ?? null,
    lead_source: lead.lead_source ?? null,
    snapshotted_at: new Date().toISOString(),
  }
}

export async function logOutcome(leadId, userId, {
  outcome, note, followUpDate, sellerExpectation, offerAmount, counterAmount, lead,
} = {}) {
  const label = OUTCOME_LABELS[outcome] || outcome || 'Outcome logged'
  const parts = [`Outcome: ${label}`]
  if (sellerExpectation != null) parts.push(`Seller expectation: $${Number(sellerExpectation).toLocaleString()}`)
  if (offerAmount != null) parts.push(`Offer: $${Number(offerAmount).toLocaleString()}`)
  if (counterAmount != null) parts.push(`Counter: $${Number(counterAmount).toLocaleString()}`)
  if (followUpDate) parts.push(`Next follow-up: ${followUpDate}`)
  const content = note?.trim() ? `${parts.join(' · ')}\n"${note.trim()}"` : parts.join(' · ')

  await supabase.from('lead_activities').insert({
    lead_id: leadId,
    user_id: userId,
    type: 'activity',
    content,
    metadata: {
      event: 'outcome_logged',
      outcome: outcome ?? null,
      note: note?.trim() || null,
      follow_up_date: followUpDate ?? null,
      seller_expectation: sellerExpectation ?? null,
      offer_amount: offerAmount ?? null,
      counter_amount: counterAmount ?? null,
      decision_snapshot: lead ? snapshotDecision(lead) : null,
    },
  })
}

export async function logDealAnalysis(leadId, userId, { verdict, profit, roi }) {
  const profitStr = profit != null ? `$${Number(profit).toLocaleString()}` : '—'
  const roiStr    = roi    != null ? `${roi}%` : '—'
  await supabase.from('lead_activities').insert({
    lead_id:  leadId,
    user_id:  userId,
    type:     'activity',
    content:  `Deal analysis run — Verdict: ${verdict} / ${profitStr} profit / ${roiStr} ROI`,
    metadata: { event: 'deal_analysis_run', verdict, profit: profit ?? null, roi: roi ?? null },
  })
}
