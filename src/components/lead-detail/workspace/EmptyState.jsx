// src/components/lead-detail/workspace/EmptyState.jsx
// Lead Workspace redesign, Final UX Polish, Section 10 — ONE consistent
// empty/readiness pattern used everywhere: TITLE, short explanation,
// what's missing (optional), one useful next action (optional, only real
// existing actions — never fabricated). No business logic, no data
// fetching — pure presentation, fed whatever the caller already computed.
export default function EmptyState({ title, explanation, missing, action }) {
  return (
    <div className="rounded-lg border border-dashed border-[color:var(--color-line)] px-4 py-3.5">
      <div className="text-[12.5px] font-bold text-[color:var(--color-text)]">{title}</div>
      {explanation && <div className="text-[12px] text-[color:var(--color-text-muted)] mt-0.5">{explanation}</div>}
      {missing?.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {missing.map((m) => (
            <li key={m.key || m.label} className="text-[11.5px] text-[color:var(--color-warn-text)]">
              <span className="font-semibold">{m.label}</span>{m.reason ? ` — ${m.reason}` : ''}
            </li>
          ))}
        </ul>
      )}
      {action && (
        <button type="button" onClick={action.onClick}
          className="mt-2.5 text-[11.5px] font-bold px-2.5 py-1.5 rounded-md text-white"
          style={{ background: 'var(--color-accent)' }}>
          {action.label}
        </button>
      )}
    </div>
  )
}
