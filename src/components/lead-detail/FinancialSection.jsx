import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import Card from '../ui/Card'
import Button from '../ui/Button'
import EditableField from './EditableField'
import DealAnalysisPanel from './DealAnalysisPanel'
import WhatIfPanel from './WhatIfPanel'
import RenoTierPicker from './RenoTierPicker'
import { formatCurrency, calculateMAO } from '../../lib/calculations'
import { useLeadUpdate } from '../../hooks/useLeadUpdate'
import { logDealAnalysis } from '../../lib/activityLogger'
import { fireLeadNotification } from '../../lib/leadNotifications'
import { suggestRenoTier } from '../../lib/renoTierSuggest'


export default function FinancialSection({ lead, userId, members, canEdit, onUpdated }) {
  const { workspaceId } = useOutletContext()
  const update = useLeadUpdate(lead, userId, members, onUpdated)

  const [strategy,     setStrategy]     = useState(lead.deal_analysis?.strategy || 'flip')
  const [monthlyRent,  setMonthlyRent]  = useState(lead.rent_estimate || lead.monthly_rent || '')
  const [analyzing,    setAnalyzing]    = useState(false)
  const [analyzeError, setAnalyzeError] = useState(null)
  const [showRenoPicker, setShowRenoPicker] = useState(false)

  // Reno tier picker state — shown when Quick Check is clicked and reno is null/0
  const [showEstimator, setShowEstimator] = useState(false)
  const [selectedTier,  setSelectedTier]  = useState(null)   // 'cosmetic' | 'medium' | 'heavy'
  const [pickerSqft,    setPickerSqft]    = useState(String(lead.sqft || ''))
  const [suggestedTier, setSuggestedTier] = useState(null)   // { tier, reason }

  const RENO_RATES = { cosmetic: 12, medium: 22, heavy: 38 }

  const hasAnalysis          = !!lead.deal_analysis
  const renoMissing          = !lead.renovation_cost
  const isPreAnalysisImport  = lead.auto_imported && !lead.deal_analysis

  const isStale = (() => {
    const inp = lead.deal_analysis?.inputs
    if (!inp) return false
    const curPP   = Number(lead.mao || 0)
    const curArv  = Number(lead.arv || 0)
    const curReno = lead.renovation_cost != null ? Number(lead.renovation_cost) : null
    // Handle null vs null (both unknown) as not-stale
    const renoMatch = curReno === inp.renovation_cost || (curReno == null && inp.renovation_cost == null)
    return curPP !== inp.purchase_price || curArv !== inp.arv || !renoMatch
  })()

  async function runAnalyze(renoOverride = null, renoWasEstimated = false, strategyOverride = null) {
    setAnalyzing(true)
    setAnalyzeError(null)
    setShowEstimator(false)
    const activeStrategy = strategyOverride ?? strategy
    // Always compute MAO fresh from current ARV + reno so Quick Check stays in sync
    // with the AI Analysis MAO formula (MAO = ARV × 75% − reno − $2,450)
    const effectiveReno = renoOverride ?? lead.renovation_cost ?? 0
    const freshMao = lead.arv
      ? Math.round(Number(lead.arv) * 0.75 - Number(effectiveReno) - 2450)
      : null
    const purchasePrice = freshMao ?? lead.mao ?? lead.asking_price
    try {
      const res = await fetch('/.netlify/functions/analyze-deal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id:            lead.id,
          address:            [lead.address, lead.city, lead.state].filter(Boolean).join(', '),
          purchase_price:     purchasePrice,
          arv:                lead.arv,
          renovation_cost:    effectiveReno || null,
          monthly_rent:       activeStrategy === 'brrrr' ? (parseFloat(monthlyRent) || null) : null,
          strategy:           activeStrategy,
          reno_was_estimated: renoWasEstimated,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Analysis failed.')
      await logDealAnalysis(lead.id, userId, data.analysis)
      const rentVal = activeStrategy === 'brrrr' ? (parseFloat(monthlyRent) || null) : null
      // Persist MAO, reno, and (for BRRRR) rent_estimate so DealAnalysisPanel can read them
      const persistFields = {
        ...(freshMao   != null ? { mao: freshMao }                        : {}),
        ...(renoOverride != null ? { renovation_cost: renoOverride }      : {}),
        ...(rentVal    != null ? { rent_estimate: rentVal }               : {}),
      }
      if (lead.id && Object.keys(persistFields).length) {
        await update(persistFields)
      }
      onUpdated?.({
        ...lead,
        deal_analysis: data.analysis,
        ...persistFields,
      })
    } catch (err) {
      setAnalyzeError(err.message || 'Something went wrong.')
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleAnalyze() {
    // If reno is known, run immediately
    if (!renoMissing) { runAnalyze(); return }
    // Show tier picker — pre-select AI-suggested tier
    const suggestion = suggestRenoTier(lead)
    setShowEstimator(true)
    setSelectedTier(suggestion.tier)
    setPickerSqft(String(lead.sqft || ''))
    setSuggestedTier(suggestion)
  }

  async function useTierReno() {
    if (!selectedTier) return
    const sqft = parseInt(pickerSqft, 10) || 1200
    const reno = Math.round(sqft * RENO_RATES[selectedTier] / 1000) * 1000
    await update({ renovation_cost: reno })
    runAnalyze(reno, true)
  }

  return (
    <Card title="Financials" subtitle="Deal numbers at a glance — click any value to edit">

      {/* ── Section 1: Price story — Ask → Gap → MAO → Starting Offer ── */}
      {lead.asking_price && (lead.arv || lead.mao) && (() => {
        const formulaMao = calculateMAO(lead.arv, lead.renovation_cost)
        const storedMao  = lead.mao != null ? Number(lead.mao) : null
        const diverged   = formulaMao !== null && storedMao !== null && Math.abs(formulaMao - storedMao) > 1
        const mao        = storedMao ?? formulaMao
        const ask        = Number(lead.asking_price)
        const gap        = mao != null ? ask - mao : null

        // Live-computed starting offer — updates instantly when ARV/reno/ask changes.
        // Uses simplified negotiation-room model (no motivation scoring; AI adds that).
        // Shown when stored value is stale (ARV changed since last AI run) or missing.
        const liveStartingOffer = (() => {
          if (!mao || !ask) return null
          if (ask <= mao) return Math.round(ask / 100) * 100
          const g = ask - mao
          const anchor = mao - g * 0.45   // neutral motivation → 45% room factor
          const floor  = ask * 0.80
          const raw    = Math.max(anchor, floor)
          return Math.round(Math.min(raw, mao * 0.995) / 100) * 100
        })()
        const aiArv = lead.deal_analysis?.inputs?.arv
        const offerIsStale = aiArv != null && Number(lead.arv) !== Number(aiArv)
        const displayOffer = (offerIsStale || !lead.starting_offer) ? liveStartingOffer : lead.starting_offer
        const pct        = gap != null ? Math.round((gap / ask) * 100) : null
        const dealOk     = gap != null && gap <= 0
        const easy       = gap != null && gap > 0 && pct <= 10
        const tough      = gap != null && gap > 0 && pct > 20

        const gapColor   = dealOk ? 'var(--color-success-text)' : easy ? 'var(--color-warn-text)' : 'var(--color-danger-text)'
        const gapBg      = dealOk ? 'var(--color-success-soft)' : easy ? 'var(--color-warn-soft)'  : 'var(--color-danger-soft)'
        const gapBorder  = dealOk ? 'var(--color-success)'      : easy ? 'var(--color-warn)'       : 'var(--color-danger)'

        const gapLabel   = gap == null ? null
          : dealOk ? `✓ ${formatCurrency(Math.abs(gap))} below MAO`
          : tough  ? `${pct}% to drop — tough`
                   : `${pct}% to drop`

        return (
          <div className="mb-5">
            {/* Price flow strip */}
            <div className="flex items-stretch gap-0 rounded-xl border border-[color:var(--color-line)] overflow-hidden mb-3">
              {/* Ask */}
              <div className="flex-1 flex flex-col items-center justify-center px-3 py-3 bg-[color:var(--color-bg-elev-2)] border-r border-[color:var(--color-line)]">
                <div className="text-[9px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-semibold mb-1">Asking</div>
                <div className="text-[16px] font-bold text-[color:var(--color-text)]">{formatCurrency(ask)}</div>
              </div>
              {/* Gap */}
              {gap != null && (
                <div className="flex-1 flex flex-col items-center justify-center px-3 py-3 border-r border-[color:var(--color-line)]"
                  style={{ background: gapBg }}>
                  <div className="text-[9px] uppercase tracking-widest font-semibold mb-1" style={{ color: gapColor }}>Gap</div>
                  <div className="text-[16px] font-bold" style={{ color: gapColor }}>
                    {gap <= 0 ? '✓ In budget' : formatCurrency(gap)}
                  </div>
                  {gapLabel && gap > 0 && (
                    <div className="text-[10px] mt-0.5" style={{ color: gapColor }}>{gapLabel}</div>
                  )}
                </div>
              )}
              {/* MAO */}
              <div className="flex-1 flex flex-col items-center justify-center px-3 py-3 bg-[color:var(--color-bg-elev-2)] border-r border-[color:var(--color-line)]">
                <div className="flex items-center gap-1 mb-1">
                  <div className="text-[9px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-semibold">MAO</div>
                  <span title={`MAO = 75% × ARV − Reno − $2,450\n= ${formatCurrency(formulaMao)}\n\nClick to edit.`}
                    className="text-[9px] text-[color:var(--color-text-dim)] cursor-help">ℹ</span>
                  {diverged && canEdit && (
                    <button onClick={() => update({ mao: formulaMao })}
                      className="text-[8px] px-1 rounded bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)] border border-[color:var(--color-warn)] hover:opacity-80"
                      title="Reset to formula">↺</button>
                  )}
                </div>
                <EditableField label="" type="currency" value={lead.mao ?? formulaMao} formatter={formatCurrency}
                  onSave={(v) => update({ mao: v })} disabled={!canEdit}
                  displayClassName="text-[16px] font-bold text-[color:var(--color-accent)]" />
              </div>
              {/* Starting Offer */}
              <div className="flex-1 flex flex-col items-center justify-center px-3 py-3 bg-[color:var(--color-bg-elev-2)]">
                <div className="flex items-center gap-1 mb-1">
                  <div className="text-[9px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-semibold">We Offer</div>
                  <span title={offerIsStale ? "Re-run AI analysis for motivation-adjusted offer" : "Starting offer to send seller. Set by AI analysis — click to override."}
                    className="text-[9px] text-[color:var(--color-text-dim)] cursor-help">ℹ</span>
                </div>
                <EditableField label="" type="currency" value={displayOffer} formatter={formatCurrency}
                  onSave={(v) => update({ starting_offer: v })} disabled={!canEdit}
                  displayClassName={`text-[16px] font-bold ${offerIsStale ? 'opacity-60' : ''} text-[color:var(--color-success-text)]`}
                  placeholder="—" />
              </div>
            </div>
          </div>
        )
      })()}

      {/* Fallback hero when no asking price yet: show MAO + Starting Offer plainly */}
      {!(lead.asking_price && (lead.arv || lead.mao)) && (() => {
        const formulaMao = calculateMAO(lead.arv, lead.renovation_cost)
        const storedMao  = lead.mao != null ? Number(lead.mao) : null
        const diverged   = formulaMao !== null && storedMao !== null && Math.abs(formulaMao - storedMao) > 1
        return (
          <div className="flex gap-6 mb-5">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-text-dim)]">MAO · Max We'd Pay</span>
                {diverged && canEdit && (
                  <button onClick={() => update({ mao: formulaMao })}
                    className="text-[9px] px-1 py-0.5 rounded bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)] border border-[color:var(--color-warn)] hover:opacity-80">↺ formula</button>
                )}
              </div>
              <EditableField label="" type="currency" value={lead.mao ?? formulaMao} formatter={formatCurrency}
                onSave={(v) => update({ mao: v })} disabled={!canEdit}
                displayClassName="text-2xl font-bold text-[color:var(--color-accent)]" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-text-dim)] mb-0.5">We Offer</div>
              <EditableField label="" type="currency" value={lead.starting_offer} formatter={formatCurrency}
                onSave={(v) => update({ starting_offer: v })} disabled={!canEdit}
                displayClassName="text-2xl font-bold text-[color:var(--color-success-text)]" placeholder="— run AI analysis" />
            </div>
          </div>
        )
      })()}

      {/* ── Section 2: Inputs — ARV + Reno ── */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-3 py-2.5">
          <EditableField
            label="After-Repair Value (ARV)"
            type="currency"
            value={lead.arv}
            formatter={formatCurrency}
            onSave={(v) => {
              const newMao = v ? Math.round(Number(v) * 0.75 - Number(lead.renovation_cost || 0) - 2450) : null
              update({ arv: v, ...(newMao ? { mao: newMao } : {}) })
            }}
            disabled={!canEdit}
          />
        </div>
        <div className={`rounded-lg border px-3 py-2.5 ${renoMissing && canEdit ? 'border-dashed border-2 border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)]' : 'border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]'}`}>
          <div className="flex items-center justify-between gap-1">
            <EditableField
              label="Renovation Cost"
              type="currency"
              value={lead.renovation_cost}
              formatter={formatCurrency}
              onSave={(v) => {
                const newMao = lead.arv ? Math.round(Number(lead.arv) * 0.75 - Number(v || 0) - 2450) : null
                update({ renovation_cost: v, ...(newMao ? { mao: newMao } : {}) })
              }}
              disabled={!canEdit}
            />
            {canEdit && (
              <button
                onClick={() => setShowRenoPicker(true)}
                title="Pick a renovation scope (AI-suggested tier)"
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-[13px] hover:bg-[color:var(--color-bg)] transition-colors"
              >
                🔨
              </button>
            )}
          </div>
          {renoMissing && canEdit && (
            <p className="text-[10px] text-[color:var(--color-warn-text)] mt-1 leading-tight">
              ⚠ Enter before running analysis
            </p>
          )}
          <RenoTierPicker
            lead={lead}
            open={showRenoPicker}
            onClose={() => setShowRenoPicker(false)}
            onApply={(reno) => {
              const newMao = lead.arv ? Math.round(Number(lead.arv) * 0.75 - reno - 2450) : null
              update({ renovation_cost: reno, ...(newMao ? { mao: newMao } : {}) })
              setShowRenoPicker(false)
            }}
          />
        </div>
      </div>

      {/* ── Section 3: Analyze row ── */}
      <div className="flex items-center justify-between gap-3 pt-3 border-t border-[color:var(--color-line)]">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Strategy toggle */}
          <div className="flex rounded-lg border border-[color:var(--color-line)] overflow-hidden text-[11px] font-bold">
            {['flip', 'brrrr'].map(s => (
              <button
                key={s}
                onClick={() => {
                  if (s === strategy) return
                  setStrategy(s)
                  if (hasAnalysis) runAnalyze(null, false, s)
                }}
                disabled={analyzing}
                className={`px-3 py-1.5 transition-colors uppercase tracking-wide ${
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
              <span className="text-[11px] text-[color:var(--color-text-dim)]">Rent</span>
              <input
                type="number"
                value={monthlyRent}
                onChange={e => setMonthlyRent(e.target.value)}
                placeholder="2000"
                className="w-20 h-7 px-2 text-[12px] bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded-lg text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)]"
              />
              <span className="text-[11px] text-[color:var(--color-text-dim)]">/mo</span>
            </div>
          )}
        </div>

        <Button
          size="sm"
          variant={hasAnalysis ? 'ghost' : 'primary'}
          onClick={handleAnalyze}
          loading={analyzing}
          disabled={!canEdit || analyzing}
        >
          {analyzing ? 'Analyzing…' : hasAnalysis ? '↺ Re-check' : '✦ Quick Check'}
        </Button>
      </div>

      {/* ── Reno tier picker — shown when Quick Check clicked with no reno ── */}
      {showEstimator && !analyzing && (() => {
        const sqft    = parseInt(pickerSqft, 10) || null
        const tiers   = [
          { key: 'cosmetic', label: 'Cosmetic',  desc: 'Paint, floors, fixtures, kitchen/bath refresh',         rate: RENO_RATES.cosmetic },
          { key: 'medium',   label: 'Medium',    desc: 'Cosmetic + 1 major (roof, HVAC, electric, or plumbing)', rate: RENO_RATES.medium   },
          { key: 'heavy',    label: 'Heavy',      desc: 'Cosmetic + 2+ majors / gut rehab',                      rate: RENO_RATES.heavy    },
        ]
        const estFor  = t => sqft ? formatCurrency(Math.round(sqft * t.rate / 1000) * 1000) : `~${formatCurrency(1200 * t.rate)}–${formatCurrency(1800 * t.rate)}`
        const selectedEst = selectedTier ? estFor(tiers.find(t => t.key === selectedTier)) : null

        return (
          <div className="mt-2 rounded-lg border border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)] p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold text-[color:var(--color-warn-text)]">⚠ No renovation cost — pick a scope to estimate</span>
              <button onClick={() => setShowEstimator(false)} className="text-[color:var(--color-warn-text)] opacity-60 hover:opacity-100 text-lg leading-none">×</button>
            </div>
            {suggestedTier && (
              <div className="flex items-start gap-1.5 bg-black/20 rounded px-2.5 py-1.5">
                <span className="text-[10px] text-[color:var(--color-warn-text)] opacity-70 mt-0.5">🤖</span>
                <span className="text-[11px] text-[color:var(--color-warn-text)] opacity-80 leading-snug">
                  <strong>Suggested: {suggestedTier.tier.charAt(0).toUpperCase() + suggestedTier.tier.slice(1)}</strong>
                  {' — '}{suggestedTier.reason}
                </span>
              </div>
            )}

            {/* Sqft input when missing */}
            {!lead.sqft && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[color:var(--color-warn-text)]">Property sqft (optional):</span>
                <input
                  type="number"
                  value={pickerSqft}
                  onChange={e => setPickerSqft(e.target.value)}
                  placeholder="e.g. 1400"
                  className="w-24 h-7 px-2 text-[12px] bg-white/60 border border-[color:var(--color-warn)] rounded text-[color:var(--color-warn-text)] focus:outline-none"
                />
                <span className="text-[10px] text-[color:var(--color-warn-text)] opacity-70">— used to compute estimate</span>
              </div>
            )}

            {/* Tier cards */}
            <div className="grid grid-cols-3 gap-2">
              {tiers.map(t => (
                <button
                  key={t.key}
                  onClick={() => setSelectedTier(t.key)}
                  className={`flex flex-col items-start gap-0.5 rounded-lg border-2 px-3 py-2 text-left transition-all ${
                    selectedTier === t.key
                      ? 'border-[color:var(--color-warn)] bg-[color:var(--color-warn)]/20'
                      : 'border-[color:var(--color-warn)]/40 bg-white/40 hover:border-[color:var(--color-warn)]/70'
                  }`}
                >
                  <div className="flex items-center gap-1.5 w-full">
                    <span className="text-[12px] font-bold text-[color:var(--color-warn-text)]">{t.label}</span>
                    {suggestedTier?.tier === t.key && (
                      <span className="text-[8.5px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-[color:var(--color-warn)] text-white leading-none">AI pick</span>
                    )}
                  </div>
                  <span className="text-[11px] font-semibold text-[color:var(--color-warn-text)]">{estFor(t)}</span>
                  <span className="text-[9.5px] text-[color:var(--color-warn-text)] opacity-70 leading-tight">{t.desc}</span>
                  <span className="text-[9px] text-[color:var(--color-warn-text)] opacity-50 mt-0.5">${t.rate}/sqft · Jacksonville avg</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 pt-1 flex-wrap">
              <button
                onClick={useTierReno}
                disabled={!selectedTier}
                className="px-3 py-1.5 text-[12px] font-semibold rounded-md bg-[color:var(--color-warn)] text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {selectedTier ? `Use ${selectedEst} & analyze` : 'Select a scope above'}
              </button>
              <button
                onClick={() => setShowEstimator(false)}
                className="text-[11.5px] text-[color:var(--color-warn-text)] underline underline-offset-2 hover:opacity-70"
              >
                Enter exact cost ↑
              </button>
              <button
                onClick={() => { setShowEstimator(false); runAnalyze(null, false) }}
                className="text-[11px] text-[color:var(--color-warn-text)] opacity-50 hover:opacity-80 ml-auto"
              >
                Run with $0 anyway
              </button>
            </div>
          </div>
        )
      })()}

      {isStale && !analyzing && (
        <div className="mt-2 flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-[color:var(--color-warn-soft)] border border-[color:var(--color-warn)]">
          <span className="text-[11.5px] text-[color:var(--color-warn-text)]">⚠ Numbers changed since last analysis — results may be outdated.</span>
          <button
            onClick={handleAnalyze}
            disabled={!canEdit || analyzing}
            className="shrink-0 text-[11.5px] font-semibold px-2.5 py-1 rounded bg-[color:var(--color-warn)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            Re-check now
          </button>
        </div>
      )}

      {analyzeError && (
        <p className="mt-2 text-[11.5px] text-[color:var(--color-danger-text)]">{analyzeError}</p>
      )}

      {lead.deal_analysis && (
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[9px] font-bold uppercase tracking-widest text-[color:var(--color-text-dim)] shrink-0">Quick Check Result</span>
          <div className="flex-1 h-px bg-[color:var(--color-line)]" />
        </div>
      )}
      <DealAnalysisPanel analysis={lead.deal_analysis} lead={lead} />
      <WhatIfPanel lead={lead} />
    </Card>
  )
}
