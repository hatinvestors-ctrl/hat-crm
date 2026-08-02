// Lender Draw Schedule — draw requests submitted to the HML lender
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtUSD } from '../../lib/dealCalculations'

const inputCls = 'px-2 py-1 text-[12px] rounded bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] border border-[color:var(--color-line)] focus:outline-none focus:border-[color:var(--color-accent)] w-full'

const DRAW_STATUSES = [
  { value: 'draft',       label: 'Draft',       cls: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]' },
  { value: 'submitted',   label: 'Submitted',   cls: 'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]' },
  { value: 'inspecting',  label: 'Inspecting',  cls: 'bg-[color:var(--color-warn-soft,#fef3c7)] text-[color:var(--color-warn-text,#92400e)]' },
  { value: 'approved',    label: 'Approved',    cls: 'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]' },
  { value: 'funded',      label: 'Funded ✓',    cls: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]' },
  { value: 'rejected',    label: 'Rejected',    cls: 'bg-[color:var(--color-danger-soft,#fee2e2)] text-[color:var(--color-danger-text)]' },
]

const STATUS_NEXT = { draft: 'submitted', submitted: 'inspecting', inspecting: 'approved', approved: 'funded' }

const today = () => new Date().toISOString().split('T')[0]

const blankDraw = () => ({
  amount_requested: '',
  date_submitted: today(),
  inspection_fee_charged: '',
  notes: '',
})

