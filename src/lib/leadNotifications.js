// Notification config map. To add a new notification, add one entry to LEAD_NOTIFICATIONS.
// Each rule fires when `trigger.field` changes to `trigger.value` on a lead.

export const LEAD_NOTIFICATIONS = [
  {
    event: 'offer_signed',
    trigger: { field: 'status', value: 'offer_signed' },
    recipient: 'assigned_user',   // future: 'all_members' | 'fixed_email'
    subject: 'HAT signed contract — send offer ASAP: {address}',
    template: 'offer_signed',
  },
]

// Returns rules whose trigger field changed to the trigger value.
// before/after are lead objects (full or partial with the changed fields).
export function matchNotifications(before, after) {
  if (!before || !after) return []
  return LEAD_NOTIFICATIONS.filter(rule => {
    const { field, value } = rule.trigger
    return after[field] === value && before[field] !== value
  })
}

// Fires all matching notifications for a lead change. Silent on error.
// workspaceId is needed to build the lead URL and fetch SMTP settings.
export async function fireLeadNotifications(before, after, workspaceId, userId) {
  const matches = matchNotifications(before, after)
  if (!matches.length) return

  for (const rule of matches) {
    try {
      const res = await fetch('/.netlify/functions/notify-lead-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: rule.event, lead_id: after.id, workspace_id: workspaceId }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.ok && data.to) {
        // Log to activity timeline
        const { logEmailSent } = await import('./activityLogger.js')
        await logEmailSent(after.id, userId, {
          to: data.to,
          subject: rule.subject.replace('{address}', after.address || ''),
        }).catch(() => {})
      }
    } catch (err) {
      console.error('[fireLeadNotifications]', rule.event, err.message)
    }
  }
}
