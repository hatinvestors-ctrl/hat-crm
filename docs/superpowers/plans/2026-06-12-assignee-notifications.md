# Assignee Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send per-user email notifications to whoever a lead is assigned to when specific events occur, with each notification type independently toggleable per user from an admin settings grid.

**Architecture:** A `notification_prefs` JSONB column on `workspace_members` stores per-user toggles (default `true` when key absent). React triggers call a new `fireLeadNotification()` helper that POSTs to the existing `notify-lead-event.mjs` Netlify function, which checks per-user prefs, fetches activity history, renders a 3-section email (summary + event + history), and sends via workspace SMTP. Admin manages all user preferences from a new "Assignee Notifications" tab in Settings.

**Tech Stack:** Supabase (JSONB column, REST API), React, nodemailer (existing), existing `notify-lead-event.mjs` Netlify function.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260612000000_member_notification_prefs.sql` | Create | ALTER TABLE migration |
| `src/lib/leadNotifications.js` | Modify | Add `fireLeadNotification` (single event), extend LEAD_NOTIFICATIONS |
| `netlify/functions/notify-lead-event.mjs` | Modify | Per-user prefs check, activity history, all 11 email templates |
| `src/components/settings/AssigneeNotificationsForm.jsx` | Create | Settings grid — members × notification types |
| `src/pages/SettingsPage.jsx` | Modify | Add "Assignee Notifications" tab |
| `src/components/lead-detail/CommentBox.jsx` | Modify | Fire `comment` notification after post |
| `src/components/lead-detail/FinancialSection.jsx` | Modify | Fire `deal_analysis` notification after analyze |
| `src/hooks/useLeadUpdate.js` | Modify | Fire `assigned`, `offer_price`, `follow_up_date` notifications |

---

## Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/20260612000000_member_notification_prefs.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260612000000_member_notification_prefs.sql
ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.workspace_members.notification_prefs IS
  'Per-user notification preferences. Keys: assigned, status_change, offer_signed, closed, dead, comment, file_attached, deal_analysis, offer_price, follow_up_date, enriched. Missing key = enabled (true by default).';
```

- [ ] **Step 2: Run in Supabase SQL editor**

Open the Supabase dashboard → SQL editor → paste and run the migration above.

Expected: "Success. No rows returned."

- [ ] **Step 3: Verify column exists**

Run in SQL editor:
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'workspace_members' AND column_name = 'notification_prefs';
```

Expected: one row showing `notification_prefs`, `jsonb`, `'{}'::jsonb`.

- [ ] **Step 4: Commit the migration file**

```bash
git add supabase/migrations/20260612000000_member_notification_prefs.sql
git commit -m "feat: add notification_prefs column to workspace_members"
```

---

## Task 2: Extend leadNotifications.js

**Files:**
- Modify: `src/lib/leadNotifications.js`

This task adds:
1. `ASSIGNEE_NOTIFICATION_EVENTS` — the master list of all 11 event keys with labels (used by the settings UI)
2. `fireLeadNotification(event, leadId, workspaceId, actorUserId, extra)` — fires a single explicit event (used for comment, deal_analysis, etc.)
3. Two new entries in `LEAD_NOTIFICATIONS` for `closed` and `dead` status transitions
4. Extension to `matchNotifications` for a `status_change` catch-all

- [ ] **Step 1: Replace the entire file with the extended version**

```js
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/leadNotifications.js
git commit -m "feat: extend leadNotifications with 11 event types and fireLeadNotification helper"
```

---

## Task 3: Extend notify-lead-event.mjs

**Files:**
- Modify: `netlify/functions/notify-lead-event.mjs`

This is the largest change. The function gains:
1. `fetchAssigneeMemberPrefs(assignedUserId, workspaceId)` — reads `notification_prefs` from `workspace_members`
2. `fetchActivityHistory(leadId)` — last 5 `lead_activities` with user name
3. `renderLeadSummary(lead)` — 4-line property header for every email
4. `renderActivityHistory(activities)` — formatted plain-text history block
5. All 11 email templates in `renderEventSection(event, lead, extra, actorName, leadUrl)`
6. Per-user pref check replacing the old workspace-level check
7. `actor_user_id` and `extra` accepted from request body

- [ ] **Step 1: Replace the entire file**

```js
// netlify/functions/notify-lead-event.mjs
import nodemailer from 'nodemailer'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_PAT = SERVICE_KEY || process.env.SUPABASE_PAT
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
  if (!rows?.length) throw new Error('Workspace not found.')
  return rows[0].settings || {}
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

