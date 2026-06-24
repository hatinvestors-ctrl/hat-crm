// Left panel — list of deals in the screener session

export default function DealQueue({ deals, selectedId, onSelect, onAdd }) {
  return (
    <div className="flex flex-col h-full border-r border-[color:var(--color-line)]">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[color:var(--color-line)]">
        <span className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-text-muted)]">
          Deal Queue ({deals.length})
        </span>
        <button
          onClick={onAdd}
          className="text-[11px] px-2 py-0.5 rounded-md font-semibold bg-[color:var(--color-accent)] text-white hover:opacity-90 transition-opacity"
        >
          + Add
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1" style={{ scrollbarWidth: 'thin' }}>
        {deals.length === 0 && (
          <p className="text-[12px] text-[color:var(--color-text-dim)] text-center mt-8 px-4 leading-relaxed">
            No deals yet.<br />Click "+ Add" or upload a CSV.
          </p>
        )}
        {deals.map(deal => (
          <DealCard
            key={deal.id}
            deal={deal}
            isSelected={deal.id === selectedId}
            onClick={() => onSelect(deal.id)}
          />
        ))}
      </div>
    </div>
  )
}

function DealCard({ deal, isSelected, onClick }) {
  const { address, askingPrice, status, score, verdict, mao } = deal
  const askingNum = parseFloat(String(askingPrice || '').replace(/[^0-9.]/g, '')) || null
  const gap = mao && askingNum ? askingNum - mao : null

  const statusBadge = {
    idle:      { label: '',             color: '' },
    enriching: { label: 'Looking up…',  color: 'var(--color-text-dim)' },
    analyzing: { label: 'Analyzing…',   color: 'var(--color-warn-text)' },
    done:      { label: '',             color: '' },
    passed:    { label: 'Passed',       color: 'var(--color-text-dim)' },
    saved:     { label: 'Saved ✓',      color: 'var(--color-success-text)' },
  }[status] || { label: '', color: '' }

  const verdictColor = v => {
    if (!v) return 'var(--color-text-muted)'
    const u = v.toUpperCase()
    if (u.includes('BUY'))   return 'var(--color-success-text)'
    if (u.includes('OFFER')) return 'var(--color-accent-text)'
    if (u.includes('WATCH')) return 'var(--color-warn-text)'
    return 'var(--color-danger-text)'
  }

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 border-b border-[color:var(--color-line)] transition-colors"
      style={{
        background: isSelected ? 'var(--color-accent-soft)' : 'transparent',
        opacity: status === 'passed' ? 0.45 : 1,
      }}
    >
      <div className="flex items-start justify-between gap-1.5">
        <span className="text-[12px] font-semibold text-[color:var(--color-text)] leading-snug truncate">
          {address || 'New Deal'}
        </span>
        {score != null && (
          <span className="shrink-0 text-[11px] font-bold tabular-nums" style={{ color: verdictColor(verdict) }}>
            {score}/100
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        {verdict && (
          <span className="text-[10px] font-semibold" style={{ color: verdictColor(verdict) }}>
            {verdict}
          </span>
        )}
        {gap != null && (
          <span className="text-[10px] text-[color:var(--color-text-dim)]">
            {gap > 0 ? `+$${gap.toLocaleString()} above MAO` : `$${Math.abs(gap).toLocaleString()} below MAO`}
          </span>
        )}
        {statusBadge.label && (
          <span className="text-[10px] ml-auto" style={{ color: statusBadge.color }}>
            {statusBadge.label}
          </span>
        )}
      </div>
    </button>
  )
}
