// src/components/agents/AgentContactList.jsx
import { useState, useRef, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const LABEL_SUGGESTIONS = ['Work', 'Personal', 'Cell', 'Office', 'Mobile', 'Home']

function ContactRow({ contact, showPrimary, onDelete, onUpdateLabel, onUpdateValue, onMakePrimary, canEdit }) {
  const [editingLabel, setEditingLabel] = useState(false)
  const [editingValue, setEditingValue] = useState(false)
  const [labelDraft, setLabelDraft]     = useState(contact.label)
  const [valueDraft, setValueDraft]     = useState(contact.value)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const labelRef = useRef(null)
  const valueRef = useRef(null)

  useEffect(() => { if (editingLabel) labelRef.current?.focus() }, [editingLabel])
  useEffect(() => { if (editingValue) valueRef.current?.focus() }, [editingValue])

  const commitLabel = () => {
    setEditingLabel(false)
    setShowSuggestions(false)
    if (labelDraft.trim() !== contact.label) onUpdateLabel(contact.id, labelDraft.trim())
  }
  const commitValue = () => {
    setEditingValue(false)
    if (valueDraft.trim() !== contact.value && valueDraft.trim()) onUpdateValue(contact.id, valueDraft.trim())
    else setValueDraft(contact.value)
  }
  const cancelLabel = () => { setLabelDraft(contact.label); setEditingLabel(false); setShowSuggestions(false) }
  const cancelValue = () => { setValueDraft(contact.value); setEditingValue(false) }

  const inputCls = 'px-1.5 py-0.5 text-[11px] rounded bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] border border-[color:var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--color-accent)]'

  return (
    <div className="group flex items-center gap-1.5 py-1">
      {/* Primary star (email only) */}
      {showPrimary && (
        <button
          onClick={() => !contact.is_primary && onMakePrimary(contact.id)}
          className={`text-[13px] shrink-0 transition-colors ${contact.is_primary ? 'text-amber-400' : 'text-[color:var(--color-text-dim)] opacity-0 group-hover:opacity-60 hover:text-amber-300'}`}
          title={contact.is_primary ? 'Primary email' : 'Make primary'}
        >
          ★
        </button>
      )}

      {/* Label */}
      {editingLabel ? (
        <div className="relative">
          <input
            ref={labelRef}
            value={labelDraft}
            onChange={e => setLabelDraft(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(commitLabel, 150)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setEditingLabel(false); setShowSuggestions(false); setEditingValue(true) } if (e.key === 'Escape') cancelLabel() }}
            className={`${inputCls} w-20`}
            placeholder="Label"
          />
          {showSuggestions && (
            <div className="absolute top-full left-0 mt-0.5 bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] rounded shadow-lg z-10 min-w-[100px]">
              {LABEL_SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onMouseDown={() => { setLabelDraft(s); setShowSuggestions(false); setEditingLabel(false); setEditingValue(true) }}
                  className="block w-full text-left px-3 py-1 text-[11px] text-[color:var(--color-text)] hover:bg-[color:var(--color-bg-elev)] transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <span
          onClick={() => canEdit && setEditingLabel(true)}
          className={`text-[11px] text-[color:var(--color-text-dim)] shrink-0 ${canEdit ? 'cursor-pointer hover:text-[color:var(--color-text)]' : ''} transition-colors`}
        >
          {contact.label || '—'}
        </span>
      )}

      <span className="text-[color:var(--color-text-dim)] text-[10px] shrink-0">·</span>

      {/* Value */}
      {editingValue ? (
        <input
          ref={valueRef}
          value={valueDraft}
          onChange={e => setValueDraft(e.target.value)}
          onBlur={commitValue}
          onKeyDown={e => { if (e.key === 'Enter') commitValue(); if (e.key === 'Escape') cancelValue() }}
          className={`${inputCls} flex-1 min-w-0`}
        />
      ) : (
        <span
          onClick={() => canEdit && setEditingValue(true)}
          className={`text-[12px] text-[color:var(--color-text)] flex-1 min-w-0 break-all ${canEdit ? 'cursor-pointer hover:text-[color:var(--color-accent)]' : ''} transition-colors`}
        >
          {contact.value}
        </span>
      )}

      {/* Delete */}
      {canEdit && (
        <button
          onClick={() => onDelete(contact.id)}
          className="opacity-0 group-hover:opacity-60 hover:opacity-100 text-[color:var(--color-text-dim)] hover:text-[color:var(--color-danger-text)] shrink-0 transition-opacity text-[12px] leading-none"
          title="Remove"
        >
          ×
        </button>
      )}
    </div>
  )
}

function NewContactRow({ type, workspaceId, agentId, nextSortOrder, onSaved, onCancel }) {
  const [label, setLabel]               = useState('')
  const [value, setValue]               = useState('')
  const [saving, setSaving]             = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [insertError, setInsertError]   = useState('')
  const labelRef = useRef(null)
  const valueRef = useRef(null)

  useEffect(() => { labelRef.current?.focus() }, [])

  const save = async () => {
    if (!value.trim()) { onCancel(); return }
    setSaving(true)
    const { error } = await supabase.from('agent_contacts').insert({
      workspace_id: workspaceId,
      agent_id:     agentId,
      type,
      value:        value.trim(),
      label:        label.trim(),
      is_primary:   false,
      sort_order:   nextSortOrder,
    })
    setSaving(false)
    if (error) { setInsertError(error.message); return }
    onSaved()
  }

  const inputCls = 'px-1.5 py-0.5 text-[11px] rounded bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] border border-[color:var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--color-accent)]'

  return (
    <div className="flex items-center gap-1.5 py-1">
      <div className="relative">
        <input
          ref={labelRef}
          value={label}
          onChange={e => setLabel(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); valueRef.current?.focus() }
            if (e.key === 'Escape') onCancel()
          }}
          className={`${inputCls} w-20`}
          placeholder="Label"
          disabled={saving}
        />
        {showSuggestions && (
          <div className="absolute top-full left-0 mt-0.5 bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] rounded shadow-lg z-10 min-w-[100px]">
            {LABEL_SUGGESTIONS.map(s => (
              <button
                key={s}
                onMouseDown={() => { setLabel(s); setShowSuggestions(false); setTimeout(() => valueRef.current?.focus(), 0) }}
                className="block w-full text-left px-3 py-1 text-[11px] text-[color:var(--color-text)] hover:bg-[color:var(--color-bg-elev)] transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="text-[color:var(--color-text-dim)] text-[10px] shrink-0">·</span>
      <input
        ref={valueRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel() }}
        className={`${inputCls} flex-1 min-w-0`}
        placeholder={type === 'email' ? 'email@example.com' : '(555) 000-0000'}
        disabled={saving}
      />
      {insertError && (
        <div className="text-[11px] text-[color:var(--color-danger-text)] ml-1">{insertError}</div>
      )}
      <button onClick={onCancel} className="text-[color:var(--color-text-dim)] text-[12px] opacity-60 hover:opacity-100">×</button>
    </div>
  )
}

export default function AgentContactList({ agentId, workspaceId, type, contacts, onChanged, onPrimaryEmailChanged, showPrimary = false, canEdit = true, onBeforeAdd }) {
  const [adding, setAdding] = useState(false)
  const [error, setError]   = useState(null)

  const updateField = async (id, field, val) => {
    setError(null)
    const { error: err } = await supabase.from('agent_contacts').update({ [field]: val }).eq('id', id)
    if (err) { setError(err.message); return }
    onChanged()
  }

  const deleteContact = async (id) => {
    setError(null)
    const target = contacts.find(c => c.id === id)
    const { error: err } = await supabase.from('agent_contacts').delete().eq('id', id)
    if (err) { setError(err.message); return }

    if (target?.is_primary && type === 'email') {
      const remaining = contacts.filter(c => c.id !== id)
      if (remaining.length > 0) {
        const next = remaining.sort((a, b) => a.sort_order - b.sort_order)[0]
        await supabase.from('agent_contacts').update({ is_primary: true }).eq('id', next.id)
        onPrimaryEmailChanged?.(next.value)
      } else {
        onPrimaryEmailChanged?.(null)
      }
    }
    onChanged()
  }

  const makePrimary = async (id) => {
    setError(null)
    const current = contacts.find(c => c.is_primary)
    if (current) await supabase.from('agent_contacts').update({ is_primary: false }).eq('id', current.id)
    const { error: err } = await supabase.from('agent_contacts').update({ is_primary: true }).eq('id', id)
    if (err) { setError(err.message); return }
    const target = contacts.find(c => c.id === id)
    onPrimaryEmailChanged?.(target?.value)
    onChanged()
  }

  const nextSortOrder = contacts.length > 0 ? Math.max(...contacts.map(c => c.sort_order)) + 1 : 0

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">
        {type === 'phone' ? 'Phones' : 'Emails'}
      </div>

      {contacts.map(c => (
        <ContactRow
          key={c.id}
          contact={c}
          showPrimary={showPrimary}
          canEdit={canEdit}
          onDelete={deleteContact}
          onUpdateLabel={(id, val) => updateField(id, 'label', val)}
          onUpdateValue={(id, val) => updateField(id, 'value', val)}
          onMakePrimary={makePrimary}
        />
      ))}

      {adding && (
        <NewContactRow
          type={type}
          workspaceId={workspaceId}
          agentId={agentId}
          nextSortOrder={nextSortOrder}
          onSaved={() => { setAdding(false); onChanged() }}
          onCancel={() => setAdding(false)}
        />
      )}

      {canEdit && !adding && (
        <button
          onClick={async () => { await onBeforeAdd?.(); setAdding(true) }}
          className="text-[11px] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-accent)] transition-colors mt-0.5"
        >
          + Add {type}
        </button>
      )}

      {error && (
        <div className="text-[11px] text-[color:var(--color-danger-text)] mt-1">{error}</div>
      )}
    </div>
  )
}
