# Lead Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send an automated email to the assigned agent when a lead status changes to `offer_signed`, using an extensible notification engine that supports adding more triggers in the future with a single config entry.

**Architecture:** A notification config map in `src/lib/leadNotifications.js` defines rules (trigger field/value → email template/recipient). The `useLeadUpdate` hook calls a new `fireLeadNotifications(before, after)` function after every save. If a rule matches, it POSTs to a new `notify-lead-event` Netlify function which fetches the assigned user's email via the Supabase admin API, renders the template, and sends via the workspace's existing SMTP settings. The notification is logged to the lead's activity timeline.

**Tech Stack:** React hooks, Netlify Functions, Supabase JS client, Supabase Admin API, nodemailer (already installed)

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/lib/leadNotifications.js` | Create | Config map + `matchNotifications(before, after)` + `fireLeadNotifications(...)` |
| `netlify/functions/notify-lead-event.mjs` | Create | Fetch lead + user email, check if enabled, render template, send email |
| `src/hooks/useLeadUpdate.js` | Modify | Call `fireLeadNotifications` after successful update |
| `src/components/settings/NotificationTriggersForm.jsx` | Create | Settings UI to enable/disable each notification rule per workspace |

---

## Task 1: Create the notification config and matcher

**Files:**
- Create: `src/lib/leadNotifications.js`

- [ ] **Step 1: Create the file**

```js
// src/lib/leadNotifications.js
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
  return LEAD_NOTIFICATIONS.filter(rule => {
    const { field, value } = rule.trigger
    return after[field] === value && before[field] !== value
  })
}
```

- [ ] **Step 2: Verify the matcher logic manually**

In your browser console or a scratch file:
```js
import { matchNotifications } from './src/lib/leadNotifications.js'

// Should return the offer_signed rule
console.log(matchNotifications({ status: 'triage' }, { status: 'offer_signed' }))
// → [{ event: 'offer_signed', ... }]

// Should return empty — status didn't change to offer_signed
console.log(matchNotifications({ status: 'offer_signed' }, { status: 'offer_signed' }))
// → []

// Should return empty — different status
console.log(matchNotifications({ status: 'triage' }, { status: 'sold' }))
// → []
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/leadNotifications.js
git commit -m "feat: add lead notification config map and matcher"
```

---

## Task 2: Create the notify-lead-event Netlify function

This function receives `{ event, lead_id, workspace_id }`, fetches the lead and the assigned user's email, renders the template, and sends via the workspace SMTP.

**Files:**
- Create: `netlify/functions/notify-lead-event.mjs`

- [ ] **Step 1: Create the function**

```js
// netlify/functions/notify-lead-event.mjs
// Generic lead event notification function.
// POST body: { event, lead_id, workspace_id }
// Fetches lead, resolves recipient email, renders template, sends email.

import nodemailer from 'nodemailer'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_PAT = process.env.SUPABASE_PAT
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP_URL      = process.env.URL || 'https://hatcrm.netlify.app'

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

function supabaseHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }
}

async function fetchLead(leadId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}&select=*`,
    { headers: supabaseHeaders(SUPABASE_PAT) }
  )
  if (!res.ok) throw new Error(`Failed to fetch lead: HTTP ${res.status}`)
  const rows = await res.json()
  if (!rows?.length) throw new Error('Lead not found')
  return rows[0]
}

async function fetchWorkspaceSettings(workspaceId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/workspaces?id=eq.${workspaceId}&select=settings`,
    { headers: supabaseHeaders(SUPABASE_PAT) }
  )
  if (!res.ok) throw new Error(`Failed to fetch workspace: HTTP ${res.status}`)
  const rows = await res.json()
  return rows?.[0]?.settings || {}
}

