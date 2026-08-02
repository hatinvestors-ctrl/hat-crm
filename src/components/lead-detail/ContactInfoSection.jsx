import { useState } from 'react'
import Card from '../ui/Card'
import EditableField from './EditableField'
import AgentNegotiationModal from './AgentNegotiationModal'
import { LEAD_SOURCES } from '../../lib/constants'
import { useLeadUpdate } from '../../hooks/useLeadUpdate'
import { safeTelHref, safeMailtoHref } from '../../lib/urlSafety'
import { formatPhone } from '../../lib/calculations'

export default function ContactInfoSection({ lead, userId, members, canEdit, onUpdated }) {
  const [composeOpen, setComposeOpen] = useState(false)
  const update = useLeadUpdate(lead, userId, members, onUpdated)

  // If the Contact phone/email exactly match the Listing Agent's,
  // it's the same person — flag that so the user knows it's not duplicate data.
  const normalize = (s) => (s || '').toString().replace(/\D/g, '')
  const sameAsListingAgent =
    !!lead.listing_agent_name &&
    (
      (lead.phone && normalize(lead.phone) === normalize(lead.listing_agent_phone)) ||
      (lead.email && lead.listing_agent_email && lead.email.toLowerCase() === lead.listing_agent_email.toLowerCase())
    )

  return (
    <Card title="Contact">
      {sameAsListingAgent && (
        <div className="mb-3 inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)]">
          <span>ℹ</span>
          <span>Same person as the Listing Agent below — edit this if you're working with someone else (e.g. a wholesaler).</span>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <EditableField
          label="Seller / Agent"
          value={lead.seller_name}
          onSave={(v) => update({ seller_name: v })}
          disabled={!canEdit}
        />
        <EditableField
          label="Lead Source"
          value={lead.lead_source}
          type="select"
          options={LEAD_SOURCES}
          onSave={(v) => update({ lead_source: v })}
          disabled={!canEdit}
        />
        <EditableField
          label="Phone"
          value={lead.phone}
          formatter={formatPhone}
          onSave={(v) => update({ phone: v })}
          disabled={!canEdit}
        />
        <EditableField
          label="Email"
          value={lead.email}
          onSave={(v) => update({ email: v })}
          disabled={!canEdit}
        />
      </div>

      {(safeTelHref(lead.phone) || lead.email) && (
        <div className="mt-4 pt-3 border-t border-[color:var(--color-line)] flex flex-wrap gap-1.5">
          {safeTelHref(lead.phone) && (
            <a href={safeTelHref(lead.phone)} className="text-[12px] px-2 py-1 bg-[color:var(--color-bg-elev-2)] hover:bg-[color:var(--color-accent-soft)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent-text)] rounded transition-colors">
              Call ↗
            </a>
          )}
          {lead.email && (
            <button
              onClick={() => setComposeOpen(true)}
              className="text-[12px] px-2 py-1 bg-[color:var(--color-bg-elev-2)] hover:bg-[color:var(--color-accent-soft)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent-text)] rounded transition-colors"
            >
              📧 Generate Email
            </button>
          )}
        </div>
      )}

      <AgentNegotiationModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        lead={lead}
        recipientEmail={lead.email}
      />
    </Card>
  )
}
