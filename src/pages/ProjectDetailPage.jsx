import { useState, useEffect, useCallback } from 'react'
import { useParams, useOutletContext, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcDeal, fmtUSD, fmtPct, dealRatingColor, DEAL_RATING_INFO } from '../lib/dealCalculations'
import Topbar from '../components/Topbar'
import Card from '../components/ui/Card'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import DealRenovationItems from '../components/lead-detail/DealRenovationItems'
import DealImportModal from '../components/lead-detail/DealImportModal'

const labelCls = 'text-[10px] uppercase tracking-wider font-medium text-[color:var(--color-text-dim)] block mb-0.5'
const inputCls = 'w-full h-8 px-2 text-[12px] rounded bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] border border-[color:var(--color-line)] focus:outline-none focus:border-[color:var(--color-accent)] disabled:opacity-50'
const calcDisplayCls = 'h-8 px-2 flex items-center text-[12px] rounded bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] text-[color:var(--color-text-muted)]'

function Field({ label, children, tip }) {
  return (
    <div>
      <label className={labelCls}>
        {label}
        {tip && (
          <span title={tip} className="ml-1 cursor-help opacity-50 hover:opacity-100 normal-case tracking-normal font-normal">ⓘ</span>
        )}
      </label>
      {children}
    </div>
  )
}

function NumInput({ value, onBlur, disabled, placeholder, onSaved }) {
  const [local, setLocal] = useState(value ?? '')
  const [saved, setSaved] = useState(false)
  useEffect(() => { setLocal(value ?? '') }, [value])
  const handleBlur = async (e) => {
    await onBlur?.(e.target.value)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }
  return (
    <div className="relative">
      <input
        type="number"
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={handleBlur}
        disabled={disabled}
        placeholder={placeholder || '0'}
        className={inputCls}
      />
      {saved && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[color:var(--color-success-text)] pointer-events-none animate-pulse">✓</span>
      )}
    </div>
  )
}

function MetricRow({ label, value, highlight, positive, negative }) {
  const valueColor = positive
    ? 'text-[color:var(--color-success-text)]'
    : negative
      ? 'text-[color:var(--color-danger-text)]'
      : highlight
        ? 'text-[color:var(--color-text)]'
        : 'text-[color:var(--color-text-muted)]'
  return (
    <div className={`flex justify-between items-center py-1.5 border-b border-[color:var(--color-line)] text-[12px] last:border-0 ${highlight ? 'font-semibold' : ''}`}>
      <span className="text-[color:var(--color-text-dim)]">{label}</span>
      <span className={valueColor}>{value}</span>
    </div>
  )
}

