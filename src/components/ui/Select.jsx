export default function Select({
  label,
  options = [],
  error,
  className = '',
  containerClassName = '',
  required = false,
  placeholder,
  id,
  ...props
}) {
  const selectId = id || (label ? `field-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined)
  return (
    <div className={`flex flex-col gap-1.5 ${containerClassName}`}>
      {label && (
        <label htmlFor={selectId} className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--color-text-muted)]">
          {label} {required && <span className="text-[color:var(--color-danger-text)]">*</span>}
        </label>
      )}
      <select
        id={selectId}
        className={`h-8 px-2.5 text-[13px] rounded-md bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] border transition-colors focus:outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)] appearance-none bg-no-repeat bg-[length:14px] bg-[right_8px_center] cursor-pointer pr-7 ${error ? 'border-[color:var(--color-danger)]' : 'border-[color:var(--color-line)] hover:border-[color:var(--color-line-strong)]'} ${className}`}
        style={{ backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23808a99' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>")` }}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {error && <p className="text-xs text-[color:var(--color-danger-text)]">{error}</p>}
    </div>
  )
}
