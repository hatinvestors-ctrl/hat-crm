// src/lib/acquisitionDecisionPresentation.js
// Lead Workspace UX V2 — Acquisition Decision presentation layer.
//
// PURE PRESENTATION ONLY. Every value this module reads comes from
// computeFlipResult/computeBrrrrResult/computeStrategyRecommendation
// (src/lib/dealExplanation.js), getDealReadiness (readiness.js), the
// lead's own fit/decision_v2 fields, or plain lead columns — nothing
// here recomputes a formula, invents a threshold, or introduces a new
// business rule. This file only TRANSLATES those already-computed facts
// into plain acquisition language.
//
// The mapping (documented per the mission's explicit "document the
// exact mapping" requirement):
//
//   readiness.flipReady === false
//     → NEEDS_RESEARCH (missing input named from readiness.missing)
//
//   fit.status === 'NOT_FIT'  OR  decisionV2Recommendation === 'PASS'
//     → PASS (existing buy-box/recommendation logic already said so —
//       never a new "price too high" PASS)
//
//   current/evaluation price <= the strategy-appropriate Max Buy
//     → GOOD_AT_ASKING (works at the current price, however thin the
//       margin — the underlying verdict, STRONG/PASS("SOLID")/WATCH, is
//       UNCHANGED and still shown in the detail view; this state only
//       answers "does it work right now", not "how comfortably")
//
//   current/evaluation price > Max Buy, but Max Buy exists (a strategy
//   is still viable at a lower price)
//     → NEGOTIATE
//
// No other state is produced. If none of the above can be determined
// (e.g. no strategy available at all despite readiness being met — the
// existing computeStrategyRecommendation 'NONE' case) this module
// returns PASS with the existing "neither strategy meets HAT's targets"
// reason, since that is what the existing engine already concluded.
//
// ── UX V2.2 addendum — market-aware price semantics ──────────────────────
// Part 1 audit finding: `lead.asking_price` is ONE generic column reused
// for two different real-world concepts:
//   - on-market (MLS) leads: a genuine listing price.
//   - off-market/distressed leads: a user-entered EVALUATION price (a
//     hypothetical price the team wants to test economics at) — NOT
//     confirmed to be anything the seller actually said. This was
//     already implicitly acknowledged elsewhere in the codebase (e.g.
//     DealDecisionCenter.jsx's "Evaluating at" vs "Seller asks" label
//     swap keyed on isDistressedLead()) but never enforced in the
//     Acquisition Decision presentation itself until now.
// The ONE genuinely trustworthy off-market seller-price field found in
// this audit is `getSellerIntelligence(lead).seller_asking_price`
// (src/lib/sellerStrategy.js) — populated only from an actual recorded
// call where the seller stated a number. This module never repurposes
// `lead.asking_price`, `flip.currentOffer`, or any MAO/suggested-offer
// value and pretends it is a seller price.
//
//   marketType === 'OFF_MARKET' AND a genuine seller_asking_price exists
//     → same WITHIN_BUY_RANGE/NEGOTIATE logic as on-market, but the
//       price is labeled "Seller Price", never "Asking Price".
//
//   marketType === 'OFF_MARKET' AND no seller_asking_price AND readiness
//   met AND a strategy is viable
//     → READY_TO_PURSUE (new state — see STATE_META). Shows HAT Max Buy
//       only, explicitly captioned "not necessarily the opening offer."
//       No asking price, no gap, no "within/above buy range" language.
//
//   marketType === 'OFF_MARKET' AND readiness not met
//     → NEEDS_RESEARCH, headline reworded "RESEARCH BEFORE OFFERING"
//       (same state/condition as the on-market case, presentation text
//       only).

import { resolveEffectiveStrategy } from './dealExplanation'

// UX V2.6, Part 3/10 — the ONE canonical strategy-comparison builder.
// Both DecisionHero (Overview) and DealDecisionCenter (Deal tab) call
// this instead of independently deciding per-strategy status/labels, so
// "does Flip work" / "does BRRRR work" can never disagree between the two
// screens. Status is derived ONLY from the existing verdict tiers
// (verdict === 'NO DEAL' → BELOW TARGET, else → WORKS; unavailable →
// UNAVAILABLE) — no new thresholds, no re-ranking. Replaces the need for
// a separate "Best Fit" conclusion line (V2.6, Part 10): the explanation
// sentence here IS that one sentence.
// ── UX V2.9 — off-market "no seller price yet" ───────────────────────────
// ROOT CAUSE this section fixes (audited, reproduced on 2596 Beachview Dr —
// ARV $300K / rehab $80K / rent $2K / no seller price):
// computeFlipResult/computeBrrrrResult initialise `verdict` to 'NO DEAL'
// and only upgrade it once a profit / cash-flow number exists. Those come
// from `evaluationPrice` (actualOffer ?? asking_price), which is null when
// nobody has stated a price — so BOTH strategies came back verdict
// 'NO DEAL' *despite* both Max Buys computing perfectly ($147,669.78 and
// $133,593.28). Everything downstream then read that as failure:
// statusForResult → 'BELOW TARGET', computeStrategyRecommendation → 'NONE',
// and deriveAcquisitionDecision's 'NONE' branch fired BEFORE the
// off-market READY_TO_PURSUE branch could ever be reached.
//
// The engine is not wrong — "NO DEAL at a price that does not exist" is
// vacuously true. The PRESENTATION was wrong: it translated "we have no
// price" into "the deal fails". So the fix lives entirely here. No
// verdict, formula, threshold or ranking rule is changed; the presentation
// simply stops consuming a price-derived verdict when there is no price.
//
// hasEvaluablePrice is the ONE place that question is answered, so no
// component can decide it differently.
export function hasEvaluablePrice({ flip = null, lead = null, sellerAskingPrice = null } = {}) {
  if (sellerAskingPrice != null) return true
  if (flip?.available && flip.evaluationPrice != null) return true
  return lead?.offer_price != null || lead?.asking_price != null
}

