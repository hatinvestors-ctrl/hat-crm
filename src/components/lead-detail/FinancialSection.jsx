import { useState } from 'react'
import Card from '../ui/Card'
import EditableField from './EditableField'
import RenoTierPicker from './RenoTierPicker'
import {
  formatCurrency, calculateFlipMAO, calculateFlipProfitAtPrice, calculateBrrrrMAO, computeBrrrrBreakdown,
  FLIP_MIN_PROFIT_TARGET, FLIP_STRONG_PROFIT, BRRRR_MAX_CASH_LEFT_IN, calculateLiveOffer, isStoredOfferStale, getEffectiveOffer,
} from '../../lib/calculations'
import { useLeadUpdate } from '../../hooks/useLeadUpdate'
import { isDistressedLead } from '../../lib/distressInfo'


// Bug fix — this section always computed/labeled a Flip MAO regardless of
// which strategy tab was active in Deal Analysis below it (real report:
// 6552 Bartholf Ave — Deal Analysis switched to BRRRR and showed BRRRR MAO
// $138,100, while Financials kept showing Flip MAO $133,700 for the exact
// same lead). `strategy` is now passed down from LeadDetailPage, kept in
// sync with DealAnalysisCard's own tab (see DealAnalysisCard's
// onStrategyChange). Defaults to 'flip' so nothing changes for a lead
// where BRRRR was never touched.
export default function FinancialSection({ lead, userId, members, canEdit, onUpdated, strategy = 'flip' }) {
  const update = useLeadUpdate(lead, userId, members, onUpdated)
  const isBrrrr = strategy === 'brrrr'

  const [showRenoPicker, setShowRenoPicker] = useState(false)

  const renoMissing          = lead.renovation_cost == null

  // Capability #10.1 — an off-market lead has no seller asking price by
  // definition; don't let it read as a missing/required first step. Only
  // shown when there's truly nothing to underwrite from yet (no ask, no
  // ARV) — once Kevin fills in ARV/reno, the normal Financials flow below
  // takes over unchanged. Does not touch the analysis engine itself.
  const isOffMarketNoInputs = isDistressedLead(lead) && !lead.asking_price && !lead.arv

  return (
    <Card title="Financials" subtitle="Deal numbers at a glance — click any value to edit">

      {isOffMarketNoInputs && (
        <div className="mb-4 rounded-lg border border-amber-300/60 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800/60 px-3 py-2.5">
          <div className="text-[12px] font-semibold text-amber-800 dark:text-amber-300">OFF-MARKET — NO ASKING PRICE</div>
          <div className="text-[11.5px] text-amber-700/90 dark:text-amber-400/90 mt-0.5">
            More property/financial information is needed before underwriting. Add ARV and renovation cost below when available.
          </div>
        </div>
      )}

      {/* ── Section 1: Price story — Ask → Gap → Flip MAO → Starting Offer ──
          Capability #19.2 — formulaMao is now the canonical Flip MAO
          (src/lib/calculations.js, same function Path to a Flip Deal /
          Detailed AI Analysis / Copilot all use), not the old flat
          75%-of-ARV rule. lead.mao itself is left exactly as-is on edit
          (see the onSave handlers below) — it's also V2's documented
          fallback input, and auto-rewriting it to a target-profit-derived
          number for every future edit would flatten V2's Economics
          Strength scoring (profit-at-MAO would always land near $30K by
          construction, regardless of how good the deal actually is).
          Instead: when a lead's stored MAO differs from canonical Flip
          MAO, the existing "diverged" detector + ↺ reset button below now
          compares against the CORRECT canonical number, so Kevin can
          one-click align it — a human decision, not a silent rewrite. */}
      {lead.asking_price && (lead.arv || lead.mao) && (() => {
        // Strategy-aware canonical MAO — Flip MAO (targets $30K minimum
        // profit) when the Flip tab is active, BRRRR MAO (targets positive
        // cash flow + under $30K cash left in) when BRRRR is active. Same
        // canonical functions Deal Analysis/Path to a Deal use — no second
        // formula.
        const brrrrMaoResult = isBrrrr ? calculateBrrrrMAO(lead.arv, lead.renovation_cost, lead.rent_estimate, lead.hold_months || 6) : null
        const formulaMao = isBrrrr ? brrrrMaoResult?.mao ?? null : calculateFlipMAO(lead.arv, lead.renovation_cost, lead.hold_months || 6)
        const storedMao  = lead.mao != null ? Number(lead.mao) : null
        // "Diverged" (stored lead.mao vs. canonical) is a Flip-only concept
        // — lead.mao is V2's Flip-formula fallback input; BRRRR MAO has no
        // stored-override counterpart, so never show a divergence banner
        // for it (would incorrectly suggest lead.mao is a stale BRRRR MAO).
        const diverged   = !isBrrrr && formulaMao !== null && storedMao !== null && Math.abs(formulaMao - storedMao) > 1
        // Canonical MAO (Flip or BRRRR, per the active tab) drives
        // Gap/Starting-Offer math now (matches Detailed Analysis's own
        // Gap-to-MAO figure in Biggest Risk) — the stored lead.mao override
        // only wins for Flip, and only when canonical can't be computed
        // (e.g. renovation cost missing); it's a Flip-only field.
        const mao        = isBrrrr ? formulaMao : (formulaMao ?? storedMao)
        const ask        = Number(lead.asking_price)
        const gap        = mao != null ? ask - mao : null

        // Live-computed starting offer — updates instantly when ARV/reno/ask
        // changes. Uses the SAME calculateLiveOffer()/isStoredOfferStale()
        // functions (src/lib/calculations.js) that Detailed Analysis and
        // Path to a Flip Deal now use for their own "current offer" figure
        // — this used to be a locally-duplicated formula, which is exactly
        // how Financials' "We Offer" and Detailed Analysis' "Starting
        // Offer" drifted apart after a renovation-cost edit.
        const liveStartingOffer = calculateLiveOffer(mao, ask)
        const offerIsStale = isStoredOfferStale(lead)
        // Bug fix — was reading lead.starting_offer verbatim here whenever
        // it wasn't stale, same drift this section's own comment above
        // warns about: an AI-suggested starting_offer can be above the
        // canonical MAO (a negotiation anchor, not a MAO-aware number),
        // which showed here as "We Offer" above Detailed Analysis' now-
        // clamped "Starting Offer" for the exact same lead. getEffectiveOffer
        // is the one shared, already-clamped source of truth for this value.
        const displayOffer = getEffectiveOffer(lead, mao) ?? liveStartingOffer
        const pct        = gap != null ? Math.round((gap / ask) * 100) : null
        const dealOk     = gap != null && gap <= 0
        const easy       = gap != null && gap > 0 && pct <= 10
        const tough      = gap != null && gap > 0 && pct > 20

        const gapColor   = dealOk ? 'var(--color-success-text)' : easy ? 'var(--color-warn-text)' : 'var(--color-danger-text)'
        const gapBg      = dealOk ? 'var(--color-success-soft)' : easy ? 'var(--color-warn-soft)'  : 'var(--color-danger-soft)'
        const gapBorder  = dealOk ? 'var(--color-success)'      : easy ? 'var(--color-warn)'       : 'var(--color-danger)'

        const gapLabel   = gap == null ? null
          : dealOk ? `✓ ${formatCurrency(Math.abs(gap))} below MAO`
          : tough  ? `${pct}% to drop — tough`
                   : `${pct}% to drop`

        return (
          <div className="mb-5">
            {/* Price flow strip */}
            <div className="flex items-stretch gap-0 rounded-xl border border-[color:var(--color-line)] overflow-hidden mb-3">
              {/* Ask */}
              <div className="flex-1 flex flex-col items-center justify-center px-3 py-3 bg-[color:var(--color-bg-elev-2)] border-r border-[color:var(--color-line)]">
                <div className="text-[9px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-semibold mb-1">Asking</div>
                <EditableField label="" type="currency" value={lead.asking_price} formatter={formatCurrency}
                  onSave={(v) => update({ asking_price: v })} disabled={!canEdit}
                  displayClassName="text-[16px] font-bold text-[color:var(--color-text)]" />
              </div>
              {/* Gap */}
              {gap != null && (
                <div className="flex-1 flex flex-col items-center justify-center px-3 py-3 border-r border-[color:var(--color-line)]"
                  style={{ background: gapBg }}>
                  <div className="text-[9px] uppercase tracking-widest font-semibold mb-1" style={{ color: gapColor }}>Gap</div>
                  <div className="text-[16px] font-bold" style={{ color: gapColor }}>
                    {gap <= 0 ? '✓ In budget' : formatCurrency(gap)}
                  </div>
                  {gapLabel && gap > 0 && (
                    <div className="text-[10px] mt-0.5" style={{ color: gapColor }}>{gapLabel}</div>
                  )}
                </div>
              )}
              {/* Flip MAO — CANONICAL number is now always the big, primary
                  figure (matches Detailed Analysis / Path to a Flip Deal /
                  Copilot exactly, every time — no more "$127,450 here,
                  $124,300 there"). The separately-stored, editable
                  lead.mao only appears as a small secondary line, and only
                  when it actually diverges — it's kept for V2/legacy
                  compatibility and Kevin's manual overrides, but it can no
                  longer LOOK like the authoritative Flip MAO. Real user
                  reports (2706 Tina Lane, 1012 Beckner Ave) showed the old
                  "stored value primary, canonical as a caption" layout was
                  read as a contradiction, not a nuance — swapped. */}
              <div className="flex-1 flex flex-col items-center justify-center px-3 py-3 bg-[color:var(--color-bg-elev-2)] border-r border-[color:var(--color-line)]">
                <div className="flex items-center gap-1 mb-1">
                  <div className="text-[9px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-semibold">{isBrrrr ? 'BRRRR MAO' : 'Flip MAO'}</div>
                  <span title={isBrrrr
                      ? 'The highest purchase price that still keeps cash left in after refinance under $30,000 (and cash flow positive). Same number shown in Detailed Analysis and Path to a BRRRR Deal.'
                      : `The highest purchase price that still nets HAT's ${formatCurrency(FLIP_MIN_PROFIT_TARGET)} minimum Flip profit. Same number shown in Detailed Analysis, Path to a Flip Deal, and Copilot.`}
                    className="text-[9px] text-[color:var(--color-text-dim)] cursor-help">ℹ</span>
                </div>
                <div className="text-[16px] font-bold text-[color:var(--color-accent)]">
                  {formulaMao != null ? formatCurrency(Math.round(formulaMao / 100) * 100) : '—'}
                </div>
                {/* lead.mao is a Flip-only stored fallback (also V2's
                    canonical MAO input) — no equivalent override concept
                    exists for BRRRR MAO, so these controls only apply to Flip. */}
                {!isBrrrr && diverged && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-[9px] text-[color:var(--color-warn-text)]">Stored override:</span>
                    <EditableField label="" type="currency" value={lead.mao} formatter={formatCurrency}
                      onSave={(v) => update({ mao: v })} disabled={!canEdit}
                      displayClassName="text-[10.5px] font-semibold text-[color:var(--color-warn-text)] underline decoration-dotted" />
                    {canEdit && (
                      <button onClick={() => update({ mao: null })}
                        className="text-[8px] px-1 rounded bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)] border border-[color:var(--color-warn)] hover:opacity-80"
                        title="Clear stored override — go back to using the canonical Flip MAO everywhere">✕</button>
                    )}
                  </div>
                )}
                {!isBrrrr && !diverged && canEdit && (
                  <button onClick={() => { const v = window.prompt('Set a manual Max Offer override (leave blank to cancel):', ''); if (v && !Number.isNaN(Number(v))) update({ mao: Number(v) }) }}
                    className="text-[8.5px] mt-0.5 text-[color:var(--color-text-faint)] hover:text-[color:var(--color-text-dim)] underline underline-offset-2">
                    Set manual override
                  </button>
                )}
                {isBrrrr ? (() => {
                  if (formulaMao == null) return null
                  const b = computeBrrrrBreakdown(formulaMao, lead.arv, lead.renovation_cost, lead.rent_estimate, lead.hold_months || 6)
                  const tone = b.totalCashInvested < BRRRR_MAX_CASH_LEFT_IN ? 'var(--color-success-text)' : 'var(--color-warn-text)'
                  return (
                    <div className="text-[9.5px] mt-0.5" style={{ color: tone }} title="Cash left in / cash flow at the canonical BRRRR MAO shown above — by construction, right at HAT's cash-left-in or cash-flow limit.">
                      Cash left in: ~{formatCurrency(b.totalCashInvested)} · {b.monthlyCF != null ? `${formatCurrency(Math.round(b.monthlyCF))}/mo` : '—'}
                    </div>
                  )
                })() : (() => {
                  const profitAtCanonical = formulaMao != null ? calculateFlipProfitAtPrice(formulaMao, lead.arv, lead.renovation_cost, lead.hold_months || 6) : null
                  if (profitAtCanonical == null) return null
                  const tone = profitAtCanonical >= FLIP_STRONG_PROFIT ? 'var(--color-success-text)' : 'var(--color-warn-text)'
                  return (
                    <div className="text-[9.5px] mt-0.5" style={{ color: tone }} title="Profit at the canonical Flip MAO shown above — always ≈ HAT's minimum target by construction.">
                      Profit at this price: ~{formatCurrency(profitAtCanonical)}
                    </div>
                  )
                })()}
              </div>
              {/* Starting Offer */}
              <div className="flex-1 flex flex-col items-center justify-center px-3 py-3 bg-[color:var(--color-bg-elev-2)]">
                <div className="flex items-center gap-1 mb-1">
                  <div className="text-[9px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-semibold">We Offer</div>
                  <span title={offerIsStale ? "Re-run AI analysis for motivation-adjusted offer" : "Starting offer to send seller. Set by AI analysis — click to override."}
                    className="text-[9px] text-[color:var(--color-text-dim)] cursor-help">ℹ</span>
                </div>
                <EditableField label="" type="currency" value={displayOffer} formatter={formatCurrency}
                  onSave={(v) => update({ starting_offer: v })} disabled={!canEdit}
                  displayClassName={`text-[16px] font-bold ${offerIsStale ? 'opacity-60' : ''} text-[color:var(--color-success-text)]`}
                  placeholder="—" />
              </div>
            </div>
          </div>
        )
      })()}

      {/* Fallback hero when no asking price yet: show MAO + Starting Offer plainly */}
      {!(lead.asking_price && (lead.arv || lead.mao)) && (() => {
        const brrrrMaoResult = isBrrrr ? calculateBrrrrMAO(lead.arv, lead.renovation_cost, lead.rent_estimate, lead.hold_months || 6) : null
        const formulaMao = isBrrrr ? brrrrMaoResult?.mao ?? null : calculateFlipMAO(lead.arv, lead.renovation_cost, lead.hold_months || 6)
        const storedMao  = lead.mao != null ? Number(lead.mao) : null
        const diverged   = !isBrrrr && formulaMao !== null && storedMao !== null && Math.abs(formulaMao - storedMao) > 1
        const displayedMao = isBrrrr ? formulaMao : (lead.mao ?? formulaMao)
        return (
          <div className="flex gap-6 mb-5">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-text-dim)]">{isBrrrr ? "BRRRR MAO · Max We'd Pay" : "Flip MAO · Max We'd Pay"}</span>
                {diverged && canEdit && (
                  <button onClick={() => update({ mao: formulaMao })}
                    className="text-[9px] px-1 py-0.5 rounded bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)] border border-[color:var(--color-warn)] hover:opacity-80">↺ formula</button>
                )}
              </div>
              {isBrrrr ? (
                <div className="text-2xl font-bold text-[color:var(--color-accent)]">{displayedMao != null ? formatCurrency(Math.round(displayedMao / 100) * 100) : '—'}</div>
              ) : (
                <EditableField label="" type="currency" value={displayedMao} formatter={formatCurrency}
                  onSave={(v) => update({ mao: v })} disabled={!canEdit}
                  displayClassName="text-2xl font-bold text-[color:var(--color-accent)]" />
              )}
              {isBrrrr ? (() => {
                if (formulaMao == null) return null
                const b = computeBrrrrBreakdown(formulaMao, lead.arv, lead.renovation_cost, lead.rent_estimate, lead.hold_months || 6)
                const tone = b.totalCashInvested < BRRRR_MAX_CASH_LEFT_IN ? 'var(--color-success-text)' : 'var(--color-warn-text)'
                return (
                  <div className="text-[10px] mt-0.5" style={{ color: tone }}>
                    Cash left in: ~{formatCurrency(b.totalCashInvested)} · {b.monthlyCF != null ? `${formatCurrency(Math.round(b.monthlyCF))}/mo` : '—'}
                  </div>
                )
              })() : (() => {
                const profitAtMao = calculateFlipProfitAtPrice(displayedMao, lead.arv, lead.renovation_cost)
                if (profitAtMao == null) return null
                const tone = profitAtMao >= FLIP_STRONG_PROFIT ? 'var(--color-success-text)' : profitAtMao >= FLIP_MIN_PROFIT_TARGET ? 'var(--color-warn-text)' : 'var(--color-danger-text)'
                return (
                  <div className="text-[10px] mt-0.5" style={{ color: tone }}>
                    Profit at this price: ~{formatCurrency(profitAtMao)}
                  </div>
                )
              })()}
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-text-dim)] mb-0.5">We Offer</div>
              <EditableField label="" type="currency" value={lead.starting_offer} formatter={formatCurrency}
                onSave={(v) => update({ starting_offer: v })} disabled={!canEdit}
                displayClassName="text-2xl font-bold text-[color:var(--color-success-text)]" placeholder="— run AI analysis" />
            </div>
          </div>
        )
      })()}

      {/* ── Section 2: Inputs — ARV + Reno + Rent ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
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
    </Card>
  )
}
