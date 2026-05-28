export const TIME_RANGES = [
  { value: '1d',  label: 'Today',     days: 1   },
  { value: '7d',  label: '7 days',    days: 7   },
  { value: '30d', label: '30 days',   days: 30  },
  { value: '90d', label: '90 days',   days: 90  },
  { value: 'ytd', label: 'Year',      days: 365 },
  { value: 'all', label: 'All time',  days: null },
]

export function rangeStart(value) {
  const r = TIME_RANGES.find(x => x.value === value) || TIME_RANGES[1]
  if (r.days === null) return new Date(0)
  const d = new Date()
  if (r.value === '1d') { d.setHours(0,0,0,0) }
  else if (r.value === 'ytd') { d.setMonth(0,1); d.setHours(0,0,0,0) }
  else { d.setDate(d.getDate() - r.days); d.setHours(0,0,0,0) }
  return d
}

export default function TimeRangePicker({ value, onChange }) {
  return (
    <div className="inline-flex rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-0.5">
      {TIME_RANGES.map(r => (
        <button
          key={r.value}
          type="button"
          onClick={() => onChange(r.value)}
          className={`px-2.5 h-7 text-[12px] font-medium rounded transition-colors ${
            value === r.value
              ? 'bg-[color:var(--color-accent)] text-white'
              : 'text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] hover:bg-[color:var(--color-bg-elev-2)]'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}