// The plain-English line each strategy shows when there is no price yet:
// "Buy at $147,700 or less". Rounded with the SAME $100 rounding the Max
// Buy headline everywhere else uses.
function buyAtOrBelowLine(mao) {
  return mao != null ? `Buy at ${fullCurrency(Math.round(mao / 100) * 100)} or less` : null
}

function fullCurrency(n) {
  return `$${Math.round(n).toLocaleString('en-US')}`
}

// UX V2.9, Part 3 — "BEST OPTION" without a seller price.
// computeStrategyRecommendation cannot answer this: it ranks by verdict,
// and with no price every verdict is the vacuous 'NO DEAL' above. This is
// therefore an explicitly-documented PRESENTATION rule, not a new
// financial rule: among the strategies whose canonical Max Buy actually
// computed, prefer the one that supports the HIGHER purchase price,
// because that is the one that gives HAT the most room to reach a deal
// with the seller. It compares two already-computed canonical Max Buys and
// nothing else — no new formula, no new threshold, no verdict override.
// Once a real price exists this function is not used at all; the canonical
// verdict-based recommendation takes over again.
export function resolveNoPriceStrategyPreference({ flip, brrrr }) {
  const flipMao = flip?.available && flip.mao != null ? flip.mao : null
  const brrrrMao = brrrr?.available && brrrr.mao != null ? brrrr.mao : null
  if (flipMao == null && brrrrMao == null) return { strategy: null, targetPrice: null, reason: null }
  if (brrrrMao == null) return { strategy: 'FLIP', targetPrice: flipMao, reason: 'Only Flip can be calculated with the information on file.' }
  if (flipMao == null) return { strategy: 'BRRRR', targetPrice: brrrrMao, reason: 'Only BRRRR can be calculated with the information on file.' }
  return flipMao >= brrrrMao
    ? { strategy: 'FLIP', targetPrice: flipMao, reason: 'Flip supports the higher purchase price.' }
    : { strategy: 'BRRRR', targetPrice: brrrrMao, reason: 'BRRRR supports the higher purchase price.' }
}

// UX V2.9 — why a strategy has no number, in plain language, taken from
// the engine's OWN missingField (computeBrrrrResult) rather than guessed.
function needsInputLine(result) {
  if (result?.missingField) return `Need ${result.missingField} to calculate`
  return 'Need more information'
}

// `hasPrice` defaults to true, so every pre-V2.9 call site keeps its exact
// previous behaviour.
export function statusForResult(result, { hasPrice = true } = {}) {
  if (!result?.available) return 'UNAVAILABLE'
  // Part 5's hard rule — never "BELOW TARGET" merely because no price
  // exists to be below a target at.
  if (!hasPrice) return result.mao != null ? 'MAX_BUY_ONLY' : 'NEEDS_INPUT'
  return result.verdict === 'NO DEAL' ? 'BELOW TARGET' : 'WORKS'
}

export function buildStrategyComparison({ flip, brrrr, strategyRec, hasPrice = true }) {
  // Part 5/7 — the no-seller-price shape. Same object contract plus a
  // `line` per strategy and `priceUnknown: true`, so the Deal tab can show
  // "Buy at $X or less" instead of a status word that would be untrue.
  if (!hasPrice) {
    const pref = resolveNoPriceStrategyPreference({ flip, brrrr })
    const side = (result) => {
      const status = statusForResult(result, { hasPrice: false })
      const maxBuy = result?.available && result.mao != null ? result.mao : null
      return { status, maxBuy, line: status === 'MAX_BUY_ONLY' ? buyAtOrBelowLine(maxBuy) : needsInputLine(result) }
    }
    return {
      recommended: pref.strategy,
      priceUnknown: true,
      flip: side(flip),
      brrrr: side(brrrr),
      explanation: pref.strategy
        ? `Seller has not given us a price yet. Based on the property numbers, ${pref.strategy === 'BRRRR' ? 'BRRRR' : 'Flip'} supports a purchase price up to ${fullCurrency(Math.round(pref.targetPrice / 100) * 100)}.`
        : 'Seller has not given us a price yet, and there is not enough property information to calculate what price works.',
    }
  }

  const effective = resolveEffectiveStrategy(strategyRec)
  const flipStatus = statusForResult(flip)
  const brrrrStatus = statusForResult(brrrr)

  let explanation
  if (effective === 'NONE' || (flipStatus !== 'WORKS' && brrrrStatus !== 'WORKS')) {
    explanation = 'Neither strategy currently meets HAT\'s requirements at this price.'
  } else if (flipStatus === 'WORKS' && brrrrStatus === 'WORKS') {
    explanation = `${effective} meets HAT's requirements at the current price. ${effective === 'BRRRR' ? 'Flip' : 'BRRRR'} also works.`
  } else if (effective === 'BRRRR') {
    explanation = flipStatus === 'BELOW TARGET' && flip?.available && flip.mao != null
      ? `BRRRR meets HAT's requirements at the current evaluation price. Flip would require a purchase price of approximately ${formatShort(Math.round(flip.mao))} or below to meet the ${flip.targetProfit != null ? formatShort(flip.targetProfit) : 'target'} minimum profit target.`
      : 'BRRRR meets HAT\'s requirements at the current price. Flip could not be evaluated.'
  } else if (effective === 'FLIP') {
    explanation = brrrrStatus === 'BELOW TARGET' && brrrr?.available && brrrr.mao != null
      ? `Flip meets HAT's requirements at the current price. BRRRR would require a purchase price of approximately ${formatShort(Math.round(brrrr.mao))} or below to meet HAT's requirements.`
      : 'Flip meets HAT\'s requirements at the current price. BRRRR could not be evaluated.'
  } else {
    explanation = 'Neither strategy currently meets HAT\'s requirements at this price.'
  }

  return {
    recommended: effective === 'NONE' ? null : effective,
    priceUnknown: false,
    flip: { status: flipStatus, maxBuy: flip?.available ? flip.mao : null, line: null },
    brrrr: { status: brrrrStatus, maxBuy: brrrr?.available ? brrrr.mao : null, line: null },
    explanation,
  }
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))

