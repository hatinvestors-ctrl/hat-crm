/* Inline stat — small, monospace number, no decorative icon box.
   Replaces the old hero-metric card. */
export default function StatsCard({ label, value, hint, accent }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[10.5px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">
        {label}
      </div>
      <div className={`text-[20px] font-semibold tabular-nums leading-tight ${accent ? 'text-[color:var(--color-accent-text)]' : 'text-[color:var(--color-text)]'}`}>
        {value}
      </div>
      {hint && <div className="text-[11px] text-[color:var(--color-text-dim)]">{hint}</div>}
    </div>
  )
}
