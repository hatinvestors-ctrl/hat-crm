// src/components/lead-detail/DealRenovationItems.jsx
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { RENOVATION_CATEGORIES, fmtUSD } from '../../lib/dealCalculations'
import Button from '../ui/Button'

const ITEM_STATUSES = [
  { value: 'planned',     label: 'Planned',     cls: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]' },
  { value: 'in_progress', label: 'In Progress', cls: 'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]' },
  { value: 'invoiced',    label: 'Invoiced',    cls: 'bg-[color:var(--color-warn-soft,#fef3c7)] text-[color:var(--color-warn-text,#92400e)]' },
  { value: 'paid',        label: 'Paid',        cls: 'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]' },
  { value: 'complete',    label: 'Complete',    cls: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]' },
  { value: 'reimbursed',  label: 'Reimbursed',  cls: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]' },
]

const inputCls = 'px-2 py-1 text-[12px] rounded bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] border border-[color:var(--color-line)] focus:outline-none focus:border-[color:var(--color-accent)] w-full'

export { ITEM_STATUSES }

export default function DealRenovationItems({ leadId, workspaceId, items, onChanged, canEdit, onOpenImport, onPendingChange }) {
  const [adding, setAdding]     = useState(false)
  const [newItem, setNewItem]   = useState({ category: 'Other', description: '', estimated_cost: '', actual_cost: '', status: 'planned', contractor_name: '', pct_complete: 0 })
  const [savingId, setSavingId] = useState(null)
  const [error, setError]       = useState(null)

  const totalEst       = items.reduce((s, i) => s + (Number(i.estimated_cost) || 0) + (Number(i.approved_change_order) || 0), 0)
  const totalInvoiced  = items.reduce((s, i) => s + (Number(i.amount_invoiced) || 0), 0)
  const totalPaid      = items.reduce((s, i) => s + (Number(i.amount_paid) || 0), 0)
  const totalReimbursed = items.reduce((s, i) => s + (Number(i.amount_reimbursed) || 0), 0)

  const patch = async (id, changes) => {
    setSavingId(id)
    setError(null)
    const { error: err } = await supabase.from('deal_renovation_items').update({ ...changes, updated_at: new Date().toISOString() }).eq('id', id)
    setSavingId(null)
    if (err) setError(err.message)
    else onChanged()
  }

  const deleteItem = async (id) => {
    setError(null)
    await supabase.from('deal_renovation_items').delete().eq('id', id)
    onChanged()
  }

  const updateNewItem = (p) => {
    const next = { ...newItem, ...p }
    setNewItem(next)
    const effectiveCost = next.actual_cost !== '' ? Number(next.actual_cost) || 0 : Number(next.estimated_cost) || 0
    onPendingChange?.(effectiveCost)
  }

  const saveNew = async () => {
    if (!newItem.category) return
    setError(null)
    const { error: err } = await supabase.from('deal_renovation_items').insert({
      lead_id:          leadId,
      workspace_id:     workspaceId,
      category:         newItem.category,
      description:      newItem.description || null,
      estimated_cost:   Number(newItem.estimated_cost) || 0,
      actual_cost:      newItem.actual_cost !== '' ? Number(newItem.actual_cost) : null,
      status:           newItem.status,
      contractor_name:  newItem.contractor_name || null,
      pct_complete:     Number(newItem.pct_complete) || 0,
      sort_order:       items.length,
    })
    if (err) { setError(err.message); return }
    onPendingChange?.(null)
    setAdding(false)
    setNewItem({ category: 'Other', description: '', estimated_cost: '', actual_cost: '', status: 'planned', contractor_name: '', pct_complete: 0 })
    onChanged()
  }

  const statusMeta = (val) => ITEM_STATUSES.find(s => s.value === val) || ITEM_STATUSES[0]

  // Budget vs overrun coloring
  const budgetWarning = (item) => {
    const revised = (Number(item.estimated_cost) || 0) + (Number(item.approved_change_order) || 0)
    const orig = Number(item.estimated_cost) || 0
    return orig > 0 && revised > orig * 1.15
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">
          Scope of Work
        </span>
        {canEdit && (
          <button onClick={onOpenImport} className="text-[11px] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-accent)] transition-colors">
            ↑ Import CSV
          </button>
        )}
      </div>

      {/* Summary bar */}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-[11px]">
          <span className="text-[color:var(--color-text-dim)]">Budget <span className="font-semibold text-[color:var(--color-text)]">{fmtUSD(totalEst)}</span></span>
          <span className="text-[color:var(--color-text-dim)]">Invoiced <span className="font-semibold text-[color:var(--color-text)]">{fmtUSD(totalInvoiced)}</span></span>
          <span className="text-[color:var(--color-text-dim)]">Paid <span className="font-semibold text-[color:var(--color-text)]">{fmtUSD(totalPaid)}</span></span>
          <span className="text-[color:var(--color-text-dim)]">Reimbursed <span className="font-semibold text-[color:var(--color-success-text)]">{fmtUSD(totalReimbursed)}</span></span>
          <span className="text-[color:var(--color-text-dim)]">Remaining <span className="font-semibold text-[color:var(--color-text)]">{fmtUSD(Math.max(0, totalEst - totalPaid))}</span></span>
        </div>
      )}

      {error && <div className="text-[11px] text-[color:var(--color-danger-text)] mb-2">{error}</div>}

      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-[color:var(--color-line)] text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">
              <th className="text-left py-1.5 pr-2 w-24">Category</th>
              <th className="text-left py-1.5 pr-2">Description</th>
              <th className="text-left py-1.5 pr-2 w-24">Contractor</th>
              <th className="text-right py-1.5 pr-2 w-20">Budget</th>
              <th className="text-right py-1.5 pr-2 w-20">CO</th>
              <th className="text-right py-1.5 pr-2 w-20">Invoiced</th>
              <th className="text-right py-1.5 pr-2 w-20">Paid</th>
              <th className="text-right py-1.5 pr-2 w-20">Reimbursed</th>
              <th className="text-center py-1.5 pr-2 w-14">%</th>
              <th className="text-left py-1.5 pr-2 w-24">Status</th>
              {canEdit && <th className="w-6" />}
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id} className={`border-b border-[color:var(--color-line)] group ${budgetWarning(item) ? 'bg-[color:var(--color-warn-soft,#fef3c7)]/30' : ''}`}>
                <td className="py-1.5 pr-2">
                  {canEdit ? (
                    <select value={item.category} onChange={e => patch(item.id, { category: e.target.value })} disabled={savingId === item.id} className={inputCls}>
                      {RENOVATION_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : <span>{item.category}</span>}
                </td>
                <td className="py-1.5 pr-2">
                  {canEdit ? (
                    <input defaultValue={item.description || ''} onBlur={e => e.target.value !== (item.description || '') && patch(item.id, { description: e.target.value || null })} placeholder="Description…" className={inputCls} />
                  ) : <span className="text-[color:var(--color-text-dim)]">{item.description}</span>}
                </td>
                <td className="py-1.5 pr-2">
                  {canEdit ? (
                    <input defaultValue={item.contractor_name || ''} onBlur={e => e.target.value !== (item.contractor_name || '') && patch(item.id, { contractor_name: e.target.value || null })} placeholder="Contractor…" className={inputCls} />
                  ) : <span className="text-[color:var(--color-text-dim)]">{item.contractor_name || '—'}</span>}
                </td>
                <td className="py-1.5 pr-2 text-right">
                  {canEdit ? (
                    <input type="number" defaultValue={item.estimated_cost ?? ''} onBlur={e => patch(item.id, { estimated_cost: Number(e.target.value) || 0 })} className={`${inputCls} text-right`} />
                  ) : <span className={budgetWarning(item) ? 'text-[color:var(--color-warn-text,#92400e)]' : ''}>{fmtUSD(item.estimated_cost)}</span>}
                </td>
                <td className="py-1.5 pr-2 text-right">
                  {canEdit ? (
                    <input type="number" defaultValue={item.approved_change_order ?? ''} onBlur={e => patch(item.id, { approved_change_order: Number(e.target.value) || 0 })} placeholder="0" className={`${inputCls} text-right`} />
                  ) : (
                    <span className={Number(item.approved_change_order) > 0 ? 'text-[color:var(--color-warn-text,#92400e)]' : 'text-[color:var(--color-text-dim)]'}>
                      {Number(item.approved_change_order) !== 0 ? fmtUSD(item.approved_change_order) : '—'}
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-2 text-right">
                  {canEdit ? (
                    <input type="number" defaultValue={item.amount_invoiced ?? ''} onBlur={e => patch(item.id, { amount_invoiced: Number(e.target.value) || 0 })} placeholder="0" className={`${inputCls} text-right`} />
                  ) : <span>{Number(item.amount_invoiced) > 0 ? fmtUSD(item.amount_invoiced) : '—'}</span>}
                </td>
                <td className="py-1.5 pr-2 text-right">
                  {canEdit ? (
                    <input type="number" defaultValue={item.amount_paid ?? ''} onBlur={e => patch(item.id, { amount_paid: Number(e.target.value) || 0 })} placeholder="0" className={`${inputCls} text-right`} />
                  ) : <span>{Number(item.amount_paid) > 0 ? fmtUSD(item.amount_paid) : '—'}</span>}
                </td>
                <td className="py-1.5 pr-2 text-right">
                  {canEdit ? (
                    <input type="number" defaultValue={item.amount_reimbursed ?? ''} onBlur={e => patch(item.id, { amount_reimbursed: Number(e.target.value) || 0 })} placeholder="0" className={`${inputCls} text-right`} />
                  ) : <span className={Number(item.amount_reimbursed) > 0 ? 'text-[color:var(--color-success-text)]' : 'text-[color:var(--color-text-dim)]'}>{Number(item.amount_reimbursed) > 0 ? fmtUSD(item.amount_reimbursed) : '—'}</span>}
                </td>
                <td className="py-1.5 pr-2 text-center">
                  {canEdit ? (
                    <input type="number" min="0" max="100" defaultValue={item.pct_complete ?? 0} onBlur={e => patch(item.id, { pct_complete: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} className={`${inputCls} text-center w-12`} />
                  ) : <span>{item.pct_complete ?? 0}%</span>}
                </td>
                <td className="py-1.5 pr-2">
                  {canEdit ? (
                    <select value={item.status} onChange={e => patch(item.id, { status: e.target.value })} className={inputCls}>
                      {ITEM_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  ) : (
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${statusMeta(item.status).cls}`}>
                      {statusMeta(item.status).label}
                    </span>
                  )}
                </td>
                {canEdit && (
                  <td className="py-1.5 text-center">
                    <button onClick={() => deleteItem(item.id)} className="opacity-0 group-hover:opacity-60 hover:opacity-100 text-[color:var(--color-danger-text)] text-[12px] transition-opacity" title="Remove">×</button>
                  </td>
                )}
              </tr>
            ))}

            {/* Add row */}
            {adding && (
              <tr className="border-b border-[color:var(--color-accent-soft)]">
                <td className="py-1.5 pr-2">
                  <select value={newItem.category} onChange={e => updateNewItem({ category: e.target.value })} className={inputCls}>
                    {RENOVATION_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td className="py-1.5 pr-2">
                  <input value={newItem.description} onChange={e => updateNewItem({ description: e.target.value })} placeholder="Description…" className={inputCls} />
                </td>
                <td className="py-1.5 pr-2">
                  <input value={newItem.contractor_name} onChange={e => updateNewItem({ contractor_name: e.target.value })} placeholder="Contractor…" className={inputCls} />
                </td>
                <td className="py-1.5 pr-2">
                  <input type="number" value={newItem.estimated_cost} onChange={e => updateNewItem({ estimated_cost: e.target.value })} placeholder="0" className={`${inputCls} text-right`} />
                </td>
                <td className="py-1.5 pr-2"><span className="text-[color:var(--color-text-dim)] text-[11px] px-2">—</span></td>
                <td className="py-1.5 pr-2"><span className="text-[color:var(--color-text-dim)] text-[11px] px-2">—</span></td>
                <td className="py-1.5 pr-2"><span className="text-[color:var(--color-text-dim)] text-[11px] px-2">—</span></td>
                <td className="py-1.5 pr-2"><span className="text-[color:var(--color-text-dim)] text-[11px] px-2">—</span></td>
                <td className="py-1.5 pr-2">
                  <input type="number" min="0" max="100" value={newItem.pct_complete} onChange={e => updateNewItem({ pct_complete: e.target.value })} className={`${inputCls} text-center w-12`} />
                </td>
                <td className="py-1.5 pr-2">
                  <select value={newItem.status} onChange={e => updateNewItem({ status: e.target.value })} className={inputCls}>
                    {ITEM_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </td>
                <td className="py-1.5">
                  <button onClick={saveNew} className="text-[color:var(--color-accent)] text-[12px] hover:opacity-80" title="Save">✓</button>
                  <button onClick={() => { setAdding(false); onPendingChange?.(null) }} className="text-[color:var(--color-text-dim)] text-[12px] ml-1 hover:opacity-80" title="Cancel">×</button>
                </td>
              </tr>
            )}

            {/* Totals */}
            {items.length > 0 && (
              <tr className="border-t-2 border-[color:var(--color-line)] font-semibold">
                <td colSpan={3} className="py-1.5 pr-2 text-[11px] text-[color:var(--color-text-dim)]">Totals</td>
                <td className="py-1.5 pr-2 text-right text-[12px]">{fmtUSD(totalEst)}</td>
                <td />
                <td className="py-1.5 pr-2 text-right text-[12px]">{fmtUSD(totalInvoiced)}</td>
                <td className="py-1.5 pr-2 text-right text-[12px]">{fmtUSD(totalPaid)}</td>
                <td className="py-1.5 pr-2 text-right text-[12px] text-[color:var(--color-success-text)]">{fmtUSD(totalReimbursed)}</td>
                <td colSpan={canEdit ? 3 : 2} />
              </tr>
            )}

            {items.length === 0 && !adding && (
              <tr>
                <td colSpan={canEdit ? 11 : 10} className="py-3 text-center text-[12px] text-[color:var(--color-text-dim)] italic">
                  No scope items yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && !adding && (
        <button
          onClick={() => setAdding(true)}
          className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-dashed border-[color:var(--color-line)] text-[12px] font-medium text-[color:var(--color-text-muted)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent-text)] hover:bg-[color:var(--color-accent-soft)] transition-colors"
        >
          + Add Scope Item
        </button>
      )}
    </div>
  )
}
