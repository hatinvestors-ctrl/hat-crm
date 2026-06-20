# Task Event Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email the task creator and all assignees when a task's status changes, a comment is posted, or any tracked field changes — excluding the person who made the change.

**Architecture:** New Netlify function `notify-task-event.mjs` handles email delivery; frontend fires it from `TaskDetailDrawer.patch()` (for field/status changes) and `TaskComment` (for comments). Recipients = deduplicated union of `created_by` + `assignee_ids`, minus the actor.

**Tech Stack:** Netlify Functions, nodemailer, Supabase REST API, React

---

## Files

- **Create:** `netlify/functions/notify-task-event.mjs` — email delivery function
- **Modify:** `src/components/tasks/TaskDetailDrawer.jsx` — fire notify after patch
- **Modify:** `src/components/tasks/TaskComment.jsx` — accept `workspaceId` + `task` props, fire notify after comment posted

---

### Task 1: Create `notify-task-event.mjs` Netlify function

**Files:**
- Create: `netlify/functions/notify-task-event.mjs`

- [ ] **Step 1: Create the file**

```js
// netlify/functions/notify-task-event.mjs
// POST { task_id, workspace_id, actor_user_id, event, extra }
// event: 'status_change' | 'comment' | 'field_change'
// Notifies task creator + all assignees, excluding the actor.

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

function sbHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }
}

async function fetchTask(taskId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tasks?id=eq.${taskId}&select=*`,
    { headers: sbHeaders(SUPABASE_PAT) }
  )
  if (!res.ok) throw new Error(`Failed to fetch task: HTTP ${res.status}`)
  const rows = await res.json()
  if (!rows?.length) throw new Error('Task not found')
  return rows[0]
}

async function fetchWorkspaceSettings(workspaceId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/workspaces?id=eq.${workspaceId}&select=settings`,
    { headers: sbHeaders(SUPABASE_PAT) }
  )
  if (!res.ok) throw new Error(`Failed to fetch workspace: HTTP ${res.status}`)
  const rows = await res.json()
  return rows?.[0]?.settings || {}
}

async function fetchUserEmail(userId) {
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users/${userId}`,
    { headers: sbHeaders(SERVICE_KEY) }
  )
  if (!res.ok) return null
  const u = await res.json()
  return u?.email || null
}

async function fetchUserName(userId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=full_name`,
    { headers: sbHeaders(SUPABASE_PAT) }
  )
  if (!res.ok) return 'Team member'
  const rows = await res.json()
  return rows?.[0]?.full_name || 'Team member'
}

async function fetchLeadAddress(leadId) {
  if (!leadId) return null
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}&select=address`,
    { headers: sbHeaders(SUPABASE_PAT) }
  )
  if (!res.ok) return null
  const rows = await res.json()
  return rows?.[0]?.address || null
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

function renderSubject(event, task, extra) {
  switch (event) {
    case 'status_change': return `Task status update: ${task.title}`
    case 'comment':       return `New comment on task: ${task.title}`
    default:              return `Task updated: ${task.title}`
  }
}

