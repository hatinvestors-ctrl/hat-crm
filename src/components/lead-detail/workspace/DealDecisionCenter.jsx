// src/components/lead-detail/workspace/DealDecisionCenter.jsx
// HAT Premium Visual Pass, Part 11-15 — "Does this deal work and what can
// we pay?" Progressive disclosure, four levels:
//   L1 DECISION — Deal Economics Hero (Strategy/Profit/MAO/Room) + Margin Visualization
//   L2 CONTEXT  — Ask/Offer/ARV/Reno (secondary line inside the hero)
//   L3 SAFETY   — Best Fit, Margin of Safety, Path to a Deal
//   L4 DETAIL   — Property & Assumptions (rendered by the caller, below this)
// DATA-AWARE, not status-dependent: readiness is judged purely from
// whether ARV/reno/rent are present, never from lead.status.
//
// Every number here comes from the SAME canonical functions DealAnalysisCard
// and FinancialSection already call (computeFlipResult/computeBrrrrResult/
// computeStrategyRecommendation — src/lib/dealExplanation.js). This file
// formats and arranges those results; it never recomputes a formula.
import { formatCurrency as fc, describeCashLeftIn, roundMaxBuy } from '../../../lib/calculations'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../../../lib/dealExplanation'
import { isDistressedLead } from '../../../lib/distressInfo'
import { FlipMarginOfSafety, FlipRealityCheck, BrrrrRealityCheck, VERDICT_DISPLAY_LABEL } from '../DealAnalysisCard'
import { getDealReadiness } from './readiness'
import EmptyState from './EmptyState'
import MarginVisualization from './MarginVisualization'
import CalculationDetails, { CalculationRows } from './CalculationDetails'

function Metric({ label, value, tone }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{label}</div>
      <div className="text-[19px] font-extrabold tabular-nums truncate" style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  )
}

const VERDICT_TONE = {
  STRONG: 'var(--color-success-text)', PASS: 'var(--color-success-text)',
  WATCH: 'var(--color-warn-text)', 'NO DEAL': 'var(--color-danger-text)',
}