// Fetches the assignee's notification_prefs from workspace_members.
// Returns {} if not found (all events default to enabled).
async function fetchAssigneeMemberPrefs(userId, workspaceId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/workspace_members?user_id=eq.${userId}&workspace_id=eq.${workspaceId}&select=notification_prefs`,
    { headers: supabaseHeaders(SUPABASE_PAT) }
  )
  if (!res.ok) return {}
  const rows = await res.json()
  return rows?.[0]?.notification_prefs || {}
}

// Fetches last 5 lead_activities with the commenter/actor name.
async function fetchActivityHistory(leadId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/lead_activities?lead_id=eq.${leadId}&select=type,content,created_at,profiles:user_id(full_name)&order=created_at.desc&limit=5`,
    { headers: supabaseHeaders(SUPABASE_PAT) }
  )
  if (!res.ok) return []
  return await res.json()
}

function fmt(n) {
  if (n == null) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function renderLeadSummary(lead) {
  const addr = [lead.address, lead.city, lead.state].filter(Boolean).join(', ')
  return [
    '── LEAD SUMMARY ─────────────────────────────',
    `Address:      ${addr || '—'}`,
    `Status:       ${lead.status || '—'}`,
    `Offer Price:  ${fmt(lead.offer_price || lead.mao)}`,
    `ARV:          ${fmt(lead.arv)}`,
  ].join('\n')
}

function renderActivityHistory(activities) {
  if (!activities?.length) return '── RECENT ACTIVITY ───────────────────────────\n(no activity yet)'
  const lines = activities.map(a => {
    const who  = a.profiles?.full_name || 'System'
    const date = fmtDate(a.created_at)
    const text = a.content?.slice(0, 120) || ''
    return `${date} · ${who} · ${text}`
  })
  return ['── RECENT ACTIVITY ───────────────────────────', ...lines].join('\n')
}

// Returns the event-specific middle section of the email.
function renderEventSection(event, lead, extra, actorName, leadUrl) {
  const actor = actorName || 'A team member'
  switch (event) {
    case 'assigned':
      return [
        '── LEAD ASSIGNED TO YOU ──────────────────────',
        `Assigned by: ${actor}`,
        '',
        `View lead: ${leadUrl}`,
      ].join('\n')

    case 'status_change': {
      const from = extra?.old_status || '—'
      const to   = extra?.new_status || '—'
      return [
        '── STATUS CHANGED ────────────────────────────',
        `From:        ${from}`,
        `To:          ${to}`,
        `Changed by:  ${actor}`,
        '',
        `View lead: ${leadUrl}`,
      ].join('\n')
    }

    case 'offer_signed':
      return [
        '── CONTRACT SIGNED ───────────────────────────',
        'HAT has signed the contract. Please send the offer to the listing agent immediately.',
        '',
        `Listing agent: ${lead.listing_agent_name || '—'}  ${lead.listing_agent_phone || ''}`,
        '',
        `Update status to "Offer Sent" once done: ${leadUrl}`,
      ].join('\n')

    case 'closed':
      return [
        '── LEAD CLOSED / WON ─────────────────────────',
        `Marked closed by: ${actor}`,
        '',
        `View lead: ${leadUrl}`,
      ].join('\n')

    case 'dead':
      return [
        '── LEAD MARKED DEAD ──────────────────────────',
        `Marked dead by: ${actor}`,
        '',
        `View lead: ${leadUrl}`,
      ].join('\n')

    case 'comment': {
      const text = extra?.comment_text || '(no content)'
      return [
        '── NEW COMMENT ───────────────────────────────',
        `From: ${actor}`,
        '',
        text,
        '',
        `View lead: ${leadUrl}`,
      ].join('\n')
    }

    case 'file_attached':
      return [
        '── FILE ATTACHED ─────────────────────────────',
        `File: ${extra?.filename || '(unnamed)'}`,
        `Attached by: ${actor}`,
        '',
        `View lead: ${leadUrl}`,
      ].join('\n')

    case 'deal_analysis': {
      const verdict = extra?.verdict || '—'
      const profit  = extra?.profit  != null ? fmt(extra.profit) : '—'
      const roi     = extra?.roi     != null ? `${extra.roi}%` : '—'
      const cash    = extra?.total_cash_needed != null ? fmt(extra.total_cash_needed) : '—'
      return [
        '── DEAL ANALYSIS RUN ─────────────────────────',
        `Verdict:      ${verdict}`,
        `Est. Profit:  ${profit}`,
        `ROI:          ${roi}`,
        `Cash Needed:  ${cash}`,
        '',
        `View analysis: ${leadUrl}`,
      ].join('\n')
    }

    case 'offer_price':
      return [
        '── OFFER PRICE UPDATED ───────────────────────',
        `From: ${extra?.old_value || '—'}`,
        `To:   ${extra?.new_value || '—'}`,
        `Updated by: ${actor}`,
        '',
        `View lead: ${leadUrl}`,
      ].join('\n')

    case 'follow_up_date':
      return [
        '── FOLLOW-UP DATE CHANGED ────────────────────',
        `Set to: ${extra?.new_value || '—'}`,
        `Updated by: ${actor}`,
        '',
        `View lead: ${leadUrl}`,
      ].join('\n')

    case 'enriched':
      return [
        '── LEAD ENRICHED (MLS/RENTCAST) ──────────────',
        extra?.summary || 'MLS data was updated.',
        '',
        `View lead: ${leadUrl}`,
      ].join('\n')

    default:
      return `── EVENT: ${event} ────────────────────────────\nView lead: ${leadUrl}`
  }
}

// Email subject per event
function renderSubject(event, lead, extra) {
  const addr = lead.address || 'lead'
  switch (event) {
    case 'assigned':       return `Lead assigned to you: ${addr}`
    case 'status_change':  return `Status update on ${addr}: ${extra?.old_status || '?'} → ${extra?.new_status || '?'}`
    case 'offer_signed':   return `HAT signed contract — send offer ASAP: ${addr}`
    case 'closed':         return `Lead closed: ${addr}`
    case 'dead':           return `Lead marked dead: ${addr}`
    case 'comment':        return `New comment on ${addr}`
    case 'file_attached':  return `File attached to ${addr}`
    case 'deal_analysis':  return `Deal analysis on ${addr}: ${extra?.verdict || '?'}`
    case 'offer_price':    return `Offer price updated on ${addr}`
    case 'follow_up_date': return `Follow-up date changed on ${addr}`
    case 'enriched':       return `Lead enriched: ${addr}`
    default:               return `Update on ${addr}`
  }
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

const KNOWN_EVENTS = new Set([
  'assigned','status_change','offer_signed','closed','dead',
  'comment','file_attached','deal_analysis','offer_price','follow_up_date','enriched',
])

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: HEADERS })
  }

  if (!SUPABASE_URL || !SUPABASE_PAT || !SERVICE_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'Server misconfigured' }), { status: 500, headers: HEADERS })
  }

  try {
    const { event, lead_id, workspace_id, actor_user_id, extra = {} } =
      await req.json().catch(() => ({}))

    if (!event || !lead_id || !workspace_id) {
      return new Response(JSON.stringify({ ok: false, error: 'event, lead_id, workspace_id required' }), { status: 400, headers: HEADERS })
    }
    if (!KNOWN_EVENTS.has(event)) {
      return new Response(JSON.stringify({ ok: false, error: `Unknown event: ${event}` }), { status: 400, headers: HEADERS })
    }

    const lead = await fetchLead(lead_id)

    // Must have an assignee to notify
    if (!lead.assigned_to) {
      return new Response(JSON.stringify({ ok: true, skipped: 'no assigned user' }), { status: 200, headers: HEADERS })
    }

    // Check per-user preference (missing key = enabled by default)
    const prefs = await fetchAssigneeMemberPrefs(lead.assigned_to, workspace_id)
    if (prefs[event] === false) {
      return new Response(JSON.stringify({ ok: true, skipped: 'notification disabled for user' }), { status: 200, headers: HEADERS })
    }

    // Also check workspace-level master toggle (legacy — keeps backward compat)
    const settings = await fetchWorkspaceSettings(workspace_id)
    const wsNotifs = settings.notifications || {}
    if (wsNotifs[event] === false) {
      return new Response(JSON.stringify({ ok: true, skipped: 'notification disabled workspace-wide' }), { status: 200, headers: HEADERS })
    }

    const toEmail = await fetchUserEmail(lead.assigned_to)
    if (!toEmail) {
      return new Response(JSON.stringify({ ok: true, skipped: 'assigned user has no email' }), { status: 200, headers: HEADERS })
    }

    // Resolve names
    const [assigneeName, actorName, activities] = await Promise.all([
      fetchUserName(lead.assigned_to),
      actor_user_id ? fetchUserName(actor_user_id) : Promise.resolve('System'),
      fetchActivityHistory(lead_id),
    ])

    const leadUrl     = `${APP_URL}/w/${workspace_id}/leads/${lead_id}`
    const subject     = renderSubject(event, lead, extra)
    const summaryBlock = renderLeadSummary(lead)
    const eventBlock   = renderEventSection(event, lead, extra, actorName, leadUrl)
    const historyBlock = renderActivityHistory(activities)

    const body = [
      `Hi ${assigneeName},`,
      '',
      summaryBlock,
      '',
      eventBlock,
      '',
      historyBlock,
      '',
      '— HAT Investors',
    ].join('\n')

    const transport = createTransport(settings)
    const fromName  = settings.mail_from_name?.trim()
    const fromEmail = settings.mail_from_email?.trim() || settings.mail_smtp_user
    const from      = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail
    const cc        = settings.notification_cc || undefined

    await transport.sendMail({ from, to: toEmail, cc, subject, text: body })

    return new Response(JSON.stringify({ ok: true, to: toEmail, subject }), { status: 200, headers: HEADERS })
  } catch (err) {
    console.error('[notify-lead-event]', err.message)
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: HEADERS })
  }
}
```

- [ ] **Step 2: Verify the function parses**

```bash
node -e "import('./netlify/functions/notify-lead-event.mjs').then(() => console.log('OK')).catch(e => console.error(e.message))"
```

Expected output: `OK`

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/notify-lead-event.mjs
git commit -m "feat: extend notify-lead-event with per-user prefs, 11 event templates, activity history"
```

