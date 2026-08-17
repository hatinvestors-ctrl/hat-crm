import { useNavigate } from 'react-router-dom'
import Button from '../ui/Button'
import { formatDateTime } from '../../lib/calculations'
import { buildZillowUrl } from '../../lib/zillow'
import { safeUrl } from '../../lib/urlSafety'
import { supabase } from '../../lib/supabase'

export default function LeadDetailHeader({ lead, members, canEdit, canAssign, onEdit, onUpdated, onCreateProject, creatingProject, workspaceId }) {
  const navigate = useNavigate()
  const isProject = ['working_project', 'sold', 'flip_sold'].includes(lead.status)
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

  // Phase 2.1 — property identity (address/city/state/zip) used to render
  // here AND again in LeadWorkspaceHeader immediately below it (human
  // review flagged this as the redesign's most visible "layered on top of
  // the old page" tell). LeadWorkspaceHeader is now the ONE place identity
  // lives; this bar keeps only what it uniquely owns — hot toggle,
  // assignment, timestamps, Zillow, Edit/Create Project — as a slim
  // secondary meta row directly under it.
  return (
    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2 pb-2.5 border-b border-[color:var(--color-line)]">
      <div className="min-w-0 flex items-center gap-3 flex-wrap">
        {lead.is_hot && (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider bg-[oklch(0.5_0.22_25)] text-white shadow-[0_0_12px_oklch(0.65_0.22_25/0.5)]"
            title="This is a hot lead"
          >
            🔥 Hot
          </span>
        )}
        <div className="text-[11px] text-[color:var(--color-text-dim)] flex gap-3 flex-wrap">
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

      <div className="flex items-center gap-2 shrink-0">
        {canEdit && (
          isProject ? (
            <button
              onClick={() => navigate(`/w/${workspaceId}/projects/${lead.id}`)}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-[12.5px] font-medium rounded-md bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)] hover:brightness-110 transition"
            >
              View Project →
            </button>
          ) : (
            <button
              onClick={onCreateProject}
              disabled={creatingProject}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-[12.5px] font-medium rounded-md bg-[color:var(--color-accent)] text-white hover:brightness-110 transition disabled:opacity-60"
            >
              {creatingProject ? 'Creating…' : '+ Create Project'}
            </button>
          )
        )}
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
            className="inline-flex items-center gap-1.5 h-8 px-3 text-[12.5px] font-medium rounded-md bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent-text)] hover:border-[color:var(--color-accent)] transition"
            title="Open this property on Zillow"
          >
            Zillow ↗
          </a>
        )}
        {canEdit && <Button variant="secondary" size="sm" onClick={onEdit}>Edit lead</Button>}
      </div>
    </div>
  )
}
