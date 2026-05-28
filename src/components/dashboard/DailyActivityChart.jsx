import Card from '../ui/Card'

// Simple CSS bar chart — no external lib. Shows two stacked metrics per day
// for the last N days: new leads (neutral) and offers sent to seller (accent).
export default function DailyActivityChart({ days = 30, newLeadsByDay = {}, offersByDay = {} }) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const labels = []
  const newCounts = []
  const offerCounts = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    labels.push(d)
    newCounts.push(newLeadsByDay[key] || 0)
    offerCounts.push(offersByDay[key] || 0)
  }
  const max = Math.max(1, ...newCounts, ...offerCounts)

  return (
    <Card title={`Daily activity — last ${days} days`}>
      <div className="flex items-center gap-3 text-[11px] text-[color:var(--color-text-muted)] mb-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-[color:var(--color-text-dim)]" /> New leads
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-[color:var(--color-accent)]" /> Offers → seller
        </span>
      </div>
      <div className="flex items-end gap-[3px] h-32">
        {labels.map((d, i) => {
          const nh = (newCounts[i] / max) * 100
          const oh = (offerCounts[i] / max) * 100
          const isSunday = d.getDay() === 0
          const label = `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${newCounts[i]} new, ${offerCounts[i]} sent`
          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-stretch gap-[2px] justify-end h-full group relative"
              title={label}
            >
              <div
                className="bg-[color:var(--color-accent)] rounded-sm min-h-[2px] transition-all"
                style={{ height: offerCounts[i] > 0 ? `${Math.max(2, oh)}%` : '0' }}
              />
              <div
                className="bg-[color:var(--color-text-dim)] rounded-sm min-h-[2px] transition-all opacity-60 group-hover:opacity-100"
                style={{ height: newCounts[i] > 0 ? `${Math.max(2, nh)}%` : '0' }}
              />
              {isSunday && (
                <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[9px] text-[color:var(--color-text-dim)] tabular-nums whitespace-nowrap">
                  {d.getDate()}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="mt-6 text-[11px] text-[color:var(--color-text-dim)] flex justify-between tabular-nums">
        <span>{labels[0]?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        <span>{labels[labels.length - 1]?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
      </div>
    </Card>
  )
}
