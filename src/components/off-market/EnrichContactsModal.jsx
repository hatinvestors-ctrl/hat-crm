// src/components/off-market/EnrichContactsModal.jsx
// Capability — Off-Market Contact Enrichment V1, Section 5. ONE shared
// paid-credit confirmation modal used by both the batch (Off-Market Leads
// tab) and single-lead (Lead Workspace) entry points, so there is exactly
// one confirmation experience, not two competing ones. Never invents a
// dollar estimate — BatchData exposes no reliable balance/cost figure
// (confirmed in this capability's audit), so this uses the honest wording
// the mission specifies instead.
export default function EnrichContactsModal({ count, onCancel, onConfirm, running }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={running ? undefined : onCancel}>
      <div className="w-full max-w-sm rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg)] p-4" onClick={e => e.stopPropagation()}>
        <div className="text-[13px] font-bold mb-1">Contact Enrichment</div>
        <div className="text-[12px] text-[color:var(--color-text-muted)] mb-3">{count} lead{count === 1 ? '' : 's'} selected</div>
        <div className="text-[12px] mb-1">We'll search for:</div>
        <ul className="text-[12px] text-[color:var(--color-text-muted)] mb-3 space-y-0.5">
          <li>• Owner phone numbers</li>
          <li>• Owner email addresses</li>
        </ul>
        <div className="text-[11px] text-[color:var(--color-text-dim)] mb-1">Provider: <span className="font-semibold text-[color:var(--color-text)]">BatchData</span></div>
        <div className="rounded bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)] text-[11.5px] px-2.5 py-2 mb-3">
          This may use paid BatchData credits.
        </div>
        <div className="flex gap-2">
          <button onClick={onConfirm} disabled={running}
            className="flex-1 px-3 py-2 rounded-lg bg-[color:var(--color-accent)] text-white font-bold text-[12.5px] hover:opacity-90 disabled:opacity-50">
            {running ? 'Running…' : 'Run Enrichment'}
          </button>
          <button onClick={onCancel} disabled={running}
            className="px-3 py-2 rounded-lg border border-[color:var(--color-line)] text-[12px] font-semibold text-[color:var(--color-text-muted)] disabled:opacity-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
