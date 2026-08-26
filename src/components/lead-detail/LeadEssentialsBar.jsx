// src/components/lead-detail/LeadEssentialsBar.jsx
// Capability — Lead Workspace Essentials & Quick Edit Layer V1.
//
// LEVEL 1 of the workspace hierarchy ("what do I need constantly?") —
// sits above the tabs, visible regardless of which tab is active. This is
// a usability layer only: every value here is read from the SAME
// canonical fields/functions the deeper tabs already use, and every edit
// goes through the SAME useLeadUpdate() hook (auto-recalculates mao,
// fires decisionV2, logs activity — all pre-existing, unchanged).
//
// DEAL INPUTS (Ask/ARV/Rehab/Rent) use EditableField — the exact same
// click-to-edit component FinancialSection.jsx already uses — so there is
// no second edit implementation. DEAL OUTPUT (Max Buy/Profit/Strategy) is
// read-only, computed fresh via computeFlipResult/computeBrrrrResult/
// computeStrategyRecommendation (dealExplanation.js) — the same canonical
// engine every other screen in this app trusts. Nothing here recalculates
// anything independently.
//
// Final UX polish pass, Part 2 — the paid-enrichment confirm/run state
// now lives ONE level up, in LeadDetailPage.jsx, so this bar AND
// DistressBanner's clickable Next Action both trigger the exact same
// single confirmation modal + runContactEnrichmentBatch() call — never
// two separate enrichment executions.
import { useState } from 'react'
import EditableField from './EditableField'
import ContactIntelligenceCard from './ContactIntelligenceCard'
import { useLeadUpdate } from '../../hooks/useLeadUpdate'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../../lib/dealExplanation'
import { formatCurrency as fc } from '../../lib/calculations'
import { getContactStatus } from '../../lib/contactEnrichment'
import { getLastAttemptSummary } from '../../lib/enrichmentResult'

function InputTile({ label, value, onSave, canEdit }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{label}</div>
      <EditableField
        label="" type="currency" value={value} formatter={fc} placeholder="Not set"
        onSave={onSave} disabled={!canEdit}
        displayClassName="text-[17px] font-extrabold text-[color:var(--color-text)] tabular-nums"
      />
    </div>
  )
}
function OutputTile({ label, value, explanation }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{label}</div>
      <div className="text-[17px] font-extrabold text-[color:var(--color-text)] tabular-nums">{value ?? '—'}</div>
      {/* Part 7 — deterministic explanation for a missing output, derived
          from which real inputs are actually absent. Never fabricated. */}
      {value == null && explanation && <div className="text-[10px] text-[color:var(--color-text-dim)] mt-0.5">{explanation}</div>}
    </div>
  )
}