---

## Task 4: Create AssigneeNotificationsForm.jsx

**Files:**
- Create: `src/components/settings/AssigneeNotificationsForm.jsx`

This is an admin-only grid: rows = workspace members, columns = 11 notification types. Each cell is a checkbox. Save button per row.

- [ ] **Step 1: Create the file**

```jsx
import { useState, useEffect } from 'react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import { supabase } from '../../lib/supabase'
import { ASSIGNEE_NOTIFICATION_EVENTS } from '../../lib/leadNotifications'

export default function AssigneeNotificationsForm({ workspaceId, members, canEdit }) {
  // prefs: { [userId]: { [eventKey]: boolean } }
  const [prefs, setPrefs]     = useState({})
  const [saving, setSaving]   = useState({}) // { [userId]: boolean }
  const [saved, setSaved]     = useState({}) // { [userId]: boolean }
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (!workspaceId) return
    supabase
      .from('workspace_members')
      .select('user_id, notification_prefs')
      .eq('workspace_id', workspaceId)
      .then(({ data, error }) => {
        if (error) { setError(error.message); return }
        const map = {}
        for (const row of data || []) map[row.user_id] = row.notification_prefs || {}
        setPrefs(map)
      })
  }, [workspaceId])

  const toggle = (userId, eventKey) => {
    setPrefs(prev => {
      const userPrefs = prev[userId] ?? {}
      // Missing key = true (default enabled), explicit false = disabled
      const current = userPrefs[eventKey] !== false
      return { ...prev, [userId]: { ...userPrefs, [eventKey]: !current } }
    })
    setSaved(prev => ({ ...prev, [userId]: false }))
  }

  const saveUser = async (userId) => {
    setSaving(prev => ({ ...prev, [userId]: true }))
    setError(null)
    const { error: err } = await supabase
      .from('workspace_members')
      .update({ notification_prefs: prefs[userId] || {} })
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
    setSaving(prev => ({ ...prev, [userId]: false }))
    if (err) { setError(err.message); return }
    setSaved(prev => ({ ...prev, [userId]: true }))
  }

  const isChecked = (userId, eventKey) => {
    const userPrefs = prefs[userId] ?? {}
    return userPrefs[eventKey] !== false
  }

  return (
    <Card title="Assignee Notifications">
      <p className="text-[12px] text-[color:var(--color-text-muted)] mb-4">
        Control which email notifications each team member receives for leads assigned to them.
        All notifications are enabled by default.
      </p>

      {error && (
        <div className="mb-3 text-[12px] text-[color:var(--color-danger-text)] bg-[color:var(--color-danger-soft)] px-3 py-2 rounded">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="border-b border-[color:var(--color-line)]">
              <th className="text-left pb-2 pr-3 font-semibold text-[color:var(--color-text-muted)] min-w-[120px]">Member</th>
              {ASSIGNEE_NOTIFICATION_EVENTS.map(ev => (
                <th key={ev.key} className="pb-2 px-1 font-medium text-[color:var(--color-text-muted)] text-center max-w-[70px]">
                  <span className="block leading-tight">{ev.label}</span>
                </th>
              ))}
              <th className="pb-2 pl-3 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {(members || []).map(member => {
              const profile = member.profiles
              const uid     = member.user_id
              const name    = profile?.full_name || uid?.slice(0, 8) || 'Unknown'
              return (
                <tr key={uid} className="border-b border-[color:var(--color-line)] last:border-0">
                  <td className="py-2 pr-3">
                    <span className="font-medium text-[color:var(--color-text)]">{name}</span>
                    <span className="ml-1.5 text-[10px] text-[color:var(--color-text-dim)] capitalize">{member.role}</span>
                  </td>
                  {ASSIGNEE_NOTIFICATION_EVENTS.map(ev => (
                    <td key={ev.key} className="py-2 px-1 text-center">
                      <input
                        type="checkbox"
                        checked={isChecked(uid, ev.key)}
                        onChange={() => toggle(uid, ev.key)}
                        disabled={!canEdit}
                        className="accent-[color:var(--color-accent)] w-3.5 h-3.5"
                        title={ev.label}
                      />
                    </td>
                  ))}
                  <td className="py-2 pl-3">
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => saveUser(uid)}
                        loading={saving[uid]}
                        disabled={!canEdit || saving[uid]}
                      >
                        Save
                      </Button>
                      {saved[uid] && (
                        <span className="text-[10.5px] text-[color:var(--color-success-text)]">✓</span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/settings/AssigneeNotificationsForm.jsx
git commit -m "feat: AssigneeNotificationsForm settings grid for per-user notification prefs"
```

