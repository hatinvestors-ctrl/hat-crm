// src/components/lead-detail/workspace/LeadWorkspaceTabs.jsx
// Lead Workspace redesign, Phase 2, Sections 5/20 — accessible tab
// navigation. Pure presentation/routing between already-existing panes;
// no business logic. Uses standard ARIA tab semantics (role="tablist" /
// "tab" / arrow-key navigation) so this holds up for keyboard/screen-
// reader users, not just click.
import { useRef } from 'react'

export const WORKSPACE_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'deal',     label: 'Deal / Underwriting' },
  { key: 'acquisition', label: 'Acquisition' },
  { key: 'ai',       label: 'AI & Comps' },
  { key: 'activity', label: 'Activity' },
]

export default function LeadWorkspaceTabs({ active, onChange }) {
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
          className="shrink-0 text-[12.5px] font-semibold px-3 py-2 border-b-2 -mb-px transition-colors whitespace-nowrap"
          style={active === t.key
            ? { borderColor: 'var(--color-accent)', color: 'var(--color-accent-text)' }
            : { borderColor: 'transparent', color: 'var(--color-text-dim)' }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