// Off-market Max Buy is labeled "... / Walk-Away" (V2.2's wording for the
// discovery/negotiation stage); on-market keeps the plain "[Strategy] Max
// Buy". Lifted to module scope in V2.9 so the new no-seller-price branch
// and the existing branches below share ONE label rule.
function targetLabelForStrategy(strategy, isOffMarket) {
  const base = strategy === 'BRRRR' ? 'BRRRR Max Buy' : 'Flip Max Buy'
  return isOffMarket ? `${base} / Walk-Away` : base
}

// ── UX V2.3 addendum — offer vs. Max Buy separation ──────────────────────
// Part 1 audit findings (traced, not assumed):
//   - `lead.offer_price` — dealExplanation.js's own D2 field-provenance
//     audit already confirmed this is the ACTUAL/SUBMITTED offer HAT
//     made (set by LeadForm's "Offer Price" field or LogOutcomeModal
//     when an outcome records an offer having been made) — genuinely
//     trustworthy, works for both market types (it's a plain lead
//     column, not on-market-specific).
//   - `lead.starting_offer` / `flip.currentOffer` — a SYSTEM-GENERATED
//     negotiation-anchor RECOMMENDATION (AI-suggested or manually
//     overridden, always clamped to Max Buy), never a real offer. Never
//     used here as "Our Offer".
//   - `getSellerIntelligence(lead).hat_offer_mentioned` — a number a rep
//     floated during a call; its own `hat_offer_type` field
//     distinguishes RANGE_MENTIONED / PROBE / FORMAL_OFFER. Only
//     FORMAL_OFFER genuinely means "an offer HAT communicated" — the
//     other two types are explicitly NOT an offer and must never be
//     labeled "Our Offer".
// resolveActualOffer() is the ONE place this decision is made — no UI
// component may independently decide what counts as a real offer.
export function resolveActualOffer(lead) {
  if (lead?.offer_price != null) return { amount: num(lead.offer_price), source: 'offer_price' }
  const si = lead?.distress_data?.seller_intelligence
  if (si?.hat_offer_type === 'FORMAL_OFFER' && si.hat_offer_mentioned != null) {
    return { amount: num(si.hat_offer_mentioned), source: 'hat_offer_mentioned (FORMAL_OFFER)' }
  }
  return { amount: null, source: null }
}

// UX V2.1, Part 3 — presentation-text-only rename. The internal state
// enum value stays GOOD_AT_ASKING (no compatibility risk for any
// existing caller keying off `.state`); only the user-facing label
// changes, because "GOOD" implied a deal-quality judgment this state
// never actually made — it only knows current/evaluation price <=
// target Max Buy, not how thin the margin is. "WITHIN BUY RANGE" says
// exactly, and only, the fact this state is built from.
const STATE_META = {
  GOOD_AT_ASKING: { label: 'WITHIN BUY RANGE', tone: 'success' },
  NEGOTIATE:      { label: 'NEGOTIATE',        tone: 'caution' },
  NEEDS_RESEARCH: { label: 'NEEDS RESEARCH',   tone: 'info' },
  PASS:           { label: 'PASS',             tone: 'danger' },
  // UX V2.2, Part 4 — a genuinely new state, not a relabel of an existing
  // one: off-market leads usually have no seller/asking price at all
  // (see this file's header note on lead.asking_price's overloaded
  // meaning). "Does it work at asking price" is meaningless with no
  // asking price. READY_TO_PURSUE answers a different, legitimate
  // question — "is there enough financial data to know what HAT can
  // safely pay" — without ever fabricating a price comparison.
  // UX V2.4, Part 3 — presentation-text-only rename (state enum
  // unchanged, same precedent as GOOD_AT_ASKING → "WITHIN BUY RANGE" in
  // V2.1): "READY TO PURSUE" is vague — it doesn't tell the user WHAT to
  // do. "CONTACT SELLER" is the actual, immediate, concrete action this
  // state's own nextAction has always resolved to.
  READY_TO_PURSUE: { label: 'CONTACT SELLER', tone: 'success' },
}

