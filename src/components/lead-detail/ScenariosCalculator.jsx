import { useEffect, useState } from 'react'
import Card from '../ui/Card'
import CurrencyInput from '../ui/CurrencyInput'
import Textarea from '../ui/Textarea'
import Button from '../ui/Button'
import { supabase } from '../../lib/supabase'
import { calculateMAO, calculateFlipProfit, formatCurrency } from '../../lib/calculations'
import { DEFAULT_CLOSING_COSTS, DEFAULT_TARGET_PROFIT } from '../../lib/constants'

const SCENARIOS = [
  { type: 'conservative', label: 'Conservative', accent: 'warn'    },
  { type: 'realistic',    label: 'Realistic',    accent: 'accent'  },
  { type: 'aggressive',   label: 'Aggressive',   accent: 'success' },
]

const emptyScenario = (defaults) => ({
  arv: '',
  renovation_cost: '',
  closing_costs: defaults?.default_closing_costs ?? DEFAULT_CLOSING_COSTS,
  target_profit: defaults?.default_target_profit ?? DEFAULT_TARGET_PROFIT,
  mao: '',
  offer_price: '',
  expected_profit: '',
  notes: '',
})

export default function ScenariosCalculator({ leadId, lead, workspaceDefaults, canEdit }) {
  const [active, setActive] = useState('realistic')
  const [scenarios, setScenarios] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!leadId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data } = await supabase.from('lead_scenarios').select('*').eq('lead_id', leadId)
      if (!cancelled) {
        const map = {}
        SCENARIOS.forEach(s => {
          const existing = data?.find(d => d.scenario_type === s.type)
          map[s.type] = existing
            ? { ...emptyScenario(workspaceDefaults), ...existing }
            : emptyScenario(workspaceDefaults)
        })
        if (!data?.find(d => d.scenario_type === 'realistic')) {
          map.realistic = {
            ...emptyScenario(workspaceDefaults),
            arv: lead.arv || '',
            renovation_cost: lead.renovation_cost || '',
            closing_costs: lead.closing_costs ?? map.realistic.closing_costs,
            target_profit: lead.target_profit ?? map.realistic.target_profit,
            mao: lead.mao || '',
            offer_price: lead.offer_price || '',
          }
        }
        setScenarios(map)
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [leadId, workspaceDefaults, lead.arv, lead.renovation_cost, lead.closing_costs, lead.target_profit, lead.mao, lead.offer_price])

  const update = (patch) => {
    setScenarios(prev => {
      const current = { ...prev[active], ...patch }
      if (['arv', 'renovation_cost', 'closing_costs', 'target_profit'].some(k => k in patch)) {
        const mao = calculateMAO(current.arv, current.renovation_cost, current.closing_costs, current.target_profit)
        if (mao !== null) current.mao = mao.toFixed(2)
      }
      if (['arv', 'offer_price', 'renovation_cost', 'closing_costs'].some(k => k in patch) || 'mao' in patch) {
        const purchase = current.offer_price || current.mao
        const profit = calculateFlipProfit(current.arv, purchase, current.renovation_cost, current.closing_costs)
        if (profit !== null) current.expected_profit = profit.toFixed(2)
      }
      return { ...prev, [active]: current }
    })
  }

  const save = async () => {
    setSaving(true)
    const data = scenarios[active]
    await supabase.from('lead_scenarios').upsert({
      lead_id: leadId,
      scenario_type: active,
      arv: data.arv || null,
      renovation_cost: data.renovation_cost || null,
      closing_costs: data.closing_costs || null,
      target_profit: data.target_profit || null,
      mao: data.mao || null,
      offer_price: data.offer_price || null,
      expected_profit: data.expected_profit || null,
      notes: data.notes || null,
    }, { onConflict: 'lead_id,scenario_type' })
    setSaving(false)
  }

  if (loading) {
    return <Card title="Scenarios"><div className="text-[13px] text-[color:var(--color-text-dim)]">Loading…</div></Card>
  }

  const current = scenarios[active] || emptyScenario(workspaceDefaults)

  return (
    <Card title="Scenarios" padding={false}>
      <div className="flex border-b border-[color:var(--color-line)]">
        {SCENARIOS.map(s => (
          <button
            key={s.type}
            onClick={() => setActive(s.type)}
            className={`flex-1 px-4 h-10 text-[12.5px] font-medium border-b-2 transition-colors ${
              active === s.type
                ? 'border-[color:var(--color-accent)] text-[color:var(--color-text)] bg-[color:var(--color-bg-elev-2)]'
                : 'border-transparent text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <CurrencyInput label="ARV" value={current.arv} onChange={v => update({ arv: v })} />
          <CurrencyInput label="Renovation Cost" value={current.renovation_cost} onChange={v => update({ renovation_cost: v })} />
          <CurrencyInput label="Closing Costs" value={current.closing_costs} onChange={v => update({ closing_costs: v })} />
          <CurrencyInput label="Target Profit" value={current.target_profit} onChange={v => update({ target_profit: v })} />
          <CurrencyInput label="MAO" value={current.mao} onChange={v => update({ mao: v })} />
          <CurrencyInput label="Offer Price" value={current.offer_price} onChange={v => update({ offer_price: v })} />
        </div>

        <div className="mt-4 p-3 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">MAO</div>
            <div className="text-[18px] font-bold text-[color:var(--color-accent-text)] tabular-nums leading-tight">
              {formatCurrency(current.mao)}
            </div>
          </div>
          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Expected Profit</div>
            <div className="text-[18px] font-bold text-[color:var(--color-success-text)] tabular-nums leading-tight">
              {formatCurrency(current.expected_profit)}
            </div>
          </div>
        </div>

        <Textarea label="Notes" rows={2} value={current.notes || ''} onChange={e => update({ notes: e.target.value })} containerClassName="mt-3" />

        {canEdit && (
          <div className="flex justify-end mt-3">
            <Button size="sm" onClick={save} loading={saving}>Save scenario</Button>
          </div>
        )}
      </div>
    </Card>
  )
}
