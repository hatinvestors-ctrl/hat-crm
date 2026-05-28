import { useEffect, useState } from 'react'
import Card from '../ui/Card'
import CurrencyInput from '../ui/CurrencyInput'
import Button from '../ui/Button'
import { supabase } from '../../lib/supabase'
import { calculateMAO, calculateFlipProfit, formatCurrency } from '../../lib/calculations'

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
  { key: 'mao',    label: 'MAO',              type: 'input', hint: '= 75% × ARV − reno' },
  { key: 'offer',  label: 'Offer Price',      type: 'input' },
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

  // Auto-compute MAO and Profit when inputs change
  const updateField = (dbField, value) => {
    setDraft(prev => {
      const next = { ...prev, [dbField]: value }

      // Recompute MAO for the affected column (MAO = 75% × ARV − Reno)
      COLUMNS.forEach(col => {
        if (col.arv === dbField || col.reno === dbField) {
          const arv  = col.arv  ? next[col.arv]  : null
          const reno = col.reno ? next[col.reno] : null
          const mao = calculateMAO(arv, reno)
          if (mao !== null && col.mao) next[col.mao] = mao.toFixed(2)
        }
      })

      // Recompute Expected Profit (uses offer_price if set, else mao)
      COLUMNS.forEach(col => {
        if (col.profit) {
          const arv = next[col.arv] || null
          const purchase = next[col.offer] || next[col.mao] || null
          const reno = next[col.reno] || 0
          const profit = calculateFlipProfit(arv, purchase, reno)
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
    COLUMNS.forEach(col => {
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

  // Derived realistic profit
  const realisticProfit = (() => {
    const arv = draft['arv']
    const purchase = draft['offer_price'] || draft['mao']
    const reno = draft['renovation_cost'] || 0
    return calculateFlipProfit(arv, purchase, reno)
  })()

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
                  // Derived profit row for realistic uses live calculation
                  if (row.type === 'derived') {
                    if (col.key === 'realistic') {
                      return (
                        <td key={col.key} className="py-2 px-2">
                          <div className="text-[14px] font-bold text-[color:var(--color-success-text)] tabular-nums text-center">
                            {formatCurrency(realisticProfit)}
                          </div>
                        </td>
                      )
                    }
                    return (
                      <td key={col.key} className="py-2 px-2">
                        <div className="text-[14px] font-bold text-[color:var(--color-success-text)] tabular-nums text-center">
                          {formatCurrency(draft[dbField])}
                        </div>
                      </td>
                    )
                  }
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
        MAO = 75% × ARV − Renovation. Est. Flip Profit = (ARV × 93%) − (Offer or MAO) − Renovation.
      </p>
    </Card>
  )
}
