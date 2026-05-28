import { Link } from 'react-router-dom'
import Card from '../ui/Card'

export default function FollowUpWidget({ leads, workspaceId }) {
  return (
    <Card title="Follow-Ups Today">
      {!leads || leads.length === 0 ? (
        <div className="text-[13px] text-[color:var(--color-text-dim)] py-3 text-center">
          Nothing due today.
        </div>
      ) : (
        <ul className="divide-y divide-[color:var(--color-line)] -my-2">
          {leads.map(lead => (
            <li key={lead.id}>
              <Link
                to={`/w/${workspaceId}/leads/${lead.id}`}
                className="block py-2 -mx-2 px-2 rounded hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
              >
                <div className="text-[13px] font-medium text-[color:var(--color-text)] truncate">{lead.address}</div>
                <div className="text-[11.5px] text-[color:var(--color-text-dim)] truncate">
                  {[lead.city, lead.seller_name].filter(Boolean).join(' · ') || 'No details'}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
