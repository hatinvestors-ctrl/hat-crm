// netlify/functions/send-agent-emails.mjs
// Sends bulk emails to agents using workspace SMTP settings.
// POST body: { workspace_id, user_id, agent_ids: string[], template: 'introduction'|'follow_up', subject: string }
// Loops agents, substitutes {agent_name}/{brokerage}, sends via nodemailer, logs to agent_outreach.

import nodemailer from 'nodemailer'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP_URL      = process.env.URL || 'https://hatcrm.netlify.app'

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

async function fetchAgents(agentIds) {
  const ids = agentIds.map(id => `"${id}"`).join(',')
  const res = await fetch(`${SUPABASE_URL}/rest/v1/agents?id=in.(${ids})&select=id,name,email,brokerage`, { headers: sbHeaders() })
  if (!res.ok) throw new Error(`Failed to fetch agents: HTTP ${res.status}`)
  return await res.json()
}

async function logOutreach(workspaceId, agentId, userId, template, subject) {
  await fetch(`${SUPABASE_URL}/rest/v1/agent_outreach`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ workspace_id: workspaceId, agent_id: agentId, user_id: userId, template, subject }),
  })
}

async function logActivity(workspaceId, agentId, userId, subject) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/agent_activities`, {
      method: 'POST',
      headers: { ...sbHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        agent_id:     agentId,
        user_id:      userId,
        type:         'email_sent',
        note:         subject,
      }),
    })
    if (!res.ok) console.warn('[logActivity] insert failed', res.status)
  } catch (_) {
    // non-blocking — log failure does not affect email delivery
  }
}

async function updateLastContacted(agentId) {
  await fetch(`${SUPABASE_URL}/rest/v1/agents?id=eq.${agentId}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ last_contacted_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  })
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

const DEFAULT_TEMPLATES = {
  introduction: {
    subject: 'Cash Buyer Looking for Properties in Jacksonville',
    body: `Hi {agent_name},

My name is Tomer with HAT Investors. We're active cash buyers in Jacksonville looking for investment properties. If you have any listings that aren't moving or off-market opportunities, we'd love to connect.

We close fast with no contingencies — usually within 2 weeks.

Would love to hear from you if anything comes up.

Best,
HAT Investors`,
  },
  follow_up: {
    subject: 'Following Up — Cash Buyer in Jacksonville',
    body: `Hi {agent_name},

Just following up on my previous message. We're still actively buying in Jacksonville — if anything has come up that might be a fit, I'd love to hear about it.

Happy to hop on a quick call anytime.

Best,
HAT Investors`,
  },
}

function renderTemplate(templateBody, agent) {
  const name = agent.name?.split(' ')[0] || agent.name || 'there'
  const brokerage = agent.brokerage || ''
  return templateBody
    .replace(/\{agent_name\}/g, name)
    .replace(/\{brokerage\}/g, brokerage)
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
    const { workspace_id, user_id, agent_ids, template, subject } = await req.json().catch(() => ({}))

    if (!workspace_id || !user_id || !agent_ids?.length || !template) {
      return new Response(JSON.stringify({ ok: false, error: 'workspace_id, user_id, agent_ids, template required.' }), { status: 400, headers: HEADERS })
    }

    if (!DEFAULT_TEMPLATES[template]) {
      return new Response(JSON.stringify({ ok: false, error: `Unknown template: ${template}` }), { status: 400, headers: HEADERS })
    }

    const isMember = await verifyWorkspaceMember(workspace_id, user_id)
    if (!isMember) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized.' }), { status: 403, headers: HEADERS })
    }

    const settings = await fetchWorkspaceSettings(workspace_id)
    const agents   = await fetchAgents(agent_ids)
    const transport = createTransport(settings)

    const fromName  = settings.mail_from_name?.trim()
    const fromEmail = settings.mail_from_email?.trim() || settings.mail_smtp_user
    const from      = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail
    const cc        = settings.notification_cc || undefined

    const templateDef = DEFAULT_TEMPLATES[template]
    const finalSubject = subject || templateDef.subject

    const results = { sent: 0, failed: 0, skipped: 0 }

    for (const agent of agents) {
      if (!agent.email) { results.skipped++; continue }
      try {
        const body = renderTemplate(templateDef.body, agent)
        await transport.sendMail({ from, to: agent.email, cc, subject: finalSubject, text: body })
        await logOutreach(workspace_id, agent.id, user_id, template, finalSubject)
        void logActivity(workspace_id, agent.id, user_id, finalSubject)
        await updateLastContacted(agent.id)
        results.sent++
      } catch (err) {
        console.error('[send-agent-emails] failed for', agent.email, err.message)
        results.failed++
      }
    }

    return new Response(JSON.stringify({ ok: true, ...results }), { status: 200, headers: HEADERS })
  } catch (err) {
    console.error('[send-agent-emails]', err.message)
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: HEADERS })
  }
}
