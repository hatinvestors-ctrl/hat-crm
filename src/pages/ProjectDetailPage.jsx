import { useState, useEffect, useCallback } from 'react'
import { useParams, useOutletContext, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcDeal, fmtUSD, fmtPct, dealRatingColor } from '../lib/dealCalculations'
import Topbar from '../components/Topbar'
import Card from '../components/ui/Card'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import DealRenovationItems from '../components/lead-detail/DealRenovationItems'
import DealImportModal from '../components/lead-detail/DealImportModal'

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

function NumInput({ value, onBlur, disabled, placeholder }) {
  const [local, setLocal] = useState(value ?? '')
  useEffect(() => { setLocal(value ?? '') }, [value])
  return (
    <input
      type="number"
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={e => onBlur?.(e.target.value)}
      disabled={disabled}
      placeholder={placeholder || '0'}
      className={inputCls}
    />
  )
}

function MetricRow({ label, value, highlight }) {
  return (
    <div className={`flex justify-between items-center py-1.5 border-b border-[color:var(--color-line)] text-[12px] last:border-0 ${highlight ? 'font-semibold' : ''}`}>
      <span className="text-[color:var(--color-text-dim)]">{label}</span>
      <span className={highlight ? 'text-[color:var(--color-text)]' : 'text-[color:var(--color-text-muted)]'}>{value}</span>
    </div>
  )
}

