import { useEffect, useState } from 'react'
import { NavLink, useParams, useMatch, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Badge from './ui/Badge'
import { categorizeLeads } from '../lib/staleness'
import QuickAnalysisModal from './QuickAnalysisModal'
import { applyLeadVisibility } from '../lib/leadVisibility'

const Icon = ({ d, size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
)

const ICONS = {
  dashboard: <Icon d={<><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></>} />,
  today:     <Icon d={<><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>} />,
  inbox:     <Icon d={<><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>} />,
  leads:     <Icon d={<><path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V9.5z" /></>} />,
  import:    <Icon d={<><path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" /></>} />,
  settings:  <Icon d={<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>} />,
  logout:    <Icon d={<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></>} />,
  chevron:   <Icon d={<><path d="M6 9l6 6 6-6" /></>} />,
  building:  <Icon d={<><path d="M3 21h18M6 21V7l6-4 6 4v14M10 9h4M10 13h4M10 17h4" /></>} />,
  tasks:     <Icon d={<><rect x="3" y="4" width="6" height="16" rx="1" /><rect x="11" y="4" width="6" height="10" rx="1" /><rect x="19" y="4" width="2" height="7" rx="1" /></>} />,
  agents: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  projects: <Icon d={<><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>} />,
}

const navItemClasses = ({ isActive }) =>
  `group flex items-center gap-2 px-2 h-7 rounded-md text-[13px] transition-colors ${
    isActive
      ? 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text)] font-medium'
      : 'text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-elev)] hover:text-[color:var(--color-text)]'
  }`

export default function Sidebar({ workspace, userRole, userId, profile, onSignOut }) {
  const { workspaceId } = useParams()
  const base = `/w/${workspaceId}`
  const leadMatch = useMatch('/w/:workspaceId/leads/:leadId')
  const currentLeadId = leadMatch?.params?.leadId || null
  const [recentLeads, setRecentLeads] = useState([])
  const [quickAnalysisOpen, setQuickAnalysisOpen] = useState(false)
  const [quickAnalysisPrefill, setQuickAnalysisPrefill] = useState(null)
  const [needsActionCount, setNeedsActionCount] = useState(0)
  const [hotCount, setHotCount] = useState(0)
  const [triageCount, setTriageCount] = useState(0)
  const [myOpenTaskCount, setMyOpenTaskCount] = useState(0)

  useEffect(() => {
    if (!workspaceId) return
    let cancel = false
    let leadsQ = supabase
      .from('leads')
      .select('id, address, status, follow_up_date, contract_signed_date, created_at, updated_at, is_hot')
      .eq('workspace_id', workspaceId)
      .not('status', 'in', '("sold","dead_lead","rejected_not_accepted","not_in_buy_box","sequence_completed")')
      .order('updated_at', { ascending: false })
    leadsQ = applyLeadVisibility(leadsQ, userId, userRole)
    leadsQ.then(({ data }) => {
        if (cancel) return
        const rows = data || []
        setRecentLeads(rows.slice(0, 8))
        setHotCount(rows.filter(r => r.is_hot).length)
        setTriageCount(rows.filter(r => r.status === 'triage').length)
        const { totalCount } = categorizeLeads(rows, workspace?.settings)
        setNeedsActionCount(totalCount)
      })
    return () => { cancel = true }
  }, [workspaceId, workspace?.settings])

  useEffect(() => {
    if (!workspaceId || !profile?.id) return
    let cancel = false
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('assignee_id', profile.id)
      .neq('status', 'done')
      .then(({ count }) => {
        if (!cancel) setMyOpenTaskCount(count || 0)
      })
    return () => { cancel = true }
  }, [workspaceId, profile?.id])

  return (
    <>
    <aside className="w-60 shrink-0 bg-[color:var(--color-bg-sidebar)] border-r border-[color:var(--color-line)] flex flex-col h-screen sticky top-0">
      {/* Brand + workspace switcher */}
      <div className="px-3 py-3 border-b border-[color:var(--color-line)]">
        <Link to="/" className="flex items-center gap-2 px-2 h-7 rounded-md hover:bg-[color:var(--color-bg-elev)] transition-colors">
          <div className="w-5 h-5 rounded-sm bg-[color:var(--color-accent)] text-white flex items-center justify-center text-[11px] font-bold tracking-tight">H</div>
          <span className="text-[13px] font-semibold text-[color:var(--color-text)]">HatInvestors CRM</span>
        </Link>
        <Link to="/" className="mt-1.5 flex items-center justify-between gap-2 px-2 h-7 rounded-md text-[12.5px] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-elev)] hover:text-[color:var(--color-text)] transition-colors">
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <span className="w-4 h-4 rounded bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] flex items-center justify-center text-[9px] font-semibold text-[color:var(--color-text-muted)] shrink-0">
              {(workspace?.name || 'W').charAt(0).toUpperCase()}
            </span>
            <span className="truncate">{workspace?.name || 'Workspace'}</span>
          </span>
          <span className="text-[color:var(--color-text-dim)] shrink-0">{ICONS.chevron}</span>
        </Link>
      </div>

      {/* Main nav */}
      <nav className="px-2 py-2 space-y-0.5">
        <NavLink to={base} end className={navItemClasses}>
          <span className="text-[color:var(--color-text-dim)]">{ICONS.dashboard}</span>
          Dashboard
        </NavLink>
        <NavLink to={`${base}/today`} className={navItemClasses}>
          <span className="text-[color:var(--color-text-dim)]">{ICONS.today}</span>
          <span className="flex-1">Today</span>
          {needsActionCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold bg-[color:var(--color-warn)] text-white tabular-nums">
              {needsActionCount}
            </span>
          )}
        </NavLink>
        <NavLink to={`${base}/inbox`} className={navItemClasses}>
          <span className="text-[color:var(--color-text-dim)]">{ICONS.inbox}</span>
          <span className="flex-1">Inbox</span>
          {triageCount > 0 && (
            <span
              title={`${triageCount} auto-import${triageCount === 1 ? '' : 's'} awaiting triage`}
              className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold bg-[oklch(0.55_0.18_75)] text-white tabular-nums"
            >
              {triageCount}
            </span>
          )}
        </NavLink>
        <NavLink to={`${base}/leads`} className={navItemClasses} end>
          <span className="text-[color:var(--color-text-dim)]">{ICONS.leads}</span>
          <span className="flex-1">Leads</span>
          <div className="flex items-center gap-1">
            {triageCount > 0 && (
              <span
                title={`${triageCount} auto-lead${triageCount === 1 ? '' : 's'} awaiting triage`}
                className="inline-flex items-center gap-0.5 px-1 h-[18px] rounded-full text-[10px] font-semibold bg-[oklch(0.55_0.18_75)] text-white tabular-nums"
              >
                🤖{triageCount}
              </span>
            )}
            {hotCount > 0 && (
              <span
                title={`${hotCount} hot lead${hotCount === 1 ? '' : 's'}`}
                className="inline-flex items-center gap-0.5 px-1 h-[18px] rounded-full text-[10px] font-semibold bg-[oklch(0.55_0.22_25)] text-white tabular-nums"
              >
                🔥{hotCount}
              </span>
            )}
          </div>
        </NavLink>
        <NavLink to={`${base}/agents`} className={navItemClasses}>
          <span className="text-[color:var(--color-text-dim)]">{ICONS.agents}</span>
          <span className="flex-1">Agents</span>
        </NavLink>
        {userRole === 'admin' && (
          <NavLink to={`${base}/projects`} className={navItemClasses}>
            <span className="text-[color:var(--color-text-dim)]">{ICONS.projects}</span>
            <span className="flex-1">Projects</span>
          </NavLink>
        )}
        {userRole !== 'readonly' && (
          <NavLink to={`${base}/tasks`} className={navItemClasses}>
            <span className="text-[color:var(--color-text-dim)]">{ICONS.tasks}</span>
            <span className="flex-1">Tasks</span>
            {myOpenTaskCount > 0 && (
              <span
                title={`${myOpenTaskCount} open task${myOpenTaskCount === 1 ? '' : 's'} assigned to you`}
                className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold bg-[color:var(--color-accent)] text-white tabular-nums"
              >
                {myOpenTaskCount}
              </span>
            )}
          </NavLink>
        )}
        {userRole === 'admin' && (
          <NavLink to={`${base}/import`} className={navItemClasses}>
            <span className="text-[color:var(--color-text-dim)]">{ICONS.import}</span>
            Import
          </NavLink>
        )}
        {userRole === 'admin' && (
          <NavLink to={`${base}/settings`} className={navItemClasses}>
            <span className="text-[color:var(--color-text-dim)]">{ICONS.settings}</span>
            Settings
          </NavLink>
        )}
      </nav>

      {/* Quick Analysis button */}
      {userRole !== 'readonly' && (
        <div className="px-2 pb-1">
          <button
            onClick={async () => {
              if (currentLeadId) {
                const { data } = await supabase.from('leads')
                  .select('address, city, state, arv, asking_price, offer_price, renovation_cost')
                  .eq('id', currentLeadId).single()
                if (data) {
                  setQuickAnalysisPrefill({
                    address: [data.address, data.city, data.state].filter(Boolean).join(', '),
                    arv: data.arv || '',
                    purchase_price: data.asking_price || data.offer_price || '',
                    renovation_cost: data.renovation_cost || '',
                  })
                }
              } else {
                setQuickAnalysisPrefill(null)
              }
              setQuickAnalysisOpen(true)
            }}
            className="w-full flex items-center gap-2 px-2 h-7 rounded-md text-[13px] font-medium text-[color:var(--color-accent-text)] bg-[color:var(--color-accent-soft)] hover:opacity-90 transition-opacity"
          >
            <span>⚡</span>
            Quick Analysis
          </button>
        </div>
      )}

      {/* Active pipeline (like GitHub "Top repositories") */}
      <div className="px-2 py-2 mt-1 flex-1 min-h-0 overflow-y-auto">
        <div className="flex items-center justify-between px-2 mb-1">
          <h3 className="text-[10.5px] font-semibold uppercase tracking-wider text-[color:var(--color-text-dim)]">
            Active Pipeline
          </h3>
          {recentLeads.length > 0 && (
            <span className="text-[10px] text-[color:var(--color-text-dim)] tabular-nums">{recentLeads.length}</span>
          )}
        </div>
        {recentLeads.length === 0 ? (
          <p className="px-2 py-1.5 text-[11.5px] text-[color:var(--color-text-dim)] leading-snug">
            Active leads will appear here.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {recentLeads.map(l => (
              <li key={l.id}>
                <NavLink
                  to={`${base}/leads/${l.id}`}
                  className={({ isActive }) =>
                    `flex items-center gap-1.5 px-2 h-6 rounded text-[12px] transition-colors ${
                      isActive
                        ? 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text)]'
                        : 'text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-elev)] hover:text-[color:var(--color-text)]'
                    }`
                  }
                >
                  <span className="text-[color:var(--color-text-dim)]">{ICONS.building}</span>
                  <span className="truncate flex-1">{l.address}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* User footer */}
      <div className="border-t border-[color:var(--color-line)] px-2 py-2">
        <div className="group flex items-center gap-2 px-2 h-9 rounded-md hover:bg-[color:var(--color-bg-elev)] transition-colors">
          <div className="w-6 h-6 rounded-full bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)] flex items-center justify-center text-[11px] font-semibold shrink-0">
            {(profile?.full_name || 'U').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-medium text-[color:var(--color-text)] truncate leading-tight">
              {profile?.full_name || 'User'}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-[color:var(--color-text-dim)] leading-tight">
              {userRole}
            </div>
          </div>
          <button
            onClick={onSignOut}
            title="Sign out"
            className="text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] w-6 h-6 rounded inline-flex items-center justify-center hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
          >
            {ICONS.logout}
          </button>
        </div>
      </div>
    </aside>

    <QuickAnalysisModal open={quickAnalysisOpen} onClose={() => { setQuickAnalysisOpen(false); setQuickAnalysisPrefill(null) }} prefill={quickAnalysisPrefill} />
    </>
  )
}
