// src/components/lead-detail/workspace/DecisionHero.jsx
// HAT Premium Visual Pass, Part 7/9/10 — the ONE dominant decision surface
// on Overview. Consolidates what used to be two separately-rendered
// voices (AcquisitionCopilot's header + LeadWorkspaceHeader's chips) into
// one hero, and makes the OVERALL DECISION (V2 recommendation — "should
// we prioritize this") explicitly distinct from DEAL SAFETY (the Flip
// tier — "does the math have room"), per Part 9's exact instruction.
//
// ZERO new business logic: OVERALL DECISION reads decision_v2 +
// classifyLeadV2()/getActionReason() (Capability #17.1) + getDecisionMaturity
// (#16.1) exactly as AcquisitionCopilot already did. DEAL SAFETY + the
// economics row read computeFlipResult() (dealExplanation.js) exactly as
// DealAnalysisCard/DealDecisionCenter already do. This file only arranges
// and labels already-computed values.
import { useState } from 'react'
import { classifyLeadV2 } from '../../../pages/ActionCenterPage'
import { getActionReason } from '../../../lib/actionReason'
import { getDecisionMaturity, getArvProvenance } from '../../../lib/arvProvenance'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../../../lib/dealExplanation'
import { formatCurrency as fc } from '../../../lib/calculations'
import { VERDICT_DISPLAY_LABEL } from '../DealAnalysisCard'
import { deriveAcquisitionDecision, buildWhyReasons, composeNextActionText } from '../../../lib/acquisitionDecisionPresentation'
import { resolveMarketType } from '../../../lib/distressInfo'
import { getSellerIntelligence } from '../../../lib/sellerStrategy'
import InfoTooltip from '../../ui/InfoTooltip'

const REC_THEME = {
  ACT_NOW:      { text: 'var(--color-danger-text)',  border: 'var(--color-danger)' },
  REVIEW_TODAY: { text: 'var(--color-warn-text)',     border: 'var(--color-warn)' },
  RESEARCH:     { text: 'var(--color-text)',          border: 'var(--color-line)' },
  FOLLOW_UP:    { text: 'var(--color-accent-text)',   border: 'var(--color-accent)' },
  MONITOR:      { text: 'var(--color-text-dim)',      border: 'var(--color-line)' },
  PASS:         { text: 'var(--color-text-dim)',      border: 'var(--color-line)' },
}
const DEAL_SAFETY_TONE = {
  STRONG: 'var(--color-success-text)', PASS: 'var(--color-success-text)',
  WATCH: 'var(--color-warn-text)', 'NO DEAL': 'var(--color-danger-text)',
}

function Metric({ label, value, tone }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{label}</div>
      <div className="text-[19px] font-extrabold tabular-nums truncate" style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  )
}

// UX V2.4, Part 8 — compact, factual, per-recommendation subtext. No new
// business logic: purely a presentation lookup keyed on the SAME
// decision_v2.recommendation value already used everywhere else. Replaces
// the previously-inline threshold explanation ("Opportunity 58 is
// promising (>=45) but hasn't reached the Act Now bar...") with one short
// sentence; the full deterministic reason (getActionReason) remains
// available, just no longer forced into the primary line.
const PRIORITY_SUBTEXT = {
  ACT_NOW: 'Urgent — act now.',
  REVIEW_TODAY: 'Worth reviewing today, but not urgent.',
  RESEARCH: 'Needs more research before acting.',
  FOLLOW_UP: 'Follow up as scheduled.',
  MONITOR: 'Low urgency — monitor for changes.',
  PASS: 'Not currently a priority.',
}

// UX V2.4, Part 6 — plain-language margin-of-safety framing. Reuses the
// EXISTING flip.verdict tiers verbatim (no new thresholds): STRONG/PASS
// ("SOLID") already mean "clears HAT's target with real room," so they
// map to HEALTHY; WATCH already means "clears the target but thinly," so
// it maps to THIN. 'NO DEAL' isn't a margin question (nothing to be thin
// or healthy about) so it produces no margin line here — that case is
// already communicated by the primary NEGOTIATE/secondaryStrategy text.
const MARGIN_OF_SAFETY = {
  STRONG: 'HEALTHY', PASS: 'HEALTHY', WATCH: 'THIN',
}

