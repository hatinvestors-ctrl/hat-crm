// src/components/lead-detail/workspace/DealDecisionCenter.jsx
// HAT Investors — UX V2.6, "Canonical Strategy Comparison + Deal Tab
// Simplification". Replaces the prior four-part hierarchy (Deal Economics
// Hero for ONE strategy + a separate always-visible BRRRR summary row +
// Best Fit line + standalone Margin of Safety card + Path to a Flip Deal
// + Path to a BRRRR Deal) with:
//   L1 RECOMMENDATION — ONE canonical "Recommended Strategy: X" line +
//                        ONE explanation sentence (buildStrategyComparison,
//                        acquisitionDecisionPresentation.js — the SAME
//                        resolver DecisionHero/Overview uses).
//   L2 COMPARISON     — a compact BRRRR-vs-Flip card pair: Status/Max Buy/
//                        2 key metrics each. Both always visible so the
//                        user can see WHY one was preferred.
//   L3 STRATEGY DETAIL — a two-tab selector (default = the same canonical
//                        recommended strategy) showing ONLY that
//                        strategy's detailed breakdown. Never both at once.
//   L4 DETAIL         — Property & Assumptions (rendered by the caller,
//                        below this).
// DATA-AWARE, not status-dependent: readiness is judged purely from
// whether ARV/reno/rent are present, never from lead.status.
//
// Every number here comes from the SAME canonical functions DealAnalysisCard
// and FinancialSection already call (computeFlipResult/computeBrrrrResult/
// computeStrategyRecommendation — src/lib/dealExplanation.js). This file
// formats and arranges those results; it never recomputes a formula.
//
// UX V2.6, Part 6/7/8/9 audit — FlipMarginOfSafety/FlipRealityCheck/
// BrrrrRealityCheck (DealAnalysisCard.jsx: "Path to a Flip Deal", "Path to
// a BRRRR Deal", the standalone Margin of Safety card, "Test downside",
// "Profit cushion vs. price cushion") were confirmed to be PURE
// PRESENTATION layers over the same canonical flip/brrrr results — no
// unique calculation of their own (BrrrrRealityCheck calls
// calculateBrrrrMAO directly rather than reusing the passed-in brrrr
// result, but that function is the same canonical solver, not new logic).
// Per the mission's explicit "do not delete underlying calc, remove UI
// only": those exported components remain fully intact and importable in
// DealAnalysisCard.jsx (available for a future Advanced Analysis area) —
// this file simply no longer imports/renders them, since their
// information (Max Buy, limiting factor, current profit vs target,
// downside sensitivity) is now covered by the comparison cards + selected
// strategy detail panel below, without a THIRD competing verdict surface.
import { useState } from 'react'
import { formatCurrency as fc, describeCashLeftIn, roundMaxBuy } from '../../../lib/calculations'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation, resolveEffectiveStrategy } from '../../../lib/dealExplanation'
import { isDistressedLead, resolveMarketType } from '../../../lib/distressInfo'
import { getSellerIntelligence } from '../../../lib/sellerStrategy'
import { buildStrategyComparison, hasEvaluablePrice } from '../../../lib/acquisitionDecisionPresentation'
import { getDealReadiness } from './readiness'
import EmptyState from './EmptyState'
import MarginVisualization from './MarginVisualization'
import CalculationDetails from './CalculationDetails'

function Metric({ label, value, tone }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{label}</div>
      <div className="text-[19px] font-extrabold tabular-nums truncate" style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  )
}

const STATUS_TONE = {
  WORKS: 'var(--color-success-text)',
  'BELOW TARGET': 'var(--color-danger-text)',
  UNAVAILABLE: 'var(--color-text-dim)',
  // V2.9 — neutral, not red: "no price yet" is not a failure.
  MAX_BUY_ONLY: 'var(--color-text)',
  NEEDS_INPUT: 'var(--color-text-dim)',
}

