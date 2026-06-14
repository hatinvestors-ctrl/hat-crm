// Daily cron at 8 AM EST (13:00 UTC). Creates message_drafts for due steps.
// Never auto-sends unless step.auto_send=true (which we don't use by default).
// Safety gauntlet: DNC → opt_out → replied → daily cap → min days → deferred.

import nodemailer from 'nodemailer'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const NETLIFY_URL  = process.env.URL || 'https://gilded-elf-31457a.netlify.app'
const DAILY_HARD_CAP = 20

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
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`)
}

async function generateDraft(workspaceId, agentId, scenarioType, agentData) {
  const res = await fetch(`${NETLIFY_URL}/.netlify/functions/generate-agent-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_id: workspaceId,
      agent_id: agentId,
      scenario_type: scenarioType || 'check_in',
      sender: 'kevin',
      context: {
        agent_name: agentData.name,
        brokerage: agentData.brokerage,
        relationship_status: agentData.relationship_status,
        last_contacted_at: agentData.last_contacted_at,
        market_areas: agentData.market_areas,
      },
    }),
  })
  if (!res.ok) throw new Error(`generate-agent-email failed: ${res.status}`)
  return res.json()
}

export default async () => {
  const today = new Date().toISOString().slice(0, 10)
  let processed = 0
  let errors = []

  try {
    // Load all workspaces that have active enrollments with due messages
    const dueMessages = await sbGet(
      `scheduled_messages?status=eq.pending&scheduled_for=lte.${today}&select=id,workspace_id,agent_id,enrollment_id,step_id,channel&order=scheduled_for.asc&limit=100`
    )

    // Load opt_out emails per workspace (build set for fast lookup)
    const optOutSets = {}

    for (const msg of dueMessages) {
      if (processed >= DAILY_HARD_CAP) break

      try {
        const { id: msgId, workspace_id, agent_id, enrollment_id, step_id, channel } = msg

        // Load opt_outs for this workspace (cache per workspace)
        if (!optOutSets[workspace_id]) {
          const outs = await sbGet(`opt_outs?workspace_id=eq.${workspace_id}&select=email`)
          optOutSets[workspace_id] = new Set(outs.map(o => o.email.toLowerCase()))
        }

        // Load agent
        const agents = await sbGet(`agents?id=eq.${agent_id}&select=*&limit=1`)
        const agent = agents[0]
        if (!agent) {
          await sbPatch(`scheduled_messages?id=eq.${msgId}`, { status: 'skipped', skip_reason: 'agent_not_found', updated_at: new Date().toISOString() })
          continue
        }

        // Safety 1: DNC
        if (agent.relationship_status === 'do_not_contact') {
          await sbPatch(`scheduled_messages?id=eq.${msgId}`, { status: 'skipped', skip_reason: 'do_not_contact', updated_at: new Date().toISOString() })
          continue
        }

        // Safety 2: opt_out
        if (agent.email && optOutSets[workspace_id].has(agent.email.toLowerCase())) {
          await sbPatch(`scheduled_messages?id=eq.${msgId}`, { status: 'skipped', skip_reason: 'opted_out', updated_at: new Date().toISOString() })
          continue
        }

        // Load enrollment + step
        const enrollments = await sbGet(`scenario_enrollments?id=eq.${enrollment_id}&select=*&limit=1`)
        const enrollment = enrollments[0]
        if (!enrollment || enrollment.status !== 'active') {
          await sbPatch(`scheduled_messages?id=eq.${msgId}`, { status: 'cancelled', skip_reason: 'enrollment_not_active', updated_at: new Date().toISOString() })
          continue
        }

        const steps = step_id ? await sbGet(`scenario_steps?id=eq.${step_id}&select=*&limit=1`) : []
        const step = steps[0]

        // Safety 3: replied (if stop_on_reply)
        if (step?.stop_on_reply && agent.last_replied_at) {
          const repliedAt = new Date(agent.last_replied_at)
          const enrolledAt = new Date(enrollment.enrolled_at)
          if (repliedAt > enrolledAt) {
            await sbPatch(`scheduled_messages?id=eq.${msgId}`, { status: 'skipped', skip_reason: 'agent_replied', updated_at: new Date().toISOString() })
            await sbPatch(`scenario_enrollments?id=eq.${enrollment_id}`, { status: 'stopped_reply', cancelled_at: new Date().toISOString(), cancel_reason: 'agent_replied' })
            continue
          }
        }

        // Safety 4: already contacted today
        const todayLog = await sbGet(`send_log?agent_id=eq.${agent_id}&sent_at=gte.${today}T00:00:00Z&select=id&limit=1`)
        if (todayLog.length > 0) {
          const tomorrow = new Date()
          tomorrow.setDate(tomorrow.getDate() + 1)
          await sbPatch(`scheduled_messages?id=eq.${msgId}`, { scheduled_for: tomorrow.toISOString().slice(0, 10), updated_at: new Date().toISOString() })
          continue
        }

        // Safety 5: min days since last contact
        if (step?.min_days_since_last_contact && agent.last_contacted_at) {
          const lastContact = new Date(agent.last_contacted_at)
          const daysSince = Math.floor((Date.now() - lastContact.getTime()) / 86400000)
          if (daysSince < step.min_days_since_last_contact) {
            const deferUntil = new Date(lastContact)
            deferUntil.setDate(deferUntil.getDate() + step.min_days_since_last_contact)
            await sbPatch(`scheduled_messages?id=eq.${msgId}`, { scheduled_for: deferUntil.toISOString().slice(0, 10), updated_at: new Date().toISOString() })
            continue
          }
        }

        // Generate draft
        const generated = await generateDraft(workspace_id, agent_id, step?.ai_scenario_type, agent)

        const subject = step?.subject_override || generated.subject || 'Checking in'
        const body = step?.body_override || generated.body || ''

        // Insert message_draft
        const draftId = crypto.randomUUID()
        await sbPost('message_drafts', {
          id: draftId,
          workspace_id,
          scheduled_message_id: msgId,
          agent_id,
          subject,
          body,
          generated_by: generated.generated_by || 'ai',
          generation_context: { scenario_type: step?.ai_scenario_type, agent_name: agent.name },
        })

        // Update scheduled_message to draft_created
        await sbPatch(`scheduled_messages?id=eq.${msgId}`, { status: 'draft_created', updated_at: new Date().toISOString() })

        processed++
      } catch (err) {
        errors.push({ msg_id: msg.id, error: err.message })
        console.error('[process-agent-sequences] message error:', msg.id, err.message)
      }
    }

    console.log(`[process-agent-sequences] Done. processed=${processed}, errors=${errors.length}`)
  } catch (err) {
    console.error('[process-agent-sequences] Fatal:', err.message)
  }
}

export const config = { schedule: '0 13 * * *' }
