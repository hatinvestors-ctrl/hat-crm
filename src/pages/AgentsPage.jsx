// src/pages/AgentsPage.jsx
import { useEffect, useState, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { syncAgentsFromLeads, sendAgentEmails } from '../lib/agentOutreach'
import Topbar from '../components/Topbar'
import Button from '../components/ui/Button'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import AgentTable from '../components/agents/AgentTable'
import AgentEmailModal from '../components/agents/AgentEmailModal'
import AddAgentModal from '../components/agents/AddAgentModal'

const FILTER_OPTIONS = [
  { value: 'all',    label: 'All agents' },
  { value: 'never',  label: 'Never contacted' },
  { value: 'due',    label: 'Due for follow-up (30+ days)' },
]

export default function AgentsPage() {
  const { workspace, workspaceId, user } = useOutletContext()
  const [agents, setAgents] = useState([])
  const [leadCounts, setLeadCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [filter, setFilter] = useState('all')
  const [brokFilter, setBrokFilter] = useState('')
  const [emailModal, setEmailModal] = useState(false)
  const [addModal, setAddModal] = useState(false)
  const [toast, setToast] = useState(null)

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

  const filtered = useMemo(() => {
    let list = agents
    if (filter === 'never') list = list.filter(a => !a.last_contacted_at)
    if (filter === 'due') {
      list = list.filter(a => {
        if (!a.last_contacted_at) return true
        return Math.floor((Date.now() - new Date(a.last_contacted_at)) / 86400000) > 30
      })
    }
    if (brokFilter.trim()) {
      const q = brokFilter.toLowerCase()
      list = list.filter(a => a.brokerage?.toLowerCase().includes(q) || a.name?.toLowerCase().includes(q))
    }
    return list
  }, [agents, filter, brokFilter])

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

  const handleSend = async ({ template, subject }) => {
    const agentIds = [...selected]
    const result = await sendAgentEmails({ workspaceId, userId: user.id, agentIds, template, subject })
    setSelected(new Set())
    await load()
    setToast(`Sent to ${result.sent} agent${result.sent === 1 ? '' : 's'}${result.failed ? `. ${result.failed} failed.` : '.'}`)
    setTimeout(() => setToast(null), 5000)
  }

  const selectedCount = [...selected].filter(id => filtered.some(a => a.id === id)).length

  return (
    <>
      <Topbar
        title="Agents"
        breadcrumbs={[{ label: workspace.name, to: `/w/${workspaceId}` }, { label: 'Agents' }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={handleSync} loading={syncing}>
              Sync from leads
            </Button>
            <Button size="sm" onClick={() => setAddModal(true)}>
              + Add Agent
            </Button>
          </div>
        }
      />

      <div className="px-6 py-4 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1">
            {FILTER_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={`px-3 h-7 text-[12px] font-medium rounded-md transition-colors ${
                  filter === opt.value
                    ? 'bg-[color:var(--color-accent)] text-white'
                    : 'bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Filter by name or brokerage…"
            value={brokFilter}
            onChange={e => setBrokFilter(e.target.value)}
            className="h-7 px-3 text-[12.5px] rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-bg)] text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-dim)] outline-none focus:ring-1 focus:ring-[color:var(--color-accent)]"
          />
          {selectedCount > 0 && (
            <Button size="sm" onClick={() => setEmailModal(true)}>
              Send Email ({selectedCount})
            </Button>
          )}
        </div>

        {toast && (
          <div className="p-2.5 bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)] text-[12px] rounded">
            {toast}
          </div>
        )}

        {loading ? (
          <LoadingSpinner />
        ) : (
          <AgentTable
            agents={filtered}
            selected={selected}
            onToggle={toggleAgent}
            onToggleAll={toggleAll}
            leadCounts={leadCounts}
          />
        )}

        <div className="text-[11px] text-[color:var(--color-text-dim)]">
          {filtered.length} agent{filtered.length === 1 ? '' : 's'}
          {filter !== 'all' && ` (filtered from ${agents.length} total)`}
        </div>
      </div>

      <AgentEmailModal
        open={emailModal}
        onClose={() => setEmailModal(false)}
        agentCount={selectedCount}
        onSend={handleSend}
      />

      <AddAgentModal
        open={addModal}
        onClose={() => setAddModal(false)}
        workspaceId={workspaceId}
        onAdded={() => load()}
      />
    </>
  )
}
