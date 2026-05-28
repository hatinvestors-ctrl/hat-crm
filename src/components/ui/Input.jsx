export default function Input({
  label,
  error,
  hint,
  className = '',
  containerClassName = '',
  required = false,
  id,
  ...props
}) {
  const inputId = id || (label ? `field-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined)
  return (
    <div className={`flex flex-col gap-1.5 ${containerClassName}`}>
      {label && (
        <label htmlFor={inputId} className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--color-text-muted)]">
          {label} {required && <span className="text-[color:var(--color-danger-text)]">*</span>}
        </label>
      )}
      <input
        id={inputId}
        className={`h-8 px-2.5 text-[13px] rounded-md bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-faint)] border transition-colors focus:outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)] disabled:opacity-50 ${error ? 'border-[color:var(--color-danger)]' : 'border-[color:var(--color-line)] hover:border-[color:var(--color-line-strong)]'} ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-[color:var(--color-danger-text)]">{error}</p>}
      {!error && hint && <p className="text-xs text-[color:var(--color-text-dim)]">{hint}</p>}
    </div>
  )
}
