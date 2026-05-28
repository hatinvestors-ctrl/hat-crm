export default function LoadingSpinner({ size = 'md', label, fullPage = false }) {
  const sizes = { sm: 'h-3.5 w-3.5', md: 'h-5 w-5', lg: 'h-8 w-8' }
  const spinner = (
    <div className="flex flex-col items-center justify-center gap-2 text-[color:var(--color-text-dim)]">
      <svg className={`animate-spin ${sizes[size]}`} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" className="opacity-20" />
        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      {label && <span className="text-[13px]">{label}</span>}
    </div>
  )
  if (fullPage) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        {spinner}
      </div>
    )
  }
  return spinner
}