export default function ProjectDetailPage() {
  const { leadId } = useParams()
  const { workspace, workspaceId, userRole } = useOutletContext()
  const canEdit = userRole !== 'readonly'

  const [lead, setLead]             = useState(null)
  const [financials, setFinancials] = useState(null)
  const [items, setItems]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [importOpen, setImportOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: l }, { data: fin }, { data: reno }] = await Promise.all([
      supabase.from('leads').select('*').eq('id', leadId).single(),
      supabase.from('deal_financials').select('*').eq('lead_id', leadId).maybeSingle(),
      supabase.from('deal_renovation_items').select('*').eq('lead_id', leadId).order('sort_order'),
    ])
    setLead(l || null)
    setFinancials(fin || null)
    setItems(reno || [])
    setLoading(false)
  }, [leadId])

  useEffect(() => { load() }, [load])

  const save = useCallback(async (changes) => {
    if (!financials) return
    const next = { ...financials, ...changes, updated_at: new Date().toISOString() }
    setFinancials(next)
    await supabase.from('deal_financials').update({ ...changes, updated_at: new Date().toISOString() }).eq('id', financials.id)
  }, [financials])

  const handleBlur = (field) => (value) => save({ [field]: value === '' ? null : Number(value) })
  const handleSelect = (field) => (e) => save({ [field]: e.target.value })

  const handleApply = async (values) => {
    const next = { ...financials, ...values, updated_at: new Date().toISOString() }
    setFinancials(next)
    await supabase.from('deal_financials').update({ ...values, updated_at: new Date().toISOString() }).eq('id', financials.id)
    setImportOpen(false)
  }

  if (loading) return <LoadingSpinner fullPage label="Loading project…" />
  if (!lead) return <div className="p-6 text-[color:var(--color-text-muted)]">Project not found.</div>

  const calc = financials ? calcDeal(financials, items) : null

  return (
    <>
      <Topbar
        title={lead.address || 'Project'}
        breadcrumbs={[
          { label: workspace?.name, to: `/w/${workspaceId}` },
          { label: 'Projects', to: `/w/${workspaceId}/projects` },
          { label: lead.address || 'Project' },
        ]}
        actions={
          <Link
            to={`/w/${workspaceId}/leads/${leadId}`}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-[12.5px] font-medium rounded-md bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] transition"
          >
            View Lead ↗
          </Link>
        }
      />

      <div className="px-6 py-4 space-y-4 max-w-[1200px] w-full">

        <div className="flex items-center gap-3">
          <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide ${
            lead.status === 'sold'
              ? 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]'
              : 'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]'
          }`}>
            {lead.status === 'sold' ? 'Sold' : 'Active Project'}
          </span>
          {financials && canEdit && (
            <button
              onClick={() => setImportOpen(true)}
              className="text-[11px] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] underline"
            >
              Import from CSV
            </button>
          )}
        </div>

        <Card title="Property Summary">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Address',        value: [lead.address, lead.city, lead.state].filter(Boolean).join(', ') || '—' },
              { label: 'Beds / Baths',   value: [lead.bedrooms && `${lead.bedrooms} bd`, lead.bathrooms && `${lead.bathrooms} ba`].filter(Boolean).join(' / ') || '—' },
              { label: 'Sqft',           value: lead.square_feet ? Number(lead.square_feet).toLocaleString() : '—' },
              { label: 'Year Built',     value: lead.year_built || '—' },
              { label: 'Purchase Price', value: fmtUSD(lead.offer_price || lead.asking_price) },
              { label: 'ARV',            value: fmtUSD(lead.arv) },
              { label: 'Listing Agent',  value: lead.listing_agent_name || '—' },
              { label: 'Agent Phone',    value: lead.listing_agent_phone || '—' },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className={labelCls}>{label}</div>
                <div className="text-[12px] text-[color:var(--color-text)]">{value}</div>
              </div>
            ))}
          </div>
        </Card>

        {!financials ? (
          <Card>
            <div className="py-8 text-center text-[13px] text-[color:var(--color-text-muted)]">
              No financial data found for this project.
            </div>
          </Card>
        ) : (
          <>
            <Card title="Assumptions">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field label="Selling Cost %">
                  <NumInput value={financials.selling_cost_pct != null ? financials.selling_cost_pct * 100 : ''} onBlur={v => save({ selling_cost_pct: v === '' ? null : Number(v) / 100 })} disabled={!canEdit} placeholder="7" />
                </Field>
                <Field label="Loan-to-Purchase %">
                  <NumInput value={financials.loan_to_purchase_pct != null ? financials.loan_to_purchase_pct * 100 : ''} onBlur={v => save({ loan_to_purchase_pct: v === '' ? null : Number(v) / 100 })} disabled={!canEdit} placeholder="90" />
                </Field>
                <Field label="Renovation Financing">
                  <select value={financials.renovation_financing || 'Financed'} onChange={handleSelect('renovation_financing')} disabled={!canEdit} className={inputCls}>
                    <option value="Financed">Financed</option>
                    <option value="Cash">Cash</option>
                  </select>
                </Field>
                <Field label="Points Charged On">
                  <select value={financials.points_charged_on || 'Full Loan'} onChange={handleSelect('points_charged_on')} disabled={!canEdit} className={inputCls}>
                    <option value="Full Loan">Full Loan</option>
                    <option value="Purchase Only">Purchase Only</option>
                  </select>
                </Field>
              </div>
            </Card>

            <Card title="Deal Inputs">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Field label="Purchase Price (Actual)">
                  <NumInput value={financials.purchase_price_actual} onBlur={handleBlur('purchase_price_actual')} disabled={!canEdit} />
                </Field>
                <Field label="Hold Months">
                  <NumInput value={financials.hold_months} onBlur={handleBlur('hold_months')} disabled={!canEdit} placeholder="5" />
                </Field>
                <Field label="Expected Sale Price">
                  <NumInput value={financials.expected_sell_price} onBlur={handleBlur('expected_sell_price')} disabled={!canEdit} />
                </Field>
                <Field label="Actual Sale Price">
                  <NumInput value={financials.actual_sale_price} onBlur={handleBlur('actual_sale_price')} disabled={!canEdit} />
                </Field>
                <Field label="Sold Date">
                  <input type="date" defaultValue={financials.sold_date || ''} onBlur={e => save({ sold_date: e.target.value || null })} disabled={!canEdit} className={inputCls} />
                </Field>
              </div>
            </Card>

            <Card title="Hard Money Loan">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field label="Lender Amount">
                  <NumInput value={financials.renovation_lender_amount} onBlur={handleBlur('renovation_lender_amount')} disabled={!canEdit} />
                </Field>
                <Field label="Interest Rate (Annual %)">
                  <NumInput value={financials.interest_rate_annual != null ? financials.interest_rate_annual * 100 : ''} onBlur={v => save({ interest_rate_annual: v === '' ? null : Number(v) / 100 })} disabled={!canEdit} placeholder="12" />
                </Field>
                <Field label="Points %">
                  <NumInput value={financials.points_pct != null ? financials.points_pct * 100 : ''} onBlur={v => save({ points_pct: v === '' ? null : Number(v) / 100 })} disabled={!canEdit} placeholder="2" />
                </Field>
                <Field label="Title Lender Insurance">
                  <NumInput value={financials.title_lender_insurance} onBlur={handleBlur('title_lender_insurance')} disabled={!canEdit} />
                </Field>
                <Field label="Interest Portion">
                  <NumInput value={financials.interest_portion} onBlur={handleBlur('interest_portion')} disabled={!canEdit} />
                </Field>
                <Field label="Doc Stamps (Mortgage)">
                  <NumInput value={financials.doc_stamps_mortgage} onBlur={handleBlur('doc_stamps_mortgage')} disabled={!canEdit} />
                </Field>
                <Field label="Intangible Tax">
                  <NumInput value={financials.intangible_tax} onBlur={handleBlur('intangible_tax')} disabled={!canEdit} />
                </Field>
                <Field label="Extension Fee">
                  <NumInput value={financials.extension_fee} onBlur={handleBlur('extension_fee')} disabled={!canEdit} />
                </Field>
              </div>
            </Card>

            <Card title="Purchase Closing Costs">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Title & Closing Costs">
                  <NumInput value={financials.title_closing_costs} onBlur={handleBlur('title_closing_costs')} disabled={!canEdit} />
                </Field>
                <Field label="Other">
                  <NumInput value={financials.purchase_closing_costs_other} onBlur={handleBlur('purchase_closing_costs_other')} disabled={!canEdit} />
                </Field>
              </div>
            </Card>

            <Card title="Holding Costs (Monthly)">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Field label="Insurance">
                  <NumInput value={financials.insurance_monthly} onBlur={handleBlur('insurance_monthly')} disabled={!canEdit} />
                </Field>
                <Field label="Utilities">
                  <NumInput value={financials.utilities_monthly} onBlur={handleBlur('utilities_monthly')} disabled={!canEdit} />
                </Field>
                <Field label="Taxes">
                  <NumInput value={financials.taxes_monthly} onBlur={handleBlur('taxes_monthly')} disabled={!canEdit} />
                </Field>
                <Field label="HOA">
                  <NumInput value={financials.hoa_monthly} onBlur={handleBlur('hoa_monthly')} disabled={!canEdit} />
                </Field>
                <Field label="Misc">
                  <NumInput value={financials.misc_holding_monthly} onBlur={handleBlur('misc_holding_monthly')} disabled={!canEdit} />
                </Field>
              </div>
            </Card>

            <DealRenovationItems
              leadId={leadId}
              workspaceId={workspaceId}
              canEdit={canEdit}
              items={items}
              onChanged={load}
              onOpenImport={() => setImportOpen(true)}
            />

            {calc && (
              <Card title="Deal Summary">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <div className={labelCls + ' mb-2'}>Costs</div>
                    <MetricRow label="Purchase Price"       value={fmtUSD(financials.purchase_price_actual)} />
                    <MetricRow label="HML Closing Costs"   value={fmtUSD(calc.hmlClosingCosts)} />
                    <MetricRow label="Purchase Closing"    value={fmtUSD(calc.purchaseClosing)} />
                    <MetricRow label="Renovation"          value={fmtUSD(calc.totalRenovationCost)} />
                    <MetricRow label="Holding Costs"       value={fmtUSD(calc.totalHoldingCosts)} />
                    <MetricRow label="Total All-In Cost"   value={fmtUSD(calc.totalAllInCost)} highlight />
                    <MetricRow label="Total Cash Invested" value={fmtUSD(calc.totalCashInvested)} highlight />
                    <MetricRow label="Break-Even Price"    value={fmtUSD(calc.breakEvenPrice)} />
                  </div>
                  <div>
                    <div className={labelCls + ' mb-2'}>Profit</div>
                    {calc.expected && (
                      <>
                        <MetricRow label="Expected Sale Price" value={fmtUSD(calc.expected.sellPrice)} />
                        <MetricRow label="Selling Costs"       value={fmtUSD(calc.expected.sellingCosts)} />
                        <MetricRow label="Expected Net Profit" value={fmtUSD(calc.expected.netProfit)} highlight />
                        <MetricRow label="Expected ROI"        value={fmtPct(calc.expected.roi)} highlight />
                      </>
                    )}
                    {calc.actual && (
                      <>
                        <div className="mt-3 mb-1 text-[10px] uppercase tracking-wider font-medium text-[color:var(--color-success-text)]">Actual (Sold)</div>
                        <MetricRow label="Actual Sale Price" value={fmtUSD(calc.actual.sellPrice)} />
                        <MetricRow label="Actual Net Profit" value={fmtUSD(calc.actual.netProfit)} highlight />
                        <MetricRow label="Actual ROI"        value={fmtPct(calc.actual.roi)} highlight />
                      </>
                    )}
                    <div className="mt-4 flex items-center gap-2">
                      <span className="text-[11px] text-[color:var(--color-text-dim)]">Deal Rating</span>
                      <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${dealRatingColor(calc.dealRating)}`}>
                        {calc.dealRating?.split(' - ')[0] || '—'}
                      </span>
                    </div>
                    {calc.warnings?.map((w, i) => (
                      <div key={i} className="mt-2 text-[11px] text-[color:var(--color-warn)] flex items-center gap-1">
                        ⚠ {w}
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            )}
          </>
        )}
      </div>

      {financials && (
        <DealImportModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onApply={handleApply}
        />
      )}
    </>
  )
}