---

## Task 5: Add Tab to SettingsPage.jsx

**Files:**
- Modify: `src/pages/SettingsPage.jsx`

- [ ] **Step 1: Add import and new tab entry**

At the top of the file, add the import after the existing imports:
```js
import AssigneeNotificationsForm from '../components/settings/AssigneeNotificationsForm'
```

Replace the `TABS` array with:
```js
const TABS = [
  { id: 'workspace',    label: 'Workspace' },
  { id: 'triggers',     label: 'Action Triggers' },
  { id: 'mls',          label: 'MLS Auto-Refresh' },
  { id: 'mail',         label: 'Mail Server' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'assignee_notif', label: 'Assignee Notifications' },
  { id: 'users',        label: 'Users' },
]
```

Add the tab panel after the existing `notifications` panel (around line 64):
```jsx
{tab === 'assignee_notif' && (
  <AssigneeNotificationsForm
    workspaceId={workspaceId}
    members={members}
    canEdit={userRole === 'admin'}
  />
)}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/SettingsPage.jsx
git commit -m "feat: add Assignee Notifications tab to Settings page"
```

---

## Task 6: Wire Event Triggers

**Files:**
- Modify: `src/components/lead-detail/CommentBox.jsx`
- Modify: `src/components/lead-detail/FinancialSection.jsx`
- Modify: `src/hooks/useLeadUpdate.js`

