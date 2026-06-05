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
