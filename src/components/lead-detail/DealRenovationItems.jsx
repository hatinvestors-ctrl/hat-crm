// src/components/lead-detail/DealRenovationItems.jsx
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { RENOVATION_CATEGORIES, ITEM_STATUSES, fmtUSD } from '../../lib/dealCalculations'
import Button from '../ui/Button'

const inputCls = 'px-2 py-1 text-[12px] rounded bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] border border-[color:var(--color-line)] focus:outline-none focus:border-[color:var(--color-accent)] w-full'

export default function DealRenovationItems({ leadId, workspaceId, items, onChanged, canEdit, onOpenImport, onPendingChange }) {
  const [adding, setAdding]     = useState(false)
  const [newItem, setNewItem]   = useState({ category: 'Other', description: '', estimated_cost: '', actual_cost: '', status: 'planned' })
  const [savingId, setSavingId] = useState(null)
  const [error, setError]       = useState(null)

  const totalEst    = items.reduce((s, i) => s + (Number(i.estimated_cost) || 0), 0)
  const totalActual = items.reduce((s, i) => s + (i.actual_cost != null ? Number(i.actual_cost) : Number(i.estimated_cost) || 0), 0)

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

  const updateNewItem = (patch) => {
    const next = { ...newItem, ...patch }
    setNewItem(next)
    // report the effective cost (actual if filled, else estimated) so parent can update calc live
    const effectiveCost = next.actual_cost !== '' ? Number(next.actual_cost) || 0 : Number(next.estimated_cost) || 0
    onPendingChange?.(effectiveCost)
  }

  const saveNew = async () => {
    if (!newItem.category) return
    setError(null)
    const { error: err } = await supabase.from('deal_renovation_items').insert({
      lead_id:        leadId,
      workspace_id:   workspaceId,
      category:       newItem.category,
      description:    newItem.description || null,
      estimated_cost: Number(newItem.estimated_cost) || 0,
      actual_cost:    newItem.actual_cost !== '' ? Number(newItem.actual_cost) : null,
      status:         newItem.status,
      sort_order:     items.length,
    })
    if (err) { setError(err.message); return }
    onPendingChange?.(null) // clear pending
    setAdding(false)
    setNewItem({ category: 'Other', description: '', estimated_cost: '', actual_cost: '', status: 'planned' })
    onChanged()
  }

  const statusMeta = (val) => ITEM_STATUSES.find(s => s.value === val) || ITEM_STATUSES[0]

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">
          Renovation Items
        </span>
        {canEdit && (
          <div className="flex gap-1.5">
            <button onClick={onOpenImport} className="text-[11px] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-accent)] transition-colors">
              ↑ Import CSV
            </button>
          </div>
        )}
      </div>

      {error && <div className="text-[11px] text-[color:var(--color-danger-text)] mb-2">{error}</div>}

      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-[color:var(--color-line)] text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">
              <th className="text-left py-1.5 pr-2 w-28">Category</th>
              <th className="text-left py-1.5 pr-2">Description</th>
              <th className="text-right py-1.5 pr-2 w-24">Estimated</th>
              <th className="text-right py-1.5 pr-2 w-24">Actual</th>
              <th className="text-left py-1.5 pr-2 w-24">Status</th>
              {canEdit && <th className="w-6" />}
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id} className="border-b border-[color:var(--color-line)] group">
                <td className="py-1.5 pr-2">
                  {canEdit ? (
                    <select
                      value={item.category}
                      onChange={e => patch(item.id, { category: e.target.value })}
                      disabled={savingId === item.id}
                      className={inputCls}
                    >
                      {RENOVATION_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : <span>{item.category}</span>}
                </td>
                <td className="py-1.5 pr-2">
                  {canEdit ? (
                    <input
                      defaultValue={item.description || ''}
                      onBlur={e => e.target.value !== (item.description || '') && patch(item.id, { description: e.target.value || null })}
                      placeholder="Description…"
                      className={inputCls}
                    />
                  ) : <span className="text-[color:var(--color-text-dim)]">{item.description}</span>}
                </td>
                <td className="py-1.5 pr-2 text-right">
                  {canEdit ? (
                    <input
                      type="number"
                      defaultValue={item.estimated_cost ?? ''}
                      onBlur={e => patch(item.id, { estimated_cost: Number(e.target.value) || 0 })}
                      className={`${inputCls} text-right`}
                    />
                  ) : <span>{fmtUSD(item.estimated_cost)}</span>}
                </td>
                <td className="py-1.5 pr-2 text-right">
                  {canEdit ? (
                    <input
                      type="number"
                      defaultValue={item.actual_cost ?? ''}
                      placeholder="—"
                      onBlur={e => patch(item.id, { actual_cost: e.target.value !== '' ? Number(e.target.value) : null })}
                      className={`${inputCls} text-right`}
                    />
                  ) : <span className={item.actual_cost != null ? 'text-[color:var(--color-text)]' : 'text-[color:var(--color-text-dim)]'}>{item.actual_cost != null ? fmtUSD(item.actual_cost) : '—'}</span>}
                </td>
                <td className="py-1.5 pr-2">
                  {canEdit ? (
                    <select
                      value={item.status}
                      onChange={e => patch(item.id, { status: e.target.value })}
                      className={inputCls}
                    >
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
                    <button
                      onClick={() => deleteItem(item.id)}
                      className="opacity-0 group-hover:opacity-60 hover:opacity-100 text-[color:var(--color-danger-text)] text-[12px] transition-opacity"
                      title="Remove"
                    >×</button>
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
                  <input type="number" value={newItem.estimated_cost} onChange={e => updateNewItem({ estimated_cost: e.target.value })} placeholder="0" className={`${inputCls} text-right`} />
                </td>
                <td className="py-1.5 pr-2">
                  <input type="number" value={newItem.actual_cost} onChange={e => updateNewItem({ actual_cost: e.target.value })} placeholder="—" className={`${inputCls} text-right`} />
                </td>
                <td className="py-1.5 pr-2">
                  <select value={newItem.status} onChange={e => updateNewItem({ status: e.target.value })} className={inputCls}>
                    {ITEM_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </td>
                <td className="py-1.5">
                  <button onClick={saveNew} className="text-[color:var(--color-accent)] text-[12px] hover:opacity-80" title="Save item">✓</button>
                  <button onClick={() => { setAdding(false); onPendingChange?.(null) }} className="text-[color:var(--color-text-dim)] text-[12px] ml-1 hover:opacity-80" title="Cancel">×</button>
                </td>
              </tr>
            )}

            {/* Totals row */}
            {items.length > 0 && (
              <tr className="border-t-2 border-[color:var(--color-line)] font-semibold">
                <td colSpan={2} className="py-1.5 pr-2 text-[11px] text-[color:var(--color-text-dim)]">Totals</td>
                <td className="py-1.5 pr-2 text-right text-[12px]">{fmtUSD(totalEst)}</td>
                <td className="py-1.5 pr-2 text-right text-[12px]">{fmtUSD(totalActual)}</td>
                <td colSpan={canEdit ? 2 : 1} />
              </tr>
            )}

            {items.length === 0 && !adding && (
              <tr>
                <td colSpan={canEdit ? 6 : 5} className="py-3 text-center text-[12px] text-[color:var(--color-text-dim)] italic">
                  No renovation items yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && !adding && (
        <button
          onClick={() => setAdding(true)}
          className="mt-2 text-[12px] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-accent)] transition-colors"
        >
          + Add item
        </button>
      )}
    </div>
  )
}