async function fetchUserEmail(userId) {
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users/${userId}`,
    { headers: supabaseHeaders(SERVICE_KEY) }
  )
  if (!res.ok) return null
  const user = await res.json()
  return user?.email || null
}

async function fetchUserName(userId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=full_name`,
    { headers: supabaseHeaders(SUPABASE_PAT) }
  )
  if (!res.ok) return 'Agent'
  const rows = await res.json()
  return rows?.[0]?.full_name || 'Agent'
}

function fmt(n) {
  if (n == null) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function renderTemplate(template, lead, agentName, leadUrl) {
  switch (template) {
    case 'offer_signed':
      return [
        `Hi ${agentName},`,
        '',
        `HAT has signed the contract on ${lead.address}, ${lead.city || ''}, ${lead.state || ''} ${lead.zip_code || ''}.`.trim(),
        '',
        'Please send the offer to the listing agent immediately.',
        '',
        'Deal details:',
        `  MAO:          ${fmt(lead.mao)}`,
        `  Offer Price:  ${fmt(lead.offer_price)}`,
        `  ARV:          ${fmt(lead.arv)}`,
        `  Asking Price: ${fmt(lead.asking_price)}`,
        `  Seller:       ${lead.seller_name || '—'}`,
        '',
        'Once you\'ve sent the offer, please update the deal status in HatCRM to "Offer Sent":',
        leadUrl,
        '',
        '— HAT Investors',
      ].join('\n')
    default:
      throw new Error(`Unknown template: ${template}`)
  }
}

function renderSubject(subjectTemplate, lead) {
  return subjectTemplate.replace('{address}', lead.address || '')
}

function createTransport(settings) {
  const host     = settings.mail_smtp_host
  const port     = Number(settings.mail_smtp_port) || 587
  const user     = settings.mail_smtp_user
  const pass     = settings.mail_smtp_password
  const secure   = settings.mail_smtp_secure === true
  const starttls = settings.mail_smtp_starttls !== false && !secure

  if (!host || !user || !pass) throw new Error('SMTP not configured')

  return nodemailer.createTransport({
    host, port, secure,
    auth: { user, pass },
    ...(starttls ? { requireTLS: true } : {}),
  })
}

// Notification config — mirrors src/lib/leadNotifications.js (server-side copy)
const TEMPLATES = {
  offer_signed: {
    recipient: 'assigned_user',
    subjectTemplate: 'HAT signed contract — send offer ASAP: {address}',
    template: 'offer_signed',
  },
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: HEADERS })
  }

  try {
    const { event, lead_id, workspace_id } = await req.json().catch(() => ({}))

    if (!event || !lead_id || !workspace_id) {
      return new Response(JSON.stringify({ ok: false, error: 'event, lead_id, workspace_id required' }), { status: 400, headers: HEADERS })
    }

    const config = TEMPLATES[event]
    if (!config) {
      return new Response(JSON.stringify({ ok: false, error: `Unknown event: ${event}` }), { status: 400, headers: HEADERS })
    }

    const lead = await fetchLead(lead_id)

    // Resolve recipient
    if (!lead.assigned_to) {
      return new Response(JSON.stringify({ ok: true, skipped: 'no assigned user' }), { status: 200, headers: HEADERS })
    }
    const toEmail = await fetchUserEmail(lead.assigned_to)
    if (!toEmail) {
      return new Response(JSON.stringify({ ok: true, skipped: 'assigned user has no email' }), { status: 200, headers: HEADERS })
    }

    const agentName = await fetchUserName(lead.assigned_to)
    const leadUrl   = `${APP_URL}/w/${workspace_id}/leads/${lead_id}`
    const body      = renderTemplate(config.template, lead, agentName, leadUrl)
    const subject   = renderSubject(config.subjectTemplate, lead)

    const settings  = await fetchWorkspaceSettings(workspace_id)
    const transport = createTransport(settings)
    const fromName  = settings.mail_from_name?.trim()
    const fromEmail = settings.mail_from_email?.trim() || settings.mail_smtp_user
    const from      = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail

    await transport.sendMail({ from, to: toEmail, subject, text: body })

    return new Response(JSON.stringify({ ok: true, to: toEmail }), { status: 200, headers: HEADERS })
  } catch (err) {
    // Log but don't expose internal errors
    console.error('[notify-lead-event]', err.message)
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: HEADERS })
  }
}
```

- [ ] **Step 2: Verify the file is in place**

```bash
ls netlify/functions/notify-lead-event.mjs
```

Expected: file exists, no error.

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/notify-lead-event.mjs
git commit -m "feat: add notify-lead-event Netlify function"
```

