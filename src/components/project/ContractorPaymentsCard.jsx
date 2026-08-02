// Contractor Payments — payments from HAT to contractors/vendors
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtUSD } from '../../lib/dealCalculations'

const inputCls = 'px-2 py-1 text-[12px] rounded bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] border border-[color:var(--color-line)] focus:outline-none focus:border-[color:var(--color-accent)] w-full'

const PAYMENT_METHODS = ['check','wire','zelle','cash','ach']
const METHOD_LABELS = { check: 'Check', wire: 'Wire', zelle: 'Zelle', cash: 'Cash', ach: 'ACH' }

const today = () => new Date().toISOString().split('T')[0]

const blankPayment = () => ({
  contractor_name: '',
  payment_date: today(),
  amount: '',
  payment_method: 'check',
  reference_number: '',
  notes: '',
})

export default function ContractorPaymentsCard({ leadId, workspaceId, payments, draws, onChanged }) {
  const [adding, setAdding]   = useState(false)
  const [form, setForm]       = useState(blankPayment())
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)

  const totalPaid       = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const totalReimbursed = payments.filter(p => p.reimbursed).reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const hatExposed      = totalPaid - totalReimbursed

  const exposureColor = hatExposed > 25000
    ? 'text-[color:var(--color-danger-text)]'
    : hatExposed > 10000
    ? 'text-[color:var(--color-warn-text,#d97706)]'
    : 'text-[color:var(--color-text)]'

  const save = async () => {
    if (!form.contractor_name || !form.amount || !form.payment_date) return
    setSaving(true)
    setError(null)
    const { error: err } = await supabase.from('contractor_payments').insert({
      lead_id:          leadId,
      workspace_id:     workspaceId,
      contractor_name:  form.contractor_name,
      payment_date:     form.payment_date,
      amount:           Number(form.amount),
      payment_method:   form.payment_method,
      reference_number: form.reference_number || null,
      notes:            form.notes || null,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setAdding(false)
    setForm(blankPayment())
    onChanged()
  }

  const patch = async (id, changes) => {
    await supabase.from('contractor_payments').update({ ...changes, updated_at: new Date().toISOString() }).eq('id', id)
    onChanged()
  }

  const remove = async (id) => {
    await supabase.from('contractor_payments').delete().eq('id', id)
    onChanged()
  }

  const drawLabel = (drawId) => {
    const d = draws.find(d => d.id === drawId)
    return d ? `Draw #${d.draw_number}` : null
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">Contractor Payments</span>
        <button onClick={() => setAdding(a => !a)} className="text-[12px] text-[color:var(--color-accent)] hover:opacity-80 transition-opacity">
          {adding ? '× Cancel' : '+ Add Payment'}
        </button>
      </div>

      {error && <div className="text-[11px] text-[color:var(--color-danger-text)]">{error}</div>}

      {/* Add form */}
      {adding && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-3 rounded-lg bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-accent-soft)]">
          <div>
            <label className="text-[10px] text-[color:var(--color-text-dim)] uppercase tracking-wider block mb-0.5">Contractor *</label>
            <input value={form.contractor_name} onChange={e => setForm(f => ({ ...f, contractor_name: e.target.value }))} placeholder="Contractor name" className={inputCls} />
          </div>
          <div>
            <label className="text-[10px] text-[color:var(--color-text-dim)] uppercase tracking-wider block mb-0.5">Date *</label>
            <input type="date" value={form.payment_date} onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className="text-[10px] text-[color:var(--color-text-dim)] uppercase tracking-wider block mb-0.5">Amount *</label>
            <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" className={`${inputCls} text-right`} />
          </div>
          <div>
            <label className="text-[10px] text-[color:var(--color-text-dim)] uppercase tracking-wider block mb-0.5">Method</label>
            <select value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))} className={inputCls}>
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[color:var(--color-text-dim)] uppercase tracking-wider block mb-0.5">Check / Wire #</label>
            <input value={form.reference_number} onChange={e => setForm(f => ({ ...f, reference_number: e.target.value }))} placeholder="Ref #" className={inputCls} />
          </div>
          <div>
            <label className="text-[10px] text-[color:var(--color-text-dim)] uppercase tracking-wider block mb-0.5">Notes</label>
            <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" className={inputCls} />
          </div>
          <div className="col-span-2 md:col-span-3 flex justify-end gap-2">
            <button onClick={() => { setAdding(false); setForm(blankPayment()) }} className="text-[12px] text-[color:var(--color-text-dim)] hover:opacity-80">Cancel</button>
            <button onClick={save} disabled={saving} className="text-[12px] px-3 py-1 rounded bg-[color:var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Payment'}
            </button>
          </div>
        </div>
      )}

      {/* Payments table */}
      {payments.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-[color:var(--color-line)] text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">
                <th className="text-left py-1.5 pr-2">Date</th>
                <th className="text-left py-1.5 pr-2">Contractor</th>
                <th className="text-right py-1.5 pr-2 w-24">Amount</th>
                <th className="text-left py-1.5 pr-2 w-16">Method</th>
                <th className="text-left py-1.5 pr-2 w-20">Ref #</th>
                <th className="text-left py-1.5 pr-2 w-20">Draw</th>
                <th className="text-center py-1.5 pr-2 w-24">Reimbursed</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} className="border-b border-[color:var(--color-line)] group">
                  <td className="py-1.5 pr-2 text-[color:var(--color-text-dim)]">{p.payment_date}</td>
                  <td className="py-1.5 pr-2 font-medium">{p.contractor_name}</td>
                  <td className="py-1.5 pr-2 text-right font-semibold">{fmtUSD(p.amount)}</td>
                  <td className="py-1.5 pr-2 text-[color:var(--color-text-dim)]">{METHOD_LABELS[p.payment_method] || p.payment_method}</td>
                  <td className="py-1.5 pr-2 text-[color:var(--color-text-dim)]">{p.reference_number || '—'}</td>
                  <td className="py-1.5 pr-2 text-[color:var(--color-text-dim)]">{p.lender_draw_id ? drawLabel(p.lender_draw_id) : '—'}</td>
                  <td className="py-1.5 pr-2 text-center">
                    <button
                      onClick={() => patch(p.id, { reimbursed: !p.reimbursed, reimbursed_date: !p.reimbursed ? today() : null })}
                      className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${p.reimbursed ? 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]' : 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)] hover:bg-[color:var(--color-accent-soft)]'}`}
                      title={p.reimbursed ? `Reimbursed ${p.reimbursed_date || ''}` : 'Mark as reimbursed'}
                    >
                      {p.reimbursed ? '✓ Yes' : 'Pending'}
                    </button>
                  </td>
                  <td className="py-1.5 text-center">
                    <button onClick={() => remove(p.id)} className="opacity-0 group-hover:opacity-60 hover:opacity-100 text-[color:var(--color-danger-text)] text-[12px] transition-opacity" title="Remove">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[color:var(--color-line)]">
                <td colSpan={2} className="py-2 pr-2 text-[11px] text-[color:var(--color-text-dim)]">Totals</td>
                <td className="py-2 pr-2 text-right font-bold text-[13px]">{fmtUSD(totalPaid)}</td>
                <td colSpan={3} />
                <td className="py-2 pr-2 text-center">
                  <span className="text-[11px] text-[color:var(--color-success-text)] font-semibold">{fmtUSD(totalReimbursed)} back</span>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        !adding && <p className="text-[12px] text-[color:var(--color-text-dim)] italic text-center py-3">No contractor payments recorded yet.</p>
      )}

      {/* Footer summary */}
      {payments.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 pt-2 border-t border-[color:var(--color-line)] text-[11px]">
          <span className="text-[color:var(--color-text-dim)]">Total Paid <span className="font-semibold text-[color:var(--color-text)]">{fmtUSD(totalPaid)}</span></span>
          <span className="text-[color:var(--color-text-dim)]">Reimbursed <span className="font-semibold text-[color:var(--color-success-text)]">{fmtUSD(totalReimbursed)}</span></span>
          <span className="text-[color:var(--color-text-dim)]">HAT Cash Exposed <span className={`font-bold ${exposureColor}`}>{fmtUSD(hatExposed)}</span></span>
        </div>
      )}
    </div>
  )
}
