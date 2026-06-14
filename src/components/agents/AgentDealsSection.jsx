import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import SearchableSelect from '../ui/SearchableSelect'
import Button from '../ui/Button'

const ROLE_LABELS = {
  listing_agent:   'Listing Agent',
  referral_source: 'Referral Source',
  wholesaler:      'Wholesaler',
  buyer_agent:     'Buyer Agent',
  co_agent:        'Co-Agent',
}

export default function AgentDealsSection({ agent, workspaceId, canEdit }) {
  const [links, setLinks]       = useState([])
  const [metrics, setMetrics]   = useState(null)
  const [leads, setLeads]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [linking, setLinking]   = useState(false)
  const [selectedLead, setSelectedLead] = useState('')
  const [selectedRole, setSelectedRole] = useState('listing_agent')

  const load = async () => {
    setLoading(true)
    const [{ data: linkedRows }, { data: metricRow }, { data: allLeads }] = await Promise.all([
      supabase
        .from('agent_leads')
        .select('*, leads(id, address, status, created_at)')
        .eq('agent_id', agent.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('agent_deal_metrics')
        .select('*')
        .eq('agent_id', agent.id)
        .maybeSingle(),
      supabase
        .from('leads')
        .select('id, address')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(300),
    ])
    setLinks(linkedRows || [])
    setMetrics(metricRow || null)
    setLeads(allLeads || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [agent.id])

  const linkDeal = async () => {
    if (!selectedLead) return
    setLinking(true)
    await supabase.from('agent_leads').upsert({
      workspace_id: workspaceId,
      agent_id: agent.id,
      lead_id: selectedLead,
      role: selectedRole,
    }, { onConflict: 'agent_id,lead_id,role' })
    setSelectedLead('')
    await load()
    setLinking(false)
  }

  const unlink = async (linkId) => {
    await supabase.from('agent_leads').delete().eq('id', linkId)
    setLinks(prev => prev.filter(l => l.id !== linkId))
  }

  const alreadyLinkedIds = links.map(l => l.lead_id)
  const availableLeads = leads.filter(l => !alreadyLinkedIds.includes(l.id))

  const MetricChip = ({ label, value }) => (
    <div className="text-center">
      <div className="text-[18px] font-bold text-[color:var(--color-text)]">{value ?? 0}</div>
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{label}</div>
    </div>
  )

  if (loading) return <div className="text-[12px] text-[color:var(--color-text-dim)] py-2">Loading deals…</div>

  return (
    <div className="space-y-3">
      {/* Metrics row */}
      <div className="grid grid-cols-4 gap-2 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded-lg p-3">
        <MetricChip label="Deals" value={metrics?.deals_linked} />
        <MetricChip label="Offers" value={metrics?.offers_made} />
        <MetricChip label="Contracts" value={metrics?.contracts_signed} />
        <MetricChip label="Closings" value={metrics?.closings} />
      </div>

      {/* Link deal form */}
      {canEdit && (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <SearchableSelect
              value={selectedLead}
              onChange={setSelectedLead}
              options={[
                { value: '', label: 'Select a lead to link…' },
                ...availableLeads.map(l => ({ value: l.id, label: l.address || '(no address)' })),
              ]}
              placeholder="Select a lead to link…"
            />
          </div>
          <select
            value={selectedRole}
            onChange={e => setSelectedRole(e.target.value)}
            className="text-[12px] px-2 h-8 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none"
          >
            {Object.entries(ROLE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <Button size="sm" onClick={linkDeal} loading={linking} disabled={!selectedLead}>
            Link
          </Button>
        </div>
      )}

      {/* Linked deals list */}
      {links.length === 0 ? (
        <div className="text-[12px] text-[color:var(--color-text-dim)] italic py-1">No deals linked yet.</div>
      ) : (
        <div className="space-y-1">
          {links.map(link => (
            <div key={link.id} className="flex items-center gap-2 py-1.5 border-b border-[color:var(--color-line)] last:border-0">
              <div className="flex-1 min-w-0">
                <div className="text-[12px] text-[color:var(--color-text)] truncate">
                  {link.leads?.address || '(no address)'}
                </div>
                <div className="text-[10.5px] text-[color:var(--color-text-dim)]">
                  {ROLE_LABELS[link.role] || link.role} · {link.leads?.status || '—'}
                </div>
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => unlink(link.id)}
                  className="text-[11px] text-[color:var(--color-danger-text)] opacity-60 hover:opacity-100 flex-shrink-0"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
