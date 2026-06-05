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

// Notification config — server-side registry mapping event → template config
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

  if (!SUPABASE_URL || !SUPABASE_PAT || !SERVICE_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'Server misconfigured: missing SUPABASE_URL, SUPABASE_PAT, or SUPABASE_SERVICE_ROLE_KEY.' }), { status: 500, headers: HEADERS })
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

    const settings = await fetchWorkspaceSettings(workspace_id)

    // Check if this notification is enabled (default: true if not configured)
    const notifSettings = settings.notifications || {}
    if (notifSettings[event] === false) {
      return new Response(JSON.stringify({ ok: true, skipped: 'notification disabled' }), { status: 200, headers: HEADERS })
    }

    const agentName = await fetchUserName(lead.assigned_to)
    const leadUrl   = `${APP_URL}/w/${workspace_id}/leads/${lead_id}`
    const body      = renderTemplate(config.template, lead, agentName, leadUrl)
    const subject   = renderSubject(config.subjectTemplate, lead)

    const transport = createTransport(settings)
    const fromName  = settings.mail_from_name?.trim()
    const fromEmail = settings.mail_from_email?.trim() || settings.mail_smtp_user
    const from      = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail

    await transport.sendMail({ from, to: toEmail, subject, text: body })

    return new Response(JSON.stringify({ ok: true, to: toEmail }), { status: 200, headers: HEADERS })
  } catch (err) {
    console.error('[notify-lead-event]', err.message)
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: HEADERS })
  }
}
