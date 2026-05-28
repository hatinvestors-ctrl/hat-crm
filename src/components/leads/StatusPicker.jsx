import { STATUS_CATEGORIES, STATUS_MAP } from '../../lib/constants'

const TONE_ACTIVE = {
  neutral: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text)] ring-[color:var(--color-text-dim)]',
  accent:  'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)] ring-[color:var(--color-accent)]',
  warn:    'bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)] ring-[color:var(--color-warn)]',
  success: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)] ring-[color:var(--color-success)]',
  danger:  'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] ring-[color:var(--color-danger)]',
}

const TONE_DOT = {
  neutral: 'bg-[color:var(--color-text-dim)]',
  accent:  'bg-[color:var(--color-accent)]',
  warn:    'bg-[color:var(--color-warn)]',
  success: 'bg-[color:var(--color-success)]',
  danger:  'bg-[color:var(--color-danger)]',
}

export default function StatusPicker({ value, onChange, label = 'Status', compact = false }) {
  return (
    <div>
      {label && (
        <div className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--color-text-muted)] mb-2">
          {label}
        </div>
      )}

      <div className={`space-y-${compact ? '2' : '3'}`}>
        {STATUS_CATEGORIES.map(cat => (
          <div key={cat.name}>
            <div className="text-[10px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)] mb-1.5">
              {cat.name}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cat.statuses.map(s => {
                const active = value === s.value
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => onChange(s.value)}
                    className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[12px] font-medium transition-all ${
                      active
                        ? `${TONE_ACTIVE[s.tone]} ring-1`
                        : 'bg-[color:var(--color-bg-elev)] hover:bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] border border-[color:var(--color-line)]'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${active ? TONE_DOT[s.tone] : 'bg-[color:var(--color-text-faint)]'}`} />
                    {s.label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
