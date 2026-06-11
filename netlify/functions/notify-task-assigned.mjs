// netlify/functions/notify-task-assigned.mjs
// POST { task_id, workspace_id, actor_user_id, new_assignee_ids[] }
// Sends an email to each newly assigned user with task details + link.

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
  if (!res.ok) return null
  const rows = await res.json()
  return rows?.[0]?.full_name || null
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

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: HEADERS })
  }

  if (!SUPABASE_URL || !SUPABASE_PAT || !SERVICE_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'Server misconfigured' }), { status: 500, headers: HEADERS })
  }

  try {
    const { task_id, workspace_id, actor_user_id, new_assignee_ids } =
      await req.json().catch(() => ({}))

    if (!task_id || !workspace_id || !Array.isArray(new_assignee_ids) || !new_assignee_ids.length) {
      return new Response(JSON.stringify({ ok: false, error: 'task_id, workspace_id, new_assignee_ids required' }), { status: 400, headers: HEADERS })
    }

    const [task, settings, actorName] = await Promise.all([
      fetchTask(task_id),
      fetchWorkspaceSettings(workspace_id),
      actor_user_id ? fetchUserName(actor_user_id) : Promise.resolve('A team member'),
    ])

    const leadAddress = await fetchLeadAddress(task.project_id)
    const taskUrl = `${APP_URL}/w/${workspace_id}/tasks/${task_id}`

    const transport = createTransport(settings)
    const fromName  = settings.mail_from_name?.trim()
    const fromEmail = settings.mail_from_email?.trim() || settings.mail_smtp_user
    const from      = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail

    const sent = []
    for (const uid of new_assignee_ids) {
      // Don't notify the person who assigned (they know)
      if (uid === actor_user_id) continue

      const [toEmail, assigneeName] = await Promise.all([
        fetchUserEmail(uid),
        fetchUserName(uid),
      ])
      if (!toEmail) continue

      const subject = `Task assigned to you: ${task.title}`
      const body = [
        `Hi ${assigneeName || 'there'},`,
        '',
        `You've been assigned to a task by ${actorName}.`,
        '',
        '── TASK ─────────────────────────────────────',
        `Title:       ${task.title}`,
        task.description ? `Description: ${task.description}` : null,
        `Priority:    ${task.priority || 'medium'}`,
        `Due Date:    ${task.due_date || 'Not set'}`,
        leadAddress ? `Property:    ${leadAddress}` : null,
        '',
        `View task: ${taskUrl}`,
        '',
        '— HAT Investors',
      ].filter(line => line !== null).join('\n')

      await transport.sendMail({ from, to: toEmail, subject, text: body })
      sent.push(toEmail)
    }

    return new Response(JSON.stringify({ ok: true, sent }), { status: 200, headers: HEADERS })
  } catch (err) {
    console.error('[notify-task-assigned]', err.message)
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: HEADERS })
  }
}
