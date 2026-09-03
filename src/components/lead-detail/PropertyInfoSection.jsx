import { useState } from 'react'
import Card from '../ui/Card'
import EditableField from './EditableField'
import RenoTierPicker from './RenoTierPicker'
import { PROPERTY_TYPES } from '../../lib/constants'
import { formatNumber, formatCurrency, calculateFlipMAO, getEffectiveOffer, calculateLiveOffer, isStoredOfferStale, FLIP_MIN_PROFIT_TARGET } from '../../lib/calculations'
import { useLeadUpdate } from '../../hooks/useLeadUpdate'
import { mlsStatusMeta } from '../../lib/mlsStatus'
import { safeUrl } from '../../lib/urlSafety'
import { enrichLead } from '../../lib/enrichment'
import { isDistressedLead } from '../../lib/distressInfo'
import { resolveHoldMonths } from '../../lib/underwritingSettings'

const TONE_PILL = {
  success: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]',
  warn:    'bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)]',
  danger:  'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)]',
  accent:  'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]',
  neutral: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)]',
}

export default function PropertyInfoSection({ lead, userId, members, canEdit, onUpdated, underwritingSettings = null }) {
  const update = useLeadUpdate(lead, userId, members, onUpdated)
  const [refreshing, setRefreshing] = useState(false)
  const [mlsErr, setMlsErr] = useState(null)
  const [showRenoPicker, setShowRenoPicker] = useState(false)
  // UX V2.7, Part 3/4 — "Legacy MAO" collapsed diagnostic override, moved
  // here verbatim from the removed FinancialSection.jsx "Financials" card
  // (this was the ONLY editable location for lead.mao — a legacy
  // 0.75×ARV−reno−2450 fallback field, confirmed by that file's own prior
  // audit comment to never be read by profit/verdict/Margin of
  // Safety/offer generation, all of which call calculateFlipMAO fresh).
  // Preserved rather than dropped, per the mission's explicit "do not
  // remove edit capability" rule — collapsed by default, same pattern.
  const [showLegacyMao, setShowLegacyMao] = useState(false)
  const mlsMeta = lead.mls_status ? mlsStatusMeta(lead.mls_status) : null
  const renoMissing = lead.renovation_cost == null
  const holdMonths = resolveHoldMonths(lead.hold_months, underwritingSettings?.default_holding_months)
  const formulaMao = calculateFlipMAO(lead.arv, lead.renovation_cost, holdMonths, FLIP_MIN_PROFIT_TARGET, underwritingSettings)
  const storedMao = lead.mao != null ? Number(lead.mao) : null
  const maoDiverged = formulaMao !== null && storedMao !== null && Math.abs(formulaMao - storedMao) > 1
  // UX V2.7, Part 3/4/5 — "Suggested Offer" edit capability, moved here
  // verbatim from the removed FinancialSection.jsx "We Offer" field. Same
  // underlying value/source (lead.starting_offer via getEffectiveOffer) —
  // only the label changes, to match the ALREADY-established "Suggested
  // Offer" wording (DealSnapshotCompact.jsx V2.1, DealDecisionCenter.jsx
  // V2.4/V2.6) instead of the misleading "We Offer" this field always
  // showed in Financials — this value is a MAO-anchored calculated
  // negotiation anchor, never a real submitted/formal HAT offer (that is
  // lead.offer_price, resolveActualOffer() in
  // acquisitionDecisionPresentation.js — a completely separate field,
  // untouched here).
  const liveOffer = getEffectiveOffer(lead, formulaMao) ?? calculateLiveOffer(formulaMao, lead.asking_price != null ? Number(lead.asking_price) : null)
  const offerIsStale = isStoredOfferStale(lead)

  const links = [
    { label: 'Zillow', url: safeUrl(lead.zillow_url) },
    { label: 'Redfin', url: safeUrl(lead.redfin_url) },
    { label: 'MLS',    url: safeUrl(lead.mls_url) },
    { label: 'Photos', url: safeUrl(lead.photos_url) },
  ].filter(l => l.url)

  return (
    <Card title="Property">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <EditableField label="Address" value={lead.address}    onSave={(v) => update({ address: v })}   disabled={!canEdit} />
        <EditableField label="City"    value={lead.city}       onSave={(v) => update({ city: v })}      disabled={!canEdit} />
        <EditableField label="State"   value={lead.state}      onSave={(v) => update({ state: v })}     disabled={!canEdit} />
        <EditableField label="Zip"     value={lead.zip_code}   onSave={(v) => update({ zip_code: v })}  disabled={!canEdit} />
        <EditableField
          label="Type"
          value={lead.property_type}
          options={PROPERTY_TYPES}
          type="select"
          onSave={(v) => update({ property_type: v })}
          disabled={!canEdit}
        />
        <EditableField label="Year Built" type="number" value={lead.year_built} onSave={(v) => update({ year_built: v })} disabled={!canEdit} />
        <EditableField label="Bedrooms"   type="number" value={lead.bedrooms}   onSave={(v) => update({ bedrooms: v })}   disabled={!canEdit} />
        <EditableField label="Bathrooms"  value={lead.bathrooms} onSave={(v) => update({ bathrooms: v === '' ? null : parseFloat(v) })} disabled={!canEdit} />
        <EditableField
          label="Sqft"
          type="number"
          value={lead.sqft}
          formatter={(v) => formatNumber(v)}
          onSave={(v) => update({ sqft: v })}
          disabled={!canEdit}
        />
        <EditableField
          label="Lot Size"
          type="number"
          value={lead.lot_size_sqft}
          formatter={(v) => `${formatNumber(v)} sqft`}
          onSave={(v) => update({ lot_size_sqft: v })}
          disabled={!canEdit}
        />
        <EditableField
          label="Garage"
          type="bool"
          value={lead.has_garage}
          onSave={(v) => update({ has_garage: v })}
          disabled={!canEdit}
        />
        <EditableField
          label="Days on Market"
          type="number"
          value={lead.days_on_market}
          formatter={(v) => `${formatNumber(v)}d`}
          onSave={(v) => update({ days_on_market: v })}
          disabled={!canEdit}
        />
      </div>

      {/* Demo Stabilization, Part 5 — lead.asking_price is used identically
          for on-market and off-market leads (a generic evaluation-price
          input the underwriting engine reads), but off-market/distressed
          leads are sourced from public records (Lis Pendens etc.), not an
          MLS listing — there is no verified seller statement backing this
          number until an actual seller conversation happens (see
          lead.distress_data.seller_intelligence.seller_asking_price, a
          SEPARATE field captured live during calls, untouched here).
          "Seller's Asking Price" would claim something not provable for
          those leads, so it's neutral ("Evaluation Price") for distressed
          leads and unchanged for on-market ones (a real MLS list price is
          a legitimate concept there). Same field, same save path — label
          only. */}
      <div className="mt-3 flex items-center justify-between px-3 py-2 rounded-md bg-[color:var(--color-warn-soft)] border border-[color:var(--color-warn)]">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-warn-text)]">{isDistressedLead(lead) ? 'Evaluation Price' : "Seller's Asking Price"}</span>
        <EditableField
          label=""
          type="currency"
          value={lead.asking_price}
          formatter={formatCurrency}
          onSave={(v) => update({ asking_price: v })}
          disabled={!canEdit}
        />
      </div>

      {/* UX V2.7, Part 3/4 — the ONE canonical editable home for
          ARV/Renovation Cost/Rent Estimate/Holding Period, moved here
          verbatim from the removed FinancialSection.jsx "Financials" card
          (this was the only editable location for these four inputs).
          Same onSave handlers, same values, same legacy-mao side effect on
          ARV/Reno edits (unchanged, diagnostic-only per that file's own
          prior audit — not read by any canonical calculation) — presentation
          moved, nothing recomputed differently. */}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-3 py-2.5">
          <EditableField
            label="After-Repair Value (ARV)"
            type="currency"
            value={lead.arv}
            formatter={formatCurrency}
            onSave={(v) => {
              const newMao = v ? Math.round(Number(v) * 0.75 - Number(lead.renovation_cost || 0) - 2450) : null
              update({ arv: v, ...(newMao ? { mao: newMao } : {}) })
            }}
            disabled={!canEdit}
          />
        </div>
        <div className={`rounded-lg border px-3 py-2.5 ${renoMissing && canEdit ? 'border-dashed border-2 border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)]' : 'border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]'}`}>
          <div className="flex items-center justify-between gap-1">
            <EditableField
              label="Renovation Cost"
              type="currency"
              value={lead.renovation_cost}
              formatter={formatCurrency}
              onSave={(v) => {
                const newMao = lead.arv ? Math.round(Number(lead.arv) * 0.75 - Number(v || 0) - 2450) : null
                update({ renovation_cost: v, ...(newMao ? { mao: newMao } : {}) })
              }}
              disabled={!canEdit}
            />
            {canEdit && (
              <button
                onClick={() => setShowRenoPicker(true)}
                title="Pick a renovation scope (AI-suggested tier)"
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-[13px] hover:bg-[color:var(--color-bg)] transition-colors"
              >
                🔨
              </button>
            )}
          </div>
          {renoMissing && canEdit && (
            <p className="text-[10px] text-[color:var(--color-warn-text)] mt-1 leading-tight">
              ⚠ Enter before running analysis
            </p>
          )}
          <RenoTierPicker
            lead={lead}
            open={showRenoPicker}
            onClose={() => setShowRenoPicker(false)}
            onApply={(reno) => {
              const newMao = lead.arv ? Math.round(Number(lead.arv) * 0.75 - reno - 2450) : null
              update({ renovation_cost: reno, ...(newMao ? { mao: newMao } : {}) })
              setShowRenoPicker(false)
            }}
          />
        </div>
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-3 py-2.5">
          <EditableField
            label="Rent Estimate (BRRRR)"
            type="currency"
            value={lead.rent_estimate}
            formatter={formatCurrency}
            onSave={(v) => update({ rent_estimate: v })}
            disabled={!canEdit}
          />
        </div>
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-3 py-2.5">
          <EditableField
            label="Holding Period"
            type="number"
            value={lead.hold_months ?? 6}
            formatter={(v) => `${v} months`}
            onSave={(v) => update({ hold_months: v })}
            disabled={!canEdit}
          />
        </div>
      </div>

      {/* UX V2.7, Part 3/4/5 — Suggested Offer edit capability, preserved
          from the removed Financials card, correctly labeled (never "We
          Offer"/"Our Offer" — see this file's header note above). Collapsed
          "Legacy Max Offer override" diagnostic alongside it, also
          preserved verbatim (unused by any canonical calculation). */}
      <div className="mt-3 flex items-center justify-between px-3 py-2 rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]">
        <div className="flex items-center gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-text-dim)]">Suggested Offer</span>
          <span title={offerIsStale ? 'Re-run AI analysis for motivation-adjusted offer' : 'Calculated negotiation anchor — not an actual submitted offer. Click to override.'} className="text-[9px] text-[color:var(--color-text-dim)] cursor-help">ℹ</span>
        </div>
        <EditableField
          label=""
          type="currency"
          value={liveOffer}
          formatter={formatCurrency}
          onSave={(v) => update({ starting_offer: v })}
          disabled={!canEdit}
          displayClassName={offerIsStale ? 'opacity-60' : ''}
          placeholder="—"
        />
      </div>
      {(formulaMao != null || storedMao != null) && (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={() => setShowLegacyMao(o => !o)}
            className="text-[9.5px] text-[color:var(--color-text-faint)] hover:text-[color:var(--color-text-dim)] underline underline-offset-2"
          >
            {showLegacyMao ? 'Hide legacy data' : maoDiverged ? 'Legacy Max Offer override (diverges from Max Buy)' : storedMao != null ? 'Legacy Max Offer override' : 'Advanced'}
          </button>
          {showLegacyMao && (
            <div className="mt-1 flex items-center gap-1">
              {maoDiverged ? (
                <>
                  <span className="text-[9px] text-[color:var(--color-warn-text)]" title="Auto-computed by the older 0.75×ARV formula whenever ARV/Reno is edited — not necessarily a manual choice. Not used by Max Buy, profit, verdict, or offer generation.">Legacy MAO:</span>
                  <EditableField label="" type="currency" value={lead.mao} formatter={formatCurrency}
                    onSave={(v) => update({ mao: v })} disabled={!canEdit}
                    displayClassName="text-[10.5px] font-semibold text-[color:var(--color-warn-text)] underline decoration-dotted" />
                  {canEdit && (
                    <button onClick={() => update({ mao: null })}
                      className="text-[8px] px-1 rounded bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)] border border-[color:var(--color-warn)] hover:opacity-80"
                      title="Clear — this legacy value isn't used by Max Buy, profit, or the verdict anywhere on this page.">✕</button>
                  )}
                </>
              ) : canEdit && (
                <button onClick={() => { const v = window.prompt('Set a manual Max Offer override (leave blank to cancel):', ''); if (v && !Number.isNaN(Number(v))) update({ mao: Number(v) }) }}
                  className="text-[8.5px] text-[color:var(--color-text-faint)] hover:text-[color:var(--color-text-dim)] underline underline-offset-2">
                  Set manual override
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* External links — MLS refresh is in the banner at the top */}
      {links.length > 0 && (
        <div className="mt-4 pt-4 border-t border-[color:var(--color-line)]">
          <div className="text-[10.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1.5">External links</div>
          <div className="flex flex-wrap gap-1.5">
            {links.map(l => (
              <a key={l.label} href={l.url} target="_blank" rel="noreferrer" className="text-[12px] px-2 py-1 bg-[color:var(--color-bg-elev-2)] hover:bg-[color:var(--color-accent-soft)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent-text)] rounded transition-colors">
                {l.label} ↗
              </a>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
