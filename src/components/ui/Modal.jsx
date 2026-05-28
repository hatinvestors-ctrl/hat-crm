import { useEffect } from 'react'

export default function Modal({ open, onClose, title, children, size = 'md', footer }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  const sizes = {
    sm: 'max-w-md',
    md: 'max-w-xl',
    lg: 'max-w-3xl',
    xl: 'max-w-5xl',
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[oklch(0_0_0/0.6)] backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-lg w-full ${sizes[size]} max-h-[90vh] flex flex-col shadow-[0_24px_60px_oklch(0_0_0/0.5)]`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <header className="flex items-center justify-between px-4 h-11 border-b border-[color:var(--color-line)]">
            <h2 className="text-[14px] font-semibold text-[color:var(--color-text)]">{title}</h2>
            <button
              onClick={onClose}
              className="text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] w-6 h-6 rounded inline-flex items-center justify-center hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </header>
        )}
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && (
          <footer className="px-4 h-12 border-t border-[color:var(--color-line)] bg-[color:var(--color-bg)] flex items-center justify-end gap-2">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
