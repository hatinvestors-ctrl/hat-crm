// src/components/lead-detail/workspace/LeadWorkspaceTabs.jsx
// Lead Workspace redesign, Phase 2, Sections 5/20 — accessible tab
// navigation. Pure presentation/routing between already-existing panes;
// no business logic. Uses standard ARIA tab semantics (role="tablist" /
// "tab" / arrow-key navigation) so this holds up for keyboard/screen-
// reader users, not just click.
import { useRef } from 'react'

export const WORKSPACE_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'deal',     label: 'Deal' },
  { key: 'acquisition', label: 'Acquisition' },
  { key: 'ai',       label: 'AI & Comps' },
  { key: 'activity', label: 'Activity' },
]

// Final UX Polish, Section 3 — `readiness` is an optional { [tabKey]:
// string } map of subtle subtitles derived from data already on the lead
// (e.g. "Needs ARV", "No Agent", "Not Run", a count). Purely presentational
// — no readiness value is computed here, only rendered.
export default function LeadWorkspaceTabs({ active, onChange, readiness = {} }) {
  const btnRefs = useRef([])

  function onKeyDown(e, idx) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = e.key === 'ArrowRight' ? (idx + 1) % WORKSPACE_TABS.length : (idx - 1 + WORKSPACE_TABS.length) % WORKSPACE_TABS.length
    onChange(WORKSPACE_TABS[next].key)
    btnRefs.current[next]?.focus()
  }

  return (
    <div role="tablist" aria-label="Lead Workspace sections"
      className="flex gap-1 overflow-x-auto -mx-1 px-1 border-b border-[color:var(--color-line)] mb-4">
      {WORKSPACE_TABS.map((t, idx) => (
        <button
          key={t.key}
          ref={(el) => { btnRefs.current[idx] = el }}
          role="tab"
          id={`workspace-tab-${t.key}`}
          aria-selected={active === t.key}
          aria-controls={`workspace-panel-${t.key}`}
          tabIndex={active === t.key ? 0 : -1}
          onKeyDown={(e) => onKeyDown(e, idx)}
          onClick={() => onChange(t.key)}
          className="shrink-0 text-[12.5px] font-semibold px-3 py-2 border-b-2 -mb-px transition-colors whitespace-nowrap flex items-center gap-1.5"
          style={active === t.key
            ? { borderColor: 'var(--color-accent)', color: 'var(--color-accent-text)' }
            : { borderColor: 'transparent', color: 'var(--color-text-dim)' }}
        >
          {t.label}
          {readiness[t.key] && (
            <span className="text-[9.5px] font-normal normal-case opacity-60">· {readiness[t.key]}</span>
          )}
        </button>
      ))}
    </div>
  )
}
