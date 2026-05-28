import Card from '../ui/Card'
import { LEAD_STATUSES } from '../../lib/constants'

const TONE_BAR = {
  neutral: 'bg-[color:var(--color-text-dim)]',
  accent:  'bg-[color:var(--color-accent)]',
  warn:    'bg-[color:var(--color-warn)]',
  success: 'bg-[color:var(--color-success)]',
  danger:  'bg-[color:var(--color-danger)]',
}

export default function StatusBreakdown({ counts = {} }) {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
  return (
    <Card title="Pipeline by Status">
      {total === 0 ? (
        <div className="text-[13px] text-[color:var(--color-text-dim)] py-3 text-center">
          No leads yet.
        </div>
      ) : (
        <div className="space-y-1.5">
          {LEAD_STATUSES.map(s => {
            const count = counts[s.value] || 0
            const pct = total > 0 ? (count / total) * 100 : 0
            return (
              <div key={s.value} className="flex items-center gap-3 group">
                <div className="w-36 shrink-0 text-[12px] text-[color:var(--color-text-muted)]">
                  {s.label}
                </div>
                <div className="flex-1 h-1.5 bg-[color:var(--color-bg)] rounded overflow-hidden">
                  <div className={`h-full ${TONE_BAR[s.tone]} transition-all`} style={{ width: `${pct}%` }} />
                </div>
                <div className="w-8 text-right text-[12px] font-medium text-[color:var(--color-text)] tabular-nums">
                  {count}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
