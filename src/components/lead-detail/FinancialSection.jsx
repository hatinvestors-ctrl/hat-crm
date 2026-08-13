import { useState } from 'react'
import Card from '../ui/Card'
import EditableField from './EditableField'
import RenoTierPicker from './RenoTierPicker'
import { formatCurrency, calculateFlipMAO, calculateFlipProfitAtPrice, FLIP_MIN_PROFIT_TARGET } from '../../lib/calculations'
import { useLeadUpdate } from '../../hooks/useLeadUpdate'
import { isDistressedLead } from '../../lib/distressInfo'


export default function FinancialSection({ lead, userId, members, canEdit, onUpdated }) {
  const update = useLeadUpdate(lead, userId, members, onUpdated)

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
        const formulaMao = calculateFlipMAO(lead.arv, lead.renovation_cost, lead.hold_months || 6)
        const storedMao  = lead.mao != null ? Number(lead.mao) : null
        const diverged   = formulaMao !== null && storedMao !== null && Math.abs(formulaMao - storedMao) > 1
        const mao        = storedMao ?? formulaMao
        const ask        = Number(lead.asking_price)
        const gap        = mao != null ? ask - mao : null

        // Live-computed starting offer — updates instantly when ARV/reno/ask changes.
        // Uses simplified negotiation-room model (no motivation scoring; AI adds that).
        // Shown when stored value is stale (ARV changed since last AI run) or missing.
        const liveStartingOffer = (() => {
          if (!mao || !ask) return null
          if (ask <= mao) return Math.round(ask / 100) * 100
          const g = ask - mao
          const anchor = mao - g * 0.45   // neutral motivation → 45% room factor
          const floor  = ask * 0.80
          const raw    = Math.max(anchor, floor)
          return Math.round(Math.min(raw, mao * 0.995) / 100) * 100
        })()
        const aiArv = lead.deal_analysis?.inputs?.arv
        const offerIsStale = aiArv != null && Number(lead.arv) !== Number(aiArv)
        const displayOffer = (offerIsStale || !lead.starting_offer) ? liveStartingOffer : lead.starting_offer
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
              {/* Flip MAO */}
              <div className="flex-1 flex flex-col items-center justify-center px-3 py-3 bg-[color:var(--color-bg-elev-2)] border-r border-[color:var(--color-line)]">
                <div className="flex items-center gap-1 mb-1">
                  <div className="text-[9px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-semibold">Flip MAO</div>
                  <span title={`Canonical Flip MAO — the highest purchase price that still nets HAT's ${formatCurrency(FLIP_MIN_PROFIT_TARGET)} minimum Flip profit.\n= ${formatCurrency(formulaMao)}\n\nStored Max Offer (below) is separate and editable — click ↺ to reset it to this canonical number.`}
                    className="text-[9px] text-[color:var(--color-text-dim)] cursor-help">ℹ</span>
                  {diverged && canEdit && (
                    <button onClick={() => update({ mao: formulaMao })}
                      className="text-[8px] px-1 rounded bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)] border border-[color:var(--color-warn)] hover:opacity-80"
                      title="Reset stored Max Offer to canonical Flip MAO">↺</button>
                  )}
                </div>
                <EditableField label="" type="currency" value={lead.mao ?? formulaMao} formatter={formatCurrency}
                  onSave={(v) => update({ mao: v })} disabled={!canEdit}
                  displayClassName="text-[16px] font-bold text-[color:var(--color-accent)]" />
                {diverged && (
                  <div className="text-[9px] mt-0.5 text-[color:var(--color-warn-text)]">
                    Canonical Flip MAO: {formatCurrency(formulaMao)}
                  </div>
                )}
                {(() => {
                  const displayedMao = lead.mao ?? formulaMao
                  const profitAtDisplayed = calculateFlipProfitAtPrice(displayedMao, lead.arv, lead.renovation_cost, lead.hold_months || 6)
                  if (profitAtDisplayed == null) return null
                  const tone = profitAtDisplayed >= 40000 ? 'var(--color-success-text)' : profitAtDisplayed >= 30000 ? 'var(--color-warn-text)' : 'var(--color-danger-text)'
                  return (
                    <div className="text-[9.5px] mt-0.5" style={{ color: tone }} title="Profit if purchased at the number shown above (stored Max Offer if set, otherwise canonical Flip MAO).">
                      Profit at this price: ~{formatCurrency(profitAtDisplayed)}
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
        const formulaMao = calculateFlipMAO(lead.arv, lead.renovation_cost, lead.hold_months || 6)
        const storedMao  = lead.mao != null ? Number(lead.mao) : null
        const diverged   = formulaMao !== null && storedMao !== null && Math.abs(formulaMao - storedMao) > 1
        return (
          <div className="flex gap-6 mb-5">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-text-dim)]">Flip MAO · Max We'd Pay</span>
                {diverged && canEdit && (
                  <button onClick={() => update({ mao: formulaMao })}
                    className="text-[9px] px-1 py-0.5 rounded bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)] border border-[color:var(--color-warn)] hover:opacity-80">↺ formula</button>
                )}
              </div>
              <EditableField label="" type="currency" value={lead.mao ?? formulaMao} formatter={formatCurrency}
                onSave={(v) => update({ mao: v })} disabled={!canEdit}
                displayClassName="text-2xl font-bold text-[color:var(--color-accent)]" />
              {(() => {
                const profitAtMao = calculateFlipProfitAtPrice(lead.mao ?? formulaMao, lead.arv, lead.renovation_cost)
                if (profitAtMao == null) return null
                const tone = profitAtMao >= 40000 ? 'var(--color-success-text)' : profitAtMao >= 30000 ? 'var(--color-warn-text)' : 'var(--color-danger-text)'
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
