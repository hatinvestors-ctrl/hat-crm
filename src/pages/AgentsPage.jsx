// src/pages/AgentsPage.jsx
import { useEffect, useState, useMemo } from 'react'
import { useOutletContext, NavLink } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { syncAgentsFromLeads, sendAgentEmails } from '../lib/agentOutreach'
import { AGENT_TYPES, RELATIONSHIP_STATUSES } from '../lib/constants'
import Topbar from '../components/Topbar'
import Button from '../components/ui/Button'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import AgentTable from '../components/agents/AgentTable'
import AgentEmailModal from '../components/agents/AgentEmailModal'
import AddAgentModal from '../components/agents/AddAgentModal'
import AgentDetailDrawer from '../components/agents/AgentDetailDrawer'

const CONTACT_FILTERS = [
  { value: 'all',   label: 'All agents' },
  { value: 'never', label: 'Never contacted' },
  { value: 'due',   label: 'Due 30+ days' },
]

export default function AgentsPage() {
  const { workspace, workspaceId, user, userRole } = useOutletContext()
  const [agents, setAgents]               = useState([])
  const [leadCounts, setLeadCounts]       = useState({})
  const [loading, setLoading]             = useState(true)
  const [syncing, setSyncing]             = useState(false)
  const [selected, setSelected]           = useState(new Set())
  const [filter, setFilter]               = useState('all')
  const [typeFilter, setTypeFilter]       = useState('')
  const [relFilter, setRelFilter]         = useState('')
  const [strategicOnly, setStrategicOnly] = useState(false)
  const [brokFilter, setBrokFilter]       = useState('')
  const [emailModal, setEmailModal]       = useState(false)
  const [addModal, setAddModal]           = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState(null)
  const [toast, setToast]                 = useState(null)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('agents')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('name', { ascending: true })
    setAgents(data || [])

    const { data: leads } = await supabase
      .from('leads')
      .select('listing_agent_email')
      .eq('workspace_id', workspaceId)
      .not('listing_agent_email', 'is', null)

    const counts = {}
    for (const agent of data || []) {
      counts[agent.id] = (leads || []).filter(l =>
        l.listing_agent_email?.toLowerCase() === agent.email?.toLowerCase()
      ).length
    }
    setLeadCounts(counts)
    setLoading(false)
  }

  useEffect(() => { load() }, [workspaceId])
  useEffect(() => { setSelectedAgentId(null) }, [workspaceId])

  const filtered = useMemo(() => {
    let list = agents
    if (filter === 'never') list = list.filter(a => !a.last_contacted_at)
    if (filter === 'due') {
      list = list.filter(a => {
        if (!a.last_contacted_at) return false
        return Math.floor((Date.now() - new Date(a.last_contacted_at)) / 86400000) > 30
      })
    }
    if (typeFilter) list = list.filter(a => (a.agent_type || 'realtor') === typeFilter)
    if (relFilter)  list = list.filter(a => (a.relationship_status || 'new') === relFilter)
    if (strategicOnly) list = list.filter(a => a.is_strategic)
    if (brokFilter.trim()) {
      const q = brokFilter.toLowerCase()
      list = list.filter(a => a.brokerage?.toLowerCase().includes(q) || a.name?.toLowerCase().includes(q))
    }
    return list
  }, [agents, filter, typeFilter, relFilter, strategicOnly, brokFilter])

  const toggleAgent = id => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const toggleAll = () => {
    if (filtered.every(a => selected.has(a.id))) {
      setSelected(prev => { const n = new Set(prev); filtered.forEach(a => n.delete(a.id)); return n })
    } else {
      setSelected(prev => { const n = new Set(prev); filtered.forEach(a => n.add(a.id)); return n })
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const { count } = await syncAgentsFromLeads(workspaceId)
      await load()
      setToast(`Synced ${count} agent${count === 1 ? '' : 's'} from leads.`)
    } catch (e) {
      setToast(`Sync failed: ${e.message}`)
    } finally {
      setSyncing(false)
      setTimeout(() => setToast(null), 4000)
    }
  }

  const handleSend = async ({ template, subject, body }) => {
    const agentIds = [...selected]
    const result = await sendAgentEmails({ workspaceId, userId: user.id, agentIds, template, subject, body })
    setSelected(new Set())
    await load()
    setToast(`Sent to ${result.sent} agent${result.sent === 1 ? '' : 's'}${result.failed ? `. ${result.failed} failed.` : '.'}`)
    setTimeout(() => setToast(null), 5000)
  }

  const handleAgentUpdated = (updated) => {
    setAgents(prev => prev.map(a => a.id === updated.id ? updated : a))
  }

  const selectedCount = [...selected].filter(id => filtered.some(a => a.id === id)).length
  const selectedAgent = selectedCount === 1
    ? agents.find(a => [...selected].find(id => id === a.id))
    : null

  const filterPillCls = (active) =>
    `px-3 py-1 rounded-full text-[12px] font-medium transition-colors ${
      active
        ? 'bg-[color:var(--color-accent)] text-white'
        : 'bg-[color:var(--color-bg-elev)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
    }`

  return (
    <>
      <Topbar
        title="Agents"
        breadcrumbs={[{ label: workspace.name, to: `/w/${workspaceId}` }, { label: 'Agents' }]}
        actions={
          <div className="flex items-center gap-2">
            {selectedCount > 0 && (
              <Button size="sm" onClick={() => setEmailModal(true)}>
                Send Email ({selectedCount})
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setAddModal(true)}>+ Add Agent</Button>
            <Button size="sm" variant="secondary" onClick={handleSync} loading={syncing}>Sync from leads</Button>
          </div>
        }
      />

      {/* Sub-nav tabs */}
      <div className="border-b border-[color:var(--color-line)] px-4 flex gap-1">
        {[
          { to: `/w/${workspaceId}/agents`,           label: 'Agents',    end: true },
          { to: `/w/${workspaceId}/agents/scenarios`, label: 'Scenarios', end: false },
          { to: `/w/${workspaceId}/agents/drafts`,    label: 'Drafts',    end: false },
        ].map(tab => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `px-3 py-2 text-[13px] font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-[color:var(--color-accent)] text-[color:var(--color-text)]'
                  : 'border-transparent text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>

      <div className="p-4 flex flex-col gap-4">
        {/* Contact filters */}
        <div className="flex flex-wrap items-center gap-2">
          {CONTACT_FILTERS.map(opt => (
            <button key={opt.value} onClick={() => setFilter(opt.value)} className={filterPillCls(filter === opt.value)}>
              {opt.label}
            </button>
          ))}

          {/* Strategic toggle */}
          <button
            onClick={() => setStrategicOnly(v => !v)}
            className={filterPillCls(strategicOnly)}
            title="Strategic contacts only"
          >
            ⭐ Strategic
          </button>

          <input
            type="text"
            value={brokFilter}
            onChange={e => setBrokFilter(e.target.value)}
            placeholder="Filter by name or brokerage"
            className="px-3 py-1 text-[12px] rounded-full bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-faint)] border border-[color:var(--color-line)] focus:outline-none focus:border-[color:var(--color-accent)] w-44"
          />
        </div>

        {/* Type + relationship filters */}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setTypeFilter('')} className={filterPillCls(!typeFilter)}>
            All types
          </button>
          {AGENT_TYPES.map(t => (
            <button key={t.value} onClick={() => setTypeFilter(typeFilter === t.value ? '' : t.value)} className={filterPillCls(typeFilter === t.value)}>
              {t.label}
            </button>
          ))}
          <span className="text-[color:var(--color-line)] mx-1">|</span>
          <button onClick={() => setRelFilter('')} className={filterPillCls(!relFilter)}>
            All statuses
          </button>
          {RELATIONSHIP_STATUSES.map(s => (
            <button key={s.value} onClick={() => setRelFilter(relFilter === s.value ? '' : s.value)} className={filterPillCls(relFilter === s.value)}>
              {s.label}
            </button>
          ))}
        </div>

        {toast && (
          <div className={`text-[12px] px-3 py-2 rounded-md ${
            toast.startsWith('Sync failed')
              ? 'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)]'
              : 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]'
          }`}>
            {toast}
          </div>
        )}

        {loading ? (
          <LoadingSpinner label="Loading agents…" />
        ) : (
          <AgentTable
            agents={filtered}
            selected={selected}
            onToggle={toggleAgent}
            onToggleAll={toggleAll}
            leadCounts={leadCounts}
            onRowClick={id => setSelectedAgentId(id)}
          />
        )}
      </div>

      <AgentEmailModal
        open={emailModal}
        onClose={() => setEmailModal(false)}
        agentCount={selectedCount}
        agent={selectedAgent}
        workspaceId={workspaceId}
        onSend={handleSend}
      />

      <AddAgentModal
        open={addModal}
        onClose={() => setAddModal(false)}
        workspaceId={workspaceId}
        onAdded={(a) => setAgents(prev => [...prev, a])}
      />

      <AgentDetailDrawer
        open={Boolean(selectedAgentId)}
        agentId={selectedAgentId}
        workspaceId={workspaceId}
        userId={user.id}
        userRole={userRole}
        leadCount={selectedAgentId ? (leadCounts[selectedAgentId] ?? 0) : null}
        onClose={() => setSelectedAgentId(null)}
        onSendEmail={() => {
          if (selectedAgentId) setSelected(new Set([selectedAgentId]))
          setSelectedAgentId(null)
          setEmailModal(true)
        }}
        onAgentUpdated={handleAgentUpdated}
      />
    </>
  )
}
