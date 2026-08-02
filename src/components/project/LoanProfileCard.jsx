// Extended HML Loan Profile card — lender details, fees, maturity countdown
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtUSD } from '../../lib/dealCalculations'

const inputCls = 'px-2 py-1 text-[12px] rounded bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] border border-[color:var(--color-line)] focus:outline-none focus:border-[color:var(--color-accent)] w-full'
const labelCls = 'text-[10px] text-[color:var(--color-text-dim)] uppercase tracking-wider mb-0.5 block'

const LOAN_STATUSES = [
  { value: 'active',     label: 'Active',      cls: 'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]' },
  { value: 'extended',   label: 'Extended',    cls: 'bg-[color:var(--color-warn-soft,#fef3c7)] text-[color:var(--color-warn-text,#92400e)]' },
  { value: 'paid_off',   label: 'Paid Off',    cls: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]' },
  { value: 'in_default', label: 'In Default',  cls: 'bg-[color:var(--color-danger-soft,#fee2e2)] text-[color:var(--color-danger-text)]' },
  { value: 'closed',     label: 'Closed',      cls: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]' },
]

const LOAN_TYPES = ['hard_money','bridge','private','seller','refi']
const LOAN_TYPE_LABELS = { hard_money: 'Hard Money', bridge: 'Bridge', private: 'Private', seller: 'Seller Finance', refi: 'Refinance' }

function daysUntil(dateStr) {
  if (!dateStr) return null
  const diff = Math.round((new Date(dateStr) - new Date()) / 86400000)
  return diff
}

function MaturityBadge({ maturityDate, extendedDate }) {
  const activeDate = extendedDate || maturityDate
  if (!activeDate) return null
  const days = daysUntil(activeDate)
  const label = days < 0 ? `${Math.abs(days)}d PAST DUE` : `${days}d left`
  const cls = days < 0 ? 'text-[color:var(--color-danger-text)] bg-[color:var(--color-danger-soft,#fee2e2)]'
    : days <= 30 ? 'text-[color:var(--color-danger-text)] bg-[color:var(--color-danger-soft,#fee2e2)]'
    : days <= 60 ? 'text-[color:var(--color-warn-text,#92400e)] bg-[color:var(--color-warn-soft,#fef3c7)]'
    : 'text-[color:var(--color-success-text)] bg-[color:var(--color-success-soft)]'
  return (
    <span className={`ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls}`}>{label}</span>
  )
}

