// Send email via a workspace-configured SMTP server.
//
// POST /.netlify/functions/send-email
// body: { workspace_id, to, cc?, subject, body, _test? }
//
// Mail server credentials are stored in workspace.settings (configured in
// Settings → Mail Server). The function fetches them server-side using the
// Supabase service key so credentials are never exposed to the browser.

import nodemailer from 'nodemailer'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_PAT = process.env.SUPABASE_PAT

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

function isValidEmail(email) {
  return /^[^\s@,;<>"'\\/\r\n]+@[^\s@,;<>"'\\/\r\n]+\.[^\s@,;<>"'\\/\r\n]+$/.test(String(email || '').trim())
}

async function getWorkspaceSettings(workspaceId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/workspaces?id=eq.${workspaceId}&select=settings`,
    {
      headers: {
        apikey: SUPABASE_PAT,
        Authorization: `Bearer ${SUPABASE_PAT}`,
        Accept: 'application/json',
      },
    }
  )
  if (!res.ok) throw new Error(`Failed to fetch workspace: HTTP ${res.status}`)
  const rows = await res.json()
  if (!rows?.length) throw new Error('Workspace not found.')
  return rows[0].settings || {}
}

function createTransport(settings) {
  const host = settings.mail_smtp_host
  const port = Number(settings.mail_smtp_port) || 587
  const user = settings.mail_smtp_user
  const pass = settings.mail_smtp_password
  const secure = settings.mail_smtp_secure === true   // true = SSL (port 465)
  const starttls = settings.mail_smtp_starttls !== false && !secure  // default on for non-SSL

  if (!host || !user || !pass) {
    throw new Error('Mail server not configured. Go to Settings → Mail Server to set up SMTP credentials.')
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    ...(starttls ? { requireTLS: true } : {}),
  })
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: HEADERS })
  }

  if (!SUPABASE_URL || !SUPABASE_PAT) {
    return new Response(JSON.stringify({ ok: false, error: 'Server misconfigured: missing SUPABASE_URL or SUPABASE_PAT.' }), { status: 500, headers: HEADERS })
  }

  try {
    const { workspace_id, to, cc, subject, body } = await req.json().catch(() => ({}))

    if (!workspace_id) {
      return new Response(JSON.stringify({ ok: false, error: 'workspace_id is required.' }), { status: 400, headers: HEADERS })
    }
    if (!to || !isValidEmail(to)) {
      return new Response(JSON.stringify({ ok: false, error: 'A valid "to" email address is required.' }), { status: 400, headers: HEADERS })
    }
    if (cc && !isValidEmail(cc)) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid CC email address.' }), { status: 400, headers: HEADERS })
    }

    const settings  = await getWorkspaceSettings(workspace_id)
    const transport = createTransport(settings)

    const fromName  = settings.mail_from_name?.trim()
    const fromEmail = settings.mail_from_email?.trim() || settings.mail_smtp_user
    const from      = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail

    await transport.sendMail({
      from,
      to:      to.trim(),
      cc:      cc?.trim() || undefined,
      subject: (subject || '').trim(),
      text:    (body    || '').trim(),
    })

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: HEADERS })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500, headers: HEADERS })
  }
}