export default function LenderDrawsCard({ leadId, workspaceId, loan, draws, payments, onChanged }) {
  const [adding, setAdding]   = useState(false)
  const [form, setForm]       = useState(blankDraw())
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)
  const [expandId, setExpandId] = useState(null)

  const totalFunded    = draws.filter(d => d.draw_status === 'funded').reduce((s, d) => s + (Number(d.amount_funded) || 0), 0)
  const totalRequested = draws.filter(d => d.draw_status !== 'funded' && d.draw_status !== 'rejected').reduce((s, d) => s + (Number(d.amount_requested) || 0), 0)
  const rehabEscrow    = Number(loan?.rehab_escrow_amount) || 0
  const remaining      = rehabEscrow - totalFunded - totalRequested

  const statusMeta = (val) => DRAW_STATUSES.find(s => s.value === val) || DRAW_STATUSES[0]

  const nextDrawNumber = (draws.length > 0 ? Math.max(...draws.map(d => d.draw_number)) : 0) + 1

  const save = async () => {
    if (!loan || !form.amount_requested) return
    setSaving(true)
    setError(null)
    const { error: err } = await supabase.from('lender_draws').insert({
      project_loan_id:        loan.id,
      lead_id:                leadId,
      workspace_id:           workspaceId,
      draw_number:            nextDrawNumber,
      draw_status:            'draft',
      amount_requested:       Number(form.amount_requested),
      inspection_fee_charged: Number(form.inspection_fee_charged) || 0,
      date_submitted:         form.date_submitted || null,
      notes:                  form.notes || null,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setAdding(false)
    setForm(blankDraw())
    onChanged()
  }

  const patch = async (id, changes) => {
    const updates = { ...changes, updated_at: new Date().toISOString() }
    // When marking funded, compute net_funded
    if (changes.draw_status === 'funded' || changes.amount_funded != null) {
      const draw = draws.find(d => d.id === id)
      if (draw) {
        const funded = changes.amount_funded != null ? Number(changes.amount_funded) : Number(draw.amount_funded) || 0
        const fee = changes.inspection_fee_charged != null ? Number(changes.inspection_fee_charged) : Number(draw.inspection_fee_charged) || 0
        updates.net_funded = funded - fee
      }
    }
    // Auto-set date when status advances
    if (changes.draw_status === 'submitted' && !changes.date_submitted) updates.date_submitted = today()
    if (changes.draw_status === 'funded' && !changes.date_funded) updates.date_funded = today()
    await supabase.from('lender_draws').update(updates).eq('id', id)
    // When draw is funded, mark linked payments as reimbursed
    if (changes.draw_status === 'funded') {
      const linkedPayments = payments.filter(p => p.lender_draw_id === id)
      if (linkedPayments.length > 0) {
        await supabase.from('contractor_payments').update({ reimbursed: true, reimbursed_date: today() }).in('id', linkedPayments.map(p => p.id))
      }
    }
    onChanged()
  }

  const remove = async (id) => {
    await supabase.from('lender_draws').delete().eq('id', id)
    onChanged()
  }

  const linkPaymentToDraw = async (paymentId, drawId) => {
    await supabase.from('contractor_payments').update({ lender_draw_id: drawId }).eq('id', paymentId)
    onChanged()
  }

  // Undrawn payments (available to include in a new draw)
  const undrawnPayments = payments.filter(p => !p.lender_draw_id && !p.reimbursed)

  if (!loan) {
    return (
      <div className="text-[12px] text-[color:var(--color-text-dim)] italic text-center py-3">
        Set up a loan profile above before managing lender draws.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">Lender Draw Schedule</span>
        <button onClick={() => setAdding(a => !a)} className="text-[12px] text-[color:var(--color-accent)] hover:opacity-80 transition-opacity">
          {adding ? '× Cancel' : '+ Request Draw'}
        </button>
      </div>

      {error && <div className="text-[11px] text-[color:var(--color-danger-text)]">{error}</div>}

      {/* Draw ceiling warning */}
      {remaining < 0 && (
        <div className="text-[11px] px-3 py-2 rounded bg-[color:var(--color-danger-soft,#fee2e2)] text-[color:var(--color-danger-text)] border border-[color:var(--color-danger-text)]/20">
          ⚠ Draws exceed rehab escrow by {fmtUSD(Math.abs(remaining))}. Cannot request additional draws.
        </div>
      )}

      {/* Add form */}
      {adding && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-3 rounded-lg bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-accent-soft)]">
          <div>
            <label className="text-[10px] text-[color:var(--color-text-dim)] uppercase tracking-wider block mb-0.5">Amount Requested *</label>
            <input type="number" value={form.amount_requested} onChange={e => setForm(f => ({ ...f, amount_requested: e.target.value }))} placeholder="0" className={`${inputCls} text-right`} />
            {rehabEscrow > 0 && <p className="text-[10px] text-[color:var(--color-text-dim)] mt-0.5">Available: {fmtUSD(remaining)}</p>}
          </div>
          <div>
            <label className="text-[10px] text-[color:var(--color-text-dim)] uppercase tracking-wider block mb-0.5">Date Submitted</label>
            <input type="date" value={form.date_submitted} onChange={e => setForm(f => ({ ...f, date_submitted: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className="text-[10px] text-[color:var(--color-text-dim)] uppercase tracking-wider block mb-0.5">Inspection Fee</label>
            <input type="number" value={form.inspection_fee_charged} onChange={e => setForm(f => ({ ...f, inspection_fee_charged: e.target.value }))} placeholder="0" className={`${inputCls} text-right`} />
          </div>
          <div className="col-span-2 md:col-span-3">
            <label className="text-[10px] text-[color:var(--color-text-dim)] uppercase tracking-wider block mb-0.5">Notes</label>
            <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Scope covered by this draw…" className={inputCls} />
          </div>
          {undrawnPayments.length > 0 && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-[10px] text-[color:var(--color-text-dim)] uppercase tracking-wider mb-1">{undrawnPayments.length} contractor payment{undrawnPayments.length > 1 ? 's' : ''} not yet in a draw</p>
              <p className="text-[11px] text-[color:var(--color-text-dim)]">You can link payments to this draw after saving it.</p>
            </div>
          )}
          <div className="col-span-2 md:col-span-3 flex justify-end gap-2">
            <button onClick={() => { setAdding(false); setForm(blankDraw()) }} className="text-[12px] text-[color:var(--color-text-dim)] hover:opacity-80">Cancel</button>
            <button onClick={save} disabled={saving || remaining < 0} className="text-[12px] px-3 py-1 rounded bg-[color:var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50">
              {saving ? 'Saving…' : `Save Draw #${nextDrawNumber}`}
            </button>
          </div>
        </div>
      )}

      {/* Draws table */}
      {draws.length > 0 ? (
        <div className="space-y-2">
          {draws.map(draw => {
            const meta = statusMeta(draw.draw_status)
            const linkedPayments = payments.filter(p => p.lender_draw_id === draw.id)
            const isExpanded = expandId === draw.id
            const nextStatus = STATUS_NEXT[draw.draw_status]

            return (
              <div key={draw.id} className="rounded-lg border border-[color:var(--color-line)] overflow-hidden">
                {/* Row */}
                <div className="flex items-center gap-3 px-3 py-2 bg-[color:var(--color-bg-elev-2)] cursor-pointer" onClick={() => setExpandId(isExpanded ? null : draw.id)}>
                  <span className="text-[12px] font-bold text-[color:var(--color-text-dim)] w-16 shrink-0">Draw #{draw.draw_number}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
                  <span className="text-[12px] font-bold ml-auto">{fmtUSD(draw.amount_requested)}</span>
                  {draw.draw_status === 'funded' && (
                    <span className="text-[11px] text-[color:var(--color-success-text)]">net {fmtUSD(draw.net_funded)}</span>
                  )}
                  <span className="text-[10px] text-[color:var(--color-text-dim)]">{isExpanded ? '▲' : '▼'}</span>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-3 py-3 space-y-3 border-t border-[color:var(--color-line)]">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <label className="text-[10px] text-[color:var(--color-text-dim)] uppercase tracking-wider block mb-0.5">Status</label>
                        <select
                          value={draw.draw_status}
                          onChange={e => patch(draw.id, { draw_status: e.target.value })}
                          className={inputCls}
                        >
                          {DRAW_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-[color:var(--color-text-dim)] uppercase tracking-wider block mb-0.5">Amount Requested</label>
                        <input
                          type="number"
                          defaultValue={draw.amount_requested}
                          onBlur={e => patch(draw.id, { amount_requested: Number(e.target.value) })}
                          className={`${inputCls} text-right`}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-[color:var(--color-text-dim)] uppercase tracking-wider block mb-0.5">Amount Funded</label>
                        <input
                          type="number"
                          defaultValue={draw.amount_funded ?? ''}
                          onBlur={e => patch(draw.id, { amount_funded: e.target.value ? Number(e.target.value) : null })}
                          placeholder="—"
                          className={`${inputCls} text-right`}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-[color:var(--color-text-dim)] uppercase tracking-wider block mb-0.5">Inspection Fee</label>
                        <input
                          type="number"
                          defaultValue={draw.inspection_fee_charged ?? 0}
                          onBlur={e => patch(draw.id, { inspection_fee_charged: Number(e.target.value) || 0 })}
                          className={`${inputCls} text-right`}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-[color:var(--color-text-dim)] uppercase tracking-wider block mb-0.5">Submitted</label>
                        <input type="date" defaultValue={draw.date_submitted || ''} onBlur={e => patch(draw.id, { date_submitted: e.target.value || null })} className={inputCls} />
                      </div>
                      <div>
                        <label className="text-[10px] text-[color:var(--color-text-dim)] uppercase tracking-wider block mb-0.5">Inspected</label>
                        <input type="date" defaultValue={draw.date_inspected || ''} onBlur={e => patch(draw.id, { date_inspected: e.target.value || null })} className={inputCls} />
                      </div>
                      <div>
                        <label className="text-[10px] text-[color:var(--color-text-dim)] uppercase tracking-wider block mb-0.5">Funded</label>
                        <input type="date" defaultValue={draw.date_funded || ''} onBlur={e => patch(draw.id, { date_funded: e.target.value || null })} className={inputCls} />
                      </div>
                      <div>
                        <label className="text-[10px] text-[color:var(--color-text-dim)] uppercase tracking-wider block mb-0.5">Net Funded</label>
                        <div className="px-2 py-1 text-[12px] font-semibold text-[color:var(--color-success-text)]">
                          {draw.net_funded != null ? fmtUSD(draw.net_funded) : '—'}
                        </div>
                      </div>
                    </div>

                    {/* Notes */}
                    <div>
                      <label className="text-[10px] text-[color:var(--color-text-dim)] uppercase tracking-wider block mb-0.5">Notes</label>
                      <input defaultValue={draw.notes || ''} onBlur={e => patch(draw.id, { notes: e.target.value || null })} placeholder="Scope covered, lender contact, etc." className={inputCls} />
                    </div>

                    {/* Linked payments */}
                    <div>
                      <p className="text-[10px] text-[color:var(--color-text-dim)] uppercase tracking-wider mb-1">Contractor Payments in This Draw</p>
                      {linkedPayments.length > 0 ? (
                        <div className="space-y-1">
                          {linkedPayments.map(p => (
                            <div key={p.id} className="flex items-center justify-between text-[11px] px-2 py-1 rounded bg-[color:var(--color-bg-elev-2)]">
                              <span>{p.contractor_name} · {p.payment_date}</span>
                              <span className="font-semibold">{fmtUSD(p.amount)}</span>
                            </div>
                          ))}
                          <div className="text-right text-[11px] font-bold text-[color:var(--color-text)]">
                            Total: {fmtUSD(linkedPayments.reduce((s, p) => s + Number(p.amount), 0))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-[11px] text-[color:var(--color-text-dim)] italic">No payments linked yet.</p>
                      )}

                      {/* Link undrawn payments */}
                      {undrawnPayments.length > 0 && draw.draw_status !== 'funded' && (
                        <div className="mt-2">
                          <p className="text-[10px] text-[color:var(--color-text-dim)] mb-1">Link a payment to this draw:</p>
                          <div className="flex flex-wrap gap-1">
                            {undrawnPayments.map(p => (
                              <button
                                key={p.id}
                                onClick={() => linkPaymentToDraw(p.id, draw.id)}
                                className="text-[10px] px-2 py-0.5 rounded border border-[color:var(--color-line)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)] transition-colors"
                              >
                                {p.contractor_name} {fmtUSD(p.amount)}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between pt-1">
                      {nextStatus && draw.draw_status !== 'funded' && draw.draw_status !== 'rejected' && (
                        <button
                          onClick={() => patch(draw.id, { draw_status: nextStatus })}
                          className="text-[11px] px-3 py-1 rounded bg-[color:var(--color-accent)] text-white hover:opacity-90"
                        >
                          → Mark as {statusMeta(nextStatus).label}
                        </button>
                      )}
                      <button onClick={() => remove(draw.id)} className="text-[11px] text-[color:var(--color-danger-text)] hover:opacity-80 ml-auto">Delete Draw</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        !adding && <p className="text-[12px] text-[color:var(--color-text-dim)] italic text-center py-3">No draws requested yet.</p>
      )}

      {/* Footer */}
      {draws.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 pt-2 border-t border-[color:var(--color-line)] text-[11px]">
          <span className="text-[color:var(--color-text-dim)]">Total Funded <span className="font-semibold text-[color:var(--color-success-text)]">{fmtUSD(totalFunded)}</span></span>
          <span className="text-[color:var(--color-text-dim)]">In Progress <span className="font-semibold text-[color:var(--color-text)]">{fmtUSD(totalRequested)}</span></span>
          {rehabEscrow > 0 && <span className="text-[color:var(--color-text-dim)]">Remaining Escrow <span className={`font-semibold ${remaining < 0 ? 'text-[color:var(--color-danger-text)]' : 'text-[color:var(--color-text)]'}`}>{fmtUSD(remaining)}</span></span>}
        </div>
      )}
    </div>
  )
}