export default function LoanProfileCard({ loan, onLoanChanged, leadId, workspaceId, financials, calc, lead }) {
  const [open, setOpen]     = useState(true)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)

  const statusMeta = LOAN_STATUSES.find(s => s.value === (loan?.loan_status || 'active')) || LOAN_STATUSES[0]

  const patch = async (changes) => {
    if (!loan) return
    setSaving(true)
    await supabase.from('project_loans').update({ ...changes, updated_at: new Date().toISOString() }).eq('id', loan.id)
    setSaving(false)
    onLoanChanged()
  }

  const createLoan = async () => {
    setCreating(true)
    // Pull from calc (pre-computed deal values) when available, fall back to raw financials
    const purchaseLoan  = calc?.purchaseLoan   ?? (financials?.purchase_loan_amount ?? null)
    const rehabEscrow   = calc?.renovationLoan ?? (financials?.renovation_lender_amount ?? null)
    const totalLoan     = calc?.totalLoan      ?? ((purchaseLoan || 0) + (rehabEscrow || 0))
    const originFee     = calc?.pointsCost     ?? null  // points × total loan in $
    const holdMonths    = financials?.hold_months ?? 12
    const startDate     = financials?.purchase_date ?? null
    // Compute maturity date from start + hold months
    let maturityDate = null
    if (startDate && holdMonths) {
      const d = new Date(startDate)
      d.setMonth(d.getMonth() + holdMonths)
      maturityDate = d.toISOString().split('T')[0]
    }
    // Borrower cash at close ≈ down payment + HML closing costs
    const cashAtClose = calc?.downPayment != null && calc?.hmlClosingCosts != null
      ? calc.downPayment + calc.hmlClosingCosts
      : null

    const { error } = await supabase.from('project_loans').insert({
      lead_id:               leadId,
      workspace_id:          workspaceId,
      loan_label:            'Primary HML',
      loan_status:           'active',
      loan_type:             'hard_money',
      purchase_loan_amount:  purchaseLoan,
      rehab_escrow_amount:   rehabEscrow,
      total_loan_amount:     totalLoan,
      borrower_cash_at_close: cashAtClose,
      interest_rate_annual:  financials?.interest_rate_annual  ?? 0.12,
      loan_term_months:      holdMonths,
      origination_points_pct: financials?.points_pct           ?? 0.02,
      origination_fee:       originFee ? Math.round(originFee) : null,
      extension_fee:         financials?.extension_fee         ?? 0,
      loan_start_date:       startDate,
      maturity_date:         maturityDate,
    })
    setCreating(false)
    if (!error) onLoanChanged()
  }

  const totalFees = !loan ? 0 : [
    loan.origination_fee, loan.appraisal_fee, loan.processing_fee,
    loan.legal_fee, loan.wire_fee, loan.draw_inspection_fee,
    loan.extension_fee, loan.other_fees,
  ].reduce((s, v) => s + (Number(v) || 0), 0)

  if (!loan) {
    return (
      <div className="rounded-lg border border-dashed border-[color:var(--color-line)] p-4 text-center space-y-2">
        <p className="text-[12px] text-[color:var(--color-text-dim)]">No loan profile set up for this project.</p>
        <button
          onClick={createLoan}
          disabled={creating}
          className="text-[12px] text-[color:var(--color-accent)] hover:opacity-80 transition-opacity"
        >
          {creating ? 'Creating…' : '+ Set Up Loan Profile'}
        </button>
      </div>
    )
  }

  const Field = ({ label, children }) => (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  )

  const NumField = ({ label, field, pct }) => (
    <Field label={label}>
      <input
        type="number"
        defaultValue={loan[field] != null ? (pct ? Number(loan[field]) * 100 : Number(loan[field])) : ''}
        onBlur={e => {
          const val = e.target.value === '' ? null : (pct ? Number(e.target.value) / 100 : Number(e.target.value))
          if (val !== (pct ? (loan[field] != null ? Number(loan[field]) * 100 : null) : loan[field])) patch({ [field]: val })
        }}
        placeholder="—"
        className={`${inputCls} text-right`}
        step={pct ? '0.01' : '1'}
      />
    </Field>
  )

  const DateField = ({ label, field }) => (
    <Field label={label}>
      <input
        type="date"
        defaultValue={loan[field] || ''}
        onBlur={e => patch({ [field]: e.target.value || null })}
        className={inputCls}
      />
    </Field>
  )

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${statusMeta.cls}`}>{statusMeta.label}</span>
          <span className="text-[11px] text-[color:var(--color-text-dim)]">{LOAN_TYPE_LABELS[loan.loan_type] || loan.loan_type}</span>
          {loan.lender_name && <span className="text-[11px] font-medium text-[color:var(--color-text)]">· {loan.lender_name}</span>}
          <MaturityBadge maturityDate={loan.maturity_date} extendedDate={loan.extended_maturity_date} />
        </div>
        <button onClick={() => setOpen(o => !o)} className="text-[11px] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] transition-colors">
          {open ? '▲ Collapse' : '▼ Expand'}
        </button>
      </div>

      {open && (
        <>
          {/* Identity */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="Lender Name">
              <input defaultValue={loan.lender_name || ''} onBlur={e => patch({ lender_name: e.target.value || null })} placeholder="Lender name" className={inputCls} />
            </Field>
            <Field label="Lender Contact">
              <input defaultValue={loan.lender_contact || ''} onBlur={e => patch({ lender_contact: e.target.value || null })} placeholder="Name or email" className={inputCls} />
            </Field>
            <Field label="Loan Label">
              <input defaultValue={loan.loan_label || ''} onBlur={e => patch({ loan_label: e.target.value || null })} placeholder="Primary HML" className={inputCls} />
            </Field>
            <Field label="Loan Type">
              <select defaultValue={loan.loan_type || 'hard_money'} onBlur={e => patch({ loan_type: e.target.value })} className={inputCls}>
                {LOAN_TYPES.map(t => <option key={t} value={t}>{LOAN_TYPE_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="Loan Status">
              <select defaultValue={loan.loan_status || 'active'} onChange={e => patch({ loan_status: e.target.value })} className={inputCls}>
                {LOAN_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Interest Calc">
              <select defaultValue={loan.interest_calc_method || 'monthly'} onChange={e => patch({ interest_calc_method: e.target.value })} className={inputCls}>
                <option value="monthly">Monthly</option>
                <option value="daily">Daily</option>
              </select>
            </Field>
          </div>

          {/* Amounts */}
          <div className="pt-1 border-t border-[color:var(--color-line)]">
            <p className={labelCls + ' mb-2'}>Loan Amounts</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <NumField label="Purchase Loan" field="purchase_loan_amount" />
              <NumField label="Rehab Escrow" field="rehab_escrow_amount" />
              <NumField label="Total Loan" field="total_loan_amount" />
              <NumField label="Borrower Cash at Close" field="borrower_cash_at_close" />
            </div>
          </div>

          {/* Dates */}
          <div className="pt-1 border-t border-[color:var(--color-line)]">
            <p className={labelCls + ' mb-2'}>Dates</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <DateField label="Loan Start" field="loan_start_date" />
              <DateField label="Maturity Date" field="maturity_date" />
              <DateField label="Extended Maturity" field="extended_maturity_date" />
              <DateField label="Paid Off Date" field="paid_off_date" />
            </div>
          </div>

          {/* Fees */}
          <div className="pt-1 border-t border-[color:var(--color-line)]">
            <p className={labelCls + ' mb-2'}>Lender Fees</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <NumField label="Origination Fee ($)" field="origination_fee" />
              <NumField label="Appraisal Fee" field="appraisal_fee" />
              <NumField label="Processing Fee" field="processing_fee" />
              <NumField label="Legal Fee" field="legal_fee" />
              <NumField label="Wire Fee" field="wire_fee" />
              <NumField label="Draw Inspection Fee" field="draw_inspection_fee" />
              <NumField label="Extension Fee" field="extension_fee" />
              <NumField label="Other Fees" field="other_fees" />
            </div>
            <div className="mt-2 flex justify-end">
              <div className="text-[12px] font-semibold text-[color:var(--color-text)]">
                Total Lender Fees: <span className="text-[color:var(--color-accent)]">{fmtUSD(totalFees)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="pt-1 border-t border-[color:var(--color-line)]">
            <Field label="Loan Notes">
              <textarea
                defaultValue={loan.notes || ''}
                onBlur={e => patch({ notes: e.target.value || null })}
                placeholder="Terms, conditions, special requirements…"
                rows={2}
                className={`${inputCls} resize-none`}
              />
            </Field>
          </div>

          {saving && <p className="text-[10px] text-[color:var(--color-text-dim)] text-right">Saving…</p>}
        </>
      )}
    </div>
  )
}
