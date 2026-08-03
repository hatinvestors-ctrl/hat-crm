import { useEffect, useRef, useState } from 'react'

// Inline-editable field. Click → edit → blur or Enter to save, Esc to cancel.
// Types: text | number | currency | select | bool
export default function EditableField({
  label,
  value,
  onSave,
  type = 'text',
  options = [],   // for type='select'  → [{value, label}]
  formatter,      // (value) => string for display
  placeholder = '—',
  disabled = false,
  displayClassName,  // optional: override display button text classes
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => {
    setDraft(value ?? '')
    setError(null)
  }, [value])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const display = (() => {
    if (value === null || value === undefined || value === '') return placeholder
    if (formatter) return formatter(value)
    if (type === 'bool') return value === true ? 'Yes' : value === false ? 'No' : placeholder
    if (type === 'select') return options.find(o => o.value === value)?.label || value
    return value
  })()

  const isEmpty = value === null || value === undefined || value === ''

  const cancel = () => {
    setDraft(value ?? '')
    setError(null)
    setEditing(false)
  }

  const commit = async () => {
    if (saving) return
    let v = draft
    // Normalize
    if (v === '') v = null
    else if (type === 'number') {
      const n = parseInt(v, 10)
      v = Number.isFinite(n) ? n : null
    } else if (type === 'currency') {
      const n = parseFloat(String(v).replace(/[$,]/g, ''))
      v = Number.isFinite(n) ? n : null
    } else if (type === 'bool') {
      v = v === 'true' ? true : v === 'false' ? false : null
    }

    if (String(v ?? '') === String(value ?? '')) {
      setEditing(false)
      return
    }

    setSaving(true)
    setError(null)
    try {
      await onSave(v)
      setEditing(false)
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && type !== 'textarea') { e.preventDefault(); commit() }
    if (e.key === 'Escape') { e.preventDefault(); cancel() }
  }

  const inputCls = 'w-full px-2 py-1 text-[13px] rounded bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] border border-[color:var(--color-accent)] ring-1 ring-[color:var(--color-accent)] focus:outline-none'

  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{label}</div>

      {editing ? (
        <div className="mt-0.5">
          {type === 'select' || type === 'bool' ? (
            <select
              ref={inputRef}
              value={draft === null || draft === undefined ? '' : String(draft)}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              onBlur={commit}
              disabled={saving}
              className={inputCls + ' cursor-pointer'}
            >
              <option value="">— Clear —</option>
              {type === 'bool'
                ? <>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </>
                : options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)
              }
            </select>
          ) : (
            <div className="relative">
              {type === 'currency' && (
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[color:var(--color-text-dim)] text-[13px] pointer-events-none">$</span>
              )}
              <input
                ref={inputRef}
                type={type === 'number' || type === 'currency' ? 'number' : 'text'}
                step={type === 'currency' ? '0.01' : type === 'number' ? '1' : undefined}
                value={draft ?? ''}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                onBlur={commit}
                disabled={saving}
                className={`${inputCls} ${type === 'currency' ? 'pl-6 tabular-nums' : ''}`}
              />
            </div>
          )}
          {error && <div className="text-[11px] text-[color:var(--color-danger-text)] mt-1">{error}</div>}
          {saving && <div className="text-[11px] text-[color:var(--color-text-dim)] mt-1">Saving…</div>}
        </div>
      ) : (
        <button
          onClick={() => !disabled && setEditing(true)}
          disabled={disabled}
          className={`group mt-0.5 w-full inline-flex items-center gap-1 text-left px-1 -mx-1 rounded transition-colors ${displayClassName ?? 'text-[13px]'} ${
            disabled
              ? 'cursor-default'
              : 'cursor-text hover:bg-[color:var(--color-bg-elev-2)]'
          } ${isEmpty ? 'text-[color:var(--color-text-dim)]' : 'text-[color:var(--color-text)]'}`}
          title={disabled ? '' : 'Click to edit'}
        >
          <span className={disabled ? '' : 'border-b border-dashed border-[color:var(--color-accent-soft)] group-hover:border-[color:var(--color-accent)]'}>
            {display || placeholder}
          </span>
          {!disabled && (
            <span className="opacity-50 group-hover:opacity-100 transition-opacity text-[10px] text-[color:var(--color-accent-text)] shrink-0">✎</span>
          )}
        </button>
      )}
    </div>
  )
}
