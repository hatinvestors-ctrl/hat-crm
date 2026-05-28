import Card from '../ui/Card'

// Per-assignee scoreboard.
// "Active" = leads currently assigned that aren't in a terminal state.
// "Sent (period)" = offer_sent transitions in the time window (passed in).
// "Won" = offer_accepted or sold currently assigned to this user.
export default function TeammatePerformance({ leads, members, offersByAssignee = {} }) {
  const memberMap = Object.fromEntries((members || []).map(m => [m.user_id, m.profiles?.full_name || 'User']))

  const TERMINAL = ['sold','dead_lead','rejected_not_accepted','not_in_buy_box','sequence_completed']
  const WON = ['offer_accepted','sold','working_project']
  const buckets = {}
  for (const l of leads) {
    const k = l.assigned_to || '__unassigned__'
    if (!buckets[k]) buckets[k] = { active: 0, won: 0, dead: 0, total: 0 }
    buckets[k].total++
    if (!TERMINAL.includes(l.status)) buckets[k].active++
    if (WON.includes(l.status)) buckets[k].won++
    if (['dead_lead','rejected_not_accepted'].includes(l.status)) buckets[k].dead++
  }
  const rows = Object.entries(buckets)
    .map(([k, v]) => ({
      key: k,
      label: k === '__unassigned__' ? '— Unassigned —' : (memberMap[k] || 'Unknown'),
      ...v,
      offersSent: offersByAssignee[k] || 0,
    }))
    .sort((a, b) => b.total - a.total)

  if (rows.length === 0) {
    return (
      <Card title="By teammate">
        <div className="text-[12.5px] text-[color:var(--color-text-dim)]">No assignments yet.</div>
      </Card>
    )
  }

  return (
    <Card title="By teammate">
      <table className="w-full text-[12.5px]">
        <thead className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">
          <tr className="border-b border-[color:var(--color-line)]">
            <th className="text-left pb-1.5 font-medium">Teammate</th>
            <th className="text-right pb-1.5 font-medium">Active</th>
            <th className="text-right pb-1.5 font-medium" title="Offers sent in selected range">Sent</th>
            <th className="text-right pb-1.5 font-medium">Won</th>
            <th className="text-right pb-1.5 font-medium">Dead</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className="border-b border-[color:var(--color-line)] last:border-b-0">
              <td className="py-1.5 text-[color:var(--color-text)]">{r.label}</td>
              <td className="py-1.5 text-right text-[color:var(--color-text)] tabular-nums">{r.active}</td>
              <td className="py-1.5 text-right text-[color:var(--color-accent-text)] tabular-nums">{r.offersSent}</td>
              <td className="py-1.5 text-right text-[color:var(--color-success-text)] tabular-nums">{r.won}</td>
              <td className="py-1.5 text-right text-[color:var(--color-text-dim)] tabular-nums">{r.dead}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
