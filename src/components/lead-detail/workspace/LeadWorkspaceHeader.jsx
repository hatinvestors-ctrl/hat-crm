// src/components/lead-detail/workspace/LeadWorkspaceHeader.jsx
// HAT Premium Visual Pass, Part 6 — "Property Context, Not Decision
// Center." Opportunity/Confidence/Urgency/Preliminary/MAO all moved to
// DecisionHero.jsx (Overview's own dominant decision surface) — this
// sticky strip now answers ONE question, "what property am I looking
// at," across every tab. SAME ENGINE: reads lead fields + getMarketType()
// directly, no new calculation, nothing recomputed.
//
// Lead Essentials V1, Part 1 (visual QA fix pass) — HEADER CONSOLIDATION.
// This used to be two stacked bars (LeadDetailHeader above this one) —
// the lead's identity was split across them (address/badges here,
// Assigned/Updated/actions there), reading as duplicated real estate. All
// of LeadDetailHeader's content is now folded into this ONE sticky bar.
// No functionality removed — Assigned select, Hot toggle, Created/Updated,
// View Project, Zillow, More menu (Create Project/Mark Hot/Edit Lead) all
// still exist, just consolidated into a single identity block.
import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMarketType } from '../../../lib/sellerStrategy'
import { STATUS_MAP } from '../../../lib/constants'
import { formatDateTime } from '../../../lib/calculations'
import { buildZillowUrl } from '../../../lib/zillow'
import { safeUrl } from '../../../lib/urlSafety'
import { supabase } from '../../../lib/supabase'

export default function LeadWorkspaceHeader({
  lead, onLogOutcome, onOpenLiveCopilot,
  members, canEdit, canAssign, onEdit, onUpdated, onCreateProject, creatingProject, workspaceId,
}) {
  const navigate = useNavigate()
  const marketType = getMarketType(lead)
  const isOffMarket = marketType === 'OFF_MARKET'
  const cityLine = [lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ')
  const bedsBaths = (lead.bedrooms || lead.bathrooms) ? `${lead.bedrooms ?? '—'}/${lead.bathrooms ?? '—'}` : null
  const sqft = lead.sqft ? `${Number(lead.sqft).toLocaleString()} sqft` : null

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
    const { data } = await supabase.from('leads').update({ is_hot: !lead.is_hot }).eq('id', lead.id).select().single()
    if (data) onUpdated?.(data)
  }

  return (
    <div className="sticky top-0 z-30 -mx-6 px-6 py-2.5 border-b border-[color:var(--color-line)] bg-[color:var(--color-bg)]/95 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {lead.is_hot && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wider bg-[oklch(0.5_0.22_25)] text-white shrink-0" title="This is a hot lead">🔥 Hot</span>
            )}
            <span className="text-[16px] font-extrabold text-[color:var(--color-text)] truncate max-w-[320px]">{lead.address}</span>
            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0"
              style={{ background: isOffMarket ? 'rgba(217,119,6,0.15)' : 'var(--color-accent-soft)', color: isOffMarket ? 'rgb(180,95,6)' : 'var(--color-accent-text)' }}>
              {isOffMarket ? 'OFF-MARKET' : 'ON-MARKET'}
            </span>
            <span className="text-[9px] font-semibold uppercase tracking-wide text-[color:var(--color-text-dim)]">
              {STATUS_MAP?.[lead.status]?.label || lead.status?.replace(/_/g, ' ')}
            </span>
          </div>
          <div className="text-[11px] text-[color:var(--color-text-dim)] mt-0.5 flex items-center gap-x-3 flex-wrap">
            {[cityLine, bedsBaths, sqft].filter(Boolean).join(' · ') && <span>{[cityLine, bedsBaths, sqft].filter(Boolean).join(' · ')}</span>}
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
                  {members?.map(m => (
                    <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name || 'Member'}</option>
                  ))}
                </select>
              ) : (
                <span className="text-[color:var(--color-text-muted)]">{lead.visible_to_all ? '🌐 All Members' : assignee?.full_name || 'Unassigned'}</span>
              )}
            </span>
            <span>Updated · {formatDateTime(lead.updated_at)}</span>
          </div>
        </div>

        {/* Quick actions — everything LeadDetailHeader used to render on
            its own second row, consolidated here. No functionality removed. */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isOffMarket && (
            <button type="button" onClick={onOpenLiveCopilot}
              className="text-[11px] font-bold px-2.5 py-1.5 rounded-md text-white" style={{ background: 'var(--color-danger)' }}>
              🎙 Live Copilot
            </button>
          )}
          <button type="button" onClick={onLogOutcome}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]">
            Log Outcome
          </button>
          {canEdit && isProject && (
            <button onClick={() => navigate(`/w/${workspaceId}/projects/${lead.id}`)}
              className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)] hover:brightness-110 transition">
              View Project →
            </button>
          )}
          {zillowUrl && (
            <a href={zillowUrl} target="_blank" rel="noreferrer"
              className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent-text)] hover:border-[color:var(--color-accent)] transition"
              title="Open this property on Zillow">
              Zillow ↗
            </a>
          )}
          {canEdit && (
            <div className="relative" ref={moreRef}>
              <button onClick={() => setMoreOpen(o => !o)}
                className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] hover:bg-[color:var(--color-bg-elev)] transition">
                More ▾
              </button>
              {moreOpen && (
                <div className="absolute right-0 mt-1 w-48 rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] shadow-lg py-1 z-40">
                  {!isProject && (
                    <button onClick={() => { setMoreOpen(false); onCreateProject() }} disabled={creatingProject}
                      className="w-full text-left px-3 py-1.5 text-[12.5px] text-[color:var(--color-text)] hover:bg-[color:var(--color-bg-elev-2)] disabled:opacity-60">
                      {creatingProject ? 'Creating…' : '+ Create Project'}
                    </button>
                  )}
                  <button onClick={() => { setMoreOpen(false); toggleHot() }}
                    className="w-full text-left px-3 py-1.5 text-[12.5px] text-[color:var(--color-text)] hover:bg-[color:var(--color-bg-elev-2)]">
                    🔥 {lead.is_hot ? 'Unmark Hot' : 'Mark Hot'}
                  </button>
                  <button onClick={() => { setMoreOpen(false); onEdit() }}
                    className="w-full text-left px-3 py-1.5 text-[12.5px] text-[color:var(--color-text)] hover:bg-[color:var(--color-bg-elev-2)]">
                    Edit Lead
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