// Part 5/17 — the strategy-appropriate Max Buy. Never picks arbitrarily
// between Flip/BRRRR Max Buy: uses the SAME preferredStrategy
// computeStrategyRecommendation already decided.
function resolveTargetPrice({ flip, brrrr, preferBrrrr }) {
  if (preferBrrrr && brrrr.available && brrrr.mao != null) return { targetPrice: brrrr.mao, targetStrategy: 'BRRRR' }
  if (flip.available && flip.mao != null) return { targetPrice: flip.mao, targetStrategy: 'FLIP' }
  return { targetPrice: null, targetStrategy: null }
}

/**
 * @param {object} params
 * @param {object} params.flip - computeFlipResult(lead, settings) output
 * @param {object} params.brrrr - computeBrrrrResult(lead, settings) output
 * @param {object} params.strategyRec - computeStrategyRecommendation(flip, brrrr) output
 * @param {object} [params.readiness] - getDealReadiness(lead) output
 * @param {object} [params.fit] - decision_v2.fit output ({ status: 'FIT'|'NOT_FIT'|'INSUFFICIENT_DATA' }), if available
 * @param {string} [params.decisionV2Recommendation] - decision_v2.recommendation, if available
 * @param {object} params.lead
 * @returns {object} { state, label, tone, headline, explanation, currentPrice, targetPrice, targetStrategy, targetLabel, gap, gapLabel, gapValue, withinBuyRange, priceIsEvaluation }
 */
