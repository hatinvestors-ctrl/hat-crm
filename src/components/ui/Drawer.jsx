import { useEffect } from 'react'

// Right-side slide-over panel. Used by TaskDetailDrawer.
export default function Drawer({ open, onClose, title, children, width = 480, footer }) {
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

  return (
    <div
      className={`fixed inset-0 z-50 transition-opacity ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      aria-hidden={!open}
    >
      <div
        className="absolute inset-0 bg-[oklch(0_0_0/0.5)] backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        style={{ width }}
        className={`absolute top-0 right-0 h-full max-w-full bg-[color:var(--color-bg-elev)] border-l border-[color:var(--color-line)] shadow-[-12px_0_32px_oklch(0_0_0/0.4)] flex flex-col transition-transform duration-200 ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <header className="flex items-center justify-between px-4 h-11 border-b border-[color:var(--color-line)] shrink-0">
          <h2 className="text-[14px] font-semibold text-[color:var(--color-text)] truncate">{title}</h2>
          <button
            onClick={onClose}
            className="text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] w-6 h-6 rounded inline-flex items-center justify-center hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && (
          <footer className="px-4 h-12 border-t border-[color:var(--color-line)] bg-[color:var(--color-bg)] flex items-center justify-end gap-2 shrink-0">
            {footer}
          </footer>
        )}
      </aside>
    </div>
  )
}