---

## Task 3: Wire notifications into useLeadUpdate

After every successful lead update, check for matching notification rules and fire them. Errors are caught silently — the status change must never fail due to a notification issue.

**Files:**
- Modify: `src/hooks/useLeadUpdate.js`

- [ ] **Step 1: Read the current file**

Current content of `src/hooks/useLeadUpdate.js`:

```js
import { supabase } from '../lib/supabase'
import { logChanges } from '../lib/activityLogger'
import { calculateMAO } from '../lib/calculations'

export function useLeadUpdate(lead, userId, members, onUpdated) {
  return async function update(patch) {
    const next = { ...lead, ...patch }

    if ('mao' in patch === false && ('arv' in patch || 'renovation_cost' in patch)) {
      const mao = calculateMAO(next.arv, next.renovation_cost)
      if (mao !== null) patch.mao = mao
    }

    const TERMINAL = ['sold','dead_lead','rejected_not_accepted','not_in_buy_box','sequence_completed']
    if ('status' in patch && TERMINAL.includes(patch.status)) {
      patch.follow_up_date = null
    }

    const { data: updated, error } = await supabase
      .from('leads')
      .update(patch)
      .eq('id', lead.id)
      .select()
      .single()

    if (error) {
      console.error('[useLeadUpdate] failed', error)
      throw error
    }

    if (updated) {
      const userLookup = Object.fromEntries((members || []).map(m => [m.user_id, m.profiles]))
      await logChanges(lead.id, userId, lead, updated, userLookup).catch(() => {})
      onUpdated?.(updated)
    }
    return updated
  }
}
```

- [ ] **Step 2: Add `fireLeadNotifications` to `src/lib/leadNotifications.js`**

Append this function to `src/lib/leadNotifications.js` (after the existing exports):

```js
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
```

- [ ] **Step 3: Update `src/hooks/useLeadUpdate.js`**

Replace the full file with:

```js
import { supabase } from '../lib/supabase'
import { logChanges } from '../lib/activityLogger'
import { calculateMAO } from '../lib/calculations'
import { fireLeadNotifications } from '../lib/leadNotifications'

export function useLeadUpdate(lead, userId, members, onUpdated) {
  return async function update(patch) {
    const next = { ...lead, ...patch }

    if ('mao' in patch === false && ('arv' in patch || 'renovation_cost' in patch)) {
      const mao = calculateMAO(next.arv, next.renovation_cost)
      if (mao !== null) patch.mao = mao
    }

    const TERMINAL = ['sold','dead_lead','rejected_not_accepted','not_in_buy_box','sequence_completed']
    if ('status' in patch && TERMINAL.includes(patch.status)) {
      patch.follow_up_date = null
    }

    const { data: updated, error } = await supabase
      .from('leads')
      .update(patch)
      .eq('id', lead.id)
      .select()
      .single()

    if (error) {
      console.error('[useLeadUpdate] failed', error)
      throw error
    }

    if (updated) {
      const userLookup = Object.fromEntries((members || []).map(m => [m.user_id, m.profiles]))
      await logChanges(lead.id, userId, lead, updated, userLookup).catch(() => {})
      fireLeadNotifications(lead, updated, lead.workspace_id, userId).catch(() => {})
      onUpdated?.(updated)
    }
    return updated
  }
}
```

Note: `fireLeadNotifications` is called without `await` — it runs in the background so it never blocks the status change from completing.

- [ ] **Step 4: Commit**

