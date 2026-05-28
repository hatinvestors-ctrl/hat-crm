import Card from '../ui/Card'

// Each cell — label, value, optional sub-line, optional delta vs previous period.
function Cell({ label, value, sub, delta, tone = 'neutral' }) {
  const toneCls = {
    neutral: 'text-[color:var(--color-text)]',
    accent:  'text-[color:var(--color-accent-text)]',
    success: 'text-[color:var(--color-success-text)]',
    warn:    'text-[color:var(--color-warn-text)]',
    danger:  'text-[color:var(--color-danger-text)]',
  }[tone]

  const deltaColor =
    delta === null || delta === undefined ? '' :
    delta > 0 ? 'text-[color:var(--color-success-text)]' :
    delta < 0 ? 'text-[color:var(--color-danger-text)]' :
                'text-[color:var(--color-text-dim)]'

  return (
    <div className="px-4 py-3 border-r border-b border-[color:var(--color-line)] last:border-r-0">
      <div className="text-[10.5px] uppercase tracking-wider font-medium text-[color:var(--color-text-dim)]">{label}</div>
      <div className={`mt-1 text-[24px] font-semibold tabular-nums leading-tight ${toneCls}`}>{value}</div>
      <div className="flex items-baseline gap-2 mt-0.5">
        {sub && <span className="text-[11px] text-[color:var(--color-text-dim)]">{sub}</span>}
        {delta !== null && delta !== undefined && (
          <span className={`text-[11px] tabular-nums ${deltaColor}`}>
            {delta > 0 ? `+${delta}` : delta} vs prev
          </span>
        )}
      </div>
    </div>
  )
}

export default function ThroughputGrid({ rangeLabel, throughput }) {
  return (
    <Card title={`Throughput — ${rangeLabel}`}>
      <div className="-m-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 border-t border-l border-[color:var(--color-line)] [&>div:last-child]:border-r-0">
        <Cell label="New Leads"            value={throughput.new_leads}        delta={throughput.delta_new_leads} />
        <Cell label="MAO Calculated"       value={throughput.mao_calculated}   delta={throughput.delta_mao_calculated} />
        <Cell label="Sent to HAT"          value={throughput.sent_to_hat}      delta={throughput.delta_sent_to_hat}      tone="accent" />
        <Cell label="HAT Signed"           value={throughput.hat_signed}       delta={throughput.delta_hat_signed}       tone="accent" />
        <Cell label="Offers → Seller"      value={throughput.offers_to_seller} delta={throughput.delta_offers_to_seller} tone="accent" />
        <Cell label="Accepted"             value={throughput.accepted}         delta={throughput.delta_accepted}         tone="success" />
        <Cell label="Sold"                 value={throughput.sold}             delta={throughput.delta_sold}             tone="success" />
      </div>
    </Card>
  )
}
