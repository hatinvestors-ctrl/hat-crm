// src/components/agents/AgentContactsSection.jsx
import { useState, useEffect } from 'react'
import Card from '../ui/Card'
import AgentInlineField from './AgentInlineField'
import AgentContactList from './AgentContactList'
import { supabase } from '../../lib/supabase'

async function seedLegacyContacts(agent, workspaceId) {
  const rows = []
  if (agent.phone) {
    rows.push({ workspace_id: workspaceId, agent_id: agent.id, type: 'phone', value: agent.phone, label: 'Phone', is_primary: false, sort_order: 0 })
  }
  if (agent.email) {
    rows.push({ workspace_id: workspaceId, agent_id: agent.id, type: 'email', value: agent.email, label: 'Work', is_primary: true, sort_order: 0 })
  }
  if (rows.length) {
    const { error } = await supabase.from('agent_contacts').insert(rows)
    if (error) console.warn('[seedLegacyContacts] failed:', error.message)
  }
}

export default function AgentContactsSection({ agent, workspaceId, canEdit, onAgentUpdated }) {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading]   = useState(true)
  const [seeded, setSeeded]     = useState(false)
  const [fetchError, setFetchError] = useState(null)

  const fetchContacts = async ({ autoSeed = false } = {}) => {
    setFetchError(null)
    const { data, error } = await supabase
      .from('agent_contacts')
      .select('*')
      .eq('agent_id', agent.id)
      .order('sort_order', { ascending: true })
    if (error) { setFetchError(error.message); setLoading(false); return [] }

    // Auto-seed legacy email/phone on first load if no contacts exist yet
    if (autoSeed && (data || []).length === 0 && (agent.email || agent.phone)) {
      await seedLegacyContacts(agent, workspaceId)
      const { data: seededData } = await supabase
        .from('agent_contacts')
        .select('*')
        .eq('agent_id', agent.id)
        .order('sort_order', { ascending: true })
      const result = seededData || []
      setContacts(result)
      setSeeded(true)
      setLoading(false)
      return result
    }

    setContacts(data || [])
    setLoading(false)
    return data || []
  }

  useEffect(() => {
    if (!agent?.id) return
    setLoading(true)
    fetchContacts({ autoSeed: true })
    setSeeded(false)
  }, [agent.id])

  const phones = contacts.filter(c => c.type === 'phone')
  const emails = contacts.filter(c => c.type === 'email')

  const handleBeforeAdd = async () => {
    if (seeded) return
    const existing = await fetchContacts()
    if (existing.length === 0) {
      await seedLegacyContacts(agent, workspaceId)
      await fetchContacts()
    }
    setSeeded(true)
  }

  const handleContactsChanged = async () => {
    await fetchContacts()
  }

  const handlePrimaryEmailChanged = async (newEmail) => {
    const { data, error } = await supabase
      .from('agents')
      .update({ email: newEmail, updated_at: new Date().toISOString() })
      .eq('id', agent.id)
      .select()
      .single()
    if (error) { console.warn('[handlePrimaryEmailChanged] failed:', error.message); return }
    if (data) onAgentUpdated?.(data)
  }

  const saveScalar = async (field, value) => {
    const { data, error } = await supabase
      .from('agents')
      .update({ [field]: value || null, updated_at: new Date().toISOString() })
      .eq('id', agent.id)
      .select()
      .single()
    if (error) { console.warn('[saveScalar] failed:', error.message); return }
    if (data) onAgentUpdated?.(data)
  }

  return (
    <Card title="Contact Info">
      <div className="flex flex-col gap-4">

        {fetchError && (
          <div className="text-[11px] text-[color:var(--color-danger-text)] mb-2">{fetchError}</div>
        )}

        {/* Scalar fields */}
        <AgentInlineField
          label="Name"
          value={agent.name}
          placeholder="Add name…"
          canEdit={canEdit}
          onSave={v => saveScalar('name', v)}
        />
        <AgentInlineField
          label="Brokerage"
          value={agent.brokerage}
          placeholder="Add brokerage…"
          canEdit={canEdit}
          onSave={v => saveScalar('brokerage', v)}
        />
        <AgentInlineField
          label="Address"
          value={agent.address}
          placeholder="Add address…"
          multiline
          canEdit={canEdit}
          onSave={v => saveScalar('address', v)}
        />

        {/* Contact lists */}
        {!loading && (
          <>
            <AgentContactList
              agentId={agent.id}
              workspaceId={workspaceId}
              type="phone"
              contacts={phones}
              canEdit={canEdit}
              showPrimary={false}
              onBeforeAdd={handleBeforeAdd}
              onChanged={handleContactsChanged}
            />
            <AgentContactList
              agentId={agent.id}
              workspaceId={workspaceId}
              type="email"
              contacts={emails}
              canEdit={canEdit}
              showPrimary={true}
              onBeforeAdd={handleBeforeAdd}
              onChanged={handleContactsChanged}
              onPrimaryEmailChanged={handlePrimaryEmailChanged}
            />
          </>
        )}
      </div>
    </Card>
  )
}
