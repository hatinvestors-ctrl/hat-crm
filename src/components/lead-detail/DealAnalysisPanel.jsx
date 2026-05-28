import { useState } from 'react'
import { formatCurrency } from '../../lib/calculations'

const VERDICT_STYLES = {
  BUY:         { bg: 'bg-[color:var(--color-success-soft)]', text: 'text-[color:var(--color-success-text)]', border: 'border-[color:var(--color-success)]' },
  PASS:        { bg: 'bg-[color:var(--color-danger-soft)]',  text: 'text-[color:var(--color-danger-text)]',  border: 'border-[color:var(--color-danger)]'  },
  CONDITIONAL: { bg: 'bg-[color:var(--color-warn-soft)]',   text: 'text-[color:var(--color-warn-text)]',    border: 'border-[color:var(--color-warn)]'    },
  UNKNOWN:     { bg: 'bg-[color:var(--color-bg-elev-2)]',   text: 'text-[color:var(--color-text-muted)]',   border: 'border-[color:var(--color-line)]'    },
}

function ScoreRing({ score }) {
  if (score == null) return null
  const pct   = Math.max(0, Math.min(100, score))
  const color = pct >= 70 ? '#22c55e' : pct >= 45 ? '#f59e0b' : '#ef4444'
  return (
    <div className="relative shrink-0 w-12 h-12">
      <svg viewBox="0 0 36 36" className="w-12 h-12 -rotate-90">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--color-line)" strokeWidth="3" />
        <circle
          cx="18" cy="18" r="15.9" fill="none"
          stroke={color} strokeWidth="3"
          strokeDasharray={`${pct} ${100 - pct}`}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-[color:var(--color-text)]">
        {pct}
      </span>
    </div>
  )
}

export default function DealAnalysisPanel({ analysis, lead }) {
  const [expanded, setExpanded] = useState(false)
  if (!analysis) return null

  const { verdict = 'UNKNOWN', score, profit, roi, annualized_roi, total_cash_needed,
          recommendation, key_risks = [], markdown, analyzed_at, strategy = 'flip' } = analysis

  const vs = VERDICT_STYLES[verdict] || VERDICT_STYLES.UNKNOWN

  const dashboardUrl = (() => {
    const p = new URLSearchParams({
      pp:      lead.asking_price    || lead.offer_price || '',
      arv:     lead.arv             || '',
      reno:    lead.renovation_cost || '',
      rent:    lead.rent_estimate   || '0',
      address: lead.address         || '',
    })
    return `/deal-analyzer.html?${p.toString()}`
  })()

  const ts = analyzed_at
    ? new Date(analyzed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div className="mt-3 pt-3 border-t border-[color:var(--color-line)] space-y-3">
      {/* Verdict + score + recommendation */}
      <div className={`flex items-start gap-3 p-3 rounded-md border ${vs.bg} ${vs.border}`}>
        <ScoreRing score={score} />
        <div className="flex-1 min-w-0">
          <div className={`text-[13px] font-bold mb-0.5 ${vs.text}`}>
            {verdict === 'BUY' ? '✓' : verdict === 'PASS' ? '✗' : '⚠'} {verdict}
            {strategy && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider opacity-60">{strategy}</span>}
          </div>
          {recommendation && (
            <p className="text-[12px] text-[color:var(--color-text-muted)] leading-relaxed">{recommendation}</p>
          )}
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Est. Profit',    value: profit            != null ? formatCurrency(profit)            : '—' },
          { label: 'ROI',            value: roi               != null ? `${roi}%`                         : '—' },
          { label: 'Annualized ROI', value: annualized_roi    != null ? `${annualized_roi}%`              : '—' },
          { label: 'Cash Needed',    value: total_cash_needed != null ? formatCurrency(total_cash_needed) : '—' },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded-md p-2 text-center">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">{label}</div>
            <div className="text-[13px] font-semibold text-[color:var(--color-text)]">{value}</div>
          </div>
        ))}
      </div>

      {/* Key risks */}
      {key_risks.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {key_risks.map((r, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)]">
              ⚠ {r}
            </span>
          ))}
        </div>
      )}

      {/* Full analysis expander */}
      {markdown && (
        <div>
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-[11.5px] text-[color:var(--color-accent-text)] hover:underline"
          >
            {expanded ? '▲ Hide full analysis' : '▼ View full analysis'}
          </button>
          {expanded && (
            <pre className="mt-2 p-3 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded-md text-[11.5px] text-[color:var(--color-text-muted)] leading-relaxed whitespace-pre-wrap overflow-auto max-h-96">
              {markdown}
            </pre>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1">
        {ts && <span className="text-[10.5px] text-[color:var(--color-text-dim)]">Analyzed {ts}</span>}
        <a
          href={dashboardUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12px] px-2.5 py-1 bg-[color:var(--color-bg-elev-2)] hover:bg-[color:var(--color-accent-soft)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent-text)] rounded transition-colors"
        >
          Open Dashboard →
        </a>
      </div>
    </div>
  )
}
