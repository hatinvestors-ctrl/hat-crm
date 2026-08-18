// src/components/lead-detail/workspace/CalculationDetails.jsx
// Phase 2 — Financial Transparency (Parts 4-12). A small, reusable
// expandable "View Calculation" disclosure. Renders a list of already-
// computed line items — it never calculates anything itself (Part 12,
// single source of truth: every number passed in comes straight from
// computeFlipResult/computeBrrrrResult's canonical `.breakdown` object).
import { useState } from 'react'
import { formatCurrency as fc } from '../../../lib/calculations'

// rows: [{ label, value, indent, bold, separator, tone, note }]
// tone: 'success' | 'danger' | undefined
export function CalculationRows({ rows }) {
  return (
    <div className="space-y-0.5">
      {rows.map((r, i) => r.separator ? (
        <div key={i} className="border-t border-[color:var(--color-line)] my-1.5" />
      ) : (
        <div key={i} className={`flex items-center justify-between gap-3 text-[11.5px] ${r.indent ? 'pl-3' : ''}`}>
          <span className={r.bold ? 'font-bold text-[color:var(--color-text)]' : 'text-[color:var(--color-text-muted)]'}>{r.label}</span>
          <span
            className={`tabular-nums font-semibold ${r.bold ? 'text-[13px]' : ''}`}
            style={{ color: r.tone === 'success' ? 'var(--color-success-text)' : r.tone === 'danger' ? 'var(--color-danger-text)' : 'var(--color-text)' }}
          >
            {r.value}
          </span>
        </div>
      ))}
    </div>
  )
}

// A labeled metric with an inline "View Calculation" disclosure —
// collapsed by default so the primary view stays scannable (Part 4:
// "do not clutter the main analysis").
export default function CalculationDetails({ label, headline, tone, definition, rows, assumptionNote }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1">
        <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{label}</div>
        {definition && (
          <span title={definition} className="text-[9px] text-[color:var(--color-text-dim)] cursor-help">ⓘ</span>
        )}
      </div>
      <div className="text-[19px] font-extrabold tabular-nums truncate" style={tone ? { color: tone } : undefined}>{headline}</div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-[10px] font-semibold underline text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text-muted)] mt-0.5"
      >
        {open ? 'Hide calculation' : 'View calculation'}
      </button>
      {open && (
        <div className="mt-2 p-2.5 rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]">
          <CalculationRows rows={rows} />
          {assumptionNote && (
            <div className="mt-2 pt-2 border-t border-[color:var(--color-line)] text-[10px] text-[color:var(--color-text-dim)] leading-snug">{assumptionNote}</div>
          )}
        </div>
      )}
    </div>
  )
}
