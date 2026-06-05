// src/lib/agentOutreach.js
import { supabase } from './supabase'

export async function upsertAgentFromLead(workspaceId, { listing_agent_name, listing_agent_email, listing_agent_phone, listing_brokerage }) {
  if (!workspaceId || !listing_agent_email?.trim()) return
  await supabase.from('agents').upsert(
    {
      workspace_id: workspaceId,
      name:         listing_agent_name || null,
      email:        listing_agent_email.trim().toLowerCase(),
      phone:        listing_agent_phone || null,
      brokerage:    listing_brokerage  || null,
      updated_at:   new Date().toISOString(),
    },
    { onConflict: 'workspace_id,email', ignoreDuplicates: false }
  )
}

export async function syncAgentsFromLeads(workspaceId) {
  if (!workspaceId) return { count: 0 }

  const { data: leads } = await supabase
    .from('leads')
    .select('listing_agent_name, listing_agent_email, listing_agent_phone, listing_brokerage')
    .eq('workspace_id', workspaceId)
    .not('listing_agent_email', 'is', null)
    .neq('listing_agent_email', '')

  if (!leads?.length) return { count: 0 }

  const seen = new Set()
  const unique = leads.filter(l => {
    const key = l.listing_agent_email.trim().toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const rows = unique.map(l => ({
    workspace_id: workspaceId,
    name:         l.listing_agent_name  || null,
    email:        l.listing_agent_email.trim().toLowerCase(),
    phone:        l.listing_agent_phone || null,
    brokerage:    l.listing_brokerage   || null,
    updated_at:   new Date().toISOString(),
  }))

  const { error } = await supabase
    .from('agents')
    .upsert(rows, { onConflict: 'workspace_id,email', ignoreDuplicates: false })

  if (error) throw error
  return { count: rows.length }
}

export async function sendAgentEmails({ workspaceId, userId, agentIds, template, subject }) {
  const res = await fetch('/.netlify/functions/send-agent-emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: workspaceId, user_id: userId, agent_ids: agentIds, template, subject }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}
