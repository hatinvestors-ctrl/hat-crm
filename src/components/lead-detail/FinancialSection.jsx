import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import Card from '../ui/Card'
import Button from '../ui/Button'
import EditableField from './EditableField'
import DealAnalysisPanel from './DealAnalysisPanel'
import { formatCurrency } from '../../lib/calculations'
import { useLeadUpdate } from '../../hooks/useLeadUpdate'
import { logDealAnalysis } from '../../lib/activityLogger'

export default function FinancialSection({ lead, userId, members, canEdit, onUpdated }) {
  const { workspaceId } = useOutletContext()
  const update = useLeadUpdate(lead, userId, members, onUpdated)

  const [strategy,     setStrategy]     = useState(lead.deal_analysis?.strategy || 'flip')
  const [monthlyRent,  setMonthlyRent]  = useState(lead.monthly_rent || '')
  const [analyzing,    setAnalyzing]    = useState(false)
  const [analyzeError, setAnalyzeError] = useState(null)

  const hasAnalysis = !!lead.deal_analysis

  const isStale = (() => {
    const inp = lead.deal_analysis?.inputs
    if (!inp) return false
    const curPP   = Number(lead.offer_price || lead.asking_price || 0)
    const curArv  = Number(lead.arv || 0)
    const curReno = Number(lead.renovation_cost || 0)
    return curPP !== inp.purchase_price || curArv !== inp.arv || curReno !== inp.renovation_cost
  })()

  async function handleAnalyze() {
    setAnalyzing(true)
    setAnalyzeError(null)
    try {
      const res = await fetch('/.netlify/functions/analyze-deal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id:         lead.id,
          address:         [lead.address, lead.city, lead.state].filter(Boolean).join(', '),
          purchase_price:  lead.offer_price || lead.asking_price,
          arv:             lead.arv,
          renovation_cost: lead.renovation_cost,
          monthly_rent:    strategy === 'brrrr' ? (parseFloat(monthlyRent) || null) : null,
          strategy,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Analysis failed.')
      await logDealAnalysis(lead.id, userId, data.analysis)
      // Pass the updated lead back so the parent re-renders with the new deal_analysis
      onUpdated?.({ ...lead, deal_analysis: data.analysis })
    } catch (err) {
      setAnalyzeError(err.message || 'Something went wrong.')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <Card title="Financials">
      <div className="grid grid-cols-2 gap-4">
        <EditableField
          label="Offer Price"
          type="currency"
          value={lead.offer_price}
          formatter={formatCurrency}
          onSave={(v) => update({ offer_price: v })}
          disabled={!canEdit}
        />
        <EditableField
          label="ARV"
          type="currency"
          value={lead.arv}
          formatter={formatCurrency}
          onSave={(v) => update({ arv: v })}
          disabled={!canEdit}
        />
        <EditableField
          label="Renovation Cost"
          type="currency"
          value={lead.renovation_cost}
          formatter={formatCurrency}
          onSave={(v) => update({ renovation_cost: v })}
          disabled={!canEdit}
        />
        <EditableField
          label="MAO · Max Allowable Offer"
          type="currency"
          value={lead.mao}
          formatter={formatCurrency}
          onSave={(v) => update({ mao: v })}
          disabled={!canEdit}
        />
      </div>

      <p className="text-[11px] text-[color:var(--color-text-dim)] mt-3 leading-relaxed">
        MAO = 75% × ARV − Renovation (auto-recalculates when ARV or Renovation changes).
      </p>

      {/* Analyze trigger row */}
      <div className="mt-3 pt-3 border-t border-[color:var(--color-line)] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* Strategy toggle */}
          <div className="flex rounded-md border border-[color:var(--color-line)] overflow-hidden text-[11.5px] font-semibold">
            {['flip', 'brrrr'].map(s => (
              <button
                key={s}
                onClick={() => setStrategy(s)}
                disabled={analyzing}
                className={`px-2.5 py-1 transition-colors uppercase tracking-wide ${
                  strategy === s
                    ? 'bg-[color:var(--color-accent)] text-white'
                    : 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          {strategy === 'brrrr' && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-[color:var(--color-text-dim)]">Rent $</span>
              <input
                type="number"
                value={monthlyRent}
                onChange={e => setMonthlyRent(e.target.value)}
                placeholder="2000"
                className="w-20 h-6 px-2 text-[12px] bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)]"
              />
              <span className="text-[11px] text-[color:var(--color-text-dim)]">/mo</span>
            </div>
          )}
          {hasAnalysis && !analyzing && (
            <span className="text-[10.5px] text-[color:var(--color-text-dim)]">
              {new Date(lead.deal_analysis.analyzed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>

        <Button
          size="sm"
          variant={hasAnalysis ? 'ghost' : 'primary'}
          onClick={handleAnalyze}
          loading={analyzing}
          disabled={!canEdit || analyzing}
        >
          {analyzing ? 'Analyzing…' : hasAnalysis ? '↺ Re-analyze' : '✦ Analyze Deal'}
        </Button>
      </div>

      {isStale && !analyzing && (
        <div className="mt-2 flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-[color:var(--color-warn-soft)] border border-[color:var(--color-warn)]">
          <span className="text-[11.5px] text-[color:var(--color-warn-text)]">⚠ Numbers changed since last analysis — results may be outdated.</span>
          <button
            onClick={handleAnalyze}
            disabled={!canEdit || analyzing}
            className="shrink-0 text-[11.5px] font-semibold px-2.5 py-1 rounded bg-[color:var(--color-warn)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            Re-analyze now
          </button>
        </div>
      )}

      {analyzeError && (
        <p className="mt-2 text-[11.5px] text-[color:var(--color-danger-text)]">{analyzeError}</p>
      )}

      <DealAnalysisPanel analysis={lead.deal_analysis} lead={lead} />
    </Card>
  )
}
