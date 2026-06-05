import { useEffect, useState } from 'react'
import Card from '../ui/Card'
import CurrencyInput from '../ui/CurrencyInput'
import Button from '../ui/Button'
import { supabase } from '../../lib/supabase'
import { calculateFlipProfit, formatCurrency } from '../../lib/calculations'

// 3 scenario columns. The "realistic" column reads/writes the lead's primary fields.
// Conservative / Aggressive use prefixed columns.
const COLUMNS = [
  { key: 'conservative', label: 'Conservative', tone: 'warn',
    arv: 'conservative_arv',     reno: 'conservative_renovation_cost',
    mao: 'conservative_mao',     offer: 'conservative_offer_price',
    profit: 'conservative_expected_profit' },
  { key: 'realistic', label: 'Realistic', tone: 'accent',
    arv: 'arv',                  reno: 'renovation_cost',
    mao: 'mao',                  offer: 'offer_price',
    profit: null /* derived */ },
  { key: 'aggressive', label: 'Aggressive', tone: 'success',
    arv: 'aggressive_arv',       reno: 'aggressive_renovation_cost',
    mao: 'aggressive_mao',       offer: 'aggressive_offer_price',
    profit: 'aggressive_expected_profit' },
]

const TONE_HEADER = {
  warn:    'text-[color:var(--color-warn-text)]',
  accent:  'text-[color:var(--color-accent-text)]',
  success: 'text-[color:var(--color-success-text)]',
}

const ROWS = [
  { key: 'arv',    label: 'ARV',              type: 'input' },
  { key: 'reno',   label: 'Renovation Cost',  type: 'input' },
  { key: 'offer',  label: 'Purchase Price',   type: 'input' },
  { key: 'profit', label: 'Est. Flip Profit', type: 'derived' },
]

export default function ScenariosFlat({ lead, canEdit, onUpdated }) {
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Pull scenario-relevant fields into local state
  useEffect(() => {
    const initial = {}
    COLUMNS.forEach(col => {
      ROWS.forEach(row => {
        const dbField = col[row.key]
        if (dbField) initial[dbField] = lead[dbField] ?? ''
      })
    })
    setDraft(initial)
    setDirty(false)
  }, [lead])

  // Recompute profit when inputs change
  const updateField = (dbField, value) => {
    setDraft(prev => {
      const next = { ...prev, [dbField]: value }
      COLUMNS.forEach(col => {
        if (col.profit) {
          const profit = calculateFlipProfit(next[col.arv], next[col.offer], next[col.reno] || 0)
          if (profit !== null) next[col.profit] = profit.toFixed(2)
        }
      })
      return next
    })
    setDirty(true)
  }

  const save = async () => {
    setSaving(true)
    const patch = {}
    // Only save Conservative and Aggressive — Realistic is managed by the Financial section
    COLUMNS.filter(c => c.key !== 'realistic').forEach(col => {
      ROWS.forEach(row => {
        const dbField = col[row.key]
        if (dbField) patch[dbField] = draft[dbField] === '' ? null : draft[dbField]
      })
    })
    const { data: updated } = await supabase.from('leads').update(patch).eq('id', lead.id).select().single()
    if (updated) onUpdated?.(updated)
    setSaving(false)
    setDirty(false)
  }

  // Realistic column always reads live from lead prop (not draft)
  const realisticValues = {
    arv:             lead.arv             ?? null,
    renovation_cost: lead.renovation_cost ?? null,
    offer_price:     lead.offer_price     ?? null,
  }
  const realisticProfit = calculateFlipProfit(
    realisticValues.arv,
    realisticValues.offer_price,
    realisticValues.renovation_cost || 0
  )

  return (
    <Card title="Scenarios" action={
      canEdit && dirty && (
        <Button size="sm" onClick={save} loading={saving}>Save changes</Button>
      )
    }>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr>
              <th className="text-left text-[10.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-medium py-2 pr-3" />
              {COLUMNS.map(col => (
                <th key={col.key} className={`text-center text-[11px] uppercase tracking-wider font-semibold py-2 px-2 ${TONE_HEADER[col.tone]} border-b border-[color:var(--color-line)]`}>
                  {col.label}
                  {col.key === 'realistic' && (
                    <div className="text-[9px] font-normal text-[color:var(--color-text-dim)] normal-case tracking-normal mt-0.5">from Financials</div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(row => (
              <tr key={row.key}>
                <td className="text-[11px] text-[color:var(--color-text-muted)] font-medium py-2 pr-3 whitespace-nowrap">
                  {row.label}
                  {row.hint && <span className="block text-[10px] text-[color:var(--color-text-dim)] font-normal mt-0.5">{row.hint}</span>}
                </td>
                {COLUMNS.map(col => {
                  const dbField = col[row.key]
                  const isRealistic = col.key === 'realistic'

                  // Profit row
                  if (row.type === 'derived') {
                    const profitVal = isRealistic ? realisticProfit : draft[dbField]
                    const color = profitVal > 0
                      ? 'text-[color:var(--color-success-text)]'
                      : profitVal < 0
                        ? 'text-[color:var(--color-danger-text)]'
                        : 'text-[color:var(--color-text-dim)]'
                    return (
                      <td key={col.key} className="py-2 px-2">
                        <div className={`text-[14px] font-bold tabular-nums text-center ${color}`}>
                          {formatCurrency(profitVal)}
                        </div>
                      </td>
                    )
                  }

                  // Realistic column — read-only, always from live lead data
                  if (isRealistic) {
                    const liveVal = realisticValues[dbField]
                    return (
                      <td key={col.key} className="py-1.5 px-1.5">
                        <div className="h-8 px-2 flex items-center justify-end rounded bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] text-[13px] text-[color:var(--color-text-muted)] tabular-nums">
                          {liveVal != null ? `$${Number(liveVal).toLocaleString()}` : <span className="text-[color:var(--color-text-dim)] text-[11px]">from Financials</span>}
                        </div>
                      </td>
                    )
                  }

                  // Conservative / Aggressive — editable
                  return (
                    <td key={col.key} className="py-1.5 px-1.5">
                      <CurrencyInput
                        value={draft[dbField] ?? ''}
                        onChange={v => updateField(dbField, v)}
                        disabled={!canEdit}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-[color:var(--color-text-dim)] mt-3 leading-relaxed">
        Est. Flip Profit = ARV − Purchase Price − Renovation Cost
      </p>
    </Card>
  )
}
