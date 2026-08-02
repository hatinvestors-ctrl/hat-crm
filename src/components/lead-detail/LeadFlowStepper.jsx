import { useDealStaleness } from '../../hooks/useDealStaleness'

const STEPS = [
  { id: 'step-property',   label: 'Property' },
  { id: 'step-renovation', label: 'Renovation' },
  { id: 'step-analysis',   label: 'Analysis' },
  { id: 'step-decision',   label: 'Decision' },
]

function stepStatus(lead, staleness, idx) {
  const hasProperty   = !!(lead.address && lead.asking_price)
  const hasReno       = lead.renovation_cost != null
  const hasAnalysis   = !!lead.deal_analysis

  if (idx === 0) return hasProperty ? 'done' : 'current'
  if (idx === 1) return hasReno ? 'done' : hasProperty ? 'current' : 'upcoming'
  if (idx === 2) {
    if (!hasAnalysis) return hasReno ? 'current' : 'upcoming'
    return staleness.stale ? 'stale' : 'done'
  }
  if (idx === 3) return hasAnalysis ? 'current' : 'upcoming'
  return 'upcoming'
}

const STATUS_STYLE = {
  upcoming: { circle: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)] border-[color:var(--color-line)]', label: 'text-[color:var(--color-text-dim)]' },
  current:  { circle: 'bg-[color:var(--color-accent)] text-white border-[color:var(--color-accent)]', label: 'text-[color:var(--color-text)] font-semibold' },
  done:     { circle: 'bg-[color:var(--color-success)] text-white border-[color:var(--color-success)]', label: 'text-[color:var(--color-text-muted)]' },
  stale:    { circle: 'bg-[color:var(--color-warn)] text-white border-[color:var(--color-warn)]', label: 'text-[color:var(--color-warn-text)] font-semibold' },
}

function scrollToStep(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export default function LeadFlowStepper({ lead }) {
  const staleness = useDealStaleness(lead)

  return (
    <div className="flex items-center gap-1 px-3 py-2 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] overflow-x-auto">
      {STEPS.map((step, idx) => {
        const status = stepStatus(lead, staleness, idx)
        const style = STATUS_STYLE[status]
        return (
          <div key={step.id} className="flex items-center gap-1 shrink-0">
            {idx > 0 && <div className="w-4 h-px bg-[color:var(--color-line)] mx-1" />}
            <button
              onClick={() => scrollToStep(step.id)}
              title={status === 'stale' ? `${step.label} — outdated: ${staleness.reasons.join(', ')}` : step.label}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-[color:var(--color-bg)] transition-colors"
            >
              <span className={`flex items-center justify-center w-5 h-5 rounded-full border text-[10px] font-bold ${style.circle}`}>
                {status === 'done' ? '✓' : status === 'stale' ? '!' : idx + 1}
              </span>
              <span className={`text-[11.5px] ${style.label}`}>{step.label}</span>
            </button>
          </div>
        )
      })}
    </div>
  )
}
