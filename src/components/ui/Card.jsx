/* Flat dark surface with a clearly emphasized header strip so sections are easy to scan. */
export default function Card({ children, className = '', title, action, padding = true }) {
  return (
    <section className={`bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-lg overflow-hidden ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-4 h-11 bg-[color:var(--color-bg-elev-2)] border-b border-[color:var(--color-line)]">
          {title && (
            <h3 className="flex items-center gap-2 text-[14px] font-semibold text-[color:var(--color-text)] tracking-tight">
              <span className="w-0.5 h-4 rounded-full bg-[color:var(--color-accent)]" aria-hidden="true" />
              {title}
            </h3>
          )}
          {action && <div>{action}</div>}
        </header>
      )}
      <div className={padding ? 'p-4' : ''}>{children}</div>
    </section>
  )
}