export default function DealDecisionCenter({ lead, onRunAnalysis, underwritingSettings = null }) {
  const readiness = getDealReadiness(lead)

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
  const preferBrrrr = strategyRec.preferredStrategy === 'BRRRR' && brrrr.available
  const hero = preferBrrrr ? brrrr : flip

  // Price Clarity + Max Buy Consistency (see RELEASE-READINESS.md) — the
  // ONE actionable Max Buy shown throughout this hero. The exact
  // canonical value (flip.mao) is still what every calculation actually
  // uses; this is presentation rounding only, applied consistently to
  // every number DERIVED from Max Buy in this component (Seller Gap,
  // offer-to-Max-Buy room) so the screen never shows two disagreeing
  // numbers for the same concept.
  const displayMao = roundMaxBuy(flip.mao)
  const sellerAsk = lead.asking_price != null ? Number(lead.asking_price) : null
  // Seller Gap to Max Buy — the difference between what the SELLER is
  // asking and our Max Buy ceiling. This is NOT the same concept as
  // "room" between OUR OFFER and Max Buy (MarginVisualization, below) —
  // that distinction is exactly what was previously mislabeled.
  const sellerGap = (sellerAsk != null && displayMao != null) ? sellerAsk - displayMao : null

  let recReason = strategyRec.reason
  if (!recReason && strategyRec.preferredStrategy === 'BRRRR' && brrrr.available) {
    const cli = describeCashLeftIn(brrrr.cashLeftIn)
    const cashLine = cli.extracted != null ? `recovers all capital and extracts ${fc(cli.extracted)}` : `leaves about ${cli.display} in the deal`
    recReason = `${cashLine.charAt(0).toUpperCase()}${cashLine.slice(1)}${brrrr.monthlyCashFlow > 0 ? ` and stays cash-flow positive at ${fc(brrrr.monthlyCashFlow)}/mo` : ''}.`
  } else if (!recReason && strategyRec.preferredStrategy === 'FLIP' && flip.available) {
    recReason = `Projects ${fc(flip.projectedProfit)} profit at the current offer, ${flip.marginOfSafety?.title?.toLowerCase() || ''}.`
  }

  return (
    <div className="space-y-4">
      {/* L1 — Deal Economics Hero. Facts (money) dominate; judgment (tier
          badge) is the one place semantic color leads (Part 5/9). */}
      <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-2 border-b border-[color:var(--color-line)]">
          <span className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--color-text-dim)]">{preferBrrrr ? 'BRRRR' : 'Flip'}</span>
          <span className="text-[12px] font-extrabold" style={{ color: VERDICT_TONE[hero.verdict] }}>{VERDICT_DISPLAY_LABEL[hero.verdict]}</span>
        </div>
        <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Metric label="We Offer" value={flip.currentOffer != null ? fc(flip.currentOffer) : 'Not set'} />
          <CalculationDetails
            label="Max Buy"
            headline={fc(displayMao)}
            tone="var(--color-accent-text)"
            definition="The maximum purchase price that still meets HAT's minimum Flip profit target, given current ARV/rehab assumptions. Rounded to the nearest $100 for the acquisition workflow — every other number on this screen derived from Max Buy uses this same actionable value."
            rows={[
              { label: 'ARV', value: fc(lead.arv) },
              { label: 'Sale proceeds (93% of ARV)', value: fc(Math.round(lead.arv * 0.93)) },
              { label: 'Rehab', value: `−${fc(lead.renovation_cost)}` },
              { label: 'Financing + holding + closing (at Max Buy)', value: 'solved algebraically', indent: true },
              { separator: true },
              { label: 'Target profit (HAT minimum)', value: fc(flip.targetProfit), bold: true },
              { separator: true },
              // Part 5 — advanced precision disclosure, only shown when
              // rounding actually moved the number, never cluttering the
              // common case where they already agree.
              ...(displayMao !== Math.round(flip.mao) ? [
                { label: 'Calculated Max Buy (exact)', value: fc(Math.round(flip.mao)) },
                { label: 'Actionable Max Buy (used everywhere on this screen)', value: fc(displayMao), bold: true },
              ] : []),
            ]}
            assumptionNote="Max Buy is solved so projected profit at that exact price equals HAT's minimum target — it is not itself a separately-modeled cost line. Displayed and used everywhere as the rounded actionable ceiling."
          />
          {/* Price Clarity fix — this was labeled "Room" and computed as
              mao - evaluationPrice (asking price, when no actual offer is
              on file), which is the SELLER's gap to Max Buy, not the
              room between OUR OFFER and Max Buy (that's the separate
              MarginVisualization concept below). Renamed and re-derived
              from sellerAsk/displayMao — same rounded Max Buy the
              headline above shows, so this number and Max Buy never
              disagree. */}
          <Metric
            label="Seller Gap to Max Buy"
            value={sellerGap == null ? '—' : sellerGap <= 0 ? `${fc(0)} — at/below Max Buy` : fc(sellerGap)}
            tone={sellerGap == null ? undefined : sellerGap <= 0 ? 'var(--color-success-text)' : 'var(--color-danger-text)'}
          />
          <CalculationDetails
            label="Projected Profit"
            headline={fc(flip.projectedProfit)}
            tone={flip.projectedProfit >= 30000 ? 'var(--color-success-text)' : 'var(--color-danger-text)'}
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
              { label: 'Projected Profit', value: fc(Math.round(flip.projectedProfit)), bold: true, tone: flip.projectedProfit >= 30000 ? 'success' : 'danger' },
            ] : []}
            assumptionNote="Selling costs (7% of ARV) are baked into the 93%-of-ARV sale-proceeds assumption above, not shown as a separate line."
          />
          {flip.breakdown && (
            <CalculationDetails
              label="All-In Cost"
              headline={fc(Math.round(flip.breakdown.allIn))}
              definition="Total modeled economic cost of acquiring, renovating, financing, and holding the property before sale — purchase + rehab + acquisition closing + financing costs + holding costs currently included in HAT's underwriting model."
              rows={[
                { label: 'Purchase Price', value: fc(Math.round(flip.evaluationPrice)) },
                { label: 'Rehab', value: fc(Math.round(lead.renovation_cost)) },
                { label: 'Acquisition Closing Costs', value: fc(flip.breakdown.fixedCosts) },
                { label: 'Financing Costs (HML points)', value: fc(Math.round(flip.breakdown.financingCosts)) },
                { label: `Holding Costs (${flip.breakdown.holdMonths}mo)`, value: fc(Math.round(flip.breakdown.totalHolding)) },
                { separator: true },
                { label: 'ALL-IN', value: fc(Math.round(flip.breakdown.allIn)), bold: true },
              ]}
              assumptionNote="Included in All-In: purchase, rehab, HML points, acquisition closing, holding (interest + tax + insurance). Not currently modeled: utilities, HOA, or property management during the hold period."
            />
          )}
        </div>
        {flip.marginOfSafety?.why && (
          <div className="px-4 pb-3 text-[12px] text-[color:var(--color-text-muted)]">{flip.marginOfSafety.why}</div>
        )}
        {/* Part 12 — margin visualization */}
        <div className="px-4 pb-3">
          <MarginVisualization currentOffer={flip.currentOffer} mao={displayMao} />
        </div>
        {/* L2 — context, secondary line */}
        <div className="px-4 py-2 border-t border-[color:var(--color-line)] text-[11px] text-[color:var(--color-text-dim)]">
          {/* Demo Stabilization, Part 5 — "Seller asks" implies a verified
              seller statement, unprovable for off-market/distressed leads
              (sourced from public records, no MLS listing). Neutral for
              those; unchanged for on-market. */}
          {isDistressedLead(lead) ? 'Evaluating at' : 'Seller asks'} {lead.asking_price != null ? fc(lead.asking_price) : '—'} · ARV {fc(lead.arv)} · Reno {fc(lead.renovation_cost)}
          {lead.starting_offer != null && <> · Starting offer {fc(lead.starting_offer)}</>}
        </div>
      </div>

      {/* BRRRR — Part 14: never given equal visual weight to an
          unavailable analysis. Compact one-liner when not ready; a real
          comparison row only once it is. */}
      {!preferBrrrr && (
        brrrr.available ? (
          <div className="rounded-lg border border-[color:var(--color-line)] px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[color:var(--color-text-dim)]">BRRRR</span>
            <span className="text-[11.5px]" style={{ color: VERDICT_TONE[brrrr.verdict] }}>{VERDICT_DISPLAY_LABEL[brrrr.verdict]}</span>
            <span className="text-[11.5px] text-[color:var(--color-text)]">
              {(() => {
                const cli = describeCashLeftIn(brrrr.cashLeftIn)
                return cli.extracted != null ? `Cash left in ${cli.display} (+${fc(cli.extracted)} extracted)` : `Cash left in ${cli.display}`
              })()}
            </span>
            <span className="text-[11.5px] text-[color:var(--color-text)]">{brrrr.monthlyCashFlow != null ? `${fc(brrrr.monthlyCashFlow)}/mo` : '—'}</span>
          </div>
        ) : (
          <div className="text-[11px] text-[color:var(--color-text-dim)] px-1">BRRRR — Rent estimate needed to evaluate.</div>
        )
      )}

      {/* Part 6/7 — BRRRR Cash Left In / Monthly Cash Flow transparency,
          the mission's explicit "highest-priority UI calculation
          breakdown". Rendered whenever BRRRR is available, both when it
          IS and isn't the preferred strategy — the compact summary row
          above only appears when Flip is preferred. */}
      {brrrr.available && brrrr.breakdown && (() => {
        const b = brrrr.breakdown
        const cli = describeCashLeftIn(b.totalCashInvested)
        return (
          <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-4 py-3 grid grid-cols-2 gap-3">
            <CalculationDetails
              label="BRRRR Cash Left In"
              headline={cli.display}
              tone={cli.allRecovered ? 'var(--color-success-text)' : undefined}
              definition="Your estimated own capital remaining in the property after refinance and modeled refinance costs."
              rows={[
                { label: 'Investor Purchase Equity (10%)', value: fc(Math.round(b.investorPurchaseEquity)) },
                { label: 'HML Points / Lender Fees', value: fc(Math.round(b.financingCosts)) },
                { label: 'Acquisition Closing Costs', value: fc(b.acquisitionCosts) },
                { label: 'Investor-Funded Rehab', value: fc(0) },
                { label: 'Rehab financing assumption', value: '100% lender-funded', indent: true },
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
                { label: 'NET CASH RETURNED TO INVESTOR', value: fc(Math.round(b.netRefiCashReturned)), bold: true },
                { separator: true },
                { label: 'Total Investor Cash Contributed', value: fc(Math.round(b.investorCashContributed)) },
                { label: 'Net Cash Returned', value: `−${fc(Math.round(b.netRefiCashReturned))}`, indent: true },
                { separator: true },
                cli.extracted != null
                  ? { label: 'CASH LEFT IN — all capital recovered, extracted', value: `$0 · +${fc(cli.extracted)}`, bold: true, tone: 'success' }
                  : { label: 'CASH LEFT IN', value: cli.display, bold: true },
              ]}
              assumptionNote={`Refinance closing costs (${(b.refiCosts / b.grossRefiLoan * 100).toFixed(1)}% of loan) and rate assumptions are ESTIMATED/DEFAULTED, not an actual lender quote — see "Remaining Financial Assumptions" in the release-readiness report. Rehab is modeled as 100% lender-financed (no draw-timing/reimbursement mechanic).`}
            />
            <CalculationDetails
              label="Monthly Cash Flow"
              headline={b.monthlyCF != null ? `${b.monthlyCF >= 0 ? '+' : ''}${fc(b.monthlyCF)}/mo` : '—'}
              tone={b.monthlyCF > 0 ? 'var(--color-success-text)' : 'var(--color-danger-text)'}
              definition="Estimated monthly rent remaining after the operating expenses and refinance debt service currently included in HAT's underwriting model."
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
                { label: 'Monthly P&I', value: fc(Math.round(b.mortgagePayment)) },
              ] : []}
              assumptionNote="Underwriting note: vacancy, property management, and maintenance/CapEx reserves are not currently deducted under the active HAT underwriting policy (self-managed assumption)."
            />
          </div>
        )
      })()}

      {/* Demo Stabilization, Part 4 — PRESENTATION ONLY, computeStrategyRecommendation
          untouched. That function cannot distinguish "BRRRR was evaluated
          and lost" from "BRRRR was never evaluated" (e.g. no rent estimate)
          — both collapse into the same FLIP-preferred branch. "Best Fit"
          implies a real comparison happened; only show it when BOTH
          strategies were genuinely evaluated. When only one could be
          evaluated, say so honestly instead — never implies the other one
          was compared and lost. */}
      {strategyRec.preferredStrategy !== 'NONE' && flip.available && brrrr.available ? (
        <div className="flex items-center gap-2 px-1 border-l-2 pl-3" style={{ borderLeftColor: 'var(--color-accent)' }}>
          <span className="text-[9px] uppercase tracking-wider font-bold text-[color:var(--color-text-dim)]">Best Fit</span>
          <span className="text-[12.5px] font-bold text-[color:var(--color-accent-text)]">{strategyRec.summary.replace(/^BEST EXIT: /, '')}</span>
          {recReason && <span className="text-[11px] text-[color:var(--color-text-dim)]">— {recReason}</span>}
        </div>
      ) : strategyRec.preferredStrategy !== 'NONE' ? (
        <div className="flex items-center gap-2 px-1 border-l-2 pl-3" style={{ borderLeftColor: 'var(--color-line)' }}>
          <span className="text-[9px] uppercase tracking-wider font-bold text-[color:var(--color-text-dim)]">Analysis Available</span>
          <span className="text-[12.5px] font-bold text-[color:var(--color-text)]">{strategyRec.preferredStrategy} ANALYSIS AVAILABLE</span>
          {recReason && <span className="text-[11px] text-[color:var(--color-text-dim)]">— {recReason}</span>}
        </div>
      ) : (
        <div className="text-[12px] text-[color:var(--color-text-dim)] px-1">
          Neither strategy meets HAT's targets at the current price.
        </div>
      )}

      {/* L3 — Margin of Safety detail + Path to a Deal (moved from AI &
          Comps, not duplicated — DealAnalysisCard hides these via
          hideDecisionSummary when mounted in AI & Comps). */}
      <FlipMarginOfSafety lead={lead} flipResult={flip} underwritingSettings={underwritingSettings} />
      <FlipRealityCheck lead={lead} flipResult={flip} underwritingSettings={underwritingSettings} />
      {readiness.brrrrReady && <BrrrrRealityCheck lead={lead} underwritingSettings={underwritingSettings} />}
    </div>
  )
}