export function deriveAcquisitionDecision({ flip, brrrr, strategyRec, readiness = null, fit = null, decisionV2Recommendation = null, lead, marketType = null, sellerAskingPrice = null }) {
  const isOffMarket = marketType === 'OFF_MARKET'
  // Part 2C/7 — resolved once, spliced into every branch below so "Our
  // Offer" can never disagree with itself depending on which state fires.
  const actualOfferInfo = resolveActualOffer(lead)
  const actualOffer = actualOfferInfo.amount

  // 1. Missing required inputs — existing readiness logic, never invented.
  if (readiness && readiness.flipReady === false) {
    // readiness.missing entries are {key, label, reason} objects
    // (getDealReadiness, readiness.js) — reuse the label/reason it
    // already wrote, never re-derive our own missing-field wording.
    const firstMissing = readiness.missing?.[0]
    const label = firstMissing?.label || 'Required inputs'
    return {
      state: 'NEEDS_RESEARCH', ...STATE_META.NEEDS_RESEARCH,
      // Part 7 — off-market framing: "we found a seller, but don't have
      // enough property data yet" rather than the generic on-market
      // "needs research" wording.
      headline: isOffMarket ? 'RESEARCH BEFORE OFFERING' : 'NEEDS RESEARCH',
      explanation: isOffMarket
        ? (firstMissing?.reason || `${label} needed before we can determine a safe purchase price.`)
        : (firstMissing?.reason || `${label} needed before we can tell you what to offer.`),
      currentPrice: null, targetPrice: null, targetStrategy: null, targetLabel: null,
      gap: null, gapLabel: null, gapValue: null, withinBuyRange: null, priceIsEvaluation: false,
      strategyLine: null, nextAction: `Verify ${label}`,
      actualOffer, actualOfferSource: actualOfferInfo.source,
    }
  }

  // 2. Existing buy-box / recommendation logic already says PASS — never
  // a new "price too high" PASS invented here.
  if (fit?.status === 'NOT_FIT') {
    return {
      state: 'PASS', ...STATE_META.PASS,
      headline: 'PASS — NOT A FIT',
      explanation: 'This property is outside HAT\'s current buy box.',
      currentPrice: null, targetPrice: null, targetStrategy: null, targetLabel: null,
      gap: null, gapLabel: null, gapValue: null, withinBuyRange: null, priceIsEvaluation: false,
      strategyLine: null, nextAction: 'Pass',
      actualOffer, actualOfferSource: actualOfferInfo.source,
    }
  }
  if (decisionV2Recommendation === 'PASS') {
    return {
      state: 'PASS', ...STATE_META.PASS,
      headline: 'PASS',
      explanation: 'HAT\'s current recommendation is to pass on this lead.',
      currentPrice: null, targetPrice: null, targetStrategy: null, targetLabel: null,
      gap: null, gapLabel: null, gapValue: null, withinBuyRange: null, priceIsEvaluation: false,
      strategyLine: null, nextAction: 'Pass',
      actualOffer, actualOfferSource: actualOfferInfo.source,
    }
  }

  // 2b. UX V2.9 — OFF-MARKET, NO SELLER PRICE YET.
  //
  // This branch MUST run before the 'NONE' check below. That ordering is
  // the bug: with no price every verdict is the vacuous 'NO DEAL' (see
  // this file's V2.9 header note), so strategyRec collapses to 'NONE' and
  // the old code returned PASS — "Neither Flip nor BRRRR meets HAT's
  // targets at the current price" — for a property that has no current
  // price at all and two perfectly good Max Buys. "Seller price unknown"
  // and "deal does not work" are different situations and must never
  // produce the same output.
  //
  // Nothing here fabricates a price: currentPrice/gap/withinBuyRange stay
  // null, and the only numbers shown are the canonical Max Buys the engine
  // already computed without needing a price.
  const noSellerPriceYet = isOffMarket && !hasEvaluablePrice({ flip, lead, sellerAskingPrice })
  if (noSellerPriceYet) {
    const pref = resolveNoPriceStrategyPreference({ flip, brrrr })
    if (pref.strategy == null) {
      // Matrix C/D — genuinely missing property inputs. Honest, never a
      // fabricated Max Buy and never a "deal fails" conclusion.
      const missingLabel = lead?.arv == null ? 'ARV' : lead?.renovation_cost == null ? 'a renovation estimate' : 'more property information'
      return {
        state: 'NEEDS_RESEARCH', ...STATE_META.NEEDS_RESEARCH,
        headline: 'NEEDS RESEARCH',
        explanation: `We need ${missingLabel} before we can work out what price works for us.`,
        currentPrice: null, targetPrice: null, targetStrategy: null, targetLabel: null,
        gap: null, gapLabel: null, gapValue: null, withinBuyRange: null, priceIsEvaluation: false,
        strategyLine: null, nextAction: `Add ${missingLabel}`,
        priceUnknown: true, noSellerPriceRecorded: true, whatWorks: null,
        actualOffer, actualOfferSource: actualOfferInfo.source,
      }
    }
    // Part 3 — "WHAT WORKS FOR US", one line per strategy, plain English.
    const sideFor = (name, result) => {
      const maxBuy = result?.available && result.mao != null ? result.mao : null
      return {
        strategy: name,
        maxBuy,
        line: maxBuy != null ? buyAtOrBelowLine(maxBuy) : needsInputLine(result),
        calculable: maxBuy != null,
      }
    }
    const whatWorks = [sideFor('FLIP', flip), sideFor('BRRRR', brrrr)]
    return {
      state: 'READY_TO_PURSUE', ...STATE_META.READY_TO_PURSUE,
      headline: STATE_META.READY_TO_PURSUE.label,
      explanation: 'Seller has not given us a price yet.',
      currentPrice: null, targetPrice: pref.targetPrice, targetStrategy: pref.strategy,
      targetLabel: targetLabelForStrategy(pref.strategy, true),
      gap: null, gapLabel: null, gapValue: null, withinBuyRange: null, priceIsEvaluation: false,
      strategyLine: null,
      secondaryStrategy: null,
      whatWorks,
      bestOptionReason: pref.reason,
      nextAction: 'Contact the seller and find out their asking price.',
      isOpeningOffer: false,
      noSellerPriceRecorded: true,
      priceUnknown: true,
      actualOffer, actualOfferSource: actualOfferInfo.source,
    }
  }

  const preferBrrrr = resolveEffectiveStrategy(strategyRec) === 'BRRRR' && brrrr?.available

  // 3. Neither strategy could be evaluated as viable at all (the existing
  // engine's own 'NONE' conclusion) — present as PASS, using its own reason.
  if (!strategyRec || strategyRec.preferredStrategy === 'NONE' || (!flip?.available && !brrrr?.available)) {
    return {
      state: 'PASS', ...STATE_META.PASS,
      headline: 'PASS',
      explanation: 'Neither Flip nor BRRRR meets HAT\'s targets at the current price.',
      currentPrice: null, targetPrice: null, targetStrategy: null, targetLabel: null,
      gap: null, gapLabel: null, gapValue: null, withinBuyRange: null, priceIsEvaluation: false,
      strategyLine: null, nextAction: 'Pass',
      actualOffer, actualOfferSource: actualOfferInfo.source,
    }
  }

  const { targetPrice, targetStrategy } = resolveTargetPrice({ flip, brrrr, preferBrrrr })

  // UX V2.2, Part 4 — off-market with no genuine seller price: skip the
  // asking-price comparison entirely (there is nothing real to compare
  // against) and answer the actually-legitimate question instead — is
  // there enough data to know HAT's safe purchase ceiling. Never treats
  // `lead.asking_price`/evaluationPrice as a stand-in seller price here.
  const genuineSellerPrice = isOffMarket && sellerAskingPrice != null ? num(sellerAskingPrice) : null
  // Part 2D — off-market Max Buy is labeled "... / Walk-Away" (this task's
  // explicit wording for the discovery/negotiation stage where there may
  // be no listing to anchor against); on-market keeps the plain
  // "[Strategy] Max Buy" label from V2.1/V2.2, unchanged.
  const targetLabelFor = (strategy) => targetLabelForStrategy(strategy, isOffMarket)
  if (isOffMarket && genuineSellerPrice == null && targetPrice != null) {
    const targetLabel = targetLabelFor(targetStrategy)
    // Part 6 — evaluation price (lead.asking_price for off-market) may
    // still be shown, visually subordinate, but is NEVER compared
    // against Max Buy as if it were the seller's price.
    const evaluationPrice = lead?.asking_price != null ? num(lead.asking_price) : null
    return {
      state: 'READY_TO_PURSUE', ...STATE_META.READY_TO_PURSUE,
      headline: STATE_META.READY_TO_PURSUE.label,
      explanation: 'No seller asking price is recorded yet. Contact the seller, understand motivation, and determine their price.',
      currentPrice: null, targetPrice, targetStrategy, targetLabel,
      evaluationPrice,
      // Explicitly null — Part 5's hard rule: a gap/reduction concept is
      // meaningless with no seller price, and Max Buy must never be
      // silently treated as a negotiation target.
      gap: null, gapLabel: null, gapValue: null, withinBuyRange: null, priceIsEvaluation: false,
      strategyLine: buildStrategyLine({ flip, brrrr, strategyRec, preferBrrrr }),
      secondaryStrategy: buildSecondaryStrategyDetail({ flip, brrrr, targetStrategy }),
      nextAction: 'Contact Seller',
      // Part 5/14 — explicit, testable confirmation this is a ceiling,
      // not a recommended opening offer. No opening-offer formula
      // exists; none is computed here.
      isOpeningOffer: false,
      noSellerPriceRecorded: true,
      actualOffer, actualOfferSource: actualOfferInfo.source,
    }
  }

  // Part 4's explicit rule: never show a financial outcome without the
  // exact price it refers to. `flip.evaluationPrice` (dealExplanation.js)
  // is THAT price — the one profit/verdict were actually computed
  // against (actualOffer ?? asking price). `flip.currentOffer` is a
  // DIFFERENT, MAO-anchored recommended-offer concept used elsewhere
  // (Margin of Safety) — using it here would silently substitute a
  // negotiated anchor for the real asking/evaluation price, exactly the
  // ambiguity this task exists to remove. Off-market WITH a genuine
  // seller price uses THAT number instead of asking_price/evaluationPrice.
  const currentPrice = genuineSellerPrice != null
    ? genuineSellerPrice
    : (flip?.available ? num(flip.evaluationPrice) : (lead?.asking_price != null ? num(lead.asking_price) : null))
  const priceIsEvaluation = genuineSellerPrice == null && flip?.available && flip.actualOffer != null && lead?.asking_price != null && num(flip.actualOffer) !== num(lead.asking_price)

  if (currentPrice == null || targetPrice == null) {
    // Can happen only when neither engine produced a usable currentPrice/
    // target despite being "available" — genuinely undetermined, not a
    // new state; falls back to NEEDS_RESEARCH rather than guessing.
    return {
      state: 'NEEDS_RESEARCH', ...STATE_META.NEEDS_RESEARCH,
      headline: 'NEEDS RESEARCH',
      explanation: 'Not enough information to compare the current price against HAT\'s target.',
      currentPrice, targetPrice, targetStrategy, targetLabel: null,
      gap: null, gapLabel: null, gapValue: null, withinBuyRange: null, priceIsEvaluation,
      strategyLine: null, nextAction: 'Verify pricing details',
      actualOffer, actualOfferSource: actualOfferInfo.source,
    }
  }

  const gapValue = currentPrice - targetPrice
  const withinBuyRange = gapValue <= 0

  const targetLabel = targetLabelFor(targetStrategy)
  const gap = Math.abs(Math.round(gapValue))
  const gapLabel = withinBuyRange ? 'WITHIN BUY RANGE' : (genuineSellerPrice != null ? 'NEEDED REDUCTION' : 'NEEDED PRICE REDUCTION')

  // Part 6 — a genuine off-market seller price is called "Seller Asking",
  // never "asking price" alone (that word implies an MLS listing).
  const priceLabel = genuineSellerPrice != null ? 'seller\'s asking price'
    : priceIsEvaluation ? 'evaluation price'
    : (isDistressedForLabel(lead) ? 'current price' : 'asking price')

  // What to call the price-context field on the price-position row. Part
  // 2A/6/14 — "Seller Asking" for a genuine off-market price, "Asking
  // Price" for on-market, "Evaluation Price" only when explicitly
  // derived from computeFlipResult's evaluation-price fallback.
  const currentPriceLabel = genuineSellerPrice != null ? 'Seller Asking' : priceIsEvaluation ? 'Evaluation Price' : 'Asking Price'

  // UX V2.9, Part 8 — when a GENUINE seller price exists the question
  // changes from "what works for us" to "does the seller's price work",
  // and the answer should be stated in the same plain language: the two
  // real numbers, side by side. Only the sentence changes; the state,
  // gap, target and every dollar value are the canonical ones already
  // computed above. Leads without a genuine seller price keep their
  // existing wording verbatim.
  const buyAtOrBelow = `${targetStrategy === 'BRRRR' ? 'a BRRRR' : 'a Flip'}, we need to buy at ${fullCurrency(Math.round(targetPrice / 100) * 100)} or less`

  if (withinBuyRange) {
    return {
      state: 'GOOD_AT_ASKING', ...STATE_META.GOOD_AT_ASKING,
      headline: STATE_META.GOOD_AT_ASKING.label,
      explanation: genuineSellerPrice != null
        ? `Seller wants ${fullCurrency(genuineSellerPrice)}. For ${buyAtOrBelow} — ${fullCurrency(gap)} inside our buy range.`
        : `The ${priceLabel} already meets HAT's ${targetStrategy} target.`,
      currentPrice, currentPriceLabel, targetPrice, targetStrategy, targetLabel,
      gap, gapLabel, gapValue, withinBuyRange, priceIsEvaluation,
      strategyLine: buildStrategyLine({ flip, brrrr, strategyRec, preferBrrrr }),
      secondaryStrategy: buildSecondaryStrategyDetail({ flip, brrrr, targetStrategy }),
      nextAction: 'Make Offer',
      isOpeningOffer: false,
      actualOffer, actualOfferSource: actualOfferInfo.source,
    }
  }

  return {
    state: 'NEGOTIATE', ...STATE_META.NEGOTIATE,
    headline: 'NEGOTIATE — WORTH PURSUING',
    explanation: genuineSellerPrice != null
      ? `Seller wants ${fullCurrency(genuineSellerPrice)}. For ${buyAtOrBelow}.`
      : `The ${priceLabel} is above what HAT can support. Try to negotiate about ${formatShort(gap)} lower.`,
    currentPrice, currentPriceLabel, targetPrice, targetStrategy, targetLabel,
    gap, gapLabel, gapValue, withinBuyRange, priceIsEvaluation,
    strategyLine: buildStrategyLine({ flip, brrrr, strategyRec, preferBrrrr }),
    secondaryStrategy: buildSecondaryStrategyDetail({ flip, brrrr, targetStrategy }),
    nextAction: isDistressedForLabel(lead) ? 'Contact Owner' : 'Contact Agent',
    isOpeningOffer: false,
    actualOffer, actualOfferSource: actualOfferInfo.source,
  }
}

