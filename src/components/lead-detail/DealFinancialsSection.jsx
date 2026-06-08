// src/components/lead-detail/DealFinancialsSection.jsx
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { calcDeal, fmtUSD, fmtPct, dealRatingColor } from '../../lib/dealCalculations'
import Card from '../ui/Card'
import Button from '../ui/Button'
import DealRenovationItems from './DealRenovationItems'
import DealImportModal from './DealImportModal'

// ── tiny helpers ──────────────────────────────────────────────────────────────

const labelCls = 'text-[10px] uppercase tracking-wider font-medium text-[color:var(--color-text-dim)] block mb-0.5'
const inputCls = 'w-full h-8 px-2 text-[12px] rounded bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] border border-[color:var(--color-line)] focus:outline-none focus:border-[color:var(--color-accent)] disabled:opacity-50'

function Field({ label, children }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  )
}

function NumInput({ value, onChange, onBlur, disabled, placeholder }) {
  const [local, setLocal] = useState(value ?? '')
  useEffect(() => { setLocal(value ?? '') }, [value])
  return (
    <input
      type="number"
      value={local}
      onChange={e => { setLocal(e.target.value); onChange?.(e.target.value) }}
      onBlur={e => onBlur?.(e.target.value)}
      disabled={disabled}
      placeholder={placeholder || '0'}
      className={inputCls}
    />
  )
}

function MetricRow({ label, value, highlight }) {
  return (
    <div className={`flex justify-between items-center py-1 border-b border-[color:var(--color-line)] text-[12px] ${highlight ? 'font-semibold' : ''}`}>
      <span className="text-[color:var(--color-text-dim)]">{label}</span>
      <span className={highlight ? 'text-[color:var(--color-text)]' : 'text-[color:var(--color-text-muted)]'}>{value}</span>
    </div>
  )
}

