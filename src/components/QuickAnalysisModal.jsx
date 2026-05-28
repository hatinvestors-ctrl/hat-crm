import { useState } from 'react'
import { formatCurrency } from '../lib/calculations'

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
        <circle cx="18" cy="18" r="15.9" fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={`${pct} ${100 - pct}`} strokeLinecap="round" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-[color:var(--color-text)]">
        {pct}
      </span>
    </div>
  )
}

const EMPTY = { address: '', purchase_price: '', arv: '', renovation_cost: '', strategy: 'flip' }

export default function QuickAnalysisModal({ open, onClose }) {
  const [form,      setForm]      = useState(EMPTY)
  const [analyzing, setAnalyzing] = useState(false)
  const [error,     setError]     = useState(null)
  const [result,    setResult]    = useState(null)
  const [expanded,  setExpanded]  = useState(false)

  if (!open) return null

  function handleClose() {
    setForm(EMPTY)
    setResult(null)
    setError(null)
    setExpanded(false)
    onClose()
  }

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }))
  }

  async function handleAnalyze() {
    if (!form.purchase_price || !form.arv) {
      setError('Purchase Price and ARV are required.')
      return
    }
    setAnalyzing(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/.netlify/functions/analyze-deal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id:         'quick-analysis',
          address:         form.address,
          purchase_price:  parseFloat(form.purchase_price),
          arv:             parseFloat(form.arv),
          renovation_cost: parseFloat(form.renovation_cost) || 0,
          strategy:        form.strategy,
          skip_save:       true,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Analysis failed.')
      setResult(data.analysis)
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setAnalyzing(false)
    }
  }

  const dashboardUrl = result ? (() => {
    const p = new URLSearchParams({
      pp:      form.purchase_price || '',
      arv:     form.arv            || '',
      reno:    form.renovation_cost|| '',
      address: form.address        || '',
    })
    return `/deal-analyzer.html?${p.toString()}`
  })() : null

  const vs = result ? (VERDICT_STYLES[result.verdict] || VERDICT_STYLES.UNKNOWN) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={handleClose} />
      <div className="relative bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--color-line)]">
          <div>
            <h2 className="text-[15px] font-semibold text-[color:var(--color-text)]">⚡ Quick Deal Analysis</h2>
            <p className="text-[11.5px] text-[color:var(--color-text-dim)] mt-0.5">Analyze any property without adding it to the CRM</p>
          </div>
          <button onClick={handleClose} className="text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] w-7 h-7 flex items-center justify-center rounded hover:bg-[color:var(--color-bg-elev-2)] transition-colors text-lg">
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {/* Form */}
          {!result && (
            <>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Property Address</label>
                <input
                  type="text"
                  value={form.address}
                  onChange={set('address')}
                  placeholder="123 Main St, Tampa, FL"
                  className="w-full bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded-md px-3 py-2 text-[13px] text-[color:var(--color-text)] placeholder-[color:var(--color-text-dim)] focus:outline-none focus:border-[color:var(--color-accent)]"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Purchase Price *</label>
                  <input
                    type="number"
                    value={form.purchase_price}
                    onChange={set('purchase_price')}
                    placeholder="250000"
                    className="w-full bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded-md px-3 py-2 text-[13px] text-[color:var(--color-text)] placeholder-[color:var(--color-text-dim)] focus:outline-none focus:border-[color:var(--color-accent)]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">ARV *</label>
                  <input
                    type="number"
                    value={form.arv}
                    onChange={set('arv')}
                    placeholder="350000"
                    className="w-full bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded-md px-3 py-2 text-[13px] text-[color:var(--color-text)] placeholder-[color:var(--color-text-dim)] focus:outline-none focus:border-[color:var(--color-accent)]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Renovation</label>
                  <input
                    type="number"
                    value={form.renovation_cost}
                    onChange={set('renovation_cost')}
                    placeholder="40000"
                    className="w-full bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded-md px-3 py-2 text-[13px] text-[color:var(--color-text)] placeholder-[color:var(--color-text-dim)] focus:outline-none focus:border-[color:var(--color-accent)]"
                  />
                </div>
              </div>

              {/* Strategy */}
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Strategy</label>
                <div className="flex rounded-md border border-[color:var(--color-line)] overflow-hidden text-[11.5px] font-semibold w-fit">
                  {['flip', 'brrrr'].map(s => (
                    <button
                      key={s}
                      onClick={() => setForm(f => ({ ...f, strategy: s }))}
                      className={`px-4 py-1.5 transition-colors uppercase tracking-wide ${
                        form.strategy === s
                          ? 'bg-[color:var(--color-accent)] text-white'
                          : 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="text-[11.5px] text-[color:var(--color-danger-text)]">{error}</p>}

              <button
                onClick={handleAnalyze}
                disabled={analyzing}
                className="w-full py-2.5 rounded-md bg-[color:var(--color-accent)] hover:opacity-90 disabled:opacity-50 text-white text-[13px] font-semibold transition-opacity flex items-center justify-center gap-2"
              >
                {analyzing ? (
                  <><span className="animate-spin">⟳</span> Analyzing…</>
                ) : (
                  '✦ Analyze Deal'
                )}
              </button>
            </>
          )}

          {/* Results */}
          {result && vs && (
            <div className="space-y-3">
              {/* Verdict */}
              <div className={`flex items-start gap-3 p-3 rounded-md border ${vs.bg} ${vs.border}`}>
                <ScoreRing score={result.score} />
                <div className="flex-1 min-w-0">
                  <div className={`text-[13px] font-bold mb-0.5 ${vs.text}`}>
                    {result.verdict === 'BUY' ? '✓' : result.verdict === 'PASS' ? '✗' : '⚠'} {result.verdict}
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider opacity-60">{form.strategy}</span>
                  </div>
                  {result.recommendation && (
                    <p className="text-[12px] text-[color:var(--color-text-muted)] leading-relaxed">{result.recommendation}</p>
                  )}
                </div>
              </div>

              {/* Metrics */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Est. Profit',    value: result.profit            != null ? formatCurrency(result.profit)            : '—' },
                  { label: 'ROI',            value: result.roi               != null ? `${result.roi}%`                         : '—' },
                  { label: 'Annualized ROI', value: result.annualized_roi    != null ? `${result.annualized_roi}%`              : '—' },
                  { label: 'Cash Needed',    value: result.total_cash_needed != null ? formatCurrency(result.total_cash_needed) : '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded-md p-2 text-center">
                    <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">{label}</div>
                    <div className="text-[13px] font-semibold text-[color:var(--color-text)]">{value}</div>
                  </div>
                ))}
              </div>

              {/* Risks */}
              {result.key_risks?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {result.key_risks.map((r, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)]">
                      ⚠ {r}
                    </span>
                  ))}
                </div>
              )}

              {/* Full analysis expander */}
              {result.markdown && (
                <div>
                  <button onClick={() => setExpanded(v => !v)} className="text-[11.5px] text-[color:var(--color-accent-text)] hover:underline">
                    {expanded ? '▲ Hide full analysis' : '▼ View full analysis'}
                  </button>
                  {expanded && (
                    <pre className="mt-2 p-3 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded-md text-[11px] text-[color:var(--color-text-muted)] leading-relaxed whitespace-pre-wrap overflow-auto max-h-64">
                      {result.markdown}
                    </pre>
                  )}
                </div>
              )}

              {/* Footer actions */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setResult(null); setError(null) }}
                  className="flex-1 py-2 rounded-md border border-[color:var(--color-line)] text-[13px] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
                >
                  ↺ New Analysis
                </button>
                <a
                  href={dashboardUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-2 rounded-md bg-[color:var(--color-accent)] text-white text-[13px] font-semibold text-center hover:opacity-90 transition-opacity"
                >
                  Open Dashboard →
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
