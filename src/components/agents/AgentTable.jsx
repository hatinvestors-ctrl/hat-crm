// src/components/agents/AgentTable.jsx

const STATUS_DAYS = 30

function contactStatus(lastContactedAt) {
  if (!lastContactedAt) return { label: 'Never contacted', cls: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]' }
  const days = Math.floor((Date.now() - new Date(lastContactedAt)) / 86400000)
  if (days > STATUS_DAYS) return { label: `${days}d ago`, cls: 'bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)]' }
  return { label: `${days}d ago`, cls: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]' }
}

export default function AgentTable({ agents, selected, onToggle, onToggleAll, leadCounts, onRowClick }) {
  const allSelected = agents.length > 0 && agents.every(a => selected.has(a.id))

  return (
    <div className="overflow-x-auto rounded-lg border border-[color:var(--color-line)]">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)]">
            <th className="px-3 py-2.5 w-8">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => onToggleAll()}
                className="accent-[color:var(--color-accent)]"
              />
            </th>
            <th className="px-3 py-2.5 text-left text-[10.5px] uppercase tracking-wider font-medium text-[color:var(--color-text-dim)]">Agent</th>
            <th className="px-3 py-2.5 text-left text-[10.5px] uppercase tracking-wider font-medium text-[color:var(--color-text-dim)]">Email</th>
            <th className="px-3 py-2.5 text-left text-[10.5px] uppercase tracking-wider font-medium text-[color:var(--color-text-dim)]">Leads</th>
            <th className="px-3 py-2.5 text-left text-[10.5px] uppercase tracking-wider font-medium text-[color:var(--color-text-dim)]">Last Contacted</th>
          </tr>
        </thead>
        <tbody>
          {agents.map(agent => {
            const status = contactStatus(agent.last_contacted_at)
            return (
              <tr
                key={agent.id}
                onClick={() => onRowClick?.(agent.id)}
                className="border-t border-[color:var(--color-line)] hover:bg-[color:var(--color-bg-elev)] transition-colors cursor-pointer"
              >
                <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(agent.id)}
                    onChange={() => onToggle(agent.id)}
                    className="accent-[color:var(--color-accent)]"
                  />
                </td>
                <td className="px-3 py-2.5">
                  <div className="font-medium text-[color:var(--color-text)]">{agent.name || '—'}</div>
                  {agent.brokerage && <div className="text-[11px] text-[color:var(--color-text-dim)]">{agent.brokerage}</div>}
                </td>
                <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">{agent.email || '—'}</td>
                <td className="px-3 py-2.5 text-center text-[color:var(--color-text-muted)]">{leadCounts?.[agent.id] ?? 0}</td>
                <td className="px-3 py-2.5">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${status.cls}`}>
                    {status.label}
                  </span>
                </td>
              </tr>
            )
          })}
          {agents.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-8 text-center text-[12px] text-[color:var(--color-text-dim)]">
                No agents yet. Click "Sync from leads" to extract agents from your leads.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
