export default function EmptyState({ icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-4 text-center">
      {icon && (
        <div className="w-12 h-12 rounded-full bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] flex items-center justify-center text-xl text-[color:var(--color-text-dim)] mb-3">
          {icon}
        </div>
      )}
      <h3 className="text-[14px] font-semibold text-[color:var(--color-text)]">{title}</h3>
      {description && (
        <p className="text-[13px] text-[color:var(--color-text-muted)] mt-1 max-w-md leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
