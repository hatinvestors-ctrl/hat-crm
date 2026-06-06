// netlify/functions/send-task-invite.mjs
// Sends calendar invites (.ics + Google Calendar link) for a task to specified invitees.
// POST body: { workspace_id, task_id, event_title, event_description, event_date, invitee_ids, reminder_days_before, created_by }

import nodemailer from 'nodemailer'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

function sbHeaders() {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' }
}

async function verifyWorkspaceMember(workspaceId, userId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/workspace_members?workspace_id=eq.${workspaceId}&user_id=eq.${userId}&select=id&limit=1`,
    { headers: sbHeaders() }
  )
  if (!res.ok) return false
  const rows = await res.json()
  return rows?.length > 0
}

async function fetchWorkspaceSettings(workspaceId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/workspaces?id=eq.${workspaceId}&select=settings`, { headers: sbHeaders() })
  if (!res.ok) throw new Error(`Failed to fetch workspace: HTTP ${res.status}`)
  const rows = await res.json()
  if (!rows?.length) throw new Error('Workspace not found.')
  return rows[0].settings || {}
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
  if (!host || !user || !pass) throw new Error('SMTP not configured. Go to Settings → Mail Server.')
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass }, ...(starttls ? { requireTLS: true } : {}) })
}

// Format a Date to ICS UTC timestamp: 20260610T140000Z
function toIcsDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

// Generate Google Calendar URL
function googleCalUrl(title, startDate, endDate, description) {
  const fmt = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z/, 'Z')
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${fmt(startDate)}/${fmt(endDate)}`,
    details: description || '',
  })
  return `https://calendar.google.com/calendar/render?${params}`
}

// Generate .ics content for one invitee
function buildIcs({ uid, title, description, startDate, endDate, organizerEmail, inviteeEmail, reminderDays }) {
  const esc = s => (s || '').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
  const now = toIcsDate(new Date())
  const dtStart = toIcsDate(startDate)
  const dtEnd   = toIcsDate(endDate)

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HatCRM//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${esc(title)}`,
    ...(description ? [`DESCRIPTION:${esc(description)}`] : []),
    `ORGANIZER:MAILTO:${organizerEmail}`,
    `ATTENDEE;RSVP=TRUE;CN=${inviteeEmail}:MAILTO:${inviteeEmail}`,
    'BEGIN:VALARM',
    `TRIGGER:-P${reminderDays}D`,
    'ACTION:DISPLAY',
    `DESCRIPTION:Reminder: ${esc(title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: HEADERS })
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'Server misconfigured.' }), { status: 500, headers: HEADERS })
  }

  try {
    const {
      workspace_id,
      task_id,
      event_title,
      event_description,
      event_date,
      invitee_ids,
      reminder_days_before = 1,
      created_by,
    } = await req.json().catch(() => ({}))

    if (!workspace_id || !task_id || !event_title || !event_date || !invitee_ids?.length || !created_by) {
      return new Response(JSON.stringify({ ok: false, error: 'workspace_id, task_id, event_title, event_date, invitee_ids, created_by required.' }), { status: 400, headers: HEADERS })
    }

    const isMember = await verifyWorkspaceMember(workspace_id, created_by)
    if (!isMember) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized.' }), { status: 403, headers: HEADERS })
    }

    const settings = await fetchWorkspaceSettings(workspace_id)
    const transport = createTransport(settings)

    const fromEmail = settings.mail_from_email?.trim() || settings.mail_smtp_user
    const fromName  = settings.mail_from_name?.trim()
    const from      = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail

    const startDate = new Date(event_date)
    const endDate   = new Date(startDate.getTime() + 60 * 60 * 1000) // +1 hour
    const gcalUrl   = googleCalUrl(event_title, startDate, endDate, event_description)
    const uid       = `task-${task_id}-${Date.now()}@hatcrm`

    const dateFormatted = startDate.toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    })

    let sent = 0
    for (const userId of invitee_ids) {
      const email = await fetchUserEmail(userId)
      if (!email) continue
      const name  = await fetchUserName(userId) || email

      const icsContent = buildIcs({
        uid,
        title: event_title,
        description: event_description,
        startDate,
        endDate,
        organizerEmail: fromEmail,
        inviteeEmail: email,
        reminderDays: reminder_days_before,
      })

      const body = [
        `Hi ${name},`,
        '',
        `You've been invited to: ${event_title}`,
        `📅 Date: ${dateFormatted}`,
        ...(event_description ? ['', event_description] : []),
        '',
        '─────────────────────────',
        '📆 Add to Google Calendar:',
        gcalUrl,
        '',
        'Or open the attached .ics file to add this event to your calendar.',
        '',
        '─────────────────────────',
        `⏰ You'll receive a reminder ${reminder_days_before} day${reminder_days_before === 1 ? '' : 's'} before the event.`,
        '',
        '— HatCRM',
      ].join('\n')

      try {
        await transport.sendMail({
          from,
          to: email,
          subject: `📅 Invite: ${event_title}`,
          text: body,
          attachments: [
            {
              filename: 'invite.ics',
              content: icsContent,
              contentType: 'text/calendar;method=REQUEST',
            },
          ],
        })
        sent++
      } catch (err) {
        console.error('[send-task-invite] failed for', email, err.message)
      }
    }

    // Save reminder record
    await fetch(`${SUPABASE_URL}/rest/v1/task_reminders`, {
      method: 'POST',
      headers: { ...sbHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        task_id,
        workspace_id,
        event_title,
        event_description: event_description || null,
        event_date: startDate.toISOString(),
        invitee_ids,
        reminder_days_before,
        created_by,
      }),
    })

    return new Response(JSON.stringify({ ok: true, sent }), { status: 200, headers: HEADERS })
  } catch (err) {
    console.error('[send-task-invite]', err)
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: HEADERS })
  }
}
