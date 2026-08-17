// src/components/lead-detail/workspace/TriageOverviewBanner.jsx
// Lead Workspace redesign, Phase 2.1, Section 5 — a freshly auto-imported
// TRIAGE lead should read as "intentionally incomplete, awaiting a
// decision," not as a broken/half-analyzed deal. Pure presentation of
// fields already on the lead row — no new data, no new logic.
import { formatCurrency as fc } from '../../../lib/calculations'

export default function TriageOverviewBanner({ lead }) {
  const hasAnalysis = !!lead.deal_analysis?.verdict
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-4 py-3">
        <div className="text-[13px] font-extrabold text-[color:var(--color-text)]">🤖 Auto-Imported Lead</div>
        <div className="text-[12px] text-[color:var(--color-text-muted)] mt-0.5">Needs review before entering the pipeline.</div>
      </div>

      <div className="rounded-lg border border-[color:var(--color-line)] px-4 py-3">
        <div className="text-[9px] uppercase tracking-widest font-bold text-[color:var(--color-text-dim)] mb-2">What We Know</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div>
            <div className="text-[8.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Asking Price</div>
            <div className="text-[13px] font-bold">{lead.asking_price != null ? fc(lead.asking_price) : 'Not available'}</div>
          </div>
          <div>
            <div className="text-[8.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Beds / Baths</div>
            <div className="text-[13px] font-bold">{lead.bedrooms ?? '—'} / {lead.bathrooms ?? '—'}</div>
          </div>
          <div>
            <div className="text-[8.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Sqft</div>
            <div className="text-[13px] font-bold">{lead.sqft ? Number(lead.sqft).toLocaleString() : 'Not available'}</div>
          </div>
          <div>
            <div className="text-[8.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Source</div>
            <div className="text-[13px] font-bold truncate">{lead.lead_source || 'Unknown'}</div>
          </div>
        </div>
      </div>

      {!hasAnalysis && (
        <div className="rounded-lg border border-dashed border-[color:var(--color-line)] px-4 py-3 text-[12px] text-[color:var(--color-text-dim)]">
          Deal analysis has not been run yet — accept the lead into the pipeline first, then run analysis from the Deal or AI &amp; Comps tab.
        </div>
      )}
    </div>
  )
}