// Hero stat box
function StatBox({ label, value, sub, color }) {
  return (
    <div className="flex-1 min-w-0 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">{label}</div>
      <div className={`text-[18px] font-bold leading-tight ${color || 'text-[color:var(--color-text)]'}`}>{value}</div>
      {sub && <div className="text-[10px] text-[color:var(--color-text-dim)] mt-0.5">{sub}</div>}
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
  const [markSoldOpen, setMarkSoldOpen] = useState(false)
  const [soldPrice, setSoldPrice]   = useState('')
  const [soldDate, setSoldDate]     = useState('')
  const [markingSOld, setMarkingSold] = useState(false)

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

  const reloadItems = useCallback(async () => {
    const { data: reno } = await supabase
      .from('deal_renovation_items').select('*').eq('lead_id', leadId).order('sort_order')
    setItems(reno || [])
  }, [leadId])

  const save = useCallback(async (changes) => {
    if (!financials) return
    setFinancials(prev => ({ ...prev, ...changes, updated_at: new Date().toISOString() }))
    await supabase.from('deal_financials').update({ ...changes, updated_at: new Date().toISOString() }).eq('id', financials.id)
  }, [financials])

  const handleBlur = (field) => (value) => save({ [field]: value === '' ? null : Number(value) })
  const handleSelect = (field) => (e) => save({ [field]: e.target.value })

  const handleApply = async (values) => {
    setFinancials(prev => ({ ...prev, ...values, updated_at: new Date().toISOString() }))
    await supabase.from('deal_financials').update({ ...values, updated_at: new Date().toISOString() }).eq('id', financials.id)
    setImportOpen(false)
  }

  const handleMarkSold = async () => {
    if (!soldPrice) return
    setMarkingSold(true)
    const { data: updatedLead } = await supabase
      .from('leads').update({ status: 'sold' }).eq('id', leadId).select().single()
    await supabase.from('deal_financials').update({
      actual_sale_price: Number(soldPrice),
      sold_date: soldDate || null,
      updated_at: new Date().toISOString(),
    }).eq('id', financials.id)
    setMarkingSold(false)
    setMarkSoldOpen(false)
    if (updatedLead) setLead(updatedLead)
    setFinancials(prev => ({ ...prev, actual_sale_price: Number(soldPrice), sold_date: soldDate || null }))
  }

  if (loading) return <LoadingSpinner fullPage label="Loading project…" />
  if (!lead) return <div className="p-6 text-[color:var(--color-text-muted)]">Project not found.</div>

  const calc = financials ? calcDeal(financials, items) : null
  const isSold = lead.status === 'sold'
  const ratingKey = calc?.dealRating?.charAt(0)
  const ratingInfo = DEAL_RATING_INFO[ratingKey]

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
          <div className="flex items-center gap-2">
            {canEdit && !isSold && financials && (
              <button
                onClick={() => setMarkSoldOpen(true)}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-[12.5px] font-medium rounded-md bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)] hover:brightness-95 transition"
              >
                ✓ Mark as Sold
              </button>
            )}
            <Link
              to={`/w/${workspaceId}/leads/${leadId}`}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-[12.5px] font-medium rounded-md bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] transition"
            >
              View Lead ↗
            </Link>
          </div>
        }
      />

      <div className="px-6 py-4 space-y-4 max-w-[1200px] w-full">

        {/* Status + Mark as Sold dialog */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide ${
            isSold
              ? 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]'
              : 'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]'
          }`}>
            {isSold ? '✓ Sold' : 'Active Project'}
          </span>
        </div>

        {/* Mark as Sold inline dialog */}
        {markSoldOpen && (
          <div className="rounded-lg border border-[color:var(--color-success)] bg-[color:var(--color-success-soft)] p-4 space-y-3">
            <div className="text-[13px] font-semibold text-[color:var(--color-success-text)]">Mark this project as sold</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Actual Sale Price *">
                <input
                  type="number"
                  value={soldPrice}
                  onChange={e => setSoldPrice(e.target.value)}
                  placeholder="Enter sale price"
                  className={inputCls}
                  autoFocus
                />
              </Field>
              <Field label="Sold Date">
                <input
                  type="date"
                  value={soldDate}
                  onChange={e => setSoldDate(e.target.value)}
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleMarkSold}
                disabled={!soldPrice || markingSOld}
                className="h-8 px-4 text-[12.5px] font-medium rounded-md bg-[color:var(--color-success)] text-white hover:brightness-110 disabled:opacity-50 transition"
              >
                {markingSOld ? 'Saving…' : 'Confirm Sale'}
              </button>
              <button
                onClick={() => setMarkSoldOpen(false)}
                className="h-8 px-4 text-[12.5px] rounded-md bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Hero summary strip ── */}
        {calc && (
          <div className="flex gap-3 flex-wrap">
            <StatBox
              label="Purchase Price"
              value={fmtUSD(financials?.purchase_price_actual)}
            />
            <StatBox
              label="Total All-In Cost"
              value={fmtUSD(calc.totalAllInCost)}
            />
            <StatBox
              label="Cash Invested"
              value={fmtUSD(calc.totalCashInvested)}
              sub="at closing"
            />
            {(calc.actual || calc.expected) && (
              <StatBox
                label={calc.actual ? 'Actual Profit' : 'Expected Profit'}
                value={fmtUSD(calc.actual?.netProfit ?? calc.expected?.netProfit)}
                color={(calc.actual?.netProfit ?? calc.expected?.netProfit) >= 0
                  ? 'text-[color:var(--color-success-text)]'
                  : 'text-[color:var(--color-danger-text)]'}
              />
            )}
            {(calc.actual || calc.expected) && (
              <StatBox
                label={calc.actual ? 'Actual ROI' : 'Expected ROI'}
                value={fmtPct(calc.actual?.roi ?? calc.expected?.roi)}
                sub="on cash invested"
                color={(calc.actual?.roi ?? calc.expected?.roi) >= 0
                  ? 'text-[color:var(--color-success-text)]'
                  : 'text-[color:var(--color-danger-text)]'}
              />
            )}
            {calc.dealRating && (
              <div className="flex-1 min-w-0 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Deal Rating</div>
                <div className="flex items-center gap-2">
                  <span className={`text-[20px] font-bold ${dealRatingColor(calc.dealRating)} px-2 py-0.5 rounded`}>
                    {ratingKey}
                  </span>
                  <div>
                    <div className="text-[12px] font-semibold text-[color:var(--color-text)]">{ratingInfo?.label}</div>
                    <div className="text-[10px] text-[color:var(--color-text-dim)]">{ratingInfo?.description}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Warnings */}
        {calc?.warnings?.map((w, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[oklch(0.97_0.04_80)] border border-[oklch(0.85_0.08_80)] text-[12px] text-[oklch(0.45_0.12_80)]">
            ⚠ {w}
          </div>
        ))}

        {/* Property Summary */}
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
            {/* Deal Parameters (formerly Assumptions) */}
            <Card title="Deal Parameters">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Field label="Purchase Price (Actual)">
                  <NumInput value={financials.purchase_price_actual} onBlur={handleBlur('purchase_price_actual')} disabled={!canEdit} />
                </Field>
                <Field label="Hold Months">
                  <NumInput value={financials.hold_months} onBlur={handleBlur('hold_months')} disabled={!canEdit} placeholder="5" />
                </Field>
                <Field label="Loan-to-Purchase % (LTV)">
                  <NumInput
                    value={financials.loan_to_purchase_pct != null ? financials.loan_to_purchase_pct * 100 : ''}
                    onBlur={v => save({ loan_to_purchase_pct: v === '' ? null : Number(v) / 100 })}
                    disabled={!canEdit} placeholder="90"
                  />
                </Field>
                <Field label="Renovation Financing">
                  <select value={financials.renovation_financing || 'Financed'} onChange={handleSelect('renovation_financing')} disabled={!canEdit} className={inputCls}>
                    <option value="Financed">Financed by lender</option>
                    <option value="Cash">Paid in cash</option>
                  </select>
                </Field>
                <Field label="Points Charged On">
                  <select value={financials.points_charged_on || 'Full Loan'} onChange={handleSelect('points_charged_on')} disabled={!canEdit} className={inputCls}>
                    <option value="Full Loan">Full Loan (purchase + reno)</option>
                    <option value="Purchase Only">Purchase Only</option>
                  </select>
                </Field>
                <Field label="Selling Cost % (agent + fees)">
                  <NumInput
                    value={financials.selling_cost_pct != null ? financials.selling_cost_pct * 100 : 7}
                    onBlur={v => save({ selling_cost_pct: v === '' ? 0.07 : Number(v) / 100 })}
                    disabled={!canEdit} placeholder="7"
                  />
                </Field>
              </div>
            </Card>

            {/* Hard Money Loan */}
            <Card title="Hard Money Loan">
              {/* Loan structure — calculated display */}
              <div className="mb-4">
                <div className={labelCls + ' mb-2'}>Loan Structure</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Field label="Purchase Loan (auto)">
                    <div className={calcDisplayCls}>{calc ? fmtUSD(calc.purchaseLoan) : '—'}</div>
                  </Field>
                  <Field label="Renovation Financed %">
                    <NumInput
                      value={financials.renovation_lender_pct != null ? financials.renovation_lender_pct * 100 : 100}
                      onBlur={v => save({ renovation_lender_pct: v === '' ? 1.0 : Number(v) / 100 })}
                      disabled={!canEdit} placeholder="100"
                    />
                  </Field>
                  <Field label="Renovation Loan (auto)">
                    <div className={calcDisplayCls}>{calc ? fmtUSD(calc.renovationLoan) : '—'}</div>
                  </Field>
                  <Field label="Total Loan (auto)">
                    <div className={`${calcDisplayCls} font-semibold text-[color:var(--color-text)]`}>{calc ? fmtUSD(calc.totalLoan) : '—'}</div>
                  </Field>
                  <Field label="Interest Rate (Annual %)">
                    <NumInput value={financials.interest_rate_annual != null ? financials.interest_rate_annual * 100 : ''} onBlur={v => save({ interest_rate_annual: v === '' ? null : Number(v) / 100 })} disabled={!canEdit} placeholder="12" />
                  </Field>
                  <Field label="Monthly Interest Payment (auto)">
                    <div className={`${calcDisplayCls} font-semibold text-[color:var(--color-accent-text)]`}>{calc ? fmtUSD(calc.monthlyInterest) : '—'}</div>
                  </Field>
                </div>
              </div>

              {/* Loan fees at closing */}
              <div className="border-t border-[color:var(--color-line)] pt-4">
                <div className={labelCls + ' mb-2'}>Loan Fees at Closing</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Field label="Points %" tip="Lender origination fee as % of loan amount">
                    <NumInput value={financials.points_pct != null ? financials.points_pct * 100 : ''} onBlur={v => save({ points_pct: v === '' ? null : Number(v) / 100 })} disabled={!canEdit} placeholder="2" />
                  </Field>
                  <Field label="Title Lender Insurance" tip="Title insurance paid to protect the lender's interest">
                    <NumInput value={financials.title_lender_insurance} onBlur={handleBlur('title_lender_insurance')} disabled={!canEdit} />
                  </Field>
                  <Field label="Interest Portion" tip="Pre-paid interest for the partial first month of the loan">
                    <NumInput value={financials.interest_portion} onBlur={handleBlur('interest_portion')} disabled={!canEdit} />
                  </Field>
                  <Field label="Doc Stamps (Mortgage)" tip="Florida tax on the mortgage note — calculated as 0.35% of loan amount">
                    <NumInput value={financials.doc_stamps_mortgage} onBlur={handleBlur('doc_stamps_mortgage')} disabled={!canEdit} />
                  </Field>
                  <Field label="Intangible Tax" tip="Florida tax on new mortgages — 0.2% of loan amount">
                    <NumInput value={financials.intangible_tax} onBlur={handleBlur('intangible_tax')} disabled={!canEdit} />
                  </Field>
                  <Field label="Extension Fee" tip="Fee charged by lender if you need to extend the loan term">
                    <NumInput value={financials.extension_fee} onBlur={handleBlur('extension_fee')} disabled={!canEdit} />
                  </Field>
                </div>
              </div>
            </Card>

            {/* Purchase Closing Costs */}
            <Card title="Purchase Closing Costs">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Title & Closing Costs" tip="Title search, title insurance (owner's), attorney, recording fees">
                  <NumInput value={financials.title_closing_costs} onBlur={handleBlur('title_closing_costs')} disabled={!canEdit} />
                </Field>
                <Field label="Other">
                  <NumInput value={financials.purchase_closing_costs_other} onBlur={handleBlur('purchase_closing_costs_other')} disabled={!canEdit} />
                </Field>
              </div>
            </Card>

            {/* Holding Costs */}
            <Card title="Holding Costs (Monthly)">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Field label="Insurance">
                  <NumInput value={financials.insurance_monthly} onBlur={handleBlur('insurance_monthly')} disabled={!canEdit} />
                </Field>
                <Field label="Utilities">
                  <NumInput value={financials.utilities_monthly} onBlur={handleBlur('utilities_monthly')} disabled={!canEdit} />
                </Field>
                <Field label="Property Taxes">
                  <NumInput value={financials.taxes_monthly} onBlur={handleBlur('taxes_monthly')} disabled={!canEdit} />
                </Field>
                <Field label="HOA">
                  <NumInput value={financials.hoa_monthly} onBlur={handleBlur('hoa_monthly')} disabled={!canEdit} />
                </Field>
                <Field label="Misc">
                  <NumInput value={financials.misc_holding_monthly} onBlur={handleBlur('misc_holding_monthly')} disabled={!canEdit} />
                </Field>
                {calc && (
                  <Field label="Total Holding (auto)">
                    <div className={calcDisplayCls}>{fmtUSD(calc.totalHoldingCosts)} <span className="ml-1 text-[10px]">({calc.holdMonths}mo)</span></div>
                  </Field>
                )}
              </div>
            </Card>

            {/* Renovation Items — wrapped in Card */}
            <Card title="Renovation Items">
              <div className="flex justify-end mb-3">
                {canEdit && (
                  <button
                    onClick={() => setImportOpen(true)}
                    className="inline-flex items-center gap-1.5 h-7 px-3 text-[11.5px] font-medium rounded-md border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] hover:bg-[color:var(--color-bg-elev)] transition"
                  >
                    ↑ Import CSV
                  </button>
                )}
              </div>
              <DealRenovationItems
                leadId={leadId}
                workspaceId={workspaceId}
                canEdit={canEdit}
                items={items}
                onChanged={reloadItems}
                onOpenImport={() => setImportOpen(true)}
              />
            </Card>

            {/* Selling Price & Profit */}
            <Card title="Selling Price & Profit">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <Field label="Expected Sale Price">
                    <NumInput value={financials.expected_sell_price} onBlur={handleBlur('expected_sell_price')} disabled={!canEdit} />
                  </Field>
                  {isSold && (
                    <>
                      <Field label="Actual Sale Price">
                        <NumInput value={financials.actual_sale_price} onBlur={handleBlur('actual_sale_price')} disabled={!canEdit} />
                      </Field>
                      <Field label="Sold Date">
                        <input type="date" defaultValue={financials.sold_date || ''} onBlur={e => save({ sold_date: e.target.value || null })} disabled={!canEdit} className={inputCls} />
                      </Field>
                    </>
                  )}
                </div>
                <div>
                  {calc?.expected ? (
                    <>
                      <div className={labelCls + ' mb-2'}>Expected Profit</div>
                      <MetricRow label="Sale Price"                                          value={fmtUSD(calc.expected.sellPrice)} />
                      <MetricRow label={`− Selling Costs (${fmtPct(calc.sellingCostPct)})`} value={`− ${fmtUSD(calc.expected.sellingCosts)}`} />
                      <MetricRow label="− Total All-In Cost"                                 value={`− ${fmtUSD(calc.totalAllInCost)}`} />
                      <MetricRow label="Net Profit"     value={fmtUSD(calc.expected.netProfit)}  highlight positive={calc.expected.netProfit >= 0} negative={calc.expected.netProfit < 0} />
                      <MetricRow label="ROI on Cash"    value={fmtPct(calc.expected.roi)}        highlight positive={calc.expected.roi >= 0} negative={calc.expected.roi < 0} />
                    </>
                  ) : (
                    <div className="text-[12px] text-[color:var(--color-text-dim)] py-6 text-center">
                      Enter an expected sale price to see profit.
                    </div>
                  )}
                  {calc?.actual && (
                    <div className="mt-5">
                      <div className="text-[10px] uppercase tracking-wider font-semibold text-[color:var(--color-success-text)] mb-2">✓ Actual Result</div>
                      <MetricRow label="Sale Price"                                          value={fmtUSD(calc.actual.sellPrice)} />
                      <MetricRow label={`− Selling Costs (${fmtPct(calc.sellingCostPct)})`} value={`− ${fmtUSD(calc.actual.sellingCosts)}`} />
                      <MetricRow label="− Total All-In Cost"                                 value={`− ${fmtUSD(calc.totalAllInCost)}`} />
                      <MetricRow label="Net Profit"  value={fmtUSD(calc.actual.netProfit)}  highlight positive={calc.actual.netProfit >= 0} negative={calc.actual.netProfit < 0} />
                      <MetricRow label="ROI on Cash" value={fmtPct(calc.actual.roi)}        highlight positive={calc.actual.roi >= 0} negative={calc.actual.roi < 0} />
                    </div>
                  )}
                </div>
              </div>
            </Card>

            {/* Deal Summary */}
            <Card title="Deal Summary">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className={labelCls + ' mb-2'}>All-In Cost Breakdown</div>
                  <MetricRow label="Purchase Price"                                        value={fmtUSD(financials.purchase_price_actual)} />
                  <MetricRow label="Renovation"                                            value={fmtUSD(calc.totalRenovationCost)} />
                  <MetricRow label="HML Closing Fees"                                      value={fmtUSD(calc.hmlClosingCosts)} />
                  <MetricRow label="Purchase Closing Costs"                                value={fmtUSD(calc.purchaseClosing)} />
                  <MetricRow label={`Holding Costs (${calc.holdMonths}mo)`}                value={fmtUSD(calc.totalHoldingCosts)} />
                  <MetricRow label="Total All-In Cost"                                     value={fmtUSD(calc.totalAllInCost)} highlight />
                  <MetricRow label="Break-Even Sale Price"                                 value={fmtUSD(calc.breakEvenPrice)} />

                  <div className={labelCls + ' mt-4 mb-2'}>Cash You Bring to the Table</div>
                  <MetricRow label={`Down Payment (${fmtPct(1 - (financials.loan_to_purchase_pct ?? 0.9))})`} value={fmtUSD(calc.downPayment)} />
                  <MetricRow label="HML Fees at Closing"                                   value={fmtUSD(calc.hmlClosingCosts)} />
                  <MetricRow label="Title & Closing Fees"                                  value={fmtUSD(calc.purchaseClosing)} />
                  {calc.renovationGap > 0 && (
                    <MetricRow label="Renovation Gap (your cash)"                          value={fmtUSD(calc.renovationGap)} />
                  )}
                  <MetricRow label="Total Cash Invested"                                   value={fmtUSD(calc.totalCashInvested)} highlight />
                </div>

                <div>
                  {/* Deal Rating */}
                  <div className={labelCls + ' mb-2'}>Deal Rating</div>
                  <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-3 mb-4">
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`text-[22px] font-bold px-2.5 py-0.5 rounded ${dealRatingColor(calc.dealRating)}`}>
                        {ratingKey || '—'}
                      </span>
                      <div>
                        <div className="text-[13px] font-semibold text-[color:var(--color-text)]">{ratingInfo?.label}</div>
                        <div className="text-[11px] text-[color:var(--color-text-muted)]">{ratingInfo?.description}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-[color:var(--color-text-dim)] border-t border-[color:var(--color-line)] pt-2">
                      <div><span className="font-semibold">A:</span> ROI ≥ 70% &amp; profit ≥ $30K</div>
                      <div><span className="font-semibold">B:</span> ROI ≥ 45% &amp; profit ≥ $20K</div>
                      <div><span className="font-semibold">C:</span> ROI ≥ 25%</div>
                      <div><span className="font-semibold">D:</span> ROI below 25%</div>
                    </div>
                  </div>

                  {/* Loan summary */}
                  <div className={labelCls + ' mb-2'}>Loan Summary</div>
                  <MetricRow label="Purchase Loan"       value={fmtUSD(calc.purchaseLoan)} />
                  <MetricRow label="Renovation Loan"     value={fmtUSD(calc.renovationLoan)} />
                  <MetricRow label="Total Loan"          value={fmtUSD(calc.totalLoan)} highlight />
                  <MetricRow label="Monthly Interest"    value={fmtUSD(calc.monthlyInterest)} />
                  <MetricRow label="Total Interest Paid" value={fmtUSD(calc.totalInterest)} />
                </div>
              </div>
            </Card>
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