function renderBody(event, task, extra, recipientName, actorName, leadAddress, taskUrl) {
  const taskBlock = [
    '── TASK ─────────────────────────────────────',
    `Title:    ${task.title}`,
    leadAddress ? `Property: ${leadAddress}` : null,
    `Status:   ${task.status}`,
    `Priority: ${task.priority || 'medium'}`,
    `Due:      ${task.due_date || 'Not set'}`,
  ].filter(Boolean).join('\n')

  let eventBlock
  switch (event) {
    case 'status_change':
      eventBlock = [
        '── STATUS CHANGED ───────────────────────────',
        `${extra?.old_status || '—'} → ${extra?.new_status || '—'}`,
        `Changed by: ${actorName}`,
      ].join('\n')
      break
    case 'comment':
      eventBlock = [
        '── NEW COMMENT ──────────────────────────────',
        `"${extra?.comment || ''}"`,
        `Posted by: ${actorName}`,
      ].join('\n')
      break
    default:
      eventBlock = [
        '── TASK UPDATED ─────────────────────────────',
        extra?.description || 'A field was updated.',
        `Updated by: ${actorName}`,
      ].join('\n')
  }

  return [
    `Hi ${recipientName},`,
    '',
    taskBlock,
    '',
    eventBlock,
    '',
    `View task: ${taskUrl}`,
    '',
    '— HAT Investors',
  ].join('\n')
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: HEADERS })
  }

  if (!SUPABASE_URL || !SUPABASE_PAT || !SERVICE_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'Server misconfigured' }), { status: 500, headers: HEADERS })
  }

  try {
    const { task_id, workspace_id, actor_user_id, event, extra = {} } =
      await req.json().catch(() => ({}))

    if (!task_id || !workspace_id || !event) {
      return new Response(JSON.stringify({ ok: false, error: 'task_id, workspace_id, event required' }), { status: 400, headers: HEADERS })
    }

    const [task, settings] = await Promise.all([
      fetchTask(task_id),
      fetchWorkspaceSettings(workspace_id),
    ])

    // Build recipient list: creator + all assignees, deduped, actor excluded
    const recipientIds = [...new Set([
      task.created_by,
      ...(task.assignee_ids || []),
    ].filter(id => id && id !== actor_user_id))]

    if (!recipientIds.length) {
      return new Response(JSON.stringify({ ok: true, skipped: 'no recipients' }), { status: 200, headers: HEADERS })
    }

    const [actorName, leadAddress] = await Promise.all([
      actor_user_id ? fetchUserName(actor_user_id) : Promise.resolve('A team member'),
      fetchLeadAddress(task.lead_id || task.project_id),
    ])

    const taskUrl   = `${APP_URL}/w/${workspace_id}/tasks/${task_id}`
    const transport = createTransport(settings)
    const fromName  = settings.mail_from_name?.trim()
    const fromEmail = settings.mail_from_email?.trim() || settings.mail_smtp_user
    const from      = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail

    const sent = []
    for (const uid of recipientIds) {
      const [toEmail, recipientName] = await Promise.all([
        fetchUserEmail(uid),
        fetchUserName(uid),
      ])
      if (!toEmail) continue

      const subject = renderSubject(event, task, extra)
      const body    = renderBody(event, task, extra, recipientName, actorName, leadAddress, taskUrl)
      await transport.sendMail({ from, to: toEmail, subject, text: body })
      sent.push(toEmail)
    }

    return new Response(JSON.stringify({ ok: true, sent }), { status: 200, headers: HEADERS })
  } catch (err) {
    console.error('[notify-task-event]', err.message)
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: HEADERS })
  }
}
```

- [ ] **Step 2: Verify the file was saved**

```
ls netlify/functions/notify-task-event.mjs
```

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/notify-task-event.mjs
git commit -m "feat: add notify-task-event netlify function"
```

---

### Task 2: Fire notifications from `TaskDetailDrawer`

**Files:**
- Modify: `src/components/tasks/TaskDetailDrawer.jsx`

The `patch()` function already exists. After `logTaskChanges`, fire `notify-task-event` with:
- `event: 'status_change'` when `status` is in the changes, passing `old_status` / `new_status` in `extra`
- `event: 'field_change'` for all other tracked field changes, with a short `description` in `extra`

- [ ] **Step 1: Replace the section after `logTaskChanges` in `patch()`**

Current code around line 65–81 in `src/components/tasks/TaskDetailDrawer.jsx`:
```js
    await logTaskChanges(task.id, userId, before, data, memberMap, projectMap)

    // Notify newly added assignees
    if ('assignee_ids' in changes) {
      const prevIds = before.assignee_ids || []
      const newIds  = (data.assignee_ids || []).filter(id => !prevIds.includes(id))
      if (newIds.length > 0) {
        fetch('/.netlify/functions/notify-task-assigned', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task_id: task.id, workspace_id: workspaceId, actor_user_id: userId, new_assignee_ids: newIds }),
        }).catch(() => {})
      }
    }
```

