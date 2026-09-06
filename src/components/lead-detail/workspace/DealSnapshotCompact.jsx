// src/components/lead-detail/workspace/DealSnapshotCompact.jsx
// Lead Workspace redesign, Final UX Polish, Sections 4C/5 — Overview's
// compact deal snapshot. DATA-AWARE, not status-dependent: this always
// renders the same way for every lead, adapting only to what data exists
// (never branching on lead.status/'triage'/etc).
//
// AI & Comps Recovery Pass, Part 20 — restored as a compact EXECUTIVE
// ECONOMICS summary (Strategy / Max Buy / Seller Price / ARV / Rehab /
// Profit or Rent+Cash Flow+Cash Left In for BRRRR), replacing the
// ARV/Rehab/Rent-only version that duplicated nothing useful. Every
// number here is read from the SAME canonical computeFlipResult/
// computeBrrrrResult/computeStrategyRecommendation/resolveEffectiveStrategy
// functions DecisionHero and the Deal tab already call with the SAME
// underwritingSettings — this card computes nothing of its own, it only
// arranges the existing canonical outputs. When a value is genuinely
// unavailable (e.g. Profit needs a seller/evaluation price that hasn't
// been recorded), an honest reason is shown instead of a blank or a
// fabricated number.
import { formatCurrency as fc } from '../../../lib/calculations'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation, resolveEffectiveStrategy } from '../../../lib/dealExplanation'
import { resolveMarketType } from '../../../lib/distressInfo'
import { getSellerIntelligence } from '../../../lib/sellerStrategy'
import { hasEvaluablePrice, resolveNoPriceStrategyPreference } from '../../../lib/acquisitionDecisionPresentation'
import { getDealReadiness } from './readiness'

function Cell({ label, value, tone, sub }) {
  return (
    <div className="min-w-0">
      <div className="text-[8.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{label}</div>
      <div className="text-[13px] font-bold truncate" style={tone ? { color: tone } : undefined}>{value}</div>
      {sub && <div className="text-[9.5px] text-[color:var(--color-text-dim)] truncate">{sub}</div>}
    </div>
  )
}

export default function DealSnapshotCompact({ lead, underwritingSettings = null, onOpenDeal }) {
  const readiness = getDealReadiness(lead)

  // Section 5 — incomplete data: show what's known, what's missing, one
  // next action. Never a wall of "Not available."
  if (!readiness.flipReady) {
    const known = []
    if (lead.asking_price != null) known.push(['Ask', fc(lead.asking_price)])
    if (lead.bedrooms || lead.bathrooms) known.push(['Beds/Baths', `${lead.bedrooms ?? '—'}/${lead.bathrooms ?? '—'}`])
    if (lead.sqft) known.push(['Sqft', Number(lead.sqft).toLocaleString()])
    if (lead.renovation_cost != null) known.push(['Rehab', fc(lead.renovation_cost)])
    if (known.length === 0 && readiness.missing.length === 0) return null

    return (
      <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9.5px] uppercase tracking-widest font-bold text-[color:var(--color-text-dim)]">Deal Snapshot</span>
          <button type="button" onClick={onOpenDeal} className="text-[10.5px] font-semibold underline text-[color:var(--color-accent-text)]">Open Deal →</button>
        </div>
        {known.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 mb-2">
            {known.map(([label, value]) => <Cell key={label} label={label} value={value} />)}
          </div>
        )}
        <div className="text-[11.5px] text-[color:var(--color-warn-text)]">
          Needs {readiness.missing.map(m => m.label).join(' + ')}
        </div>
      </div>
    )
  }

  // Part 20 — canonical facts only, threaded with the SAME
  // underwritingSettings every other consumer of these functions uses
  // (the exact wiring gap DecisionHero itself was fixed for in UX V2.4 —
  // never repeat it here).
  const flip = computeFlipResult(lead, underwritingSettings)
  const brrrr = computeBrrrrResult(lead, underwritingSettings)
  const marketType = resolveMarketType(lead)
  const sellerPrice = marketType === 'OFF_MARKET'
    ? getSellerIntelligence(lead).seller_asking_price
    : (lead.asking_price != null ? Number(lead.asking_price) : null)

  // Part 20/24 — off-market, no seller price recorded yet: computeStrategy-
  // Recommendation ranks by verdict, and with no price every verdict is the
  // vacuous 'NO DEAL' (see dealExplanation.js's own comment on this), which
  // would wrongly read "no viable strategy" for a property that simply has
  // no price on file. Reuses the SAME existing, already-tested
  // hasEvaluablePrice/resolveNoPriceStrategyPreference presentation helpers
  // DecisionHero's deriveAcquisitionDecision already applies for exactly
  // this case — never a second/different strategy-preference rule, so this
  // card can never disagree with the Overview headline above it.
  const noPriceYet = marketType === 'OFF_MARKET' && !hasEvaluablePrice({ flip, lead, sellerAskingPrice: sellerPrice })
  const strategyRec = flip.available || brrrr.available ? computeStrategyRecommendation(flip, brrrr) : null
  const effectiveStrategy = noPriceYet
    ? (resolveNoPriceStrategyPreference({ flip, brrrr }).strategy || 'NONE')
    : resolveEffectiveStrategy(strategyRec)
  const isBrrrr = effectiveStrategy === 'BRRRR' && brrrr.available

  return (
    <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9.5px] uppercase tracking-widest font-bold text-[color:var(--color-text-dim)]">Deal Snapshot</span>
        <button type="button" onClick={onOpenDeal} className="text-[10.5px] font-semibold underline text-[color:var(--color-accent-text)]">Open Deal Analysis →</button>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
        <Cell label="Strategy" value={effectiveStrategy === 'NONE' ? '—' : effectiveStrategy} />
        <Cell
          label={isBrrrr ? 'BRRRR Max Buy' : 'Flip Max Buy'}
          value={(isBrrrr ? brrrr.mao : flip.mao) != null ? fc(isBrrrr ? brrrr.mao : flip.mao) : '—'}
          tone="var(--color-accent-text)"
        />
        <Cell label="Seller Price" value={sellerPrice != null ? fc(sellerPrice) : 'Missing'} />
        <Cell label="ARV" value={fc(lead.arv)} />
        <Cell label="Rehab" value={fc(lead.renovation_cost)} />
        {isBrrrr ? (
          <>
            <Cell label="Rent" value={lead.rent_estimate != null ? fc(lead.rent_estimate) : 'Not set'} />
            <Cell
              label="Cash Flow"
              value={brrrr.monthlyCashFlow != null ? `${brrrr.monthlyCashFlow >= 0 ? '+' : ''}${fc(brrrr.monthlyCashFlow)}/mo` : '— Needs seller price'}
            />
            <Cell
              label="Cash Left In"
              value={brrrr.cashLeftIn != null ? fc(brrrr.cashLeftIn) : '— Needs seller price'}
            />
          </>
        ) : (
          <Cell
            label="Profit"
            value={flip.projectedProfit != null ? fc(flip.projectedProfit) : '— Needs seller price'}
          />
        )}
      </div>
    </div>
  )
}
