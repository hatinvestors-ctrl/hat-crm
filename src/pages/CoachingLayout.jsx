// src/pages/CoachingLayout.jsx
// Capability #25.3 — the Coaching Center shell. One restrained branding
// moment (Part 22: "use HAT Investors / Acquisition Coaching Intelligence
// ONCE in the main shell/header") + Team | Agents | Calls sub-navigation.
// Everything data-related is fetched once here (useCoachingData) and
// forwarded to children via Outlet context — Team/Agents/AgentProfile/
// Calls never issue their own competing queries for the same rows.
import { NavLink, Outlet, useOutletContext } from 'react-router-dom'
import Topbar from '../components/Topbar'
import { useCoachingData } from '../hooks/useCoachingData'

const TABS = [
  { key: 'team', label: 'Team' },
  { key: 'agents', label: 'Agents' },
  { key: 'calls', label: 'Calls' },
]

export default function CoachingLayout() {
  const outer = useOutletContext()
  const coaching = useCoachingData(outer.workspaceId)

  return (
    <>
      <Topbar title="Coaching" breadcrumbs={[{ label: outer.workspace.name }, { label: 'Coaching' }]} />
      <div className="px-6 pt-5 w-full flex-1 flex flex-col min-h-0">
        <div className="mb-4">
          <div className="text-[9.5px] uppercase tracking-widest text-[color:var(--color-accent-text)] font-bold">HAT Investors</div>
          <h1 className="text-[20px] font-bold text-[color:var(--color-text)]">Acquisition Coaching Intelligence</h1>
        </div>

        <div className="flex gap-1 border-b border-[color:var(--color-line)] mb-5">
          {TABS.map(t => (
            <NavLink
              key={t.key}
              to={t.key}
              className={({ isActive }) => `text-[12.5px] font-semibold px-3 py-2 border-b-2 -mb-px transition-colors ${isActive ? 'border-[color:var(--color-accent)] text-[color:var(--color-accent-text)]' : 'border-transparent text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)]'}`}
            >
              {t.label}
            </NavLink>
          ))}
        </div>

        {coaching.error && (
          <div className="rounded-lg border border-[color:var(--color-danger)] bg-[color:var(--color-danger-soft)] px-4 py-2.5 text-[12px] text-[color:var(--color-danger-text)] mb-4">
            Couldn't load coaching data. {coaching.error}
          </div>
        )}

        <div className="flex-1 min-h-0 pb-8">
          <Outlet context={{ ...outer, coaching }} />
        </div>
      </div>
    </>
  )
}