```bash
git add src/lib/leadNotifications.js src/hooks/useLeadUpdate.js
git commit -m "feat: wire lead notifications into useLeadUpdate"
```

---

## Task 4: Manual end-to-end verification

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Open a lead that is assigned to a user with a valid email and has MAO/offer fields filled**

If no such lead exists, create one:
- Address: 123 Test Street
- Status: triage
- Assign to Kevin (or any user whose email you can check)
- MAO: $150,000, Offer Price: $145,000, ARV: $220,000, Asking Price: $180,000, Seller: Test Seller

- [ ] **Step 3: Change the lead status to "Offer Signed"**

Via ActionZone or the status picker in the lead detail page.

- [ ] **Step 4: Check Kevin's email inbox**

Expected email:
```
Subject: HAT signed contract — send offer ASAP: 123 Test Street

Hi Kevin,

HAT has signed the contract on 123 Test Street, Jacksonville, FL ...

Please send the offer to the listing agent immediately.

Deal details:
  MAO:          $150,000
  Offer Price:  $145,000
  ARV:          $220,000
  Asking Price: $180,000
  Seller:       Test Seller

Once you've sent the offer, please update the deal status in HatCRM to "Offer Sent":
http://localhost:5173/w/.../leads/...

— HAT Investors
```

- [ ] **Step 5: Check the lead's activity timeline**

Expected: a new activity entry — `Email sent to kevin@... — Subject: "HAT signed contract — send offer ASAP: 123 Test Street"`

- [ ] **Step 6: Push to deploy**

```bash
git push origin main
```

Netlify auto-deploys. Test once more on the live URL to confirm the function works in production (dev server uses Netlify Dev for functions; production uses the actual Netlify runtime).

---

## Task 5: Settings UI — enable/disable notification triggers

Admins need to control which notifications are active without touching code. Notification enabled state is stored in `workspace.settings.notifications` as `{ offer_signed: true }`. The Netlify function reads this before sending. The settings form lets admins toggle each rule on/off.

**Files:**
- Create: `src/components/settings/NotificationTriggersForm.jsx`
- Modify: `netlify/functions/notify-lead-event.mjs` — check enabled state before sending

**How settings are stored:** `workspace.settings` is a JSONB column. Notification enabled state lives at key `notifications`: `{ "offer_signed": true }`. Default (key absent) = enabled, so existing workspaces automatically get notifications without needing to save settings first.

- [ ] **Step 1: Update `notify-lead-event.mjs` to check enabled state**

In the handler, after `const settings = await fetchWorkspaceSettings(workspace_id)`, add this check before sending:

```js
// Check if this notification is enabled (default: true if not configured)
const notifSettings = settings.notifications || {}
if (notifSettings[event] === false) {
  return new Response(JSON.stringify({ ok: true, skipped: 'notification disabled' }), { status: 200, headers: HEADERS })
}
```

Insert it right before the `createTransport(settings)` call. The full updated block around that area:

```js
    const settings  = await fetchWorkspaceSettings(workspace_id)

    // Check if this notification is enabled (default: true if not configured)
    const notifSettings = settings.notifications || {}
    if (notifSettings[event] === false) {
      return new Response(JSON.stringify({ ok: true, skipped: 'notification disabled' }), { status: 200, headers: HEADERS })
    }

    const transport = createTransport(settings)
```

- [ ] **Step 2: Create `src/components/settings/NotificationTriggersForm.jsx`**