function ScenarioCard({ label, scenario, cls }) {
  if (!scenario) return (
    <div className={`rounded-lg p-3 border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] flex flex-col gap-1 opacity-40`}>
      <div className={`text-[10px] uppercase tracking-wider font-semibold ${cls}`}>{label}</div>
      <div className="text-[11px] text-[color:var(--color-text-dim)]">—</div>
    </div>
  )
  return (
    <div className="rounded-lg p-3 border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] flex flex-col gap-1">
      <div className={`text-[10px] uppercase tracking-wider font-semibold ${cls}`}>{label}</div>
      <div className="text-[14px] font-bold text-[color:var(--color-text)]">{fmtUSD(scenario.sellPrice)}</div>
      <div className="text-[11px] text-[color:var(--color-text-dim)]">Selling costs: {fmtUSD(scenario.sellingCosts)}</div>
      <div className={`text-[13px] font-semibold ${scenario.netProfit >= 0 ? 'text-[color:var(--color-success-text)]' : 'text-[color:var(--color-danger-text)]'}`}>
        {scenario.netProfit >= 0 ? '+' : ''}{fmtUSD(scenario.netProfit)}
      </div>
      <div className="text-[11px] text-[color:var(--color-text-dim)]">ROI: {fmtPct(scenario.roi)}</div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DealFinancialsSection({ lead, canEdit, onUpdated }) {
  const [financials, setFinancials]     = useState(null)
  const [items, setItems]               = useState([])
  const [loading, setLoading]           = useState(true)
  const [creating, setCreating]         = useState(false)
  const [importOpen, setImportOpen]     = useState(false)
  const [collapsed, setCollapsed]       = useState({ assumptions: false, property: false, hml: false, closing: false, holding: false })

  const toggle = (key) => setCollapsed(p => ({ ...p, [key]: !p[key] }))

  const loadFinancials = useCallback(async () => {
    if (!lead?.id) return
    const [{ data: fin }, { data: reno }] = await Promise.all([
      supabase.from('deal_financials').select('*').eq('lead_id', lead.id).maybeSingle(),
      supabase.from('deal_renovation_items').select('*').eq('lead_id', lead.id).order('sort_order'),
    ])
    setFinancials(fin || null)
    setItems(reno || [])
    setLoading(false)
  }, [lead?.id])

  useEffect(() => { loadFinancials() }, [loadFinancials])

  const createRecord = async () => {
    setCreating(true)
    const { data } = await supabase.from('deal_financials').insert({
      lead_id:                 lead.id,
      workspace_id:            lead.workspace_id,
      purchase_price_actual:   lead.offer_price || lead.asking_price || null,
      conservative_sell_price: lead.conservative_arv || null,
      expected_sell_price:     lead.arv || null,
      optimistic_sell_price:   lead.aggressive_arv || null,
    }).select().single()
    setFinancials(data)
    setCreating(false)
  }

  const save = async (changes) => {
    if (!financials) return
    const next = { ...financials, ...changes, updated_at: new Date().toISOString() }
    setFinancials(next) // optimistic
    await supabase.from('deal_financials').update({ ...changes, updated_at: new Date().toISOString() }).eq('id', financials.id)
  }

  const handleBlur = (field) => (value) => {
    const num = value === '' ? null : Number(value)
    save({ [field]: num })
  }

  const handleSelect = (field) => (e) => save({ [field]: e.target.value })

  const handleImportApply = async (parsed) => {
    // Convert string values to numbers where appropriate
    const numFields = ['selling_cost_pct','loan_to_purchase_pct','renovation_lender_amount',
      'purchase_price_actual','hold_months','conservative_sell_price','expected_sell_price',
      'optimistic_sell_price','interest_rate_annual','points_pct','title_lender_insurance',
      'interest_portion','doc_stamps_mortgage','intangible_tax','extension_fee',
      'title_closing_costs','insurance_monthly','utilities_monthly','taxes_monthly',
      'hoa_monthly','misc_holding_monthly']
    const changes = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (numFields.includes(k)) {
        const n = parseFloat(v)
        if (!isNaN(n)) changes[k] = n
      } else {
        changes[k] = v
      }
    }
    if (!financials) {
      await supabase.from('deal_financials').insert({ lead_id: lead.id, workspace_id: lead.workspace_id, ...changes })
    } else {
      await supabase.from('deal_financials').update(changes).eq('id', financials.id)
    }
    loadFinancials()
  }

  const calc = calcDeal(financials, items)

  if (loading) return null

  if (!financials) {
    return (
      <Card title="Project Financials">
        <div className="flex flex-col items-center gap-3 py-4">
          <p className="text-[12px] text-[color:var(--color-text-dim)] text-center">
            Track actual costs, renovation items, and profit scenarios for this deal.
          </p>
          <div className="flex gap-2">
            {canEdit && (
              <Button size="sm" onClick={createRecord} loading={creating}>
                Start Deal Tracking
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
              ↑ Import from CSV
            </Button>
          </div>
        </div>
        <DealImportModal open={importOpen} onClose={() => setImportOpen(false)} onApply={async (parsed) => { await handleImportApply(parsed); }} />
      </Card>
    )
  }

  const f = financials

  const SectionHeader = ({ label, section }) => (
    <button
      onClick={() => toggle(section)}
      className="w-full flex items-center justify-between text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)] py-2 hover:text-[color:var(--color-text)] transition-colors"
    >
      <span>{label}</span>
      <span className="text-[10px]">{collapsed[section] ? '▶' : '▼'}</span>
    </button>
  )

  return (
    <>
      <Card
        title="Project Financials"
        action={canEdit && (
          <button onClick={() => setImportOpen(true)} className="text-[12px] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] transition-colors">
            ↑ Import CSV
          </button>
        )}
      >
        <div className="space-y-4">

          {/* Assumptions & Settings */}
          <div className="border-b border-[color:var(--color-line)]">
            <SectionHeader label="Assumptions & Settings" section="assumptions" />
            {!collapsed.assumptions && (
              <div className="grid grid-cols-2 gap-3 pb-3">
                <Field label="Selling Cost %">
                  <NumInput value={f.selling_cost_pct} onBlur={handleBlur('selling_cost_pct')} disabled={!canEdit} />
                </Field>
                <Field label="Loan to Purchase %">
                  <NumInput value={f.loan_to_purchase_pct} onBlur={handleBlur('loan_to_purchase_pct')} disabled={!canEdit} />
                </Field>
                <Field label="Renovation Financing">
                  <select value={f.renovation_financing || 'Financed'} onChange={handleSelect('renovation_financing')} disabled={!canEdit} className={inputCls}>
                    <option value="Financed">Financed</option>
                    <option value="Cash">Cash</option>
                  </select>
                </Field>
                <Field label="Points Charged On">
                  <select value={f.points_charged_on || 'Full Loan'} onChange={handleSelect('points_charged_on')} disabled={!canEdit} className={inputCls}>
                    <option value="Full Loan">Full Loan</option>
                    <option value="Purchase Only">Purchase Only</option>
                  </select>
                </Field>
              </div>
            )}
          </div>

          {/* Property & Deal Inputs */}
          <div className="border-b border-[color:var(--color-line)]">
            <SectionHeader label="Property & Deal Inputs" section="property" />
            {!collapsed.property && (
              <div className="grid grid-cols-2 gap-3 pb-3">
                <Field label="Purchase Price (Actual)">
                  <NumInput value={f.purchase_price_actual} onBlur={handleBlur('purchase_price_actual')} disabled={!canEdit} />
                </Field>
                <Field label="Hold Time (Months)">
                  <NumInput value={f.hold_months} onBlur={handleBlur('hold_months')} disabled={!canEdit} />
                </Field>
                <Field label="Conservative Sell Price">
                  <NumInput value={f.conservative_sell_price} onBlur={handleBlur('conservative_sell_price')} disabled={!canEdit} />
                </Field>
                <Field label="Expected Sell Price">
                  <NumInput value={f.expected_sell_price} onBlur={handleBlur('expected_sell_price')} disabled={!canEdit} />
                </Field>
                <Field label="Optimistic Sell Price">
                  <NumInput value={f.optimistic_sell_price} onBlur={handleBlur('optimistic_sell_price')} disabled={!canEdit} />
                </Field>
                <Field label="Actual Sale Price">
                  <NumInput value={f.actual_sale_price} onBlur={handleBlur('actual_sale_price')} disabled={!canEdit} placeholder="—" />
                </Field>
                {f.actual_sale_price && (
                  <Field label="Sold Date">
                    <input
                      type="date"
                      defaultValue={f.sold_date || ''}
                      onBlur={e => save({ sold_date: e.target.value || null })}
                      disabled={!canEdit}
                      className={inputCls}
                    />
                  </Field>
                )}
              </div>
            )}
          </div>

          {/* Hard Money Loan */}
          <div className="border-b border-[color:var(--color-line)]">
            <SectionHeader label="Hard Money Loan Inputs" section="hml" />
            {!collapsed.hml && (
              <div className="grid grid-cols-2 gap-3 pb-3">
                <Field label="Renovation Lender Amount">
                  <NumInput value={f.renovation_lender_amount} onBlur={handleBlur('renovation_lender_amount')} disabled={!canEdit} />
                </Field>
                <Field label="Interest Rate (Annual)">
                  <NumInput value={f.interest_rate_annual} onBlur={handleBlur('interest_rate_annual')} disabled={!canEdit} />
                </Field>
                <Field label="Points %">
                  <NumInput value={f.points_pct} onBlur={handleBlur('points_pct')} disabled={!canEdit} />
                </Field>
                <Field label="Title Lender Insurance">
                  <NumInput value={f.title_lender_insurance} onBlur={handleBlur('title_lender_insurance')} disabled={!canEdit} />
                </Field>
                <Field label="Interest Portion (Prepaid)">
                  <NumInput value={f.interest_portion} onBlur={handleBlur('interest_portion')} disabled={!canEdit} />
                </Field>
                <Field label="Doc Stamps Mortgage">
                  <NumInput value={f.doc_stamps_mortgage} onBlur={handleBlur('doc_stamps_mortgage')} disabled={!canEdit} />
                </Field>
                <Field label="Intangible Tax">
                  <NumInput value={f.intangible_tax} onBlur={handleBlur('intangible_tax')} disabled={!canEdit} />
                </Field>
                <Field label="Extension Fee">
                  <NumInput value={f.extension_fee} onBlur={handleBlur('extension_fee')} disabled={!canEdit} />
                </Field>
              </div>
            )}
          </div>

          {/* Purchase Closing Costs */}
          <div className="border-b border-[color:var(--color-line)]">
            <SectionHeader label="Purchase Closing Costs" section="closing" />
            {!collapsed.closing && (
              <div className="grid grid-cols-2 gap-3 pb-3">
                <Field label="Title & Closing Costs">
                  <NumInput value={f.title_closing_costs} onBlur={handleBlur('title_closing_costs')} disabled={!canEdit} />
                </Field>
                <Field label="Other Closing Costs">
                  <NumInput value={f.purchase_closing_costs_other} onBlur={handleBlur('purchase_closing_costs_other')} disabled={!canEdit} />
                </Field>
              </div>
            )}
          </div>

          {/* Holding Costs */}
          <div className="border-b border-[color:var(--color-line)]">
            <SectionHeader label="Holding Costs (Monthly)" section="holding" />
            {!collapsed.holding && (
              <div className="grid grid-cols-2 gap-3 pb-3">
                {[
                  ['Insurance', 'insurance_monthly'],
                  ['Utilities', 'utilities_monthly'],
                  ['Taxes', 'taxes_monthly'],
                  ['HOA', 'hoa_monthly'],
                  ['Miscellaneous', 'misc_holding_monthly'],
                ].map(([label, field]) => (
                  <Field key={field} label={label}>
                    <NumInput value={f[field]} onBlur={handleBlur(field)} disabled={!canEdit} />
                  </Field>
                ))}
              </div>
            )}
          </div>

          {/* Renovation Items */}
          <div className="border-b border-[color:var(--color-line)] pb-3">
            <DealRenovationItems
              leadId={lead.id}
              workspaceId={lead.workspace_id}
              items={items}
              onChanged={loadFinancials}
              canEdit={canEdit}
              onOpenImport={() => setImportOpen(true)}
            />
          </div>

          {/* Deal Summary Dashboard */}
          {calc && (
            <div>
              <div className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)] mb-3">
                Deal Summary Dashboard
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Left: Costs & Metrics */}
                <div className="space-y-0.5">
                  <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1 font-semibold">Core Calculations</div>
                  <MetricRow label="Purchase Loan Amount" value={fmtUSD(calc.purchaseLoan)} />
                  <MetricRow label="Renovation Loan" value={fmtUSD(calc.renovationLoan)} />
                  <MetricRow label="Total Loan" value={fmtUSD(calc.totalLoan)} highlight />
                  <MetricRow label="Points Cost" value={fmtUSD(calc.pointsCost)} />
                  <MetricRow label="Monthly Interest" value={fmtUSD(calc.monthlyInterest)} />
                  <MetricRow label="Total Interest" value={fmtUSD(calc.totalInterest)} />

                  <div className="pt-2 text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1 font-semibold">Costs Summary</div>
                  <MetricRow label="HML Closing Costs" value={fmtUSD(calc.hmlClosingCosts)} />
                  <MetricRow label="Purchase Closing" value={fmtUSD(calc.purchaseClosing)} />
                  <MetricRow label="Holding Costs" value={fmtUSD(calc.totalHoldingCosts)} />
                  <MetricRow label="Renovation Cost" value={fmtUSD(calc.totalRenovationCost)} />
                  <MetricRow label="Total All-In Cost" value={fmtUSD(calc.totalAllInCost)} highlight />
                  <MetricRow label="Total Cash Invested" value={fmtUSD(calc.totalCashInvested)} highlight />
                </div>

                {/* Right: Scenarios */}
                <div className="space-y-2">
                  <ScenarioCard label="Conservative" scenario={calc.conservative} cls="text-[color:var(--color-text-dim)]" />
                  <ScenarioCard label="Expected" scenario={calc.expected} cls="text-[color:var(--color-accent-text)]" />
                  <ScenarioCard label="Optimistic" scenario={calc.optimistic} cls="text-[color:var(--color-success-text)]" />
                  {calc.actual && (
                    <ScenarioCard label="Actual (Sold)" scenario={calc.actual} cls="text-[color:var(--color-warn-text)]" />
                  )}
                </div>
              </div>

              {/* Break-even + Warnings + Rating */}
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="rounded-lg p-3 border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)]">
                  <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Break-Even Price</div>
                  <div className="text-[14px] font-bold text-[color:var(--color-text)]">{fmtUSD(calc.breakEvenPrice)}</div>
                  <div className="text-[10px] text-[color:var(--color-text-dim)] mt-0.5">All-In / ARV: {fmtPct(calc.allInVsARV)}</div>
                </div>

                <div className="rounded-lg p-3 border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)]">
                  <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">⚠ Warnings</div>
                  {calc.warnings.length === 0
                    ? <div className="text-[11px] text-[color:var(--color-success-text)]">✓ No flags</div>
                    : calc.warnings.map((w, i) => <div key={i} className="text-[10px] text-[color:var(--color-warn-text)]">{w}</div>)
                  }
                </div>

                <div className="rounded-lg p-3 border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] flex flex-col items-center justify-center">
                  <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Deal Rating</div>
                  <span className={`text-[13px] font-bold px-2 py-1 rounded ${dealRatingColor(calc.dealRating)}`}>
                    {calc.dealRating}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>

      <DealImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onApply={handleImportApply}
      />
    </>
  )
}
