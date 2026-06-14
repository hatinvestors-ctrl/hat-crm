// POST { workspace_id, user_id, draft_id, subject_override?, body_override? }
// Approve-and-send with atomic idempotency guard. Advances enrollment to next step.

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

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() })
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`)
  return res.json()
}

async function sbPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`POST ${path} failed: ${res.status} ${text}`)
  }
}

async function sbPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(), Prefer: 'count=exact,return=minimal' },
    body: JSON.stringify(body),
  })
  const range = res.headers.get('Content-Range') || ''
  const match = range.match(/\/(\d+)$/)
  return { ok: res.ok, rowsAffected: match ? parseInt(match[1], 10) : (res.ok ? 1 : 0) }
}

function createTransport(settings) {
  const host   = settings.mail_smtp_host
  const port   = Number(settings.mail_smtp_port) || 587
  const user   = settings.mail_smtp_user
  const pass   = settings.mail_smtp_password
  const secure = settings.mail_smtp_secure === true
  if (!host || !user || !pass) throw new Error('SMTP not configured')
  return nodemailer.createTransport({
    host, port, secure,
    auth: { user, pass },
    ...((!secure) ? { requireTLS: true } : {}),
  })
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: HEADERS })

  try {
    const { workspace_id, user_id, draft_id, subject_override, body_override } = await req.json().catch(() => ({}))
    if (!workspace_id || !user_id || !draft_id) {
      return new Response(JSON.stringify({ ok: false, error: 'workspace_id, user_id, draft_id required' }), { status: 400, headers: HEADERS })
    }

    // Verify workspace member
    const members = await sbGet(`workspace_members?workspace_id=eq.${workspace_id}&user_id=eq.${user_id}&select=id&limit=1`)
    if (!members.length) return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 403, headers: HEADERS })

    // Load draft
    const drafts = await sbGet(`message_drafts?id=eq.${draft_id}&select=*&limit=1`)
    const draft = drafts[0]
    if (!draft) return new Response(JSON.stringify({ ok: false, error: 'Draft not found' }), { status: 404, headers: HEADERS })

    // Atomic idempotency: set status=approved only if currently draft_created
    const { rowsAffected } = await sbPatch(`scheduled_messages?id=eq.${draft.scheduled_message_id}&status=eq.draft_created`, {
      status: 'approved',
      updated_at: new Date().toISOString(),
    })
    if (rowsAffected === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'Already approved or not in draft state' }), { status: 409, headers: HEADERS })
    }

    // Load agent
    const agents = await sbGet(`agents?id=eq.${draft.agent_id}&select=*&limit=1`)
    const agent = agents[0]
    if (!agent || !agent.email) {
      await sbPatch(`scheduled_messages?id=eq.${draft.scheduled_message_id}`, { status: 'failed', skip_reason: 'no_agent_email', updated_at: new Date().toISOString() })
      return new Response(JSON.stringify({ ok: false, error: 'Agent has no email' }), { status: 422, headers: HEADERS })
    }

    // Re-check DNC at send time
    if (agent.relationship_status === 'do_not_contact') {
      await sbPatch(`scheduled_messages?id=eq.${draft.scheduled_message_id}`, { status: 'skipped', skip_reason: 'do_not_contact', updated_at: new Date().toISOString() })
      return new Response(JSON.stringify({ ok: false, error: 'Agent is do_not_contact' }), { status: 422, headers: HEADERS })
    }

    // Re-check opt_out
    const optOuts = await sbGet(`opt_outs?workspace_id=eq.${workspace_id}&email=eq.${encodeURIComponent(agent.email)}&select=id&limit=1`)
    if (optOuts.length > 0) {
      await sbPatch(`scheduled_messages?id=eq.${draft.scheduled_message_id}`, { status: 'skipped', skip_reason: 'opted_out', updated_at: new Date().toISOString() })
      return new Response(JSON.stringify({ ok: false, error: 'Agent has opted out' }), { status: 422, headers: HEADERS })
    }

    // Load workspace settings for SMTP
    const workspaces = await sbGet(`workspaces?id=eq.${workspace_id}&select=settings&limit=1`)
    const settings = workspaces[0]?.settings || {}

    const finalSubject = subject_override || draft.edited_subject || draft.subject
    const finalBody    = body_override    || draft.edited_body    || draft.body

    // Send
    const transport = createTransport(settings)
    const fromName  = settings.mail_from_name?.trim()
    const fromEmail = settings.mail_from_email?.trim() || settings.mail_smtp_user
    const from      = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail
    const info      = await transport.sendMail({ from, to: agent.email, subject: finalSubject, text: finalBody })

    const now = new Date().toISOString()

    // Load scheduled_message to get enrollment/step
    const msgs = await sbGet(`scheduled_messages?id=eq.${draft.scheduled_message_id}&select=*&limit=1`)
    const msg = msgs[0]

    // Insert send_log
    let scenarioId = null
    if (msg?.enrollment_id) {
      const enr = await sbGet(`scenario_enrollments?id=eq.${msg.enrollment_id}&select=scenario_id&limit=1`)
      scenarioId = enr[0]?.scenario_id || null
    }
    await sbPost('send_log', {
      workspace_id,
      agent_id: draft.agent_id,
      draft_id,
      sent_by: user_id,
      subject: finalSubject,
      body: finalBody,
      to_email: agent.email,
      channel: 'email',
      scenario_id: scenarioId,
      step_id: msg?.step_id,
      smtp_message_id: info?.messageId,
    })

    // Update draft (approved_by, approved_at, edited fields)
    await sbPatch(`message_drafts?id=eq.${draft_id}`, {
      approved_by: user_id,
      approved_at: now,
      ...(subject_override ? { edited_subject: subject_override } : {}),
      ...(body_override    ? { edited_body: body_override }       : {}),
    })

    // Update agent last_contacted_at
    await sbPatch(`agents?id=eq.${draft.agent_id}`, { last_contacted_at: now })

    // Mark scheduled_message sent
    await sbPatch(`scheduled_messages?id=eq.${draft.scheduled_message_id}`, { status: 'sent', updated_at: now })

    // Advance enrollment to next step
    if (msg?.enrollment_id && msg?.step_id) {
      const enrollment = (await sbGet(`scenario_enrollments?id=eq.${msg.enrollment_id}&select=*&limit=1`))[0]
      const currentStep = (await sbGet(`scenario_steps?id=eq.${msg.step_id}&select=*&limit=1`))[0]

      if (enrollment && currentStep) {
        const nextSteps = await sbGet(
          `scenario_steps?scenario_id=eq.${currentStep.scenario_id}&step_number=gt.${currentStep.step_number}&order=step_number.asc&limit=1`
        )
        const nextStep = nextSteps[0]

        if (nextStep) {
          const nextDate = new Date(now)
          nextDate.setDate(nextDate.getDate() + nextStep.day_offset)
          await sbPost('scheduled_messages', {
            workspace_id,
            agent_id: draft.agent_id,
            enrollment_id: msg.enrollment_id,
            step_id: nextStep.id,
            scheduled_for: nextDate.toISOString().slice(0, 10),
            channel: nextStep.channel,
            status: 'pending',
          })
          await sbPatch(`scenario_enrollments?id=eq.${msg.enrollment_id}`, { current_step: nextStep.step_number })
        } else {
          // No more steps — complete enrollment
          await sbPatch(`scenario_enrollments?id=eq.${msg.enrollment_id}`, { status: 'completed', completed_at: now })
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, sent_to: agent.email }), { status: 200, headers: HEADERS })
  } catch (err) {
    console.error('[send-approved-draft]', err.message)
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: HEADERS })
  }
}