const CONTACT_STATUS_BADGE = {
  CONTACT_READY: { text: 'CONTACT READY', cls: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  MATCH_NEEDS_REVIEW: { text: 'MATCH NEEDS REVIEW', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  NO_MATCH: { text: 'NO VERIFIED CONTACT', cls: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]' },
  ENRICHMENT_ERROR: { text: 'NO VERIFIED CONTACT', cls: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]' },
  NEEDS_ENRICHMENT: { text: 'NOT ENRICHED', cls: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]' },
}

export default function LeadEssentialsBar({ lead, userId, members, canEdit, onUpdated, onRequestEnrich }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const update = useLeadUpdate(lead, userId, members, onUpdated)

  const flip = computeFlipResult(lead)
  const brrrr = computeBrrrrResult(lead)
  const strategy = computeStrategyRecommendation(flip, brrrr)
  const maxBuy = strategy.preferredStrategy === 'BRRRR' ? brrrr.mao : flip.mao
  const profitLabel = strategy.preferredStrategy === 'BRRRR' ? 'Cash Flow' : 'Profit'
  const profitValue = strategy.preferredStrategy === 'BRRRR' ? brrrr.monthlyCashFlow : flip.projectedProfit

  // Part 7 — real, deterministic reasons an output is missing, built only
  // from which of the actual required inputs are absent.
  const missingForMaxBuy = [lead.arv == null && 'ARV', lead.renovation_cost == null && 'Rehab'].filter(Boolean)
  const maxBuyExplanation = missingForMaxBuy.length ? `Needs ${missingForMaxBuy.join(' + ')}` : (maxBuy == null ? 'No purchase price meets HAT\'s target under current assumptions' : null)
  const profitExplanation = maxBuy == null ? 'Needs deal inputs' : null
  const strategyExplanation = strategy.preferredStrategy === 'NONE' ? (missingForMaxBuy.length ? `Needs ${missingForMaxBuy.join(' + ')}` : 'Insufficient data for either Flip or BRRRR to clear HAT\'s targets') : null

  const contactStatus = getContactStatus(lead)
  const lastAttempt = getLastAttemptSummary(lead)
  const profile = lead.enrichment_data?.contact_profile
  const primaryPhone = profile?.phones?.find(p => p.is_primary) || profile?.phones?.[0]
  const primaryEmail = profile?.emails?.find(e => e.is_primary) || profile?.emails?.[0]
  const extraPhones = Math.max((profile?.phones?.length || 0) - (primaryPhone ? 1 : 0), 0)
  const extraEmails = Math.max((profile?.emails?.length || 0) - (primaryEmail ? 1 : 0), 0)
  const associatedCount = profile?.associated_people?.length || 0
  const badge = CONTACT_STATUS_BADGE[contactStatus]

  return (
    <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-4 py-3 mb-4">
      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_2fr_1.5fr] gap-4 divide-y lg:divide-y-0 lg:divide-x divide-[color:var(--color-line)]">
        {/* CONTACT — Part 1. Hierarchy: OWNER NAME -> CONTACT STATUS badge
            -> supporting info -> actions. Owner always shown, status
            always visually obvious, attempt status and contact
            availability never conflated. */}
        <div className="pb-3 lg:pb-0 lg:pr-4">
          <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mb-1">Contact</div>
          <div className="text-[13.5px] font-bold text-[color:var(--color-text)] leading-tight">{profile?.primary_person?.name || lead.owner_name || 'Owner not identified'}</div>
          {badge && (
            <span className={`inline-block mt-1 text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.text}</span>
          )}
          {contactStatus === 'CONTACT_READY' ? (
            <div className="mt-1">
              <div className="text-[12.5px] text-[color:var(--color-text-muted)]">{lead.phone || (primaryPhone && (primaryPhone.raw || primaryPhone.number))}</div>
              {lead.email && <div className="text-[11.5px] text-[color:var(--color-text-dim)]">{lead.email}</div>}
              {(extraPhones > 0 || extraEmails > 0 || associatedCount > 0) && (
                <div className="text-[10.5px] text-[color:var(--color-text-dim)] mt-0.5">
                  {[extraPhones > 0 && `+${extraPhones} phone${extraPhones === 1 ? '' : 's'}`, extraEmails > 0 && `+${extraEmails} email${extraEmails === 1 ? '' : 's'}`, associatedCount > 0 && `+${associatedCount} associated person${associatedCount === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          ) : lastAttempt ? (
            <div className="text-[11px] text-[color:var(--color-text-dim)] mt-1">Last skip trace: {new Date(lastAttempt.attemptedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
          ) : (
            <div className="text-[11.5px] text-[color:var(--color-text-dim)] italic mt-1">No contact on file</div>
          )}
          <div className="flex items-center gap-3 mt-1.5">
            {(profile || lastAttempt) && (
              <button onClick={() => setDrawerOpen(true)} className="text-[11px] font-semibold underline text-[color:var(--color-accent-text)]">
                {profile ? 'View All Contacts' : 'View Result'}
              </button>
            )}
            {contactStatus !== 'CONTACT_READY' && canEdit && (
              <button onClick={onRequestEnrich} className="text-[11px] font-semibold underline text-[color:var(--color-accent-text)]">
                {lastAttempt ? 'Retry Enrichment' : 'Enrich Contact'}
              </button>
            )}
          </div>
        </div>

        {/* DEAL INPUTS — Part 4. Quick edit via the SAME EditableField +
            useLeadUpdate() every other screen uses — no duplicate save path. */}
        <div className="py-3 lg:py-0 lg:px-4">
          <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mb-1">Deal Inputs</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <InputTile label="Ask" value={lead.asking_price} canEdit={canEdit} onSave={(v) => update({ asking_price: v })} />
            <InputTile label="ARV" value={lead.arv} canEdit={canEdit} onSave={(v) => update({ arv: v })} />
            <InputTile label="Rehab" value={lead.renovation_cost} canEdit={canEdit} onSave={(v) => update({ renovation_cost: v })} />
            <InputTile label="Rent" value={lead.rent_estimate} canEdit={canEdit} onSave={(v) => update({ rent_estimate: v })} />
          </div>
        </div>

        {/* DEAL OUTPUT — Part 2/7. Read-only, computed fresh from the SAME
            canonical engine every other screen uses. Never editable here. */}
        <div className="pt-3 lg:pt-0 lg:pl-4">
          <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mb-1">Deal Output</div>
          <div className="grid grid-cols-3 gap-3">
            <OutputTile label="Max Buy" value={maxBuy != null ? fc(Math.round(maxBuy / 100) * 100) : null} explanation={maxBuyExplanation} />
            <OutputTile label={profitLabel} value={profitValue != null ? fc(profitValue) : null} explanation={profitExplanation} />
            <OutputTile label="Strategy" value={strategy.preferredStrategy !== 'NONE' ? strategy.preferredStrategy : null} explanation={strategyExplanation} />
          </div>
        </div>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/40" onClick={() => setDrawerOpen(false)}>
          <div className="w-full max-w-md h-full bg-[color:var(--color-bg)] border-l border-[color:var(--color-line)] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[15px] font-bold">Contact Intelligence</h3>
              <button onClick={() => setDrawerOpen(false)} className="text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] text-[13px]">✕ Close</button>
            </div>
            {profile ? (
              <ContactIntelligenceCard lead={lead} defaultExpanded />
            ) : lastAttempt ? (
              <div className="text-[12.5px] space-y-1.5">
                <div className="font-bold text-[color:var(--color-text)]">No safe contact match</div>
                <div className="text-[11px] text-[color:var(--color-text-dim)]">
                  Last attempt: {new Date(lastAttempt.attemptedAt).toLocaleDateString()}
                  {lastAttempt.ownerSearched && <> · Owner searched: {lastAttempt.ownerSearched}</>}
                </div>
                <div className="text-[color:var(--color-text-muted)]">{lastAttempt.humanReason}</div>
              </div>
            ) : (
              <div className="text-[12.5px] text-[color:var(--color-text-dim)]">No enrichment has been attempted for this lead yet.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
