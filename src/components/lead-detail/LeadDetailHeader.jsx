import Button from '../ui/Button'
import { formatDateTime } from '../../lib/calculations'
import { buildZillowUrl } from '../../lib/zillow'
import { safeUrl } from '../../lib/urlSafety'
import { supabase } from '../../lib/supabase'

export default function LeadDetailHeader({ lead, members, canEdit, canAssign, onEdit, onUpdated }) {
  const userLookup = Object.fromEntries((members || []).map(m => [m.user_id, m.profiles]))
  const assignee = userLookup[lead.assigned_to]
  const zillowUrl = safeUrl(lead.zillow_url) || buildZillowUrl(lead)

  const handleAssigneeChange = async (e) => {
    const val = e.target.value
    const patch = val === '__all__'
      ? { visible_to_all: true, assigned_to: null }
      : { visible_to_all: false, assigned_to: val || null }
    const { data } = await supabase.from('leads').update(patch).eq('id', lead.id).select().single()
    if (data) onUpdated?.(data)
  }

  const assigneeValue = lead.visible_to_all ? '__all__' : (lead.assigned_to || '')

  const toggleHot = async () => {
    if (!canEdit) return
    const next = !lead.is_hot
    const { data } = await supabase.from('leads').update({ is_hot: next }).eq('id', lead.id).select().single()
    if (data) onUpdated?.(data)
  }

  return (
    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3 pb-4 border-b border-[color:var(--color-line)]">
      <div className="min-w-0 flex items-start gap-3">
        {/* HOT indicator dot — visible to readonly too */}
        {lead.is_hot && (
          <span
            className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-[oklch(0.5_0.22_25)] text-white shadow-[0_0_16px_oklch(0.65_0.22_25/0.6)]"
            title="This is a hot lead"
          >
            🔥 Hot
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold text-[color:var(--color-text)] tracking-tight">
            {lead.address}
          </h1>
          <div className="text-[12.5px] text-[color:var(--color-text-muted)] mt-0.5">
            {[lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ')}
          </div>
          <div className="text-[11px] text-[color:var(--color-text-dim)] mt-2 flex gap-3 flex-wrap">
            <span className="flex items-center gap-1">
              Assigned ·
              {canAssign ? (
                <select
                  value={assigneeValue}
                  onChange={handleAssigneeChange}
                  className="bg-transparent border-none text-[color:var(--color-text-muted)] text-[11px] cursor-pointer focus:outline-none hover:text-[color:var(--color-text)] -ml-0.5"
                >
                  <option value="">Unassigned</option>
                  <option value="__all__">🌐 All Members</option>
                  {members.map(m => (
                    <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name || 'Member'}</option>
                  ))}
                </select>
              ) : (
                <span className="text-[color:var(--color-text-muted)]">
                  {lead.visible_to_all ? '🌐 All Members' : assignee?.full_name || 'Unassigned'}
                </span>
              )}
            </span>
            <span>Created · {formatDateTime(lead.created_at)}</span>
            <span>Updated · {formatDateTime(lead.updated_at)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {canEdit && (
          <button
            onClick={toggleHot}
            title={lead.is_hot ? 'Click to unmark as hot' : 'Mark as hot lead'}
            className={`inline-flex items-center gap-1.5 h-8 px-3 text-[12.5px] font-semibold rounded-md transition-all ${
              lead.is_hot
                ? 'bg-[oklch(0.5_0.22_25)] text-white hover:brightness-110 shadow-[0_0_12px_oklch(0.65_0.22_25/0.5)]'
                : 'bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-danger-soft)] hover:text-[color:var(--color-danger-text)] hover:border-[color:var(--color-danger)]'
            }`}
          >
            🔥 {lead.is_hot ? 'HOT' : 'Mark Hot'}
          </button>
        )}
        {zillowUrl && (
          <a
            href={zillowUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 h-8 px-3 text-[12.5px] font-medium rounded-md bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)] hover:brightness-110 transition"
            title="Open this property on Zillow"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            Zillow
          </a>
        )}
        {canEdit && <Button variant="secondary" size="sm" onClick={onEdit}>Edit lead</Button>}
      </div>
    </div>
  )
}
