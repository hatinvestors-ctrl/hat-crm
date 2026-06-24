// Bottom action bar for each deal: Pass / Save to CRM / Get Negotiation Plan

function buildDashboardUrl(deal) {
  const asking = deal.askingPrice
    ? parseFloat(String(deal.askingPrice).replace(/[^0-9.]/g, '')) || ''
    : ''
  const p = new URLSearchParams()
  if (asking)              p.set('pp',      asking)
  if (deal.enriched?.arv) p.set('arv',     deal.enriched.arv)
  if (deal.address)        p.set('address', deal.address)
  if (deal.enriched?.bedrooms)  p.set('beds', deal.enriched.bedrooms)
  if (deal.enriched?.bathrooms) p.set('baths', deal.enriched.bathrooms)
  if (deal.enriched?.sqft)      p.set('sqft', deal.enriched.sqft)
  if (deal.enriched?.zip_code)  p.set('zip', deal.enriched.zip_code)
  return `/deal-analyzer.html?${p.toString()}`
}

export default function DecisionStrip({
  deal,
  onPass,
  onSave,
  onGetNegoPlan,
  saving,
  gettingNego,
}) {
  if (!deal || deal.status === 'idle' || deal.status === 'enriching' || deal.status === 'analyzing') {
    return null
  }

  const isPassed = deal.status === 'passed'
  const isSaved  = deal.status === 'saved'
  const hasNego  = !!deal.negoNotes
  const dashUrl  = buildDashboardUrl(deal)

  if (isPassed || isSaved) {
    return (
      <div className="px-4 py-3 border-t border-[color:var(--color-line)] flex items-center gap-2">
        <span className="text-[12px] text-[color:var(--color-text-dim)]">
          {isSaved ? '✓ Saved to CRM' : 'Passed — not saving this deal'}
        </span>
        <div className="flex-1" />
        <a
          href={dashUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 h-8 inline-flex items-center rounded-md text-[12px] font-semibold border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
        >
          📊 Deal Dashboard
        </a>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 border-t border-[color:var(--color-line)] flex items-center gap-2 flex-wrap">
      <button
        onClick={onPass}
        className="px-3 h-8 rounded-md text-[12px] font-semibold border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
      >
        Pass
      </button>

      <a
        href={dashUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="px-3 h-8 inline-flex items-center rounded-md text-[12px] font-semibold border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
      >
        📊 Deal Dashboard
      </a>

      <div className="flex-1" />

      {!hasNego && (
        <button
          onClick={onGetNegoPlan}
          disabled={gettingNego}
          className="px-3 h-8 rounded-md text-[12px] font-semibold border border-[color:var(--color-accent)] text-[color:var(--color-accent-text)] bg-[color:var(--color-accent-soft)] hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {gettingNego ? 'Getting Plan…' : '🤝 Get Negotiation Plan'}
        </button>
      )}
      {hasNego && (
        <span className="text-[11px] text-[color:var(--color-success-text)]">✓ Plan ready</span>
      )}

      <button
        onClick={onSave}
        disabled={saving}
        className="px-3 h-8 rounded-md text-[12px] font-semibold bg-[color:var(--color-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save to CRM'}
      </button>
    </div>
  )
}