### 6a — CommentBox: fire `comment` notification

The `CommentBox` needs `lead` and `workspaceId` props to fire the notification. Currently it only has `leadId` and `userId`. Update the call site in `LeadDetailPage.jsx` and the component itself.

- [ ] **Step 1: Update CommentBox.jsx**

Replace the file content:
```jsx
import { useState } from 'react'
import Button from '../ui/Button'
import { logComment } from '../../lib/activityLogger'
import { fireLeadNotification } from '../../lib/leadNotifications'

export default function CommentBox({ leadId, userId, workspaceId, onPosted, commentText }) {
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)

  const post = async () => {
    if (!text.trim()) return
    setPosting(true)
    await logComment(leadId, userId, text)
    if (workspaceId) {
      fireLeadNotification('comment', leadId, workspaceId, userId, { comment_text: text.trim() })
        .catch(() => {})
    }
    setText('')
    setPosting(false)
    onPosted?.()
  }

  return (
    <div className="bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-lg p-3 focus-within:border-[color:var(--color-accent)] focus-within:ring-1 focus-within:ring-[color:var(--color-accent)] transition-colors">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Leave a comment…"
        rows={2}
        className="w-full text-[13px] text-[color:var(--color-text)] bg-transparent placeholder:text-[color:var(--color-text-faint)] resize-none focus:outline-none leading-relaxed"
      />
      <div className="flex justify-end">
        <Button size="sm" onClick={post} loading={posting} disabled={!text.trim()}>Post</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update the CommentBox call in LeadDetailPage.jsx**

Find the `<CommentBox` usage in `LeadDetailPage.jsx` (search for `CommentBox`) and add `workspaceId`:
```jsx
<CommentBox
  leadId={lead.id}
  userId={user.id}
  workspaceId={workspaceId}
  onPosted={() => setActivityRefresh(k => k + 1)}
