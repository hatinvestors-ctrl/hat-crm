import { useState } from 'react'
import Card from '../ui/Card'
import { safeTelHref, safeMailtoHref } from '../../lib/urlSafety'
import { formatPhone } from '../../lib/calculations'
import AgentNegotiationModal from './AgentNegotiationModal'

// Shows the LISTING agent contact (from RentCast). This is the person
// representing the seller — different from `seller_name`/`phone`/`email`
// on the lead, which may be a wholesaler, FSBO seller, or our own contact.
export default function ListingAgentCard({ lead }) {
  const [composeOpen, setComposeOpen] = useState(false)

  const hasAny = lead.listing_agent_name || lead.listing_agent_phone || lead.listing_agent_email || lead.listing_brokerage
  if (!hasAny) return null

  const phoneHref = safeTelHref(lead.listing_agent_phone)
  const emailHref = safeMailtoHref(lead.listing_agent_email)

  return (
    <Card title="Listing Agent">
      <div className="space-y-2">
        {lead.listing_agent_name && (
          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Agent</div>
            <div className="text-[13.5px] text-[color:var(--color-text)] font-medium">{lead.listing_agent_name}</div>
            {lead.listing_brokerage && (
              <div className="text-[11.5px] text-[color:var(--color-text-muted)]">{lead.listing_brokerage}</div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {lead.listing_agent_phone && (
            <div>
              <div className="text-[10.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Phone</div>
              <div className="text-[13px] text-[color:var(--color-text)] tabular-nums">{formatPhone(lead.listing_agent_phone)}</div>
            </div>
          )}
          {lead.listing_agent_email && (
            <div className="min-w-0">
              <div className="text-[10.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Email</div>
              <div className="text-[13px] text-[color:var(--color-text)] truncate">{lead.listing_agent_email}</div>
            </div>
          )}
        </div>

        <div className="pt-2 border-t border-[color:var(--color-line)] flex flex-wrap gap-1.5">
          {phoneHref && (
            <a href={phoneHref} className="text-[12px] px-2 py-1 bg-[color:var(--color-bg-elev-2)] hover:bg-[color:var(--color-accent-soft)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent-text)] rounded transition-colors">
              📞 Call ↗
            </a>
          )}
          <button
            onClick={() => setComposeOpen(true)}
            className="text-[12px] px-2 py-1 bg-[color:var(--color-bg-elev-2)] hover:bg-[color:var(--color-accent-soft)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent-text)] rounded transition-colors"
          >
            📧 Generate Agent Email
          </button>
        </div>

        {lead.mls_number && (
          <div className="text-[10.5px] text-[color:var(--color-text-dim)]">
            MLS#: <span className="tabular-nums">{lead.mls_number}</span>
            {lead.list_price && <> · listed at <span className="tabular-nums">${Number(lead.list_price).toLocaleString()}</span></>}
            {lead.list_date && <> on {lead.list_date}</>}
          </div>
        )}

        <ListingHistory lead={lead} />
      </div>

      <AgentNegotiationModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        lead={lead}
        recipientEmail={lead.listing_agent_email}
      />
    </Card>
  )
}

// Mini timeline of price + status changes pulled from RentCast's `history` payload
// (stored in lead.enrichment_data.listing.history).
function ListingHistory({ lead }) {
  const raw = lead.enrichment_data?.listing?.history
  if (!raw || typeof raw !== 'object') return null
  const entries = Object.entries(raw)
    .map(([date, evt]) => ({ date, ...evt }))
    .sort((a, b) => (a.date < b.date ? 1 : -1))   // newest first
  if (entries.length === 0) return null

  return (
    <div className="pt-2 border-t border-[color:var(--color-line)]">
      <div className="text-[10.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1.5">
        Listing history
      </div>
      <ol className="space-y-1">
        {entries.slice(0, 6).map((e, i) => {
          const prev = entries[i + 1]
          let delta = null
          if (prev && typeof e.price === 'number' && typeof prev.price === 'number') {
            const d = e.price - prev.price
            if (d !== 0) delta = d
          }
          return (
            <li key={e.date} className="flex items-baseline gap-2 text-[11.5px]">
              <span className="text-[color:var(--color-text-dim)] tabular-nums shrink-0">{e.date}</span>
              <span className="text-[color:var(--color-text-muted)]">{e.event || 'Update'}</span>
              {typeof e.price === 'number' && (
                <span className="text-[color:var(--color-text)] tabular-nums font-medium">
                  ${e.price.toLocaleString()}
                </span>
              )}
              {delta !== null && (
                <span className={`tabular-nums ${delta < 0 ? 'text-[color:var(--color-success-text)]' : 'text-[color:var(--color-danger-text)]'}`}>
                  {delta < 0 ? '↓' : '↑'} ${Math.abs(delta).toLocaleString()}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