// UX V2.1, Part 5/6 — factual, strategy-specific detail for the
// NON-preferred strategy, so its own internal verdict (which may be the
// raw 'NO DEAL' tier) never gets exposed as if it were a second,
// competing acquisition recommendation. Built ONLY from that strategy's
// own already-computed mao/target — no new formula, no new threshold.
// Returns null whenever there is nothing secondary to say (the
// non-preferred strategy wasn't evaluated at all, or agrees with the
// primary target).
function buildSecondaryStrategyDetail({ flip, brrrr, targetStrategy }) {
  // The strategy that is NOT the primary/preferred one.
  const secondary = targetStrategy === 'BRRRR'
    ? (flip?.available ? { name: 'FLIP', mao: flip.mao, verdict: flip.verdict } : null)
    : (brrrr?.available && brrrr.mao != null ? { name: 'BRRRR', mao: brrrr.mao, verdict: brrrr.verdict } : null)
  if (!secondary) return null

  if (secondary.name === 'FLIP') {
    const works = secondary.verdict !== 'NO DEAL'
    return {
      strategy: 'FLIP',
      headline: works ? 'Flip also works' : 'Flip doesn\'t work at asking price',
      detail: works
        ? `Flip also meets HAT's target at the current price (Flip Max Buy ${formatShort(Math.round(secondary.mao))}).`
        : `Flip requires approximately ${formatShort(Math.round(secondary.mao))} or below to meet HAT's minimum profit target.`,
      maxBuy: secondary.mao,
    }
  }
  const works = secondary.verdict !== 'NO DEAL'
  return {
    strategy: 'BRRRR',
    headline: works ? 'BRRRR also works' : 'BRRRR doesn\'t work at asking price',
    detail: works
      ? `BRRRR also meets HAT's target at the current price (BRRRR Max Buy ${formatShort(Math.round(secondary.mao))}).`
      : `BRRRR requires approximately ${formatShort(Math.round(secondary.mao))} or below to meet HAT's target.`,
    maxBuy: secondary.mao,
  }
}

