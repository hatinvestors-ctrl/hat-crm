import Card from '../ui/Card'
import { LEAD_SOURCES } from '../../lib/constants'

const SOURCE_LABEL = Object.fromEntries(LEAD_SOURCES.map(s => [s.value, s.label]))

// Computes per-source breakdown over the given lead set.
// "Accepted/sold" = leads currently in offer_accepted/sold/working_project status.
// "Dead" = dead_lead/rejected_not_accepted/not_in_buy_box.
export default function SourcePerformance({ leads }) {
  const buckets = {}
  for (const l of leads) {
    const k = l.lead_source || 'unknown'
    if (!buckets[k]) buckets[k] = { count: 0, accepted: 0, sold: 0, dead: 0 }
    buckets[k].count++
    if (l.status === 'offer_accepted') buckets[k].accepted++
    if (l.status === 'sold' || l.status === 'flip_sold' || l.status === 'working_project') buckets[k].sold++
    if (['dead_lead','rejected_not_accepted','not_in_buy_box'].includes(l.status)) buckets[k].dead++
  }
  const rows = Object.entries(buckets)
    .map(([k, v]) => ({
      key: k,
      label: SOURCE_LABEL[k] || k,
      ...v,
      conversion: v.count > 0 ? Math.round(((v.accepted + v.sold) / v.count) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)

  if (rows.length === 0) {
    return (
      <Card title="By lead source">
        <div className="text-[12.5px] text-[color:var(--color-text-dim)]">No leads yet.</div>
      </Card>
    )
  }

  return (
    <Card title="By lead source">
      <table className="w-full text-[12.5px]">
        <thead className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">
          <tr className="border-b border-[color:var(--color-line)]">
            <th className="text-left pb-1.5 font-medium">Source</th>
            <th className="text-right pb-1.5 font-medium">Total</th>
            <th className="text-right pb-1.5 font-medium">Won</th>
            <th className="text-right pb-1.5 font-medium">Dead</th>
            <th className="text-right pb-1.5 font-medium">Conv. %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className="border-b border-[color:var(--color-line)] last:border-b-0">
              <td className="py-1.5 text-[color:var(--color-text)]">{r.label}</td>
              <td className="py-1.5 text-right text-[color:var(--color-text)] tabular-nums">{r.count}</td>
              <td className="py-1.5 text-right text-[color:var(--color-success-text)] tabular-nums">{r.accepted + r.sold}</td>
              <td className="py-1.5 text-right text-[color:var(--color-text-dim)] tabular-nums">{r.dead}</td>
              <td className="py-1.5 text-right text-[color:var(--color-text)] tabular-nums font-medium">{r.conversion}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
