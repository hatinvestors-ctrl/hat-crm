import { useState, useEffect } from 'react'
import { suggestRenoTier } from '../../lib/renoTierSuggest'

const RENO_RATES = { cosmetic: 12, medium: 22, heavy: 38 }

const TIERS = [
  { key: 'cosmetic', label: 'Cosmetic', desc: 'Paint, floors, fixtures, kitchen/bath refresh',          rate: RENO_RATES.cosmetic },
  { key: 'medium',   label: 'Medium',   desc: 'Cosmetic + 1 major (roof, HVAC, electric, or plumbing)', rate: RENO_RATES.medium },
  { key: 'heavy',    label: 'Heavy',    desc: 'Cosmetic + 2+ majors / gut rehab',                        rate: RENO_RATES.heavy },
]

const fmt = n => `$${Math.round(n).toLocaleString()}`

export default function RenoTierPicker({ lead, open, onClose, onApply }) {
  const [selectedTier, setSelectedTier] = useState(null)
  const [sqft, setSqft] = useState(String(lead.sqft || ''))
  const [suggestion, setSuggestion] = useState(null)

  useEffect(() => {
    if (!open) return
    const s = suggestRenoTier(lead)
    setSuggestion(s)
    setSelectedTier(s.tier)
    setSqft(String(lead.sqft || ''))
  }, [open, lead])

  if (!open) return null

  const parsedSqft = parseInt(sqft, 10) || null
  const estFor = t => parsedSqft
    ? fmt(Math.round(parsedSqft * t.rate / 1000) * 1000)
    : `~${fmt(1200 * t.rate)}–${fmt(1800 * t.rate)}`
  const selectedEst = selectedTier ? estFor(TIERS.find(t => t.key === selectedTier)) : null

  const apply = () => {
    if (!selectedTier) return
    const s = parseInt(sqft, 10) || 1200
    const reno = Math.round(s * RENO_RATES[selectedTier] / 1000) * 1000
    onApply(reno)
  }

  return (
    <div className="mt-2 rounded-lg border border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)] p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-[color:var(--color-warn-text)]">🔨 Pick a renovation scope</span>
        <button onClick={onClose} className="text-[color:var(--color-warn-text)] opacity-60 hover:opacity-100 text-lg leading-none">×</button>
      </div>

      {suggestion && (
        <div className="flex items-start gap-1.5 bg-black/20 rounded px-2.5 py-1.5">
          <span className="text-[10px] text-[color:var(--color-warn-text)] opacity-70 mt-0.5">🤖</span>
          <span className="text-[11px] text-[color:var(--color-warn-text)] opacity-80 leading-snug">
            <strong>Suggested: {suggestion.tier.charAt(0).toUpperCase() + suggestion.tier.slice(1)}</strong>
            {' — '}{suggestion.reason}
          </span>
        </div>
      )}

      {!lead.sqft && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[color:var(--color-warn-text)]">Property sqft (optional):</span>
          <input
            type="number"
            value={sqft}
            onChange={e => setSqft(e.target.value)}
            placeholder="e.g. 1400"
            className="w-24 h-7 px-2 text-[12px] bg-white/60 border border-[color:var(--color-warn)] rounded text-[color:var(--color-warn-text)] focus:outline-none"
          />
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {TIERS.map(t => (
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
              {suggestion?.tier === t.key && (
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
          onClick={apply}
          disabled={!selectedTier}
          className="px-3 py-1.5 text-[12px] font-semibold rounded-md bg-[color:var(--color-warn)] text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {selectedTier ? `Use ${selectedEst}` : 'Select a scope above'}
        </button>
        <button
          onClick={onClose}
          className="text-[11.5px] text-[color:var(--color-warn-text)] underline underline-offset-2 hover:opacity-70"
        >
          Cancel — enter exact cost instead
        </button>
      </div>
    </div>
  )
}