// UX V2.3, Part 3 — the ONE presentation resolver for "what does each
// price on this screen mean and where did it come from." A thin,
// read-only summary over deriveAcquisitionDecision's own output — no
// component should independently decide what counts as seller price/
// evaluation price/our offer/Max Buy; they all read this (or the
// decision object directly) instead.
export function resolveAcquisitionPricePosition({ flip, brrrr, strategyRec, lead, marketType = null, sellerAskingPrice = null }) {
  const preferBrrrr = resolveEffectiveStrategy(strategyRec) === 'BRRRR' && brrrr?.available
  const { targetPrice, targetStrategy } = resolveTargetPrice({ flip, brrrr, preferBrrrr })
  const isOffMarket = marketType === 'OFF_MARKET'
  const genuineSellerPrice = isOffMarket && sellerAskingPrice != null ? num(sellerAskingPrice) : null
  const evaluationPrice = flip?.available ? num(flip.evaluationPrice) : (lead?.asking_price != null ? num(lead.asking_price) : null)
  const { amount: actualOffer, source: actualOfferSource } = resolveActualOffer(lead)

  let pricePosition = 'NO_SELLER_PRICE'
  const referencePrice = isOffMarket ? genuineSellerPrice : evaluationPrice
  if (referencePrice != null && targetPrice != null) {
    const gapValue = referencePrice - targetPrice
    pricePosition = gapValue === 0 ? 'SELLER_AT_LIMIT' : gapValue < 0 ? 'SELLER_WITHIN_RANGE' : 'SELLER_ABOVE_RANGE'
  }

  return {
    marketType,
    sellerPrice: isOffMarket ? genuineSellerPrice : (evaluationPrice != null ? evaluationPrice : null),
    sellerPriceSource: isOffMarket ? (genuineSellerPrice != null ? 'seller_intelligence.seller_asking_price' : null) : (evaluationPrice != null ? 'lead.asking_price' : null),
    evaluationPrice: isOffMarket ? evaluationPrice : null,
    actualOffer, actualOfferSource,
    primaryStrategy: targetStrategy,
    maxBuy: targetPrice,
    maxBuyLabel: targetStrategy ? (isOffMarket ? `${targetStrategy === 'BRRRR' ? 'BRRRR' : 'Flip'} Max Buy / Walk-Away` : `${targetStrategy === 'BRRRR' ? 'BRRRR' : 'Flip'} Max Buy`) : null,
    sellerToMaxBuyGap: (isOffMarket && genuineSellerPrice != null && targetPrice != null) ? Math.round(genuineSellerPrice - targetPrice) : null,
    pricePosition,
    isOpeningOffer: false,
  }
}

