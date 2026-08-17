import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
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
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef(null)

  useEffect(() => {
    if (!moreOpen) return
    const onClick = (e) => { if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [moreOpen])

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

  // Final UX Polish, Section 2 — was 4 equally-weighted buttons (Create
  // Project / Mark Hot / Zillow / Edit) competing for attention alongside
  // the workspace header's own quick actions. "View Project" is the one
  // genuinely high-value, contextual action here (only shown once a lead
  // IS a project) and stays visible; everything else — including "Create
  // Project" before that point — moves into one "More" menu. Property
  // identity (address/city/zip) lives ONLY in LeadWorkspaceHeader above
  // this bar (Phase 2.1) — this row keeps just assignment/timestamps + actions.
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
        {canEdit && isProject && (
          <button
            onClick={() => navigate(`/w/${workspaceId}/projects/${lead.id}`)}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-[12.5px] font-medium rounded-md bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)] hover:brightness-110 transition"
          >
            View Project →
          </button>
        )}

        {canEdit && (
          <div className="relative" ref={moreRef}>
            <button
              onClick={() => setMoreOpen(o => !o)}
              className="inline-flex items-center gap-1 h-8 px-3 text-[12.5px] font-medium rounded-md border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] hover:bg-[color:var(--color-bg-elev)] transition"
            >
              More ▾
            </button>
            {moreOpen && (
              <div className="absolute right-0 mt-1 w-48 rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] shadow-lg py-1 z-40">
                {!isProject && (
                  <button
                    onClick={() => { setMoreOpen(false); onCreateProject() }}
                    disabled={creatingProject}
                    className="w-full text-left px-3 py-1.5 text-[12.5px] text-[color:var(--color-text)] hover:bg-[color:var(--color-bg-elev-2)] disabled:opacity-60"
                  >
                    {creatingProject ? 'Creating…' : '+ Create Project'}
                  </button>
                )}
                <button
                  onClick={() => { setMoreOpen(false); toggleHot() }}
                  className="w-full text-left px-3 py-1.5 text-[12.5px] text-[color:var(--color-text)] hover:bg-[color:var(--color-bg-elev-2)]"
                >
                  🔥 {lead.is_hot ? 'Unmark Hot' : 'Mark Hot'}
                </button>
                {zillowUrl && (
                  <a
                    href={zillowUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setMoreOpen(false)}
                    className="block px-3 py-1.5 text-[12.5px] text-[color:var(--color-text)] hover:bg-[color:var(--color-bg-elev-2)]"
                  >
                    Zillow ↗
                  </a>
                )}
                <button
                  onClick={() => { setMoreOpen(false); onEdit() }}
                  className="w-full text-left px-3 py-1.5 text-[12.5px] text-[color:var(--color-text)] hover:bg-[color:var(--color-bg-elev-2)]"
                >
                  Edit Lead
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
