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

async function fetchAssigneeMemberPrefs(userId, workspaceId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/workspace_members?user_id=eq.${userId}&workspace_id=eq.${workspaceId}&select=notification_prefs`,
    { headers: supabaseHeaders(SUPABASE_PAT) }
  )
  if (!res.ok) return {}
  const rows = await res.json()
  return rows?.[0]?.notification_prefs || {}
}

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

    if (!lead.assigned_to) {
      return new Response(JSON.stringify({ ok: true, skipped: 'no assigned user' }), { status: 200, headers: HEADERS })
    }

    const prefs = await fetchAssigneeMemberPrefs(lead.assigned_to, workspace_id)
    if (prefs[event] === false) {
      return new Response(JSON.stringify({ ok: true, skipped: 'notification disabled for user' }), { status: 200, headers: HEADERS })
    }

    const settings = await fetchWorkspaceSettings(workspace_id)
    const wsNotifs = settings.notifications || {}
    if (wsNotifs[event] === false) {
      return new Response(JSON.stringify({ ok: true, skipped: 'notification disabled workspace-wide' }), { status: 200, headers: HEADERS })
    }

    const toEmail = await fetchUserEmail(lead.assigned_to)
    if (!toEmail) {
      return new Response(JSON.stringify({ ok: true, skipped: 'assigned user has no email' }), { status: 200, headers: HEADERS })
    }

    const [assigneeName, actorName, activities] = await Promise.all([
      fetchUserName(lead.assigned_to),
      actor_user_id ? fetchUserName(actor_user_id) : Promise.resolve('System'),
      fetchActivityHistory(lead_id),
    ])

    const leadUrl      = `${APP_URL}/w/${workspace_id}/leads/${lead_id}`
    const subject      = renderSubject(event, lead, extra)
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