// Compact comparison card — L2. Never shows a raw internal verdict word
// (WATCH/SOLID/STRONG/NO DEAL); only the strategy-specific WORKS/BELOW
// TARGET/UNAVAILABLE status the mission's Part 4 requires.
// V2.9 — `line` (e.g. "Buy at $147,700 or less" / "Need rent estimate to
// calculate") replaces the status word whenever there is no price to be
// WORKS/BELOW TARGET against. Plain English, per Part 4.
function StrategyCard({ name, status, statusLine, isRecommended, metrics }) {
  return (
    <div
      className="rounded-lg border px-3.5 py-3 flex-1 min-w-0"
      style={{ borderColor: isRecommended ? 'var(--color-accent)' : 'var(--color-line)', borderWidth: isRecommended ? '1.5px' : '1px' }}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[11px] font-extrabold uppercase tracking-wide text-[color:var(--color-text)]">
          {name}{isRecommended && <span className="text-[color:var(--color-accent-text)]"> — {statusLine ? 'Best Option' : 'Recommended'}</span>}
        </span>
      </div>
      {statusLine ? (
        <div className="text-[12px] font-bold mb-1.5" style={{ color: STATUS_TONE[status] }}>{statusLine}</div>
      ) : (
        <div className="text-[10.5px] font-bold uppercase tracking-wide mb-1.5" style={{ color: STATUS_TONE[status] }}>{status}</div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {metrics.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{label}</div>
            <div className="text-[13.5px] font-bold tabular-nums truncate">{value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DealDecisionCenter({ lead, onRunAnalysis, underwritingSettings = null }) {
  const readiness = getDealReadiness(lead)
  const [selectedStrategy, setSelectedStrategy] = useState(null)

  // L1 fallback — one consolidated readiness block instead of the
  // decision hero / strategy comparison / margin / path each separately
  // rendering their own "not available." Property basics already on file
  // are still shown under KNOWN, so nothing looks broken — just not yet
  // computed.
  if (!readiness.flipReady) {
    return (
      <div className="space-y-4">
        <EmptyState
          title="Deal Not Ready"
          explanation={`${readiness.missing.length} input${readiness.missing.length === 1 ? '' : 's'} needed before economics can be calculated.`}
          missing={readiness.missing}
          action={onRunAnalysis ? { label: 'Run Comps to Estimate ARV →', onClick: onRunAnalysis } : undefined}
        />
        {(lead.asking_price != null || lead.renovation_cost != null || lead.bedrooms) && (
          <div className="rounded-lg border border-[color:var(--color-line)] px-4 py-3">
            <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-2">Known</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {lead.asking_price != null && <Metric label="Ask" value={fc(lead.asking_price)} />}
              {(lead.bedrooms || lead.bathrooms) && <Metric label="Beds / Baths" value={`${lead.bedrooms ?? '—'} / ${lead.bathrooms ?? '—'}`} />}
              {lead.sqft != null && <Metric label="Sqft" value={Number(lead.sqft).toLocaleString()} />}
              {lead.renovation_cost != null && <Metric label="Rehab" value={fc(lead.renovation_cost)} />}
            </div>
          </div>
        )}
      </div>
    )
  }

  const flip = computeFlipResult(lead, underwritingSettings)
  const brrrr = computeBrrrrResult(lead, underwritingSettings)
  const strategyRec = computeStrategyRecommendation(flip, brrrr)
  // Price provenance (UX V2.3–V2.5, preserved verbatim) — off-market shows
  // Evaluation Price unless a genuine seller price is on file; never
  // silently relabeled. Hoisted above the comparison in V2.9 because
  // hasEvaluablePrice needs the genuine seller price.
  const isOffMarket = resolveMarketType(lead) === 'OFF_MARKET'
  const genuineSellerAsking = isOffMarket ? getSellerIntelligence(lead).seller_asking_price : null
  // UX V2.6, Part 3/10 — the ONE canonical strategy-comparison + recommendation
  // builder, shared with DecisionHero/Overview (same resolveEffectiveStrategy
  // underneath) — this is where "Overview and Deal must agree" is enforced
  // structurally, not just by convention.
  // UX V2.9 — the ONE shared answer to "is there a real price to evaluate
  // against?" (acquisitionDecisionPresentation.js). Without it this tab
  // showed BRRRR/FLIP "BELOW TARGET" and "None — neither strategy
  // qualifies" for a property whose only problem is that the seller has
  // not named a price yet. Same single canonical resolver as Overview.
  const priceKnown = hasEvaluablePrice({ flip, lead, sellerAskingPrice: genuineSellerAsking })
  const comparison = buildStrategyComparison({ flip, brrrr, strategyRec, hasPrice: priceKnown })
  const effective = comparison.recommended // 'FLIP' | 'BRRRR' | null
  // Part 5 — default selection follows the canonical recommendation;
  // selecting the other tab never changes what's recommended, only which
  // detail panel is shown.
  const active = selectedStrategy || effective || (flip.available ? 'FLIP' : 'BRRRR')

  const displayMao = roundMaxBuy(flip.mao)
  const brrrrDisplayMao = brrrr.available && brrrr.mao != null ? roundMaxBuy(brrrr.mao) : null

  const priceLabel = isOffMarket ? (genuineSellerAsking != null ? 'Seller Asking' : 'Evaluation Price') : 'Asking Price'
  const priceValue = isOffMarket ? (genuineSellerAsking ?? lead.asking_price) : lead.asking_price

  // V2.9 — with no price, profit / cash-left-in / cash-flow are all null
  // (they are evaluated AT a price). Showing "—" for each would imply the
  // strategy could not be evaluated, when in fact its Max Buy computed
  // fine. Each card carries only its Max Buy in that state.
  const flipMetrics = priceKnown
    ? [
        ['Max Buy', fc(displayMao)],
        ['Profit @ ' + (isDistressedLead(lead) ? 'Evaluation' : 'Current') + ' Price', flip.available ? fc(flip.projectedProfit) : '—'],
      ]
    : [['Max Buy', fc(displayMao)]]
  const brrrrMetrics = !brrrr.available
    ? [['Max Buy', '—'], ['Status', 'Rent estimate needed']]
    : priceKnown
      ? [['Max Buy', brrrrDisplayMao != null ? fc(brrrrDisplayMao) : '—'], ['Cash Left In', describeCashLeftIn(brrrr.cashLeftIn).display], ['Cash Flow', brrrr.monthlyCashFlow != null ? `${brrrr.monthlyCashFlow >= 0 ? '+' : ''}${fc(brrrr.monthlyCashFlow)}/mo` : '—']]
      : [['Max Buy', brrrrDisplayMao != null ? fc(brrrrDisplayMao) : '—']]

  return (
    <div className="space-y-4">
      {/* L1 — ONE canonical recommendation + ONE explanation sentence. */}
      <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-4 py-3">
        <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold">Recommended Strategy</div>
        {/* V2.9 — "None — neither strategy qualifies" is only honest when a
            real price was actually tested. With no price it was a false
            failure verdict; comparison.recommended now carries the
            no-price best option instead. */}
        <div className="text-[18px] font-extrabold text-[color:var(--color-text)] mt-0.5">
          {effective ?? (comparison.priceUnknown ? 'Need more information' : 'None — neither strategy qualifies')}
        </div>
        <p className="text-[12px] text-[color:var(--color-text-muted)] mt-1 leading-snug">{comparison.explanation}</p>
        <div className="text-[10.5px] text-[color:var(--color-text-dim)] mt-1.5">
          {priceKnown
            ? `${priceLabel} ${priceValue != null ? fc(priceValue) : '—'}`
            : 'Seller price: not given yet'} · ARV {fc(lead.arv)} · Reno {fc(lead.renovation_cost)}
        </div>
      </div>

      {/* L2 — compact strategy comparison, both always visible. */}
      <div className="flex flex-col sm:flex-row gap-3">
        <StrategyCard name="BRRRR" status={comparison.brrrr.status} statusLine={comparison.brrrr.line} isRecommended={effective === 'BRRRR'} metrics={brrrrMetrics} />
        <StrategyCard name="FLIP" status={comparison.flip.status} statusLine={comparison.flip.line} isRecommended={effective === 'FLIP'} metrics={flipMetrics} />
      </div>

      {/* L3 — strategy selector, defaulting to the canonical recommendation.
          Never shows both strategies' detail at once (Part 5's explicit
          requirement). */}
      <div className="flex items-center gap-2">
        {['BRRRR', 'FLIP'].map(s => (
          <button
            key={s}
            type="button"
            onClick={() => setSelectedStrategy(s)}
            className="text-[11.5px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-md border transition-colors"
            style={active === s
              ? { borderColor: 'var(--color-accent)', color: 'var(--color-accent-text)', background: 'var(--color-bg-elev-2)' }
              : { borderColor: 'var(--color-line)', color: 'var(--color-text-dim)' }}
          >
            {s}{s === effective ? ' — Recommended' : ''}
          </button>
        ))}
      </div>

      {/* V2.9 — with no price there is nothing to evaluate AT: Suggested
          Offer, Profit @ price and All-In are all null. Show the one thing
          that is genuinely computable (Max Buy) and say plainly what is
          missing, instead of a row of "—" that reads as a broken deal.
          Nothing is removed for priced leads. */}
      {!priceKnown ? (
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-4 py-3">
          <div className="grid grid-cols-2 gap-3">
            <Metric
              label={active === 'FLIP' ? 'Flip Max Buy' : 'BRRRR Max Buy'}
              value={active === 'FLIP' ? fc(displayMao) : (brrrrDisplayMao != null ? fc(brrrrDisplayMao) : '—')}
              tone="var(--color-accent-text)"
            />
            {active === 'BRRRR' && brrrr.available && (
              <Metric label="Limiting Factor" value={brrrr.limitingFactor === 'CASH_LEFT_IN' ? 'Cash Left In' : 'Cash Flow'} />
            )}
          </div>
          <p className="text-[11.5px] text-[color:var(--color-text-muted)] mt-2 leading-snug">
            {active === 'BRRRR' && !brrrr.available
              ? 'Need a rent estimate to calculate BRRRR.'
              : `Buy at ${fc(active === 'FLIP' ? displayMao : brrrrDisplayMao)} or less. Profit and cash-flow figures need a purchase price — get the seller's asking price to see them.`}
          </p>
        </div>
      ) : active === 'FLIP' ? (
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] overflow-hidden">
          <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* UX V2.4/V2.5, Part 1 Finding B — this value is flip.currentOffer,
                a MAO-anchored CALCULATED suggestion (getEffectiveOffer), never
                an actual submitted offer (lead.offer_price is that field —
                see acquisitionDecisionPresentation.js's resolveActualOffer).
                Labeled to match DealSnapshotCompact.jsx (V2.1). */}
            <Metric label="Suggested Offer" value={flip.currentOffer != null ? fc(flip.currentOffer) : 'Not set'} />
            <CalculationDetails
              label="Flip Max Buy"
              headline={fc(displayMao)}
              tone="var(--color-accent-text)"
              definition="Highest purchase price that still meets HAT's minimum Flip profit target, given current ARV/rehab assumptions. Rounded to the nearest $100 for the acquisition workflow."
              rows={[
                { label: 'ARV', value: fc(lead.arv) },
                { label: 'Sale proceeds (93% of ARV)', value: fc(Math.round(lead.arv * 0.93)) },
                { label: 'Rehab', value: `−${fc(lead.renovation_cost)}` },
                { label: 'Financing + holding + closing (at Max Buy)', value: 'solved algebraically', indent: true },
                { separator: true },
                { label: 'Target profit (HAT minimum)', value: fc(flip.targetProfit), bold: true },
              ]}
              assumptionNote="Max Buy is solved so projected profit at that exact price equals HAT's minimum target."
            />
            <CalculationDetails
              label={`Flip Profit @ ${isDistressedLead(lead) ? 'Evaluation' : 'Current'} Price${flip.evaluationPrice != null ? ` (${fc(Math.round(flip.evaluationPrice))})` : ''}`}
              headline={fc(flip.projectedProfit)}
              tone={flip.projectedProfit >= flip.targetProfit ? 'var(--color-success-text)' : 'var(--color-danger-text)'}
              definition="Estimated Flip profit at the current evaluation price, after HML financing, closing, holding, and selling costs currently modeled by HAT's underwriting."
              rows={flip.breakdown ? [
                { label: 'Expected Sale Price (93% of ARV)', value: fc(Math.round(flip.breakdown.saleProceeds)) },
                { separator: true },
                { label: 'Purchase Price', value: `−${fc(Math.round(flip.evaluationPrice))}`, indent: true },
                { label: 'Rehab', value: `−${fc(Math.round(lead.renovation_cost))}`, indent: true },
                { label: 'HML points/fees (financing)', value: `−${fc(Math.round(flip.breakdown.points))}`, indent: true },
                { label: 'Acquisition closing costs', value: `−${fc(flip.breakdown.fixedCosts)}`, indent: true },
                { label: `Holding costs (${flip.breakdown.holdMonths}mo)`, value: `−${fc(Math.round(flip.breakdown.totalHolding))}`, indent: true },
                { separator: true },
                { label: 'Projected Profit', value: fc(Math.round(flip.projectedProfit)), bold: true, tone: flip.projectedProfit >= flip.targetProfit ? 'success' : 'danger' },
              ] : []}
              assumptionNote="Selling costs (7% of ARV) are baked into the 93%-of-ARV sale-proceeds assumption above."
            />
            {flip.breakdown && (
              <CalculationDetails
                label="All-In Cost"
                headline={fc(Math.round(flip.breakdown.allIn))}
                definition="Total modeled economic cost of acquiring, renovating, financing, and holding the property before sale."
                rows={[
                  { label: 'Purchase Price', value: fc(Math.round(flip.evaluationPrice)) },
                  { label: 'Rehab', value: fc(Math.round(lead.renovation_cost)) },
                  { label: 'Acquisition Closing Costs', value: fc(flip.breakdown.fixedCosts) },
                  { label: 'Financing Costs (HML points)', value: fc(Math.round(flip.breakdown.financingCosts)) },
                  { label: `Holding Costs (${flip.breakdown.holdMonths}mo)`, value: fc(Math.round(flip.breakdown.totalHolding)) },
                  { separator: true },
                  { label: 'ALL-IN', value: fc(Math.round(flip.breakdown.allIn)), bold: true },
                ]}
                assumptionNote="Included in All-In: purchase, rehab, HML points, acquisition closing, holding. Not modeled: utilities, HOA, property management during the hold period."
              />
            )}
          </div>
          {/* UX V2.6, Part 8 — a compact secondary thin-margin note replaces
              the removed standalone Margin of Safety card, but ONLY when
              Flip actually WORKS and is thin (verdict WATCH) — never shown
              for a strategy that's simply BELOW TARGET (that's already
              communicated by the Status/Profit numbers above). */}
          {flip.available && flip.verdict === 'WATCH' && (
            <div className="px-4 pb-2 text-[11px] text-[color:var(--color-warn-text)]">
              Margin: Thin — only {fc(Math.round(displayMao - flip.evaluationPrice))} below Flip Max Buy.
            </div>
          )}
          <div className="px-4 pb-3">
            <MarginVisualization currentOffer={flip.currentOffer} mao={displayMao} />
          </div>
        </div>
      ) : (
        brrrr.available && brrrr.breakdown ? (
          <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-4 py-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Metric label="BRRRR Max Buy" value={brrrrDisplayMao != null ? fc(brrrrDisplayMao) : '—'} tone="var(--color-accent-text)" />
              <Metric label="Limiting Factor" value={brrrr.limitingFactor === 'CASH_LEFT_IN' ? 'Cash Left In' : 'Cash Flow'} />
            </div>
            {brrrr.verdict === 'WATCH' && (
              <div className="text-[11px] text-[color:var(--color-warn-text)]">Margin: Thin — close to HAT's cash-left-in ceiling.</div>
            )}
            {(() => {
              const b = brrrr.breakdown
              const cli = describeCashLeftIn(b.totalCashInvested)
              return (
                <div className="grid grid-cols-2 gap-3">
                  <CalculationDetails
                    label="BRRRR Cash Left In"
                    headline={cli.display}
                    tone={cli.allRecovered ? 'var(--color-success-text)' : undefined}
                    definition="Your estimated own capital remaining in the property after refinance and modeled refinance costs."
                    rows={[
                      { label: 'Investor Purchase Equity (10%)', value: fc(Math.round(b.investorPurchaseEquity)) },
                      { label: 'HML Points / Lender Fees', value: fc(Math.round(b.financingCosts)) },
                      { label: 'Acquisition Closing Costs', value: fc(b.acquisitionCosts) },
                      { label: `Holding / Financing Costs (${b.holdMonths}mo)`, value: fc(Math.round(b.totalHolding)) },
                      { separator: true },
                      { label: 'TOTAL INVESTOR CASH CONTRIBUTED', value: fc(Math.round(b.investorCashContributed)), bold: true },
                      { separator: true },
                      { label: 'Refinance Value (ARV)', value: fc(b.refiValue) },
                      { label: 'Refinance LTV', value: `${(b.refiLtvPct * 100).toFixed(0)}%` },
                      { label: 'Gross Refinance Loan', value: fc(Math.round(b.grossRefiLoan)) },
                      { label: 'HML Payoff', value: `−${fc(Math.round(b.hmlPayoff))}`, indent: true },
                      { label: 'Refinance Closing Costs (estimated)', value: `−${fc(Math.round(b.refiCosts))}`, indent: true },
                      { separator: true },
                      cli.extracted != null
                        ? { label: 'CASH LEFT IN — all capital recovered, extracted', value: `$0 · +${fc(cli.extracted)}`, bold: true, tone: 'success' }
                        : { label: 'CASH LEFT IN', value: cli.display, bold: true },
                    ]}
                    assumptionNote={`Refinance closing costs (${(b.refiCosts / b.grossRefiLoan * 100).toFixed(1)}% of loan) and rate assumptions are ESTIMATED, not an actual lender quote. Rehab is modeled as 100% lender-financed.`}
                  />
                  <CalculationDetails
                    label="Monthly Cash Flow"
                    headline={b.monthlyCF != null ? `${b.monthlyCF >= 0 ? '+' : ''}${fc(b.monthlyCF)}/mo` : '—'}
                    tone={b.monthlyCF > 0 ? 'var(--color-success-text)' : 'var(--color-danger-text)'}
                    definition="Estimated monthly rent remaining after operating expenses and refinance debt service."
                    rows={b.monthlyCF != null ? [
                      { label: 'Monthly Rent', value: fc(b.rent) },
                      { separator: true },
                      { label: 'Mortgage P&I', value: `−${fc(Math.round(b.mortgagePayment))}`, indent: true },
                      { label: 'Property Taxes', value: `−${fc(b.taxesMonthly)}`, indent: true },
                      { label: 'Insurance', value: `−${fc(b.insuranceMonthly)}`, indent: true },
                      { separator: true },
                      { label: 'MONTHLY CASH FLOW', value: `${b.monthlyCF >= 0 ? '+' : ''}${fc(b.monthlyCF)}`, bold: true, tone: b.monthlyCF > 0 ? 'success' : 'danger' },
                      { separator: true },
                      { label: 'Refi Loan', value: fc(Math.round(b.grossRefiLoan)) },
                      { label: 'Interest Rate', value: `${(b.refiInterestRate * 100).toFixed(2)}%` },
                      { label: 'Amortization', value: `${b.amortizationYears} years` },
                    ] : []}
                    assumptionNote="Underwriting note: vacancy, property management, and maintenance/CapEx reserves are not currently deducted under the active HAT underwriting policy (self-managed assumption)."
                  />
                </div>
              )
            })()}
          </div>
        ) : (
          <div className="rounded-lg border border-[color:var(--color-line)] px-4 py-3 text-[11.5px] text-[color:var(--color-text-dim)]">
            BRRRR — insufficient data. A rent estimate is needed to evaluate this strategy.
          </div>
        )
      )}
    </div>
  )
}
