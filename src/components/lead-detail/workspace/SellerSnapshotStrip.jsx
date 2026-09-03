// src/components/lead-detail/workspace/SellerSnapshotStrip.jsx
// Lead Workspace redesign, Phase 2, Section 6 — compact off-market
// orientation for the Overview tab. Mission is explicit: do NOT duplicate
// the full Off-Market Seller Strategy card here — this reads the SAME
// deterministic getSellerSnapshot() (src/lib/sellerStrategy.js, no LLM)
// already built for exactly this and shows only the four key dimensions
// plus a link to the full workspace in the Acquisition tab.
import { getSellerSnapshot } from '../../../lib/sellerStrategy'

export default function SellerSnapshotStrip({ lead, onOpenFull }) {
  const s = getSellerSnapshot(lead)
  const rows = [
    ['Motivation', s.motivation],
    ['Timeline', s.timeline],
    ['Price', s.priceDisplay],
    ['Decision Maker', s.decisionMaker],
  ]
  const unknownCount = rows.filter(([, v]) => v === 'UNKNOWN').length
  // UX V2.5, Part 9 — when EVERY seller fact is unknown, a 4-tile grid of
  // "UNKNOWN" text was itself the visual noise the mission is asking to
  // remove: four equally-loud negatives with nothing to scan. Same
  // underlying facts (still all "UNKNOWN" from the same getSellerSnapshot
  // read), just collapsed to one action-oriented line instead of a grid.
  // Any real known fact still gets the full tile grid, unchanged.
  const allUnknown = unknownCount === rows.length

  return (
    <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-3.5 py-2.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9.5px] uppercase tracking-widest font-bold text-[color:var(--color-text-dim)]">Seller Snapshot</span>
        <button type="button" onClick={onOpenFull} className="text-[10.5px] font-semibold underline text-[color:var(--color-accent-text)]">
          Full Seller Strategy →
        </button>
      </div>
      {allUnknown ? (
        <div className="text-[11.5px] text-[color:var(--color-warn-text)]">
          4 key seller facts still unknown (motivation, timeline, price, decision maker).
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {rows.map(([label, value]) => (
              <div key={label}>
                <div className="text-[8.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{label}</div>
                <div className={`text-[12px] font-semibold ${value === 'UNKNOWN' ? 'text-[color:var(--color-warn-text)]' : 'text-[color:var(--color-text)]'}`}>{value}</div>
              </div>
            ))}
          </div>
          {s.mainPain && (
            <div className="text-[10.5px] text-[color:var(--color-text-muted)] mt-2">
              <span className="font-semibold text-[color:var(--color-text)]">Main pain: </span>
              {s.mainPain.label || s.mainPain}
            </div>
          )}
          {unknownCount > 0 && (
            <div className="text-[10px] text-[color:var(--color-warn-text)] mt-1.5">⚠ {unknownCount} of 4 key seller facts still unknown</div>
          )}
        </>
      )}
    </div>
  )
}
