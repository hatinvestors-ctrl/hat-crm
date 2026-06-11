import { logEmailSent } from './activityLogger.js'

// Master list of all notification event types. Used by AssigneeNotificationsForm.
export const ASSIGNEE_NOTIFICATION_EVENTS = [
  { key: 'assigned',       label: 'Lead Assigned to You' },
  { key: 'status_change',  label: 'Any Status Change' },
  { key: 'offer_signed',   label: 'Contract Signed' },
  { key: 'closed',         label: 'Lead Closed / Won' },
  { key: 'dead',           label: 'Lead Marked Dead' },
  { key: 'comment',        label: 'New Comment Posted' },
  { key: 'file_attached',  label: 'File Attached' },
  { key: 'deal_analysis',  label: 'Deal Analysis Run' },
  { key: 'offer_price',    label: 'Offer Price Updated' },
  { key: 'follow_up_date', label: 'Follow-up Date Changed' },
  { key: 'enriched',       label: 'Lead Enriched (MLS/RentCast)' },
]

// Field-change rules — fired automatically by useLeadUpdate via matchNotifications.
// trigger.value = specific status value to match.
// trigger.anyChange = true means any non-null change to the field fires this.
export const LEAD_NOTIFICATIONS = [
  {
    event: 'offer_signed',
    trigger: { field: 'status', value: 'offer_signed' },
    recipient: 'assigned_user',
    subject: 'HAT signed contract — send offer ASAP: {address}',
    template: 'offer_signed',
  },
  {
    event: 'closed',
    trigger: { field: 'status', value: 'closed' },
    recipient: 'assigned_user',
    subject: 'Lead closed: {address}',
    template: 'closed',
  },
  {
    event: 'dead',
    trigger: { field: 'status', value: 'dead' },
    recipient: 'assigned_user',
    subject: 'Lead marked dead: {address}',
    template: 'dead',
  },
  {
    event: 'status_change',
    trigger: { field: 'status', anyChange: true },
    recipient: 'assigned_user',
    subject: 'Status update on {address}',
    template: 'status_change',
  },
]

// Returns rules whose trigger condition was met between before and after lead objects.
export function matchNotifications(before, after) {
  if (!before || !after) return []
  return LEAD_NOTIFICATIONS.filter(rule => {
    const { field, value, anyChange } = rule.trigger
    if (anyChange) {
      // Fires when the field changes at all (any value, but not same value)
      return after[field] != null && after[field] !== before[field]
    }
    return after[field] === value && before[field] !== value
  })
}

// Fires all matching field-change notifications. Called from useLeadUpdate.
// actorUserId = the user who made the change (for "Changed by:" in the email).
export async function fireLeadNotifications(before, after, workspaceId, actorUserId) {
  const matches = matchNotifications(before, after)
  if (!matches.length) return

  for (const rule of matches) {
    const extra = {}
    if (rule.trigger.field === 'status') {
      extra.old_status = before.status
      extra.new_status = after.status
    }
    await fireLeadNotification(rule.event, after.id, workspaceId, actorUserId, extra)
      .catch(err => console.error('[fireLeadNotifications]', rule.event, err.message))
  }
}

// Fires a single explicit notification event. Use this for comment, deal_analysis,
// file_attached, enriched, assigned, offer_price, follow_up_date events.
// extra: optional contextual payload forwarded to the Netlify function.
export async function fireLeadNotification(event, leadId, workspaceId, actorUserId, extra = {}) {
  try {
    const res = await fetch('/.netlify/functions/notify-lead-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, lead_id: leadId, workspace_id: workspaceId, actor_user_id: actorUserId, extra }),
    })
    const data = await res.json().catch(() => ({}))
    if (data.ok && data.to) {
      await logEmailSent(leadId, actorUserId, {
        to: data.to,
        subject: data.subject || `[${event}] lead notification`,
      }).catch(() => {})
    } else if (!data.ok && !data.skipped) {
      console.error('[fireLeadNotification]', event, data.error || res.status)
    }
  } catch (err) {
    console.error('[fireLeadNotification]', event, err.message)
  }
}
