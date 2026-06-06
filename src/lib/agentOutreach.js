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
    { onConflict: 'workspace_id,email', ignoreDuplicates: true }
  )
}

// Parse "First Last (Brokerage)" format from seller_name field
function parseBrokerage(sellerName) {
  if (!sellerName) return { name: null, brokerage: null }
  const match = sellerName.match(/^(.+?)\s*\((.+)\)$/)
  if (match) return { name: match[1].trim(), brokerage: match[2].trim() }
  return { name: sellerName.trim(), brokerage: null }
}

export async function syncAgentsFromLeads(workspaceId) {
  if (!workspaceId) return { count: 0 }

  // Source 1: dedicated listing_agent_* fields (populated via RentCast lookup)
  const { data: enrichedLeads } = await supabase
    .from('leads')
    .select('listing_agent_name, listing_agent_email, listing_agent_phone, listing_brokerage')
    .eq('workspace_id', workspaceId)
    .not('listing_agent_email', 'is', null)
    .neq('listing_agent_email', '')

  // Source 2: seller contact email field (often contains listing agent email)
  const { data: sellerLeads } = await supabase
    .from('leads')
    .select('seller_name, email, phone')
    .eq('workspace_id', workspaceId)
    .not('email', 'is', null)
    .neq('email', '')

  const seen = new Set()
  const rows = []

  for (const l of enrichedLeads || []) {
    const key = l.listing_agent_email.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      workspace_id: workspaceId,
      name:         l.listing_agent_name  || null,
      email:        key,
      phone:        l.listing_agent_phone || null,
      brokerage:    l.listing_brokerage   || null,
      updated_at:   new Date().toISOString(),
    })
  }

  for (const l of sellerLeads || []) {
    const key = l.email.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const { name, brokerage } = parseBrokerage(l.seller_name)
    rows.push({
      workspace_id: workspaceId,
      name,
      email:        key,
      phone:        l.phone || null,
      brokerage,
      updated_at:   new Date().toISOString(),
    })
  }

  if (!rows.length) return { count: 0 }

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
