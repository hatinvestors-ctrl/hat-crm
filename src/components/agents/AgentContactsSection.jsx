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
  if (rows.length) await supabase.from('agent_contacts').insert(rows)
}

export default function AgentContactsSection({ agent, workspaceId, canEdit, onAgentUpdated }) {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading]   = useState(true)
  const [seeded, setSeeded]     = useState(false)

  const fetchContacts = async () => {
    const { data } = await supabase
      .from('agent_contacts')
      .select('*')
      .eq('agent_id', agent.id)
      .order('sort_order', { ascending: true })
    setContacts(data || [])
    setLoading(false)
    return data || []
  }

  useEffect(() => {
    if (!agent?.id) return
    setLoading(true)
    fetchContacts()
    setSeeded(false)
  }, [agent.id])

  const phones = contacts.filter(c => c.type === 'phone')
  const emails = contacts.filter(c => c.type === 'email')

  const handleContactsChanged = async () => {
    await fetchContacts()
  }

  const handleBeforeAdd = async () => {
    if (seeded) return
    const existing = await fetchContacts()
    if (existing.length === 0) {
      await seedLegacyContacts(agent, workspaceId)
      await fetchContacts()
    }
    setSeeded(true)
  }

  const handlePrimaryEmailChanged = async (newEmail) => {
    const { data } = await supabase
      .from('agents')
      .update({ email: newEmail, updated_at: new Date().toISOString() })
      .eq('id', agent.id)
      .select()
      .single()
    if (data) onAgentUpdated?.(data)
  }

  const saveScalar = async (field, value) => {
    const { data } = await supabase
      .from('agents')
      .update({ [field]: value || null, updated_at: new Date().toISOString() })
      .eq('id', agent.id)
      .select()
      .single()
    if (data) onAgentUpdated?.(data)
  }

  return (
    <Card title="Contact Info">
      <div className="flex flex-col gap-4">

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
