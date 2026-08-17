// src/components/lead-detail/workspace/OnMarketAcquisitionWorkspace.jsx
// Lead Workspace redesign, Phase 2.1, Section 7A — turns the on-market
// Acquisition tab from "mostly a Contact tab" into an execution workspace,
// reusing existing data/components only. No new recommendation engine, no
// new LLM calls — Next Move reads ActionZone's own PLAYBOOKS (exported,
// Phase 2.1), Questions reads the existing AI-generated deal_brief if one
// was already generated (never triggers generation here).
import { formatCurrency as fc } from '../../../lib/calculations'
import { computeFlipResult, computeBrrrrResult } from '../../../lib/dealExplanation'
import { PLAYBOOKS, DEFAULT_PLAYBOOK, smartHint } from '../ActionZone'
import ListingAgentCard from '../ListingAgentCard'
import ContactInfoSection from '../ContactInfoSection'
import ActivityTimeline from '../ActivityTimeline'
import EmptyState from './EmptyState'
import { getAcquisitionReadiness } from './readiness'

export default function OnMarketAcquisitionWorkspace({ lead, userId, members, canEdit, onUpdated, onOpenActivity }) {
  const flip = computeFlipResult(lead)
  const brrrr = computeBrrrrResult(lead)
  const playbook = PLAYBOOKS[lead.status] || DEFAULT_PLAYBOOK
  const nextMove = smartHint(lead, playbook.hint)
  const { hasAgent, hasContact } = getAcquisitionReadiness(lead)
  const questions = lead.deal_brief?.questions?.slice(0, 4) || []

  return (
    <div className="space-y-4">
      {/* 1 — Next Move: the ONE dominant action on this tab (Part 3/6) —
          reuses the SAME PLAYBOOKS/smartHint ActionZone's own "Next Best
          Action" uses, so Acquisition never disagrees with Overview. */}
      <div className="rounded-lg border-l-4 border border-[color:var(--color-line)] px-4 py-3" style={{ borderLeftColor: 'var(--color-accent)' }}>
        <div className="text-[9.5px] uppercase tracking-widest font-bold text-[color:var(--color-text-dim)] mb-1">Next Move</div>
        <p className="text-[14px] font-bold text-[color:var(--color-text)] leading-snug">{nextMove}</p>
      </div>

      {/* 2 — Negotiation Position */}
      <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-4 py-3">
        <div className="text-[9.5px] uppercase tracking-widest font-bold text-[color:var(--color-text-dim)] mb-2">Negotiation Position</div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          <div>
            <div className="text-[8.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Asking Price</div>
            <div className="text-[13px] font-bold">{lead.asking_price != null ? fc(lead.asking_price) : 'Not available'}</div>
          </div>
          <div>
            <div className="text-[8.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Starting Offer</div>
            <div className="text-[13px] font-bold">{lead.starting_offer != null ? fc(lead.starting_offer) : 'Not set'}</div>
          </div>
          <div>
            <div className="text-[8.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Current Offer</div>
            <div className="text-[13px] font-bold">{flip.available && flip.currentOffer != null ? fc(flip.currentOffer) : 'Not available'}</div>
          </div>
          <div>
            <div className="text-[8.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Max Buy (Flip)</div>
            <div className="text-[13px] font-bold" style={{ color: 'var(--color-accent-text)' }}>{flip.available ? fc(Math.round(flip.mao / 100) * 100) : 'Not available'}</div>
          </div>
          <div>
            <div className="text-[8.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Max Buy (BRRRR)</div>
            <div className="text-[13px] font-bold" style={{ color: 'var(--color-accent-text)' }}>{brrrr.available ? fc(Math.round(brrrr.mao / 100) * 100) : 'Not available'}</div>
          </div>
        </div>
        {/* Part 12 — one-line interpretation, existing values only. Only
            shown when the gap is genuinely large (>15% of asking price)
            so it doesn't state the obvious on a near-MAO offer. */}
        {lead.asking_price != null && flip.available && (lead.asking_price - flip.mao) > lead.asking_price * 0.15 && (
          <p className="text-[11px] text-[color:var(--color-warn-text)] mt-2.5">
            Seller is asking {fc(lead.asking_price)} while HAT's Max Buy is {fc(Math.round(flip.mao / 100) * 100)} — a major price reduction would be required.
          </p>
        )}
      </div>

      {/* 3 — Questions/Talking Points, only if an AI Deal Brief already generated them */}
      {questions.length > 0 && (
        <div className="rounded-lg border border-[color:var(--color-line)] px-4 py-3">
          <div className="text-[9.5px] uppercase tracking-widest font-bold text-[color:var(--color-text-dim)] mb-2">Questions To Ask</div>
          <ol className="list-decimal list-inside space-y-1">
            {questions.map((q, i) => (
              <li key={i} className="text-[12.5px] text-[color:var(--color-text-muted)]">{q}</li>
            ))}
          </ol>
        </div>
      )}

      {/* A — Listing / Agent. Listing-agent fields (unlike Contact below)
          have no manual-entry UI anywhere in the app today — they're
          populated only by MLS enrichment (see LeadForm.jsx). Per the
          mission's explicit instruction, this is stated honestly rather
          than given a fake "Add Agent" button; the real mechanism (MLS
          refresh) already lives in Overview's MlsStatusBanner. */}
      {hasAgent ? (
        <ListingAgentCard lead={lead} />
      ) : (
        <EmptyState title="Listing Agent Needed" explanation="Not yet in MLS enrichment data. Refresh MLS status from Overview, or add it once the listing is found." />
      )}

      {/* E — Contact + communication actions. ContactInfoSection's own
          fields ARE the real "add contact" action (EditableField,
          click-to-fill) — always mount it rather than swapping in a
          dead-end empty state with no real action behind it. */}
      <ContactInfoSection lead={lead} userId={userId} members={members} canEdit={canEdit} onUpdated={onUpdated} />
      {!hasContact && (
        <div className="text-[11px] text-[color:var(--color-text-dim)] -mt-2 px-1">Click any field above to add seller/agent contact info.</div>
      )}

      {/* F — Recent negotiation/offer history — reuses ActivityTimeline's
          existing query, capped and linked to the full Activity tab. */}
      <div>
        <ActivityTimeline leadId={lead.id} maxItems={5} title="Recent Activity" emptyMessage="No activity recorded yet." />
        <button type="button" onClick={onOpenActivity} className="text-[11px] font-semibold underline text-[color:var(--color-accent-text)] mt-1.5">
          See full history →
        </button>
      </div>
    </div>
  )
}