Replace with:
```js
    await logTaskChanges(task.id, userId, before, data, memberMap, projectMap)

    // Notify newly added assignees
    if ('assignee_ids' in changes) {
      const prevIds = before.assignee_ids || []
      const newIds  = (data.assignee_ids || []).filter(id => !prevIds.includes(id))
      if (newIds.length > 0) {
        fetch('/.netlify/functions/notify-task-assigned', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task_id: task.id, workspace_id: workspaceId, actor_user_id: userId, new_assignee_ids: newIds }),
        }).catch(() => {})
      }
    }

    // Notify creator + assignees of the change (skip pure assignee-only patches — already handled above)
    const changedFields = Object.keys(changes)
    const notifyEvent = changedFields.includes('status') ? 'status_change'
      : changedFields.every(f => f === 'assignee_ids') ? null
      : 'field_change'
    if (notifyEvent) {
      const extra = notifyEvent === 'status_change'
        ? { old_status: before.status, new_status: data.status }
        : { description: `${changedFields.join(', ')} updated` }
      fetch('/.netlify/functions/notify-task-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: task.id, workspace_id: workspaceId, actor_user_id: userId, event: notifyEvent, extra }),
      }).catch(() => {})
    }
```

- [ ] **Step 2: Commit**

```bash
git add src/components/tasks/TaskDetailDrawer.jsx
git commit -m "feat: fire notify-task-event on task field/status changes"
```

---

### Task 3: Fire notifications from `TaskComment`

**Files:**
- Modify: `src/components/tasks/TaskComment.jsx`
- Modify: `src/components/tasks/TaskDetailDrawer.jsx` (pass new props to `<TaskComment>`)

`TaskComment` currently receives `taskId`, `userId`, `onPosted`. We need to add `workspaceId` and `taskCreatedBy` so it can fire the notify function.

- [ ] **Step 1: Update `TaskComment.jsx`**

Replace the entire file with:
```jsx
import { useState } from 'react'
import Button from '../ui/Button'
import { logTaskComment } from '../../lib/taskHelpers'

export default function TaskComment({ taskId, userId, workspaceId, taskCreatedBy, assigneeIds, onPosted }) {
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)

  const post = async () => {
    if (!text.trim()) return
    setPosting(true)
    await logTaskComment(taskId, userId, text)
    fetch('/.netlify/functions/notify-task-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: taskId,
        workspace_id: workspaceId,
        actor_user_id: userId,
        event: 'comment',
        extra: { comment: text.trim() },
      }),
    }).catch(() => {})
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

- [ ] **Step 2: Update the `<TaskComment>` usage in `TaskDetailDrawer.jsx`**

Find the current usage (around line 272):
```jsx
{canEdit && <TaskComment taskId={task.id} userId={userId} onPosted={() => setActivityRefresh(v => v + 1)} />}
```

Replace with:
```jsx
{canEdit && <TaskComment taskId={task.id} userId={userId} workspaceId={workspaceId} onPosted={() => setActivityRefresh(v => v + 1)} />}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/tasks/TaskComment.jsx src/components/tasks/TaskDetailDrawer.jsx
git commit -m "feat: fire notify-task-event on task comments"
```

---

### Task 4: Manual smoke test

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Open a task in the drawer, change its status**

Verify in the Netlify function logs (or browser network tab) that `/.netlify/functions/notify-task-event` is called with `event: 'status_change'`.

Expected request body:
```json
{
  "task_id": "<id>",
  "workspace_id": "<id>",
  "actor_user_id": "<your user id>",
  "event": "status_change",
  "extra": { "old_status": "todo", "new_status": "in_progress" }
}
```

- [ ] **Step 3: Post a comment on a task**

Verify `notify-task-event` is called with `event: 'comment'` and `extra.comment` matches what you typed.

- [ ] **Step 4: Verify actor is excluded**

If you are both the creator and the only assignee, the function should return `{ ok: true, skipped: 'no recipients' }`.
