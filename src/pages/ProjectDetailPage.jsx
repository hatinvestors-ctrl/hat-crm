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
                <Field label="Purchase Loan (90% of price)">
                  <div className="h-8 px-2 flex items-center text-[12px] rounded bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] text-[color:var(--color-text-muted)]">
                    {calc ? fmtUSD(calc.purchaseLoan) : '—'}
                  </div>
                </Field>
                <Field label="Renovation Financed % (default 100%)">
                  <NumInput
                    value={financials.renovation_lender_pct != null ? financials.renovation_lender_pct * 100 : 100}
                    onBlur={v => save({ renovation_lender_pct: v === '' ? 1.0 : Number(v) / 100 })}
                    disabled={!canEdit} placeholder="100"
                  />
                </Field>
                <Field label="Renovation Loan (calculated)">
                  <div className="h-8 px-2 flex items-center text-[12px] rounded bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] text-[color:var(--color-text-muted)]">
                    {calc ? fmtUSD(calc.renovationLoan) : '—'}
                  </div>
                </Field>
                <Field label="Total Loan">
                  <div className="h-8 px-2 flex items-center text-[12px] font-semibold rounded bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] text-[color:var(--color-text)]">
                    {calc ? fmtUSD(calc.totalLoan) : '—'}
                  </div>
                </Field>
                <Field label="Interest Rate (Annual %)">
                  <NumInput value={financials.interest_rate_annual != null ? financials.interest_rate_annual * 100 : ''} onBlur={v => save({ interest_rate_annual: v === '' ? null : Number(v) / 100 })} disabled={!canEdit} placeholder="12" />
                </Field>
                <Field label="Points %">
                  <NumInput value={financials.points_pct != null ? financials.points_pct * 100 : ''} onBlur={v => save({ points_pct: v === '' ? null : Number(v) / 100 })} disabled={!canEdit} placeholder="2" />
                </Field>
                <Field label="Monthly Interest Payment">
                  <div className="h-8 px-2 flex items-center text-[12px] font-semibold rounded bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] text-[color:var(--color-accent-text)]">
                    {calc ? fmtUSD(calc.monthlyInterest) : '—'}
                  </div>
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

                  {/* Left: Cost breakdown */}
                  <div>
                    <div className={labelCls + ' mb-2'}>All-In Costs</div>
                    <MetricRow label="Purchase Price"            value={fmtUSD(financials.purchase_price_actual)} />
                    <MetricRow label="Renovation"                value={fmtUSD(calc.totalRenovationCost)} />
                    <MetricRow label="HML Closing Costs"         value={fmtUSD(calc.hmlClosingCosts)} />
                    <MetricRow label="Purchase Closing Costs"    value={fmtUSD(calc.purchaseClosing)} />
                    <MetricRow label={`Holding (${calc.holdMonths}mo interest + expenses)`} value={fmtUSD(calc.totalHoldingCosts)} />
                    <MetricRow label="Total All-In Cost"         value={fmtUSD(calc.totalAllInCost)} highlight />

                    <div className={labelCls + ' mt-4 mb-2'}>Cash You Bring to the Deal</div>
                    <MetricRow label={`Down Payment (${fmtPct(1 - (financials.loan_to_purchase_pct ?? 0.9))})`} value={fmtUSD(calc.downPayment)} />
                    <MetricRow label="Lender Fees at Closing"   value={fmtUSD(calc.hmlClosingCosts)} />
                    <MetricRow label="Title & Closing Fees"     value={fmtUSD(calc.purchaseClosing)} />
                    {calc.renovationGap > 0 && (
                      <MetricRow label="Renovation Gap (lender shortage)" value={fmtUSD(calc.renovationGap)} />
                    )}
                    <MetricRow label="Total Cash Invested"      value={fmtUSD(calc.totalCashInvested)} highlight />
                    <MetricRow label="Break-Even Sale Price"    value={fmtUSD(calc.breakEvenPrice)} />
                  </div>

                  {/* Right: Profit & ROI */}
                  <div>
                    {calc.expected && (
                      <>
                        <div className={labelCls + ' mb-2'}>Expected Profit</div>
                        <MetricRow label="Expected Sale Price"              value={fmtUSD(calc.expected.sellPrice)} />
                        <MetricRow label={`Selling Costs (${fmtPct(calc.sellingCostPct)})`} value={`− ${fmtUSD(calc.expected.sellingCosts)}`} />
                        <MetricRow label="Total All-In Cost"               value={`− ${fmtUSD(calc.totalAllInCost)}`} />
                        <MetricRow
                          label="Net Profit"
                          value={fmtUSD(calc.expected.netProfit)}
                          highlight
                        />
                        <MetricRow
                          label="ROI on Cash Invested"
                          value={fmtPct(calc.expected.roi)}
                          highlight
                        />
                      </>
                    )}

                    {calc.actual && (
                      <>
                        <div className="mt-5 mb-1 text-[10px] uppercase tracking-wider font-semibold text-[color:var(--color-success-text)]">
                          ✓ Actual (Sold)
                        </div>
                        <MetricRow label="Actual Sale Price"               value={fmtUSD(calc.actual.sellPrice)} />
                        <MetricRow label={`Selling Costs (${fmtPct(calc.sellingCostPct)})`} value={`− ${fmtUSD(calc.actual.sellingCosts)}`} />
                        <MetricRow label="Net Profit"                      value={fmtUSD(calc.actual.netProfit)} highlight />
                        <MetricRow label="ROI on Cash Invested"            value={fmtPct(calc.actual.roi)} highlight />
                      </>
                    )}

                    {/* Deal Rating */}
                    {(() => {
                      const ratingKey = calc.dealRating?.charAt(0)
                      const info = DEAL_RATING_INFO[ratingKey]
                      return (
                        <div className="mt-5 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[11px] text-[color:var(--color-text-dim)]">Deal Rating</span>
                            <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-bold ${dealRatingColor(calc.dealRating)}`}>
                              {ratingKey || '—'}
                            </span>
                            <span className="text-[12px] font-semibold text-[color:var(--color-text)]">
                              {info?.label}
                            </span>
                          </div>
                          {info && (
                            <div className="text-[11px] text-[color:var(--color-text-muted)] leading-relaxed">
                              {info.description}
                            </div>
                          )}
                          <div className="mt-2 text-[10px] text-[color:var(--color-text-dim)] space-y-0.5">
                            <div>A: ROI ≥ 70% &amp; profit ≥ $30K</div>
                            <div>B: ROI ≥ 45% &amp; profit ≥ $20K</div>
                            <div>C: ROI ≥ 25%</div>
                            <div>D: ROI below 25%</div>
                          </div>
                        </div>
                      )
                    })()}

                    {/* Warnings */}
                    {calc.warnings?.map((w, i) => (
                      <div key={i} className="mt-2 text-[11px] text-[color:var(--color-warn,oklch(0.55_0.15_80))] flex items-center gap-1">
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
