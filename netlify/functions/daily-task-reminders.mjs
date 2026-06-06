// netlify/functions/daily-task-reminders.mjs
// Runs daily at 9 AM. Finds task_reminders whose reminder window has arrived
// and sends a plain reminder email to each invitee. Marks reminder_sent_at when done.

import nodemailer from 'nodemailer'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

function sbHeaders() {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' }
}

async function fetchWorkspaceSettings(workspaceId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/workspaces?id=eq.${workspaceId}&select=settings`, { headers: sbHeaders() })
  if (!res.ok) return {}
  const rows = await res.json()
  return rows?.[0]?.settings || {}
}

async function fetchUserEmail(userId) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: sbHeaders() })
  if (!res.ok) return null
  const user = await res.json()
  return user?.email || null
}

async function fetchUserName(userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=full_name`, { headers: sbHeaders() })
  if (!res.ok) return null
  const rows = await res.json()
  return rows?.[0]?.full_name || null
}

function createTransport(settings) {
  const host     = settings.mail_smtp_host
  const port     = Number(settings.mail_smtp_port) || 587
  const user     = settings.mail_smtp_user
  const pass     = settings.mail_smtp_password
  const secure   = settings.mail_smtp_secure === true
  const starttls = settings.mail_smtp_starttls !== false && !secure
  if (!host || !user || !pass) return null
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass }, ...(starttls ? { requireTLS: true } : {}) })
}

async function markReminderSent(id) {
  await fetch(`${SUPABASE_URL}/rest/v1/task_reminders?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ reminder_sent_at: new Date().toISOString() }),
  })
}

export default async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('[daily-task-reminders] missing env vars')
    return
  }

  // Fetch reminders whose reminder window has arrived:
  // event_date - reminder_days_before days <= now
  const now = new Date().toISOString()
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/task_reminders?reminder_sent_at=is.null&select=*`,
    { headers: sbHeaders() }
  )
  if (!res.ok) {
    console.error('[daily-task-reminders] fetch failed', res.status)
    return
  }

  const reminders = await res.json()
  if (!reminders?.length) {
    console.log('[daily-task-reminders] no pending reminders')
    return
  }

  // Filter in JS: event_date - reminder_days_before days <= now
  const nowMs = Date.now()
  const due = reminders.filter(r => {
    const eventMs = new Date(r.event_date).getTime()
    const reminderMs = eventMs - r.reminder_days_before * 24 * 60 * 60 * 1000
    return reminderMs <= nowMs
  })

  console.log(`[daily-task-reminders] ${due.length} reminders to send`)

  for (const reminder of due) {
    try {
      const settings = await fetchWorkspaceSettings(reminder.workspace_id)
      const transport = createTransport(settings)
      if (!transport) {
        console.warn('[daily-task-reminders] SMTP not configured for workspace', reminder.workspace_id)
        continue
      }

      const fromEmail = settings.mail_from_email?.trim() || settings.mail_smtp_user
      const fromName  = settings.mail_from_name?.trim()
      const from      = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail

      const eventDate = new Date(reminder.event_date)
      const dateFormatted = eventDate.toLocaleString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      })

      const subject = `⏰ Reminder: ${reminder.event_title} — ${dateFormatted}`

      for (const userId of (reminder.invitee_ids || [])) {
        const email = await fetchUserEmail(userId)
        if (!email) continue
        const name = await fetchUserName(userId) || email

        const body = [
          `Hi ${name},`,
          '',
          `This is a reminder for: ${reminder.event_title}`,
          `📅 Date: ${dateFormatted}`,
          ...(reminder.event_description ? ['', reminder.event_description] : []),
          '',
          '— HatCRM',
        ].join('\n')

        try {
          await transport.sendMail({ from, to: email, subject, text: body })
        } catch (err) {
          console.error('[daily-task-reminders] email failed for', email, err.message)
        }
      }

      await markReminderSent(reminder.id)
    } catch (err) {
      console.error('[daily-task-reminders] failed for reminder', reminder.id, err.message)
    }
  }
}

export const config = {
  schedule: '0 9 * * *',
}
