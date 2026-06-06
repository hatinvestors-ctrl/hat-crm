// src/components/tasks/TaskChecklist.jsx
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

export default function TaskChecklist({ taskId, canEdit }) {
  const [items, setItems]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [addText, setAddText]       = useState('')
  const [addingItem, setAddingItem] = useState(false)
  const [editingId, setEditingId]   = useState(null)
  const [editText, setEditText]     = useState('')
  const addInputRef                 = useRef(null)

  const load = async () => {
    const { data, error: err } = await supabase
      .from('task_checklist_items')
      .select('id, text, done, sort_order')
      .eq('task_id', taskId)
      .order('sort_order', { ascending: true })
    if (err) setError(err.message)
    else setItems(data || [])
    setLoading(false)
  }

  useEffect(() => {
    if (!taskId) return
    setLoading(true)
    setItems([])
    load()
  }, [taskId])

  const total = items.length
  const doneCount = items.filter(i => i.done).length
  const pct = total === 0 ? 0 : Math.round((doneCount / total) * 100)

  const handleAdd = async () => {
    const text = addText.trim()
    if (!text) { setAddText(''); setAddingItem(false); return }
    setError(null)
    const sort_order = items.length
    const tempId = 'tmp-' + Date.now()
    setItems(prev => [...prev, { id: tempId, text, done: false, sort_order }])
    setAddText('')
    const { data, error: err } = await supabase
      .from('task_checklist_items')
      .insert({ task_id: taskId, text, sort_order })
      .select('id, text, done, sort_order')
      .single()
    if (err) {
      setError(err.message)
      setItems(prev => prev.filter(i => i.id !== tempId))
    } else {
      setItems(prev => prev.map(i => i.id === tempId ? data : i))
    }
  }

  const handleToggle = async (item) => {
    setError(null)
    const newDone = !item.done
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, done: newDone } : i))
    const { error: err } = await supabase
      .from('task_checklist_items')
      .update({ done: newDone })
      .eq('id', item.id)
    if (err) {
      setError(err.message)
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, done: item.done } : i))
    }
  }

  const handleDelete = async (id) => {
    setError(null)
    setItems(prev => prev.filter(i => i.id !== id))
    const { error: err } = await supabase
      .from('task_checklist_items')
      .delete()
      .eq('id', id)
    if (err) { setError(err.message); load() }
  }

  const startEdit = (item) => { setEditingId(item.id); setEditText(item.text) }

  const commitEdit = async () => {
    const text = editText.trim()
    const original = items.find(i => i.id === editingId)
    setEditingId(null)
    if (!text || !original || text === original.text) return
    setError(null)
    setItems(prev => prev.map(i => i.id === original.id ? { ...i, text } : i))
    const { error: err } = await supabase
      .from('task_checklist_items')
      .update({ text })
      .eq('id', original.id)
    if (err) {
      setError(err.message)
      setItems(prev => prev.map(i => i.id === original.id ? original : i))
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">
          Checklist
        </span>
        {total > 0 && (
          <span className="text-[10.5px] text-[color:var(--color-text-dim)]">
            {doneCount} / {total}
          </span>
        )}
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="h-1.5 bg-[color:var(--color-bg-elev-2)] rounded-full mb-3 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${pct}%`,
              backgroundColor: pct === 100 ? 'var(--color-success)' : 'var(--color-accent)',
            }}
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-[11px] text-[color:var(--color-danger-text)] bg-[color:var(--color-danger-soft)] px-2 py-1 rounded mb-2">
          {error}
        </div>
      )}

      {/* Items */}
      {loading ? (
        <div className="text-[12px] text-[color:var(--color-text-dim)]">Loading…</div>
      ) : (
        <ul className="space-y-0.5">
          {items.map(item => (
            <li key={item.id} className="group flex items-center gap-2 py-0.5 min-h-[24px]">
              <input
                type="checkbox"
                checked={item.done}
                disabled={!canEdit}
                onChange={() => handleToggle(item)}
                className="h-3.5 w-3.5 rounded accent-[color:var(--color-accent)] cursor-pointer shrink-0"
              />
              {editingId === item.id ? (
                <input
                  autoFocus
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitEdit()
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="flex-1 text-[13px] px-1 bg-transparent border-b border-[color:var(--color-accent)] text-[color:var(--color-text)] focus:outline-none"
                />
              ) : (
                <span
                  onClick={() => canEdit && startEdit(item)}
                  className={`flex-1 text-[13px] leading-5 transition-colors ${
                    item.done
                      ? 'line-through text-[color:var(--color-text-dim)]'
                      : 'text-[color:var(--color-text)]'
                  } ${canEdit ? 'cursor-text' : ''}`}
                >
                  {item.text}
                </span>
              )}
              {canEdit && (
                <button
                  onClick={() => handleDelete(item.id)}
                  className="opacity-0 group-hover:opacity-60 hover:opacity-100 text-[12px] w-5 h-5 flex items-center justify-center text-[color:var(--color-text-dim)] hover:text-[color:var(--color-danger-text)] rounded transition-opacity shrink-0"
                  title="Remove"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Add item */}
      {canEdit && (
        addingItem ? (
          <div className="flex items-center gap-2 mt-1.5">
            <span className="h-3.5 w-3.5 shrink-0" />
            <input
              ref={addInputRef}
              autoFocus
              value={addText}
              onChange={e => setAddText(e.target.value)}
              onBlur={handleAdd}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAdd()
                if (e.key === 'Escape') { setAddText(''); setAddingItem(false) }
              }}
              placeholder="New item…"
              className="flex-1 text-[13px] px-1 py-0.5 bg-transparent border-b border-[color:var(--color-line)] focus:border-[color:var(--color-accent)] text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-faint)] focus:outline-none transition-colors"
            />
          </div>
        ) : (
          <button
            onClick={() => setAddingItem(true)}
            className="mt-2 text-[12px] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-accent)] transition-colors"
          >
            + Add item
          </button>
        )
      )}
    </div>
  )
}
