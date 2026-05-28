import { STATUS_MAP } from '../../lib/constants'

const TONE_STYLES = {
  neutral: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] ring-[color:var(--color-line)]',
  accent:  'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)] ring-[color:var(--color-accent-soft)]',
  warn:    'bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)] ring-[color:var(--color-warn-soft)]',
  success: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)] ring-[color:var(--color-success-soft)]',
  danger:  'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] ring-[color:var(--color-danger-soft)]',
}

const TONE_DOT = {
  neutral: 'bg-[color:var(--color-text-dim)]',
  accent:  'bg-[color:var(--color-accent)]',
  warn:    'bg-[color:var(--color-warn)]',
  success: 'bg-[color:var(--color-success)]',
  danger:  'bg-[color:var(--color-danger)]',
}

export default function Badge({ status, tone, label, className = '', showDot = true }) {
  const meta = status ? STATUS_MAP[status] : null
  const resolvedTone = tone || meta?.tone || 'neutral'
  const text = label || meta?.label || status || '—'
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${TONE_STYLES[resolvedTone]} ${className}`}>
      {showDot && <span className={`w-1.5 h-1.5 rounded-full ${TONE_DOT[resolvedTone]}`} />}
      {text}
    </span>
  )
}
