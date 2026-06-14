// src/components/agents/AgentDetailDrawer.jsx
import { useEffect, useState } from 'react'
import Drawer from '../ui/Drawer'
import Button from '../ui/Button'
import AgentNotesSection from './AgentNotesSection'
import AgentActivityFeed from './AgentActivityFeed'
import AddAgentModal from './AddAgentModal'
import AgentContactsSection from './AgentContactsSection'
import AgentProfileSection from './AgentProfileSection'
import AgentDealsSection from './AgentDealsSection'
import AgentScenarioPanel from './AgentScenarioPanel'
import { supabase } from '../../lib/supabase'

function lastContactedBadge(lastContactedAt) {
  if (!lastContactedAt) return { label: 'Never contacted', cls: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]' }
  const days = Math.floor((Date.now() - new Date(lastContactedAt)) / 86400000)
  if (days > 30) return { label: `${days}d ago`, cls: 'bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)]' }
  return { label: `${days}d ago`, cls: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]' }
}

export default function AgentDetailDrawer({
  open,
  agentId,
  workspaceId,
  userId,
  userRole,
  leadCount,
  onClose,
  onSendEmail,
  onAgentUpdated,
}) {
  const [agent, setAgent]           = useState(null)
  const [loading, setLoading]       = useState(false)
  const [editOpen, setEditOpen]     = useState(false)
  const [fetchError, setFetchError] = useState(null)

  const canEdit = userRole !== 'readonly'
  const drawerWidth = Math.min(900, Math.max(600, Math.round(window.innerWidth * 0.70)))

  useEffect(() => {
    if (!agentId || !open) { setAgent(null); setFetchError(null); return }
    let cancelled = false
    setLoading(true)
    setFetchError(null)
    supabase.from('agents').select('*').eq('id', agentId).single()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setFetchError(error.message); setLoading(false); return }
        setAgent(data)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [agentId, open])

  const handleAgentUpdated = (updated) => {
    setAgent(updated)
    onAgentUpdated?.(updated)
  }

  const badge = agent ? lastContactedBadge(agent.last_contacted_at) : null

  return (
    <>
      <Drawer open={open} onClose={onClose} title="" width={drawerWidth}>
        {loading || !agent ? (
          <div className="flex items-center justify-center h-32 text-[13px] text-[color:var(--color-text-dim)]">
            {loading ? 'Loading…' : fetchError ? `Error: ${fetchError}` : 'Agent not found.'}
          </div>
        ) : (
          <div className="flex flex-col h-full">

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--color-line)] shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-semibold text-[color:var(--color-text)]">{agent.name || agent.email}</span>
                  {badge && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                  )}
                </div>
                <div className="text-[11px] text-[color:var(--color-text-dim)] mt-0.5">
                  {agent.brokerage && <span>{agent.brokerage}</span>}
                  {agent.brokerage && leadCount != null && <span className="mx-1.5">·</span>}
                  {leadCount != null && (
                    <a
                      href={`/w/${workspaceId}/leads?agent_email=${encodeURIComponent(agent.email || '')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[color:var(--color-accent)] hover:underline"
                    >
                      {leadCount} lead{leadCount === 1 ? '' : 's'} ↗
                    </a>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {canEdit && (
                  <Button size="sm" onClick={() => onSendEmail?.()}>Send Email</Button>
                )}
                {canEdit && (
                  <Button size="sm" variant="secondary" onClick={() => setEditOpen(true)}>Edit</Button>
                )}
                <button
                  onClick={onClose}
                  className="text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] w-6 h-6 rounded inline-flex items-center justify-center hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
                  aria-label="Close"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6 6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* 2-column body */}
            <div className="flex flex-1 min-h-0">

              {/* Left column */}
              <div className="w-1/2 border-r border-[color:var(--color-line)] overflow-y-auto p-4 flex flex-col gap-4">
                {/* Contact Info — editable */}
                <AgentContactsSection
                  agent={agent}
                  workspaceId={workspaceId}
                  canEdit={canEdit}
                  onAgentUpdated={handleAgentUpdated}
                />

                {/* Profile */}
                <div>
                  <div className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)] mb-2">Profile</div>
                  <AgentProfileSection agent={agent} canEdit={canEdit} onUpdated={handleAgentUpdated} />
                </div>

                {/* Linked Deals */}
                <div>
                  <div className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)] mb-2">Linked Deals</div>
                  <AgentDealsSection agent={agent} workspaceId={workspaceId} canEdit={canEdit} />
                </div>

                <div className="pt-3 border-t border-[color:var(--color-line)]">
                  <AgentScenarioPanel
                    agent={agent}
                    workspaceId={workspaceId}
                    userId={userId}
                    canEdit={canEdit}
                  />
                </div>

                {/* Notes */}
                <div className="flex-1">
                  <AgentNotesSection agent={agent} canEdit={canEdit} onUpdated={handleAgentUpdated} />
                </div>
              </div>

              {/* Right column */}
              <div className="w-1/2 flex flex-col min-h-0">
                <AgentActivityFeed
                  agentId={agent.id}
                  workspaceId={workspaceId}
                  userId={userId}
                />
              </div>

            </div>
          </div>
        )}
      </Drawer>

      {/* Edit modal — reuses AddAgentModal prefilled */}
      {editOpen && agent && (
        <AddAgentModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          workspaceId={workspaceId}
          initialValues={{ name: agent.name, email: agent.email, phone: agent.phone, brokerage: agent.brokerage }}
          agentId={agent.id}
          onAdded={handleAgentUpdated}
        />
      )}
    </>
  )
}