```jsx
import { useState } from 'react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import { supabase } from '../../lib/supabase'
import { LEAD_NOTIFICATIONS } from '../../lib/leadNotifications'

// Human-readable labels for each notification event
const EVENT_LABELS = {
  offer_signed: {
    label: 'Contract Signed — Notify Agent',
    description: 'Sends an email to the assigned agent when a lead status changes to "Offer Signed", asking them to send the offer to the listing agent immediately.',
  },
}

export default function NotificationTriggersForm({ workspace, canEdit, onUpdated }) {
  const initial = workspace?.settings?.notifications || {}
  const [enabled, setEnabled] = useState(
    () => Object.fromEntries(LEAD_NOTIFICATIONS.map(r => [r.event, initial[r.event] !== false]))
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [dirty, setDirty] = useState(false)

  const toggle = (event) => {
    setEnabled(prev => ({ ...prev, [event]: !prev[event] }))
    setDirty(true)
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const currentSettings = workspace?.settings || {}
      const { error: err } = await supabase
        .from('workspaces')
        .update({ settings: { ...currentSettings, notifications: enabled } })
        .eq('id', workspace.id)
      if (err) throw err
      setSaved(true)
      setDirty(false)
      onUpdated?.({ ...workspace, settings: { ...currentSettings, notifications: enabled } })
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="Notification Triggers">
      <div className="space-y-4">
        <p className="text-[12px] text-[color:var(--color-text-muted)]">
          Control which automated email notifications are sent when lead events occur.
          Emails are sent via the configured mail server to the assigned agent.
        </p>

        {LEAD_NOTIFICATIONS.map(rule => {
          const meta = EVENT_LABELS[rule.event] || { label: rule.event, description: '' }
          return (
            <div key={rule.event} className="flex items-start gap-3 p-3 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)]">
              <input
                type="checkbox"
                id={`notif-${rule.event}`}
                checked={enabled[rule.event] ?? true}
                onChange={() => toggle(rule.event)}
                disabled={!canEdit}
                className="mt-0.5 accent-[color:var(--color-accent)]"
              />
              <label htmlFor={`notif-${rule.event}`} className="flex-1 cursor-pointer">
                <div className="text-[13px] font-medium text-[color:var(--color-text)]">{meta.label}</div>
                <div className="text-[11.5px] text-[color:var(--color-text-muted)] mt-0.5">{meta.description}</div>
                <div className="text-[11px] text-[color:var(--color-text-dim)] mt-1 font-mono">
                  Trigger: status → {rule.trigger.value} · Recipient: {rule.recipient}
                </div>
              </label>
            </div>
          )
        })}

        {error && (
          <div className="text-[12px] text-[color:var(--color-danger-text)] bg-[color:var(--color-danger-soft)] px-3 py-2 rounded">
            {error}
          </div>
        )}

        {canEdit && (
          <div className="flex items-center gap-3">
            <Button onClick={handleSave} loading={saving} disabled={!dirty}>
              Save
            </Button>
            {saved && <span className="text-[12px] text-[color:var(--color-success-text)]">Saved</span>}
          </div>
        )}
      </div>
    </Card>
  )
}
```

- [ ] **Step 3: Find where settings forms are rendered and add NotificationTriggersForm**

Look for the Settings page that renders `MailServerForm` and `ActionTriggersForm`. It will be in `src/pages/` or `src/components/`. Find the file and add the import and component:

```jsx
import NotificationTriggersForm from '../components/settings/NotificationTriggersForm'
```

Add it after `MailServerForm` in the JSX:
```jsx
<NotificationTriggersForm workspace={workspace} canEdit={canEdit} onUpdated={onUpdated} />
```

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/notify-lead-event.mjs src/components/settings/NotificationTriggersForm.jsx
git commit -m "feat: add notification triggers settings UI and per-workspace enable/disable"
```

---

## Task 6: Final end-to-end verification with settings

- [ ] **Step 1: Open Settings → Notification Triggers**

Verify the "Contract Signed — Notify Agent" toggle is visible and checked by default.

- [ ] **Step 2: Test that disabling works**

Uncheck the toggle, save, then change a lead status to `offer_signed`. Confirm no email is sent.

- [ ] **Step 3: Re-enable and verify email sends again**

Re-check the toggle, save, change another lead to `offer_signed`. Confirm email arrives.

- [ ] **Step 4: Push**

```bash
git push origin main
```