export default function DecisionHero({ lead, underwritingSettings = null }) {
  const [showDetails, setShowDetails] = useState(false)
  const d = lead.decision_v2
  if (!d) return null

  const theme = REC_THEME[d.recommendation] || REC_THEME.MONITOR
  const isOverridden = d.next_best_action === 'HUMAN_OVERRIDE'
  const classified = classifyLeadV2(lead)
  const actionReason = classified ? getActionReason(lead, classified) : (isOverridden ? getActionReason(lead, { category: 'ACT_NOW' }) : null)
  // UX V2.2, Part 1/2 — real, confirmed root cause of the Woodleigh
  // headline problem: this component previously gated the ENTIRE plain-
  // language Acquisition Decision behind `!lead.is_distressed`, so every
  // off-market lead fell through to the raw internal recommendation word
  // (e.g. "REVIEW TODAY") as its headline — none of the V2/V2.1 work
  // ever reached off-market leads at all. Flip/BRRRR ARE computable for
  // off-market leads with enough data (Woodleigh has full ARV/reno/rent)
  // — the gating was never a real data limitation, just an oversight.
  // Market-aware computation now runs for every lead; deriveAcquisitionDecision
  // itself (not this component) decides how to present price context per
  // marketType (see that file's header for the full mapping).
  const maturity = getDecisionMaturity(lead)
  const isPreliminary = maturity === 'PRELIMINARY'
  const prov = getArvProvenance(lead)

  // UX V2.4, Part 1 Finding A — real, confirmed root cause of the
  // Woodleigh "Overview says FLIP preferred, Deal tab says BRRRR
  // preferred" contradiction: this component NEVER received
  // `underwritingSettings` at all, so computeFlipResult/computeBrrrrResult
  // here silently used calculations.js's hardcoded DEFAULT settings
  // (e.g. refi_ltv_pct=70%), while DealDecisionCenter.jsx (the Deal tab)
  // correctly receives and threads the workspace's actual configured
  // settings (e.g. 75%). BRRRR's MAO is highly sensitive to refi LTV, so
  // a 70%-vs-75% mismatch can genuinely flip which strategy scores
  // higher between the two surfaces — a wiring defect, not a real
  // methodology disagreement (same functions, same formulas, different
  // settings object). Fixed by threading the same effective settings
  // LeadDetailPage.jsx already resolves for every other consumer.
  const flip = computeFlipResult(lead, underwritingSettings)
  const brrrr = computeBrrrrResult(lead, underwritingSettings)
  const strategyRec = flip.available || brrrr.available ? computeStrategyRecommendation(flip, brrrr) : null

  // Part 1/6 audit — the ONE trustworthy off-market seller-price field
  // (populated only from an actual recorded call where the seller stated
  // a number). Never repurposes asking_price/currentOffer/MAO as a
  // stand-in — see acquisitionDecisionPresentation.js's header note.
  const marketType = resolveMarketType(lead)
  const sellerAskingPrice = marketType === 'OFF_MARKET' ? getSellerIntelligence(lead).seller_asking_price : null

  // Lead Workspace UX V2 — the ONE dominant headline is now the plain-
  // language ACQUISITION DECISION (does it work / negotiate / research /
  // pass), not the raw internal recommendation word (ACT_NOW/
  // REVIEW_TODAY/etc, a WORKFLOW PRIORITY concept — Part 7's explicit
  // "these are not the same as GOOD DEAL/BAD DEAL/NEGOTIATE/PASS").
  // deriveAcquisitionDecision reads ONLY the same computeFlipResult/
  // computeBrrrrResult/computeStrategyRecommendation facts already used
  // below for Deal Safety/the economics row — zero new business logic.
  const decision = deriveAcquisitionDecision({
    flip, brrrr, strategyRec,
    // UX V2.9, matrix C/D — name the input that is ACTUALLY missing
    // instead of the generic "ARV/Renovation Cost" pair, so a lead missing
    // only a rehab estimate is not told to go run comps. Same readiness
    // shape, same NEEDS_RESEARCH state, same source fields — wording only.
    readiness: !flip.available ? { flipReady: false, missing: [
      lead.arv == null
        ? { label: 'ARV', reason: 'Run comps or enter an ARV so we can work out what price works for us.' }
        : { label: 'Renovation Estimate', reason: 'Add a renovation estimate so we can work out what price works for us.' },
    ] } : null,
    fit: d.fit, decisionV2Recommendation: isOverridden ? 'PASS' : d.recommendation,
    lead, marketType, sellerAskingPrice,
  })
  const whyReasons = decision ? buildWhyReasons({ decision, flip, brrrr, decisionV2Confidence: d.confidence?.score }) : []

  const DECISION_TONE = { success: 'var(--color-success-text)', caution: 'var(--color-warn-text)', info: 'var(--color-text-dim)', danger: 'var(--color-danger-text)' }
  const DECISION_BORDER = { success: 'var(--color-success)', caution: 'var(--color-warn)', info: 'var(--color-line)', danger: 'var(--color-danger)' }

  return (
    <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] overflow-hidden">
      <div className="px-4 py-3.5 border-l-[3px]" style={{ borderLeftColor: isPreliminary ? 'var(--color-warn)' : (decision ? DECISION_BORDER[decision.tone] : theme.border) }}>
        {/* LEVEL 1 — ACQUISITION DECISION (plain language, not an internal term) */}
        {isPreliminary ? (
          <>
            <div className="text-[20px] font-extrabold text-[color:var(--color-warn-text)]">Preliminary Review</div>
            <div className="text-[12.5px] text-[color:var(--color-text-muted)] mt-0.5">Not enough information to evaluate the deal yet.</div>
          </>
        ) : decision ? (
          <>
            <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold">Acquisition Decision</div>
            <div className="text-[20px] font-extrabold mt-0.5" style={{ color: DECISION_TONE[decision.tone] }}>{decision.headline}</div>
            <p className="text-[12.5px] text-[color:var(--color-text)] mt-1 leading-snug">{decision.explanation}</p>
          </>
        ) : (
          <div className="text-[20px] font-extrabold" style={{ color: theme.text }}>
            {isOverridden ? 'Pass — Human Override' : d.recommendation.replace(/_/g, ' ')}
          </div>
        )}

        {/* LEVEL 2 — PRICE POSITION. Part 4/6 — a real price comparison
            (asking/seller price vs target vs gap) only when there is a
            genuine price to compare against. READY_TO_PURSUE (off-market,
            no seller price recorded) never shows a fabricated price row —
            only HAT's ceiling, explicitly captioned as not an offer. */}
        {decision?.currentPrice != null && decision.targetPrice != null && (
          <div className={`mt-2 grid gap-3 ${decision.actualOffer != null ? 'grid-cols-4' : 'grid-cols-3'}`}>
            <Metric label={decision.currentPriceLabel || (decision.priceIsEvaluation ? 'Evaluation Price' : 'Asking Price')} value={fc(decision.currentPrice)} />
            {/* Part 2C/7 — "Our Offer" only ever from resolveActualOffer's
                trustworthy sources (lead.offer_price, or a recorded
                FORMAL_OFFER) — never a calculated/suggested anchor. */}
            {decision.actualOffer != null && <Metric label="Our Offer" value={fc(Math.round(decision.actualOffer))} />}
            <Metric label={decision.targetLabel} value={fc(Math.round(decision.targetPrice))} tone="var(--color-accent-text)" />
            <Metric
              label={decision.gapLabel}
              value={decision.withinBuyRange ? `${fc(decision.gap)} below` : `~${fc(decision.gap)}`}
              tone={decision.withinBuyRange ? 'var(--color-success-text)' : 'var(--color-warn-text)'}
            />
          </div>
        )}
        {/* UX V2.9, Part 3/6 — OFF-MARKET, NO SELLER PRICE YET. The whole
            point of this state: a missing seller price is not a failed
            deal. Plain English only, and every number is a canonical Max
            Buy the engine computed without needing a price. No fabricated
            evaluation price, no gap, no "below target". */}
        {decision?.priceUnknown && decision.whatWorks && (
          <div className="mt-2.5">
            <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold">What Works For Us</div>
            <div className="mt-1 space-y-0.5">
              {decision.whatWorks.map(w => (
                <div key={w.strategy} className="text-[12.5px]">
                  <span className={`font-extrabold ${w.strategy === decision.targetStrategy ? 'text-[color:var(--color-text)]' : 'text-[color:var(--color-text-muted)]'}`}>{w.strategy}</span>
                  <span className="text-[color:var(--color-text-muted)]"> · {w.line}</span>
                </div>
              ))}
            </div>
            <div className="mt-2">
              <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Best Option</span>{' '}
              <span className="text-[13px] font-extrabold text-[color:var(--color-text)]">{decision.targetStrategy}</span>
            </div>
          </div>
        )}
        {decision?.state === 'READY_TO_PURSUE' && !decision.priceUnknown && decision.targetPrice != null && (
          <div className="mt-2">
            <div className={`grid gap-3 ${decision.actualOffer != null ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <Metric label={`${decision.targetLabel} — Do Not Exceed`} value={fc(Math.round(decision.targetPrice))} tone="var(--color-accent-text)" />
              {decision.actualOffer != null && <Metric label="Our Offer" value={fc(Math.round(decision.actualOffer))} />}
            </div>
            <p className="text-[10.5px] text-[color:var(--color-text-dim)] mt-1 leading-snug">
              The highest purchase price supported by HAT's current underwriting assumptions. This is not necessarily the opening offer.
            </p>
            {/* Part 6 — evaluation price may still exist, visually
                subordinate, never compared against Max Buy as if it were
                the seller's price. */}
            {decision.evaluationPrice != null && (
              <p className="text-[10.5px] text-[color:var(--color-text-dim)] mt-1 leading-snug">
                <span className="font-semibold text-[color:var(--color-text-muted)]">Evaluation Price:</span> {fc(decision.evaluationPrice)} — internal price used to evaluate deal economics.
              </p>
            )}
          </div>
        )}

        {/* LEVEL 3 — RECOMMENDED STRATEGY: ONE primary, one small optional
            alternative line (UX V2.4, Part 5 — replaces the previous
            equally-weighted 2-column comparison box, which visually
            competed with the primary recommendation). Never invents a
            preference — targetStrategy comes straight from
            deriveAcquisitionDecision's existing strategyRec-driven pick. */}
        {/* V2.9 — suppressed when the price is unknown: "Best Option" just
            above already answers this, and two labels for one fact is
            exactly the duplication V2.4–V2.8 removed. */}
        {decision?.targetStrategy && !decision.priceUnknown && (
          <div className="mt-2">
            <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Recommended Strategy</span>{' '}
            <span className="text-[13px] font-extrabold text-[color:var(--color-text)]">{decision.targetStrategy}</span>
          </div>
        )}
        {decision?.strategyLine?.headline === 'BOTH STRATEGIES WORK' && flip.available && brrrr.available && (
          <div className="text-[11px] text-[color:var(--color-text-dim)] mt-0.5">
            Both strategies are viable — Alternative: {decision.targetStrategy === 'BRRRR' ? 'FLIP' : 'BRRRR'} · Max Buy{' '}
            {fc(Math.round(decision.targetStrategy === 'BRRRR' ? flip.mao : brrrr.mao))}
          </div>
        )}

        {/* LEVEL 3 — Next Action, one clear actionable line */}
        {decision?.nextAction && (
          <div className="mt-2">
            <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Next Action</span>{' '}
            <span className="text-[12px] font-semibold text-[color:var(--color-text)]">
              {actionReason?.reason && /agent|owner/i.test(decision.nextAction) ? composeNextActionText(decision.nextAction, decision) : decision.nextAction}
            </span>
          </div>
        )}

        {/* LEVEL 4 — PRIORITY, now a single very small secondary line (UX
            V2.5, Part 5: "Review Today · High confidence") instead of its
            own labeled section with a subtext paragraph — the full
            deterministic explanation (getActionReason) and confidence
            reasons move into the "Show Details" disclosure below, not
            deleted. Still reads the exact same decision_v2.recommendation/
            confidence.score the rest of the app uses; the "≥70 = well
            verified" framing reuses the SAME threshold buildWhyReasons
            below already applies — no new threshold introduced. */}
        {!isPreliminary && (
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Priority</span>
            <span className="text-[11px] font-semibold" style={{ color: theme.text }}>
              {isOverridden ? 'Human Override' : d.recommendation.replace(/_/g, ' ')}
            </span>
            <InfoTooltip title="Priority" definition="When this lead needs attention — a workflow signal, not a verdict on deal quality." reasons={actionReason?.reason ? [actionReason.reason] : undefined} />
            {d.confidence?.score != null && (
              <span className="text-[11px] text-[color:var(--color-text-dim)]">· {d.confidence.score >= 70 ? 'High confidence' : 'Preliminary confidence'}</span>
            )}
            <button
              type="button"
              onClick={() => setShowDetails(v => !v)}
              className="text-[10.5px] font-semibold uppercase tracking-wide text-[color:var(--color-accent-text)] hover:underline ml-auto"
            >
              {showDetails ? 'Hide Details' : 'Show Details'}
            </button>
          </div>
        )}

        {/* UX V2.5, Part 5 — everything below (full priority reasoning,
            "Why HAT Says This", the long Margin of Safety paragraph,
            Opportunity/Data Confidence/Urgency) is real, existing,
            unchanged data — just moved behind "Show Details" so the
            default hero reads as a decision surface, not an underwriting
            report. NO DATA REMOVED. */}
        {showDetails && (
          <>
            {!isPreliminary && (
              <div className="mt-2">
                <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Priority reason</span>
                <p className="text-[11px] text-[color:var(--color-text-dim)] mt-0.5">
                  {isOverridden ? (d.human_override?.reason || 'Passed by human override.') : (PRIORITY_SUBTEXT[d.recommendation] || actionReason?.reason || '')}
                </p>
              </div>
            )}

            {/* WHY HAT SAYS THIS, max 3 deterministic reasons */}
            {whyReasons.length > 0 && (
              <div className="mt-2">
                <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold">Why HAT Says This</span>
                <ul className="mt-0.5 space-y-0.5">
                  {whyReasons.map((r, i) => (
                    <li key={i} className="text-[11.5px] text-[color:var(--color-text-muted)] leading-snug">• {r}</li>
                  ))}
                </ul>
              </div>
            )}

            {flip.marginOfSafety?.why && decision?.targetStrategy !== 'BRRRR' && (
              <div className="mt-2">
                <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Margin of Safety detail</span>
                <p className="text-[11.5px] text-[color:var(--color-text-muted)] mt-0.5 leading-snug">{flip.marginOfSafety.why}</p>
              </div>
            )}

            <div className="mt-2 flex items-center gap-4 flex-wrap">
              <span className="text-[11px] text-[color:var(--color-text-dim)] inline-flex items-center">
                Opportunity <b className="text-[color:var(--color-text)] ml-1">{d.opportunity?.score ?? '—'}</b>
                <InfoTooltip
                  title="Opportunity"
                  definition="How attractive this lead currently looks as an acquisition opportunity."
                  thisLead={d.opportunity?.score}
                  reasons={d.opportunity?.reasons}
                  note="Different from Off-Market Priority Score: Priority ranks sourced leads for review; Opportunity evaluates the acquisition opportunity. Two real, separate scores — not a contradiction."
                />
              </span>
              <span className="text-[11px] text-[color:var(--color-text-dim)] inline-flex items-center">
                Data Confidence <b className="text-[color:var(--color-text)] ml-1">{d.confidence?.score ?? '—'}</b>
                <InfoTooltip
                  title="Data Confidence"
                  definition="How complete and reliable the information behind this decision is — NOT whether this is a good deal, and not the same as the ARV Confidence badge (which grades comp evidence)."
                  thisLead={d.confidence?.score}
                  reasons={d.confidence?.reasons}
                  missing={d.confidence?.missing}
                />
              </span>
              <span className="text-[11px] text-[color:var(--color-text-dim)] inline-flex items-center">
                Urgency <b className="text-[color:var(--color-text)] ml-1">{d.urgency?.level ?? '—'}</b>
                <InfoTooltip
                  title="Urgency"
                  definition="How time-sensitive this lead currently appears, based on filing/listing timing signals — tells the team how quickly to act, not how good the deal is."
                  thisLead={d.urgency?.level}
                  reasons={d.urgency?.reasons}
                />
              </span>
              {maturity && (
                <span className="text-[10px] font-bold uppercase tracking-wide ml-auto" style={{ color: isPreliminary ? 'var(--color-warn-text)' : 'var(--color-success-text)' }}>
                  {isPreliminary
                    ? `Preliminary — Missing: ${(d.confidence?.missing || []).slice(0, 2).join(' · ') || 'more data'}`
                    : `Refined${prov.comps_available ? ` · ${prov.comps_count} comp${prov.comps_count === 1 ? '' : 's'}` : ''} · Data Confidence ${d.confidence.score}`}
                </span>
              )}
            </div>
          </>
        )}

        {/* LEVEL 5 — DEAL SAFETY detail. UX V2.1, Part 5/10 — when Flip is
            the PRIMARY/preferred strategy, this still shows its own
            internal verdict tier exactly as before (unchanged verdict
            logic/labels). But when a DIFFERENT strategy is primary (e.g.
            BRRRR, Norfolk's case), Flip's raw verdict — which can be the
            literal word "NO DEAL" — must never appear to compete with
            the primary recommendation above. In that case this block
            shows the factual, strategy-specific secondaryStrategy detail
            instead (built in acquisitionDecisionPresentation.js from the
            SAME flip.verdict/flip.mao facts, just worded honestly). */}
        {/* UX V2.4, Part 6/7 — "MAIN RISK", the ONE most relevant
            existing factual concern, in plain language. Reuses the
            SAME verdict tier / marginOfSafety text as before (verdict
            logic completely unchanged) — only the label moves away from
            raw WATCH/SOLID/STRONG words. THIN/HEALTHY only render when
            the existing verdict tier genuinely supports that framing
            (see MARGIN_OF_SAFETY above); otherwise falls back to the
            existing marginOfSafety.title text rather than inventing one.
            UX V2.5, Part 6 — the long "why" paragraph moved into the
            Show Details disclosure above; this line stays visible
            unconditionally (it's the ONE main risk the mission's Part 7
            requires in the primary card). */}
        {/* V2.9 — Margin of Safety is a question about a PRICE ("how much
            room does this price leave"). With no price, flip.verdict is the
            vacuous 'NO DEAL' (see acquisitionDecisionPresentation.js's V2.9
            note), which would render here as a red failure signal for a
            deal that has not failed. Suppressed rather than reinterpreted. */}
        {flip.available && !decision?.priceUnknown && decision?.targetStrategy !== 'BRRRR' && (
          <div className="mt-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Margin of Safety</span>
              <span className="text-[12px] font-bold" style={{ color: DEAL_SAFETY_TONE[flip.verdict] }}>
                {MARGIN_OF_SAFETY[flip.verdict] || flip.marginOfSafety?.title || VERDICT_DISPLAY_LABEL[flip.verdict]}
              </span>
            </div>
          </div>
        )}
        {decision?.targetStrategy === 'BRRRR' && decision.secondaryStrategy && (
          <div className="mt-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Alternative Strategy — Flip (detail)</span>
            </div>
            <p className="text-[11.5px] text-[color:var(--color-text-muted)] mt-0.5 leading-snug">{decision.secondaryStrategy.detail}</p>
          </div>
        )}
      </div>

      {/* UX V2.4, Part 9 — collapsed to ONE compact line per strategy
          instead of 3 large, separately-labeled Metric blocks that
          repeated Max Buy/profit numbers already shown in the price
          position row above. Full economics remain one click away on
          the Deal tab (unchanged, not deleted). */}
      {/* V2.9 — this strip states "profit @ current price"; with no price
          both figures are null and it would read "$— projected profit".
          Hidden entirely in that state (What Works For Us above already
          carries the useful number). */}
      {flip.available && !decision?.priceUnknown && (
        <div className="px-4 py-2 border-t border-[color:var(--color-line)] text-[11.5px] text-[color:var(--color-text-muted)]">
          <span className="font-bold text-[color:var(--color-text)]">FLIP</span>{' '}
          {fc(flip.projectedProfit)} projected profit @ {decision?.priceIsEvaluation ? 'evaluation' : 'current'} price
          {brrrr.available && brrrr.monthlyCashFlow != null && (
            <> · <span className="font-bold text-[color:var(--color-text)]">BRRRR</span> {brrrr.monthlyCashFlow >= 0 ? '+' : ''}{fc(brrrr.monthlyCashFlow)}/mo cash flow</>
          )}
        </div>
      )}
      {/* UX V2.5, Part 5 — the always-visible Opportunity/Data Confidence/
          Urgency row was moved into the "Show Details" disclosure above
          (still the exact same values/tooltips/reasons, nothing removed —
          see the showDetails block earlier in this file) so it no longer
          competes with the primary decision by default. */}
      {isPreliminary && maturity && (
        <div className="px-4 py-2 border-t border-[color:var(--color-line)] text-[10px] font-bold uppercase tracking-wide text-[color:var(--color-warn-text)]">
          Preliminary — Missing: {(d.confidence?.missing || []).slice(0, 2).join(' · ') || 'more data'}
        </div>
      )}

      {isOverridden && d.human_override?.reason && (
        <div className="px-4 pb-2.5 text-[11.5px] text-[color:var(--color-text-dim)]">⚠ {d.human_override.reason}</div>
      )}
    </div>
  )
}
