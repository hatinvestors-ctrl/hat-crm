export default function CurrencyInput({
  label,
  value,
  onChange,
  error,
  className = '',
  containerClassName = '',
  required = false,
  placeholder = '0',
  id,
  ...props
}) {
  const fieldId = id || (label ? `field-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined)
  return (
    <div className={`flex flex-col gap-1.5 ${containerClassName}`}>
      {label && (
        <label htmlFor={fieldId} className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--color-text-muted)]">
          {label} {required && <span className="text-[color:var(--color-danger-text)]">*</span>}
        </label>
      )}
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--color-text-dim)] text-[13px] pointer-events-none tabular-nums">$</span>
        <input
          id={fieldId}
          type="number"
          inputMode="decimal"
          step="0.01"
          value={value ?? ''}
          onChange={(e) => onChange?.(e.target.value === '' ? null : e.target.value)}
          placeholder={placeholder}
          className={`h-8 pl-6 pr-2.5 w-full text-[13px] tabular-nums rounded-md bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-faint)] border transition-colors focus:outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)] ${error ? 'border-[color:var(--color-danger)]' : 'border-[color:var(--color-line)] hover:border-[color:var(--color-line-strong)]'} ${className}`}
          {...props}
        />
      </div>
      {error && <p className="text-xs text-[color:var(--color-danger-text)]">{error}</p>}
    </div>
  )
}
