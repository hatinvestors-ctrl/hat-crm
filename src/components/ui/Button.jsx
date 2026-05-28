const VARIANTS = {
  primary:   'bg-[color:var(--color-accent)] hover:bg-[color:var(--color-accent-hover)] text-white border border-transparent shadow-[0_1px_0_rgba(255,255,255,0.08)_inset]',
  secondary: 'bg-[color:var(--color-bg-elev)] hover:bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text)] border border-[color:var(--color-line)]',
  ghost:     'bg-transparent hover:bg-[color:var(--color-bg-elev)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] border border-transparent',
  danger:    'bg-[color:var(--color-danger)] hover:brightness-110 text-white border border-transparent',
  success:   'bg-[color:var(--color-success)] hover:brightness-110 text-white border border-transparent',
}

const SIZES = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-8 px-3 text-[13px] gap-1.5',
  lg: 'h-9 px-3.5 text-sm gap-2',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className = '',
  disabled = false,
  loading = false,
  children,
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {loading && (
        <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
          <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )}
      {children}
    </button>
  )
}
