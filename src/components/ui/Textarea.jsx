export default function Textarea({
  label,
  error,
  rows = 3,
  className = '',
  containerClassName = '',
  required = false,
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
      <textarea
        id={fieldId}
        rows={rows}
        className={`px-2.5 py-2 text-[13px] rounded-md bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-faint)] border transition-colors focus:outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)] resize-y ${error ? 'border-[color:var(--color-danger)]' : 'border-[color:var(--color-line)] hover:border-[color:var(--color-line-strong)]'} ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-[color:var(--color-danger-text)]">{error}</p>}
    </div>
  )
}
