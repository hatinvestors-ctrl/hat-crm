# Lead Notifications — Design Spec

**Date:** 2026-06-05  
**Status:** Approved  
**Scope:** Build an extensible notification engine that sends emails to assigned agents when key lead events occur. First trigger: status changes to `offer_signed`.

---

## Problem

When HAT signs a contract on a lead, the assigned agent (currently Kevin) needs to be notified immediately by email with deal details and a request to send the offer to the listing agent ASAP. There is currently no automated notification — this is done manually or not at all.

The system must be built to easily support additional notification rules in the future (e.g. other status changes, field changes) without restructuring.

---

## Architecture

A `useLeadNotifications` hook holds a **notification config map** — an array of rules. Each rule defines what event triggers it, who receives it, and which email template to use. When a lead update is saved, the hook checks whether any rule matches the change. If a match is found, it calls the generic `notify-lead-event` Netlify function, which fetches the assigned user's email, renders the template, sends via workspace SMTP, and returns. The hook then logs the notification to the activity timeline.

Status changes are always UI-driven (user action in ActionZone or LeadForm), so frontend-triggered notifications are reliable for this workflow.

---

## Notification Config Map

Defined in `src/lib/leadNotifications.js`. Each rule:

```js
{
  event: string,           // unique key, e.g. 'offer_signed'
  trigger: {
    field: string,         // lead field to watch, e.g. 'status'
    value: string,         // value that triggers the rule
  },
  recipient: 'assigned_user',  // extensible: future values = 'all_members', 'fixed_email'
  subject: string,         // email subject, supports {address} placeholder
  template: string,        // template key, matches a template in the Netlify function
}
```

**First rule:**
```js
{
  event: 'offer_signed',
  trigger: { field: 'status', value: 'offer_signed' },
  recipient: 'assigned_user',
  subject: 'HAT signed contract — send offer ASAP: {address}',
  template: 'offer_signed',
}
```

Adding a new notification in the future = adding one object to this array. No other code changes required.

---

## Email Template: `offer_signed`

```
Hi {agent_name},

HAT has signed the contract on {address}, {city}, {state} {zip}.

Please send the offer to the listing agent immediately.

Deal details:
  MAO:          ${mao}
  Offer Price:  ${offer_price}
  ARV:          ${arv}
  Asking Price: ${asking_price}
  Seller:       {seller_name}

Once you've sent the offer, please update the deal status in HatCRM to "Offer Sent":
{lead_url}

— HAT Investors
```

---

## Data Flow

1. User changes lead status to `offer_signed` (via ActionZone or LeadForm)
2. `useLeadUpdate` saves the change to Supabase, then calls `useLeadNotifications(before, after, lead)`
3. Hook scans the config map for a matching rule (`trigger.field` changed to `trigger.value`)
4. On match, calls `POST /.netlify/functions/notify-lead-event` with `{ event, lead_id, workspace_id }`
5. Netlify function:
   - Fetches full lead from Supabase
   - Fetches assigned user's email via Supabase admin API (`/auth/v1/admin/users/{user_id}`)
   - Fetches workspace SMTP settings from `workspaces.settings`
   - Renders template with lead fields + `lead_url` = `https://{app_domain}/w/{workspace_id}/leads/{lead_id}`
   - Sends email via nodemailer (same SMTP infrastructure as `send-email.mjs`)
   - Returns `{ ok: true }` or `{ ok: false, error }`
6. Hook logs notification to activity timeline via `logEmailSent(lead_id, userId, { to, subject })`

---

## Files

| File | Action | Purpose |
|---|---|---|
| `src/lib/leadNotifications.js` | Create | Notification config map + `matchNotifications(before, after)` helper |
| `netlify/functions/notify-lead-event.mjs` | Create | Generic notification function: fetch lead, render template, send email |
| `src/hooks/useLeadNotifications.js` | Create | Hook: matches rules, calls Netlify function, logs activity |
| `src/hooks/useLeadUpdate.js` | Modify | Call `useLeadNotifications` after successful lead update |

---

## Error Handling

All notification errors are **silent and non-blocking** — the status change has already been saved to the DB and must not be rolled back or surfaced as an error to the user.

Specific cases:
- `assigned_to` is null or `visible_to_all` is true → skip (no specific agent to notify)
- Assigned user email not found → skip
- Workspace SMTP not configured → skip
- Email send fails → log to console only, do not throw

---

## Success Criteria

- When a lead status changes to `offer_signed`, the assigned agent receives an email within seconds
- Email contains address, MAO, offer price, ARV, asking price, seller name, and direct CRM link
- Notification appears in the lead's activity timeline
- Adding a new notification rule in the future requires only adding one entry to the config map in `src/lib/leadNotifications.js`
- Status change is never blocked or rolled back due to a notification failure

---

## Out of Scope

- Notifications for statuses other than `offer_signed` (future work)
- In-app notifications / push notifications
- Email open/click tracking
- Notification preferences per user
- Retry logic for failed sends