// UX V2.1, Part 7/18 — the ONE gap-to-target computation every UI block
// (primary hero, Next Best Action, any other surface) should consume,
// instead of each one independently subtracting a hardcoded Flip Max
// Buy. Callers that only have `lead` + a freshly computed flip/brrrr/
// strategyRec (e.g. ActionZone.jsx, which has no readiness/fit context)
// can call this directly for just the price-gap piece without needing
// the full state machine above.
export function resolvePrimaryPriceGap({ flip, brrrr, strategyRec }) {
  const preferBrrrr = resolveEffectiveStrategy(strategyRec) === 'BRRRR' && brrrr?.available
  const { targetPrice, targetStrategy } = resolveTargetPrice({ flip, brrrr, preferBrrrr })
  const currentPrice = flip?.available ? num(flip.evaluationPrice) : null
  if (currentPrice == null || targetPrice == null) return null
  const gapValue = currentPrice - targetPrice
  return {
    targetPrice, targetStrategy,
    targetLabel: targetStrategy === 'BRRRR' ? 'BRRRR Max Buy' : 'Flip Max Buy',
    gap: Math.abs(Math.round(gapValue)), withinBuyRange: gapValue <= 0,
  }
}

function isDistressedForLabel(lead) {
  // Presentation-only mirror of the same distress signal already used
  // elsewhere on the page (isDistressedLead) — imported lazily to avoid
  // a circular import between this module and distressInfo.js callers.
  return !!lead?.is_distressed
}

function formatShort(n) {
  if (n >= 1000) return `$${Math.round(n / 1000)}K`
  return `$${Math.round(n)}`
}

// Part 10 — strategy communication. Uses ONLY the existing
// strategyRec.preferredStrategy + flip.available/brrrr.available facts —
// never invents a preference.
export function buildStrategyLine({ flip, brrrr, strategyRec, preferBrrrr }) {
  const bothViable = flip?.available && brrrr?.available
  if (!strategyRec || strategyRec.preferredStrategy === 'NONE') return null
  if (bothViable) {
    return { headline: 'BOTH STRATEGIES WORK', detail: `${preferBrrrr ? 'BRRRR' : 'FLIP'} preferred` }
  }
  if (flip?.available) return { headline: 'FLIP ONLY', detail: 'BRRRR could not be evaluated (rent estimate needed).' }
  if (brrrr?.available) return { headline: 'BRRRR ONLY', detail: 'Flip could not be evaluated.' }
  return null
}

// Part 13 — "Why HAT Says This", max 3 deterministic reasons, built only
// from facts already computed elsewhere on the page (never new AI
// reasoning, never a duplicate of the long AI narrative).
export function buildWhyReasons({ decision, flip, brrrr, decisionV2Confidence = null }) {
  const reasons = []
  if (decision.state === 'NEGOTIATE' && decision.gap != null) {
    reasons.push(`${decision.targetLabel === 'BRRRR Max Buy' ? 'Current' : 'Asking'} price is ~${formatShort(decision.gap)} above HAT ${decision.targetLabel}.`)
  }
  if (decision.state === 'GOOD_AT_ASKING' && decision.targetStrategy) {
    reasons.push(`${decision.targetStrategy} currently supports the acquisition price.`)
  }
  if (decision.strategyLine?.headline === 'BOTH STRATEGIES WORK') {
    reasons.push(`${decision.strategyLine.detail.replace(/^/, '')} supports the stronger acquisition price.`.replace('preferred supports', 'is preferred and supports'))
  }
  if (decisionV2Confidence != null) {
    reasons.push(decisionV2Confidence >= 70 ? 'Property data is well verified.' : 'Property data is only partially verified — treat numbers as preliminary.')
  }
  return reasons.slice(0, 3)
}

// Part 14 — compose an actionable Next Action line with safe price
// context, from the existing next-action text + this module's own
// already-derived gap. Never invents a new action.
export function composeNextActionText(baseAction, decision) {
  if (decision.state === 'NEGOTIATE' && decision.targetPrice != null && /agent|owner/i.test(baseAction)) {
    return `${baseAction} and negotiate toward ~${formatShort(Math.round(decision.targetPrice))} or below.`
  }
  return baseAction
}