/>
```

### 6b — FinancialSection: fire `deal_analysis` notification

- [ ] **Step 3: Update FinancialSection.jsx**

In `src/components/lead-detail/FinancialSection.jsx`, add the import at the top:
```js
import { fireLeadNotification } from '../../lib/leadNotifications'
```

In `handleAnalyze()`, after `onUpdated?.({ ...lead, deal_analysis: data.analysis })`, add:
```js
fireLeadNotification('deal_analysis', lead.id, workspaceId, userId, {
  verdict:           data.analysis?.verdict,
  profit:            data.analysis?.profit,
  roi:               data.analysis?.roi,
  total_cash_needed: data.analysis?.total_cash_needed,
}).catch(() => {})
```

### 6c — useLeadUpdate: fire `assigned`, `offer_price`, `follow_up_date`

- [ ] **Step 4: Update useLeadUpdate.js**

Replace the file:
```js
import { supabase } from '../lib/supabase'
import { logChanges } from '../lib/activityLogger'
import { calculateMAO } from '../lib/calculations'
import { fireLeadNotifications, fireLeadNotification } from '../lib/leadNotifications'

export function useLeadUpdate(lead, userId, members, onUpdated) {
  return async function update(patch) {
    const next = { ...lead, ...patch }

    // Auto-recalc MAO if ARV or renovation_cost changed and user didn't manually set MAO
    if ('mao' in patch === false && ('arv' in patch || 'renovation_cost' in patch)) {
      const mao = calculateMAO(next.arv, next.renovation_cost)
      if (mao !== null) patch.mao = mao
    }

    // Auto-clear follow_up_date when status moves to a terminal/closed state
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

      // assigned
      if ('assigned_to' in patch && patch.assigned_to !== lead.assigned_to) {
        fireLeadNotification('assigned', lead.id, lead.workspace_id, userId).catch(() => {})
      }

      // offer_price
      if ('offer_price' in patch && patch.offer_price !== lead.offer_price) {
        fireLeadNotification('offer_price', lead.id, lead.workspace_id, userId, {
          old_value: lead.offer_price != null ? `$${Number(lead.offer_price).toLocaleString()}` : '—',
          new_value: patch.offer_price != null ? `$${Number(patch.offer_price).toLocaleString()}` : '—',
        }).catch(() => {})
      }

      // follow_up_date
      if ('follow_up_date' in patch && patch.follow_up_date !== lead.follow_up_date) {
        fireLeadNotification('follow_up_date', lead.id, lead.workspace_id, userId, {
          new_value: patch.follow_up_date || '(cleared)',
        }).catch(() => {})
      }

      onUpdated?.(updated)
    }
    return updated
  }
}
```

- [ ] **Step 5: Commit all trigger changes**

```bash
git add src/components/lead-detail/CommentBox.jsx src/pages/LeadDetailPage.jsx src/components/lead-detail/FinancialSection.jsx src/hooks/useLeadUpdate.js
git commit -m "feat: wire comment, deal_analysis, assigned, offer_price, follow_up_date notification triggers"
```

---

## Task 7: Deploy and Smoke Test

- [ ] **Step 1: Push to trigger Netlify deploy**

```bash
git push
```

Wait ~2 minutes for Netlify to deploy.

- [ ] **Step 2: Open Settings → Assignee Notifications**

Navigate to Settings in HatCRM. Verify the new "Assignee Notifications" tab appears. Verify the grid shows all workspace members as rows and all 11 notification types as columns with checkboxes.

- [ ] **Step 3: Toggle a notification off for one user and save**

Uncheck one event for a user, click Save, reload the page, confirm the checkbox is still unchecked.

- [ ] **Step 4: Trigger a test notification**

On any lead assigned to a user: post a comment. Confirm a notification email arrives with the 3-section format (Lead Summary, New Comment, Recent Activity).

- [ ] **Step 5: Verify disabled notification is skipped**

Disable the `comment` event for the assignee. Post another comment. Confirm no email arrives (Netlify function logs should show `skipped: notification disabled for user`).
