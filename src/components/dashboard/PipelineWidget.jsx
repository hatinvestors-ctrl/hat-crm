import { Link } from 'react-router-dom'
import Card from '../ui/Card'
import Badge from '../ui/Badge'
import { formatCurrency } from '../../lib/calculations'

export default function PipelineWidget({ leads, workspaceId }) {
  return (
    <Card title="Active Pipeline" padding={false}>
      {!leads || leads.length === 0 ? (
        <div className="text-[13px] text-[color:var(--color-text-dim)] py-6 text-center">
          No active deals.
        </div>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] border-b border-[color:var(--color-line)]">
              <th className="px-4 py-2 text-left font-medium">Address</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">ARV</th>
              <th className="px-4 py-2 text-right font-medium">MAO</th>
              <th className="px-4 py-2 text-right font-medium">Offer</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--color-line)]">
            {leads.map(lead => (
              <tr key={lead.id} className="hover:bg-[color:var(--color-bg-elev-2)] transition-colors">
                <td className="px-4 py-2">
                  <Link
                    to={`/w/${workspaceId}/leads/${lead.id}`}
                    className="text-[color:var(--color-accent-text)] hover:underline truncate inline-block max-w-xs"
                  >
                    {lead.address}
                  </Link>
                </td>
                <td className="px-4 py-2"><Badge status={lead.status} /></td>
                <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(lead.arv)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(lead.mao)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(lead.offer_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
