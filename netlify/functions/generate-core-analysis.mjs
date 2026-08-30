// Core deal analysis — HAT Investors
// Generates: DEAL SCORE, DEAL SNAPSHOT, RECOMMENDED ACTION, PROS, CONS, CRM WORKFLOW
// DEAL SCORE + DEAL SNAPSHOT come FIRST so Summary tab always appears even if truncated.
// No comps fetch — fast, always completes within budget.
//
// POST /.netlify/functions/generate-core-analysis
// body: { lead: { address, city, state, zip_code, bedrooms, bathrooms, sqft,
//           asking_price, arv, renovation_cost, mao, rent_estimate, notes } }
// Returns: { ok, notes: string }

import { calculateFlipMAO, computeFlipBreakdown, computeBrrrrBreakdown } from '../../src/lib/calculations.js'
import { computeBrrrrResult } from '../../src/lib/dealExplanation.js'
import { resolveHoldMonths } from '../../src/lib/underwritingSettings.js'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

// Exported (additive only, no behavior change) so the seller-narrative
// guardrail (QA-08, RELEASE-READINESS.md) is directly unit-testable.
export const SYSTEM_PROMPT = `You are a senior Jacksonville FL real estate investor writing internal deal notes for HAT Investors. Be declarative, number-driven, opinionated. No hedging on the NUMBERS — the math is the math.

SELLER BEHAVIOR — NEVER STATE AS FACT: "No hedging" applies to deal math, not to what a real person will do. Never write that the seller "will probably counter," "will likely accept," "will likely move to close," or any similar prediction of seller behavior UNLESS the pre-computed Seller Signals score is at least MODERATE and you cite the specific evidence (estate/probate, price drop %, as-is language, DOM, motivated notes). When Seller Signals are WEAK/baseline (no real evidence), describe the signal strength itself ("weak motivation signals — no estate, price-drop, or as-is evidence found") instead of predicting behavior, and give factual acquisition guidance instead ("start at $X," "do not exceed $Y," "if the seller won't move into range, follow up or pass").

JAX ARV (3/2 renovated): 32208/32219 $160-240K | 32210/32244/32221 $220-320K | 32205/32216 $230-380K | 32211 $155-200K | Clay Co $200-300K
Adjustments: 2BR -$20K | 4BR +$15K | 1BA only -$20K | <1,000sqft -$15K
Rent: 2BR $1,200 | 3/2 $1,550 | 4/2 $2,000/mo
BRRRR: Refi = 70% ARV @ 6.875%/30yr (FL DSCR rate). Cash left in <$30K great, $30-40K ok, >$40K fails.
Flip: carry+close = 8% ARV. MAO = 0.75 x ARV - reno.

CRITICAL: Use the PRE-COMPUTED DEAL MATH values provided in the prompt exactly as given. Do not recalculate anything.
COMPETITIVE MODE (when flagged): Strategy is to win the contract first at or near MAO, then use the inspection period to negotiate any issues found. "How to Get There" opening should reflect this — lead with speed and certainty, not price.
CRITICAL: Deal Math score and verdict are based on the AT MAO numbers — not the AT ASK numbers. We never pay asking price. The AT ASK block is reference only to explain why we need a discount.
When reno is UNKNOWN: score Deal Math based on how realistic the max reno budget is for the property condition. If the max reno budget is generous (>$40K for medium condition), score well. If it's very tight (<$15K) for a heavy reno, score low. "How to Get There" must include: get a contractor walk to confirm reno is under the max budget shown.

VERDICT PHILOSOPHY — VERY IMPORTANT:
We NEVER pay asking price. We always make an offer at or below MAO. Therefore:
- DEAD LEAD means the deal math FAILS EVEN AT MAO (cash-left-in too high AND flip profit negative) OR the ZIP/property has no realistic exit. Asking price above MAO alone is NEVER a reason for DEAD LEAD.
- When deal WORKS AT MAO but ask > MAO: the job is to get the price down. Use MAKE OFFER, NEGOTIATE, or WATCH depending on the gap and seller signals.
- Verdict is about whether a profitable deal is ACHIEVABLE — not whether the seller is asking too much today.

Verdict rules (based on total score AND deal math AT MAO):
MAKE OFFER:  score ≥65 AND deal works at MAO — send offer now
NEGOTIATE:   score 45-64 AND deal works at MAO — gap closeable with follow-up
LONG SHOT:   score 30-44 AND deal works at MAO — needs distressed seller or big price drop
WATCH:       score 15-29 OR marginal math at MAO — monitor for changes
DEAD LEAD:   score <15 OR deal FAILS at MAO on both BRRRR and flip — math is broken, move on

Write EXACTLY these 6 sections in this order. No markdown. No intro. Start immediately with the first ===== line.

=====================================
DEAL SCORE
=====================================
Total:          [X]/100
Deal Return:    [X]/30 - [BEST of BRRRR or Flip AT MAO. BRRRR: cash-out or <$0=30, $0-15K=26, $15-30K=20, $30-60K=12, >$60K=5, fails=0. Flip: >$60K=30, $40-60K=26, $25-40K=20, $10-25K=10, <$10K=4, neg=0. Take whichever path scores higher.]
Price Gap:      [X]/20 - [USE PRE-COMPUTED Price Gap score exactly — do not recalculate]
Seller Signals: [X]/15 - [START from PRE-COMPUTED base score, then add: +5 estate/probate, +5 price drop>15%, +4 as-is listed, +3 motivated language in notes. Cap 15.]
Market & Exit:  [X]/15 - [USE PRE-COMPUTED ZIP tier score + your ARV confidence judgment (HIGH=7, MEDIUM=4, LOW=1). Sum = ZIP score + ARV score, cap 15.]
Cash Flow:      [X]/10 - [USE PRE-COMPUTED Cash Flow score and formula line exactly — do not recalculate or reword the numbers. Then append 1 sentence of deal-specific risk context: if the deal scores high overall or has a motivated seller, explain why the gap is acceptable or what reno ceiling keeps it viable; if the deal is weak AND cash flow fails, say so directly. Be specific to THIS property — no generic advice.]
Data Quality:   [X]/10 - [COPY PRE-COMPUTED Data Quality score EXACTLY as given — do not adjust, do not recalculate, do not round differently. Write the exact number provided.]
Verdict:        [MAKE OFFER / NEGOTIATE / LONG SHOT / WATCH / DEAD LEAD]

=====================================
DEAL SNAPSHOT
=====================================
Profile:    [X]BR/[X]BA | [sqft] sqft | ZIP [X] | [property type]
Ask:        $[X] | $[X]/sqft ([below/at/above] investor floor ~$[X]/sqft)
Condition:  [Light cosmetic / Medium / Heavy / Unknown] - [1 line reason]
DOM:        [X days / Unknown] | Price history: [drop of $X / no change / unknown]
Motivation: [estate / price drop / as-is / tired landlord / unknown]
HOA:        [None / $X/mo / Unknown]

=====================================
RECOMMENDED ACTION
=====================================
Verdict:           [MAKE OFFER / NEGOTIATE / LONG SHOT / WATCH / DEAD LEAD]
At Ask:            [WORKS / FAILS / MARGINAL] - [one line why]
At MAO:            [WORKS / FAILS / MARGINAL] - [one line why]
Gap to Close:      $[X] off ask ([X]% reduction needed from seller)
Strategy:          [BRRRR / Flip / Rental Hold / None]
Our ARV:           $[X]
Our MAO:           $[X]
Starting Offer:    $[X] ← USE THE EXACT PRE-COMPUTED ANCHOR FROM THE DEAL MATH BLOCK — do not invent or round this number. When ask is at/below MAO, Starting Offer = asking price.
Target Price:      $[X]
Max Walk-Away:     $[X]
How to Get There:  [EXACTLY 3 lines. No more. Each line starts with the label then a colon. Plain English — write like you are briefing a colleague before a phone call. Short sentences. No jargon. No parentheses. Max 20 words per line.
Opening: [What to say to the agent or seller to open. One simple sentence. Example: "Tell them we are a cash buyer and our offer is firm at our investor price for this condition."]
Probe for: [One thing to find out about the seller that could help us. Example: "Ask if they have a deadline or need to close fast — that gives us leverage."]
Walk if: [The one number or condition that means we stop. Example: "If they won't go below $170K, we walk — the numbers don't work above that."]]

=====================================
PROS - WHY THIS DEAL IS INTERESTING
=====================================
1. [market/zip signal with number]
2. [seller motivation or pricing signal]
3. [property upside or value-add potential]

=====================================
CONS - RISKS AND RED FLAGS
=====================================
1. [price or spread risk with numbers]
2. [property or condition risk]
3. [market or exit risk]

=====================================
CRM WORKFLOW
=====================================
Set Status: [new_lead / contacted / offer_sent / negotiating / dead_lead / follow_up]
Make Offer: [YES - $[X] / NO / NOT YET]
Priority:   [HIGH - act today / MEDIUM - this week / LOW - watch]`

// Exported (additive only, no behavior change) so the pre-computed deal
// math feeding the AI prompt — the part that must stay canonical, per
// the Product Decision in RELEASE-READINESS.md (QA-03) — is directly
// unit-testable without a live LLM call.
export function buildPrompt(lead, underwritingSettings = null) {
  const addr = [lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ')
  const fmt  = (n) => n != null ? `$${Number(n).toLocaleString()}` : 'Unknown'
  const num  = (n) => n != null ? Number(n) : null

  const pp   = num(lead.asking_price)
  const arv  = num(lead.arv)
  const reno = num(lead.renovation_cost)
  const rent = num(lead.rent_estimate)
  const mao  = num(lead.mao)
  const sqft = num(lead.sqft)

  // P0/P1 Decision Integrity Fix (2026-08-30) — resolved the same way the
  // Deal page resolves it (resolveHoldMonths), so a workspace with a
  // non-default holding period doesn't silently diverge here.
  const holdMonths = resolveHoldMonths(lead.hold_months, underwritingSettings?.default_holding_months)

  // Capability #19.2, Section 6 — pre-compute MAO so the AI never has to
  // estimate it. Uses the SAME canonical Flip MAO function (src/lib/
  // calculations.js) the Lead Detail UI's "Flip MAO" badge/Path to a Flip
  // Deal/Copilot all use, instead of the old flat 75%-of-ARV rule this
  // file used to compute independently — that mismatch was the exact
  // "$147,550 here, $148,200 there" contradiction this capability exists
  // to remove. Falls back to lead.mao only when ARV or reno is unknown
  // (calculateFlipMAO returns null in that case, same as before).
  // P0/P1 Decision Integrity Fix (2026-08-30) — now threads the effective
  // workspace underwriting settings so this number matches the Deal
  // page's canonical Flip MAO under a customized configuration too, not
  // just at system defaults.
  const computedMao = (arv && reno != null) ? Math.round(calculateFlipMAO(arv, reno, holdMonths, undefined, underwritingSettings)) : mao

  let computedBlock = ''
  let brrrrResult = null
  let flipResult  = null
  let anchorFinal = null
  let targetPriceRaw = null

  if (pp && arv && reno != null) {
    // Reno is known — compute deal math at BOTH asking price AND MAO
    // We never buy at asking — verdict is based on MAO math
    const buyPrice = computedMao && computedMao > 0 ? computedMao : pp
    const refi     = arv * 0.70
    const rentEst  = rent || (lead.bedrooms >= 4 ? 2000 : lead.bedrooms === 3 ? 1600 : 1300)
    // P&I at 6.875% / 30yr. Factor = 0.006566
    // NOTE (P0/P1 Decision Integrity Fix, 2026-08-30) — `refi`/`loanFactor`
    // here are dead values (never read below in this branch — superseded
    // by the canonical computeBrrrrResult/computeBrrrrBreakdown calls a
    // few lines down). Left as-is; removing unused code is out of this
    // task's scope ("do not refactor unrelated code").
    const loanFactor = refi <= 150000 ? 985 : refi <= 180000 ? 1182 : refi <= 200000 ? 1313 : refi <= 220000 ? 1445 : Math.round(refi * 0.006566)
    // P0/P1 Decision Integrity Fix (2026-08-30) — was hardcoded to 6,
    // now the same resolved holdMonths used for computedMao above, so
    // this block's BRRRR/Flip math (computeBrrrrBreakdown/
    // computeFlipBreakdown calls below) uses the effective holding
    // period, not a silently different one.
    const holdMo = holdMonths

    // Math AT MAO (what we actually pay)
    // Product Decision — Canonical Deal Values (QA-03, see RELEASE-
    // READINESS.md). BRRRR pre-computation used to evaluate cash left
    // in/cash flow AT THE FLIP MAO (buyPrice/computedMao) using a
    // hand-rolled approximation (bucketed refi P&I table, flat $1,500
    // closing, $136 flat insurance) — a materially different purchase
    // price AND formula than the canonical Deal tab's BRRRR figures.
    // This is exactly the "BRRRR at MAO: cash left in $16,652" vs.
    // canonical "$23,063" contradiction manual QA found. Calls
    // computeBrrrrResult(lead) DIRECTLY — the exact function the Deal
    // tab uses — rather than re-deriving BRRRR math from lower-level
    // helpers, so this can never drift from the canonical evaluation
    // price/formula again (computeBrrrrResult evaluates cash left in/
    // cash flow at the RECOMMENDED offer, not at BRRRR's own Max Buy —
    // reusing it directly, instead of re-implementing that same
    // convention by hand, is what guarantees the match).
    const brrrr = computeBrrrrResult(lead, underwritingSettings)
    // currentOffer is the SAME price computeBrrrrResult itself evaluated
    // cashLeftIn/monthlyCashFlow at (the recommended/negotiated offer,
    // not BRRRR's own Max Buy) — computeBrrrrBreakdown here only supplies
    // the "all-in" total-cash-needed figure for the 1%-rule text below;
    // cashLeftIn/cashflow themselves come straight from `brrrr`, never
    // recomputed, so they can never drift from the canonical value.
    const brrrrBuyPrice = brrrr.available ? brrrr.currentOffer : null
    if (brrrr.available && brrrrBuyPrice != null && brrrr.cashLeftIn != null) {
      const bb = computeBrrrrBreakdown(brrrrBuyPrice, arv, reno, rentEst, holdMo, { settings: underwritingSettings })
      brrrrResult = {
        allIn: Math.round(bb.totalCashNeeded + bb.totalHolding),
        refi: Math.round(bb.refiLoan),
        cashLeftIn: brrrr.cashLeftIn,
        cashflow: brrrr.monthlyCashFlow,
        label: brrrr.verdict === 'STRONG' || brrrr.verdict === 'PASS' ? 'GREAT' : brrrr.verdict === 'WATCH' ? 'OK' : 'FAILS',
      }
    }
    // Capability #19.2 — same canonical Flip cost model as calculateFlipMAO
    // (HML financing, holding costs, 93%-of-ARV sale), not the simplified
    // "ARV − price − reno − 8%" formula this used to compute independently
    // — that second formula was the actual source of the "$46,650 at MAO"
    // text that didn't match the $30,728/$30,000 figures shown elsewhere.
    const flipNetMao    = Math.round(computeFlipBreakdown(buyPrice, arv, reno, holdMo, underwritingSettings).totalProfit)
    // $30,000 is HAT's minimum acceptable Flip profit (FLIP_MIN_PROFIT_TARGET) —
    // anything at/above it is never "FAILS"; $40K+ is descriptively STRONG.
    flipResult  = { allIn: buyPrice + reno, netProfit: flipNetMao, label: flipNetMao >= 40000 ? 'STRONG' : flipNetMao >= 30000 ? 'ACCEPTABLE' : 'FAILS' }

    // Math AT ASK (reference only — shows why we can't pay full price).
    // BRRRR reference figures now use the same canonical
    // computeBrrrrBreakdown, at the actual asking price, for the same
    // provenance reason as above.
    const askBrrrr    = computeBrrrrBreakdown(pp, arv, reno, rentEst, holdMo, { settings: underwritingSettings })
    const allInAsk    = Math.round(askBrrrr.totalCashNeeded + askBrrrr.totalHolding)
    const cashLeftAsk = Math.round(askBrrrr.totalCashInvested)
    const flipNetAsk  = Math.round(computeFlipBreakdown(pp, arv, reno, holdMo, underwritingSettings).totalProfit)

    const pctAboveMaoNum = computedMao ? ((pp - computedMao) / Math.abs(computedMao)) * 100 : 0
    const pctAboveMao    = pctAboveMaoNum.toFixed(1)
    const askBelowMao    = pp <= computedMao

    // ── Seller motivation score ────────────────────────────────────────────
    // Measures how likely the seller is to accept a lower offer.
    // High score → we can anchor close to MAO (they'll engage).
    // Low score  → we need more room to negotiate, anchor lower.
    const notesText = ((lead.notes || '') + ' ' + (lead.team_comments || '')).toLowerCase()
    let motivationScore = 0
    const motivationTags = []
    // DOM signals
    const dom = lead.days_on_market != null ? Number(lead.days_on_market) : null
    if (dom != null) {
      if (dom > 90)       { motivationScore += 3; motivationTags.push(`${dom}d DOM`) }
      else if (dom > 60)  { motivationScore += 2; motivationTags.push(`${dom}d DOM`) }
      else if (dom > 30)  { motivationScore += 1 }
    }
    // Price drop signals
    const priceDrop = lead.price_drop_pct != null ? Number(lead.price_drop_pct) : null
    if (priceDrop != null) {
      if (priceDrop > 15) { motivationScore += 3; motivationTags.push(`${priceDrop}% price drop`) }
      else if (priceDrop > 5) { motivationScore += 2; motivationTags.push(`price reduced`) }
    }
    // Notes keyword signals
    const highMotivationKw = [
      { kw: 'estate',       tag: 'estate sale', pts: 3 },
      { kw: 'probate',      tag: 'probate',     pts: 3 },
      { kw: 'divorce',      tag: 'divorce',     pts: 3 },
      { kw: 'relocation',   tag: 'relocation',  pts: 2 },
      { kw: 'relocating',   tag: 'relocation',  pts: 2 },
      { kw: 'must sell',    tag: 'must sell',   pts: 3 },
      { kw: 'motivated',    tag: 'motivated',   pts: 2 },
      { kw: 'as-is',        tag: 'as-is',       pts: 2 },
      { kw: 'as is',        tag: 'as-is',       pts: 2 },
      { kw: 'tired landlord', tag: 'tired landlord', pts: 2 },
      { kw: 'behind on',    tag: 'financial pressure', pts: 3 },
      { kw: 'pre-foreclosure', tag: 'pre-foreclosure', pts: 3 },
      { kw: 'foreclosure',  tag: 'foreclosure', pts: 3 },
      { kw: 'job loss',     tag: 'financial pressure', pts: 2 },
      { kw: 'medical',      tag: 'medical hardship', pts: 2 },
      { kw: 'inherited',    tag: 'inherited',   pts: 2 },
      { kw: 'cash only',    tag: 'cash only',   pts: 1 },
      { kw: 'quick close',  tag: 'quick close', pts: 2 },
      { kw: 'fast close',   tag: 'fast close',  pts: 2 },
      { kw: 'price reduced', tag: 'price reduced', pts: 1 },
      { kw: 'reduced',      tag: 'reduced',     pts: 1 },
      { kw: 'vacant',       tag: 'vacant',      pts: 1 },
    ]
    for (const { kw, tag, pts } of highMotivationKw) {
      if (notesText.includes(kw)) { motivationScore += pts; motivationTags.push(tag) }
    }
    motivationScore = Math.min(10, motivationScore)  // cap at 10
    const motivationLabel = motivationScore >= 7 ? 'HIGH' : motivationScore >= 4 ? 'MEDIUM' : 'LOW'

    // ── Smart anchor — negotiation-room model ──────────────────────────────
    // Philosophy: anchor = MAO − half the gap. This leaves equal room on both
    // sides so negotiations can "meet in the middle" at MAO.
    // Credibility floor prevents an insulting offer that kills the conversation.
    // Motivation shifts both the raw anchor UP and relaxes the floor DOWN.
    const competitive = !!lead.competitive_mode
    let anchorRaw, anchorNote
    if (askBelowMao) {
      anchorRaw      = pp
      targetPriceRaw = pp
      anchorNote     = competitive
        ? 'ask is at/below MAO and competitive mode ON — offer AT ask, consider above ask if multiple offers'
        : 'ask is already at/below MAO — offer AT asking price, no discount needed'
    } else if (competitive) {
      if (pctAboveMaoNum <= 15) {
        anchorRaw  = computedMao
        anchorNote = `COMPETITIVE MODE — offering at MAO (${pctAboveMao}% gap) to win contract; negotiate on inspection`
      } else if (pctAboveMaoNum <= 35) {
        anchorRaw  = Math.round(computedMao * 0.96)
        anchorNote = `COMPETITIVE MODE — anchor near MAO (${pctAboveMao}% gap) to stay in deal; use inspection to close gap`
      } else {
        anchorRaw  = Math.round(computedMao * 0.91)
        anchorNote = `COMPETITIVE MODE — large gap (${pctAboveMao}%), anchor 9% below MAO; motivated seller needed`
      }
      targetPriceRaw = computedMao
    } else {
      // Negotiation-room model:
      // raw = MAO − (gap × roomFactor)
      // roomFactor shrinks as motivation rises (less room needed — deal will close faster)
      const gap = pp - computedMao
      // Base room factor: 50% of gap. Motivation reduces it: each point = -2% (up to -20% at 10pts).
      // So high motivation (score 8) → roomFactor = 30% → anchor = MAO − 30% of gap (much closer to MAO)
      // Low motivation (score 0-2) → roomFactor = 50% → anchor = MAO − 50% of gap (more negotiating room)
      const roomFactor = Math.max(0.20, 0.50 - motivationScore * 0.02)
      anchorRaw = computedMao - gap * roomFactor

      // Credibility floor: anchor can't drop below X% of asking price — that's insulting and kills the deal.
      // Floor relaxes (gets lower) when seller is motivated — they'll engage even on a low offer.
      // Base floor 80%, relaxes to 72% at max motivation.
      const floorPct = Math.max(0.72, 0.80 - motivationScore * 0.008)
      const credibilityFloor = pp * floorPct
      anchorRaw = Math.max(anchorRaw, credibilityFloor)

      // Never anchor below 65% of ask (truly insulting) — but MAO is an absolute
      // ceiling, so apply that cap last; it must win over the 65%-of-ask floor.
      anchorRaw = Math.max(anchorRaw, pp * 0.65)
      anchorRaw = Math.min(anchorRaw, computedMao * 0.995)

      // Build a human-readable note explaining the decision
      const motivationContext = motivationTags.length > 0
        ? `${motivationLabel} motivation (${motivationTags.slice(0, 2).join(', ')})`
        : `${motivationLabel} motivation (no strong signals)`
      const roomPct = (roomFactor * 100).toFixed(0)
      anchorNote = pctAboveMaoNum <= 10
        ? `gap only ${pctAboveMao}% — anchor near MAO, ${motivationContext}`
        : `${motivationContext} → ${roomPct}% room factor, anchor leaves negotiating space to MAO`
      targetPriceRaw = computedMao
    }
    // Round to nearest $100 for a specific, calculated feel
    anchorFinal = Math.round(anchorRaw / 100) * 100
    const anchorOffer = fmt(anchorFinal)
    const targetPrice = fmt(targetPriceRaw)
    const maxWalkAway = fmt(computedMao)

    computedBlock = `
PRE-COMPUTED DEAL MATH — use these exact numbers, do not recalculate:
Our MAO (canonical Flip Max Buy — the ceiling; NOT the current evaluation price below): ${fmt(computedMao)}
Price gap: Ask ${fmt(pp)} vs MAO ${fmt(computedMao)} = ${pctAboveMao}% ${askBelowMao ? 'AT/BELOW MAO ✓ — ASK IS ALREADY A GOOD PRICE' : 'ABOVE MAO — need price reduction'}
OFFER LADDER (use these exact values — do not adjust):
  Starting Offer (anchor): ${anchorOffer} (${anchorNote})
  Target Price:            ${targetPrice} ${askBelowMao ? '(the asking price — already a deal, do not negotiate below this)' : '(our MAO — the number that makes the deal work)'}
  Max Walk-Away:           ${maxWalkAway} (absolute ceiling — do not pay above this)
${askBelowMao ? `AT ASK ${fmt(pp)} [THE DEAL WORKS HERE — this is our primary scenario]:` : 'AT EACH STRATEGY\'S OWN BASIS PRICE [base verdict on these numbers — BRRRR and Flip use DIFFERENT prices below, do not conflate them]:'}
  BRRRR${askBelowMao ? '' : ` (Max Buy ${fmt(brrrr.mao != null ? Math.round(brrrr.mao) : null)}, evaluated at our recommended offer ${fmt(brrrrBuyPrice)})`}: ${brrrrResult ? `All-in ${fmt(brrrrResult.allIn)} | Refi ${fmt(brrrrResult.refi)} | Cash left in ${fmt(brrrrResult.cashLeftIn)} → ${brrrrResult.label} | Cash flow ~$${brrrrResult.cashflow}/mo` : 'not viable under current rent/ARV/reno assumptions'}
  Flip${askBelowMao ? '' : ` (evaluated at Flip Max Buy ${fmt(buyPrice)})`}:  All-in ${fmt(buyPrice + reno)} | Net profit ${fmt(flipNetMao)} → ${flipResult.label}
${askBelowMao ? '' : `
AT ASK ${fmt(pp)} [reference only — shows why full price doesn't work]:
  BRRRR: All-in ${fmt(allInAsk)} | Cash left in ${fmt(cashLeftAsk)} → ${cashLeftAsk < 30000 ? 'GREAT' : cashLeftAsk < 60000 ? 'OK' : 'FAILS'}
  Flip:  Net profit ${fmt(flipNetAsk)} → ${flipNetAsk >= 40000 ? 'STRONG' : flipNetAsk >= 30000 ? 'ACCEPTABLE' : 'FAILS'}`}`

  } else if (pp && arv && reno == null) {
    // Reno unknown — compute MAX reno budget that makes each strategy work
    const refi        = arv * 0.70
    const rentEst     = rent || (lead.bedrooms >= 4 ? 2000 : lead.bedrooms === 3 ? 1600 : 1300)
    const loanFactor  = refi <= 150000 ? 985 : refi <= 180000 ? 1182 : refi <= 200000 ? 1313 : refi <= 220000 ? 1445 : Math.round(refi * 0.006566)
    const cashflow    = rentEst - loanFactor - 208 - 136

    // Max reno for BRRRR: solve allIn = refi - 30000 → pp*0.9 + reno + hmlCosts(reno) ≈ refi - 30000
    // Simplified: maxRenoBRRRR ≈ (refi - 30000 - pp*0.9*1.085 - 1500) / (1 + 1.085)
    const hmlBaseNoreno = pp * 0.90
    const maxRenoBRRRR  = Math.round((refi - 30000 - hmlBaseNoreno * 1.085 - 1500) / 2.085)
    // Max reno for Flip — reno unknown yet, so this stays an approximate
    // reference solve (not the canonical calculateFlipMAO model, which needs
    // reno as an input, not an output). Capability #19.2: target aligned to
    // HAT's actual $30,000 minimum, not the old $25,000.
    // ARV - pp - reno - ARV*0.08 = 30000 → reno = ARV*0.92 - pp - 30000
    const maxRenoFlip   = Math.round(arv * 0.92 - pp - 30000)

    const askBelowZeroMao = computedMao && pp <= computedMao
    const atAskLabel = askBelowZeroMao ? 'MARGINAL' : 'FAILS'
    const atAskReason = askBelowZeroMao
      ? `ask is below the zero-reno MAO ceiling — deal works IF reno stays under ${maxRenoBRRRR > 0 ? fmt(maxRenoBRRRR) : fmt(maxRenoFlip)}`
      : `ask exceeds MAO even before reno costs`
    const atMaoLabel = (maxRenoBRRRR > 0 || maxRenoFlip > 0) ? 'MARGINAL' : 'FAILS'
    const atMaoReason = (maxRenoBRRRR > 0 || maxRenoFlip > 0)
      ? `deal works at MAO if reno stays under max budget — confirm with contractor walk`
      : `no reno headroom even at MAO`

    computedBlock = `
RENO UNKNOWN — MAX RENO BUDGET TO MAKE THIS DEAL WORK (pre-computed — do not recalculate):
MAO at zero reno (75%×ARV−closing): ${fmt(computedMao)}
Max reno for BRRRR (cash left in <$30K at MAO): ${maxRenoBRRRR > 0 ? fmt(maxRenoBRRRR) : 'IMPOSSIBLE — ask too high'}
Max reno for Flip (net profit >$25K at ask price): ${maxRenoFlip > 0 ? fmt(maxRenoFlip) : 'IMPOSSIBLE — ask too high'}
Refi at 70% ARV: ${fmt(refi)} | Est. cash flow if reno ≤ budget: ~$${cashflow}/mo
KEY QUESTION: Can we renovate this property for under ${maxRenoBRRRR > 0 ? fmt(maxRenoBRRRR) : fmt(maxRenoFlip)} based on condition? That is the go/no-go number.
Score Deal Math based on how realistic the max reno budget is for the property condition described.

REQUIRED OUTPUT FOR RECOMMENDED ACTION (copy exactly):
At Ask: ${atAskLabel} - ${atAskReason}
At MAO: ${atMaoLabel} - ${atMaoReason}
Our MAO: ${fmt(computedMao)} (zero-reno ceiling — actual MAO lower once reno is known)
Starting Offer: ${askBelowZeroMao ? fmt(pp) : 'N/A'} ${askBelowZeroMao ? '(asking price — ask is already below MAO ceiling; offer at ask, confirm reno before going higher)' : '(cannot set offer — ask exceeds MAO ceiling)'}
Target Price: ${askBelowZeroMao ? fmt(pp) : 'N/A'} ${askBelowZeroMao ? '(asking price — already a deal at this price)' : ''}
Max Walk-Away: ${askBelowZeroMao ? `${fmt(pp)} (capped at asking — reno unknown; do not go above ask until reno budget is confirmed. Zero-reno ceiling: ${fmt(computedMao)})` : `${fmt(computedMao)} (zero-reno MAO ceiling — do not pay above this without confirmed reno budget)`}`
  }

  const arvLabel = arv != null ? `ARV: ${fmt(arv)} [INVESTOR-PROVIDED]` : 'ARV: Unknown'
  const domLabel = lead.days_on_market != null ? `DOM: ${lead.days_on_market} days` : 'DOM: Unknown'

  // Pre-compute Price Gap score (exact bracket — do not let AI recalculate)
  let priceGapScore = null
  if (pp && computedMao && computedMao > 0) {
    const pct = (pp - computedMao) / Math.abs(computedMao) * 100
    if (pp <= computedMao)  priceGapScore = 20
    else if (pct <= 10)     priceGapScore = 17
    else if (pct <= 20)     priceGapScore = 13
    else if (pct <= 30)     priceGapScore = 8
    else if (pct <= 40)     priceGapScore = 4
    else if (pct <= 50)     priceGapScore = 2
    else                    priceGapScore = 1
  }

  // Pre-compute ZIP tier score
  const ZIP_SCORES = { '32205':8,'32216':8,'32210':6,'32244':6,'32211':6,'32218':6,'32219':6,'32208':4,'32254':4,'32221':4 }
  const zipScore = lead.zip_code ? (ZIP_SCORES[String(lead.zip_code)] ?? 3) : 3

  // Pre-compute Cash Flow score + 1% rule detail (from brrrrResult if available, else neutral 5)
  let cashFlowScore = null
  let cashFlowDetail = ''
  if (brrrrResult) {
    const cf = brrrrResult.cashflow
    cashFlowScore = cf > 400 ? 10 : cf > 200 ? 8 : cf > 50 ? 5 : cf >= 0 ? 2 : 0
    // 1% rule: monthly rent / all-in cost × 100. Goal ≥ 1% means rent covers 1% of total investment per month.
    const rentUsed   = rent || (lead.bedrooms >= 4 ? 2000 : lead.bedrooms === 3 ? 1600 : 1300)
    const allInAtMao = brrrrResult.allIn
    const pctAtMao   = allInAtMao > 0 ? ((rentUsed / allInAtMao) * 100).toFixed(2) : null
    const rentNeeded = allInAtMao > 0 ? Math.ceil(allInAtMao * 0.01) : null
    if (pctAtMao) {
      const meetsRule = parseFloat(pctAtMao) >= 1.0
      const allInLabel = reno
        ? `$${Math.round(allInAtMao).toLocaleString()} all-in (purchase + $${Math.round(reno).toLocaleString()} reno + costs)`
        : `$${Math.round(allInAtMao).toLocaleString()} all-in (purchase + costs)`
      cashFlowDetail = meetsRule
        ? `1% rule: $${rentUsed.toLocaleString()}/mo rent ÷ ${allInLabel} = ${pctAtMao}% ✓ (goal: ≥1% means rent covers 1% of your investment per month). Cash flow ~$${cf}/mo after P&I, taxes, insurance.`
        : `1% rule: $${rentUsed.toLocaleString()}/mo rent ÷ ${allInLabel} = ${pctAtMao}% ✗ (goal: ≥1% — need $${rentNeeded.toLocaleString()}/mo to hit it). Cash flow ~$${cf}/mo after P&I, taxes, insurance.`
    }
  } else if (reno == null || !arv) {
    cashFlowScore = 5  // reno unknown — neutral
    const rentUsed = rent || (lead.bedrooms >= 4 ? 2000 : lead.bedrooms === 3 ? 1600 : 1300)
    cashFlowDetail = `1% rule cannot be calculated yet — reno cost unknown so all-in cost is unknown. Est. rent $${rentUsed.toLocaleString()}/mo. Confirm reno budget then re-run.`
  }

  // Pre-compute Seller Signals base (DOM + price drop — AI adds estate/as-is/notes on top)
  const dom = lead.days_on_market != null ? Number(lead.days_on_market) : null
  const domPts = dom == null ? 0 : dom > 90 ? 4 : dom >= 60 ? 3 : dom >= 30 ? 2 : 0
  const priceDrop = lead.price_drop_pct != null ? Number(lead.price_drop_pct) : null
  const priceDropPts = priceDrop != null && priceDrop > 15 ? 5 : priceDrop != null && priceDrop > 5 ? 2 : 0
  const sellerSignalsBase = Math.min(15, 4 + domPts + priceDropPts)

  // Pre-compute Data Quality score (server knows exactly what data is present)
  let dataQuality = 10
  if (reno == null)                                         dataQuality -= 4  // major: reno unknown
  if (!arv)                                                 dataQuality -= 2  // no investor/comps ARV
  if (!lead.sqft || !lead.bedrooms || !lead.bathrooms)      dataQuality -= 2  // no property details
  if (!lead.notes && dom == null && !lead.team_comments)   dataQuality -= 2  // no seller context at all
  dataQuality = Math.max(0, dataQuality)

  const preComputedScores = `
PRE-COMPUTED SCORES — copy these EXACT numbers into DEAL SCORE. Do NOT change them. Do NOT recalculate. Do NOT adjust for any reason. These are final:
Price Gap score: ${priceGapScore ?? 'compute per bracket'}/20
Seller Signals base score: ${sellerSignalsBase} (4 baseline + ${domPts} DOM pts + ${priceDropPts} price-drop pts) — add your pts for estate/probate(+5), as-is listing(+4), motivated language in notes(+3). Cap total at 15.
ZIP tier score (part of Market & Exit): ${zipScore}/8 — Market & Exit total = ${zipScore} + ARV confidence pts (HIGH=7, MEDIUM=4, LOW=1), cap 15
Cash Flow score: ${cashFlowScore ?? 'compute per bracket'}/10${cashFlowDetail ? ` — COPY THIS FORMULA LINE EXACTLY (numbers are locked): ${cashFlowDetail} — then add 1 sentence of YOUR deal-specific risk opinion based on the overall score, ARV confidence, seller motivation, and DOM.` : ''}
Data Quality score: ${dataQuality}/10`

  const userPrompt = `${addr} | ${lead.bedrooms || '?'}BR/${lead.bathrooms || '?'}BA | ${sqft || '?'} sqft | ZIP ${lead.zip_code || '?'}
Ask: ${fmt(pp)} | ${arvLabel} | Reno: ${fmt(reno != null ? reno : null)} | Rent: ${fmt(rent)} | ${domLabel}${computedBlock}${preComputedScores}
Notes: ${lead.notes || 'None'}
Team Comments: ${lead.team_comments || 'None'}

Write all 6 sections now using the deal data above. For DEAL SCORE use the PRE-COMPUTED values above exactly.`

  // Build a partial prefill for RECOMMENDED ACTION that locks in the computed offer numbers.
  // Claude will continue from this point and cannot overwrite the locked values.
  let assistantPrefill = '====================================='
  if (pp && arv && reno != null && computedMao) {
    // anchorFinal and targetPriceRaw already computed by the smart anchor logic above
    const anchorLocked = fmt(anchorFinal)
    const targetLocked = fmt(targetPriceRaw)
    const maxLocked    = fmt(computedMao)

    return {
      prompt: userPrompt + `

LOCKED OFFER VALUES — copy these EXACT numbers verbatim into RECOMMENDED ACTION. Do not round differently. Do not change any of these numbers:
Our ARV:        ${fmt(arv)}
Our MAO:        ${maxLocked}
Starting Offer: ${anchorLocked}
Target Price:   ${targetLocked}
Max Walk-Away:  ${maxLocked}`,
      prefill: '=====================================',
      // P0/P1 Decision Integrity Fix (2026-08-30) — returned so the
      // handler below can reuse THESE canonical, settings-aware values
      // for its API response instead of independently re-deriving MAO/
      // starting-offer with a different (legacy, or re-implemented)
      // formula. This is the exact number the LLM was told to use — the
      // response the client persists into lead.mao can now never
      // disagree with what the AI narrative itself says.
      computedMao: computedMao ?? null,
      computedStartingOffer: anchorFinal ?? null,
    }
  }

  return { prompt: userPrompt, prefill: assistantPrefill, computedMao: computedMao ?? null, computedStartingOffer: null }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: HEADERS })

  const body = await req.json().catch(() => ({}))
  const { lead = {}, underwriting_settings = null } = body

  if (!lead.address) return new Response(JSON.stringify({ ok: false, error: 'lead.address required' }), { status: 400, headers: HEADERS })
  if (!lead.asking_price) return new Response(JSON.stringify({ ok: false, error: 'NO_ASKING_PRICE' }), { status: 400, headers: HEADERS })

  // Returned to the client alongside computed_mao — unchanged, still the
  // investor-provided/comps ARV, not a derived value.
  const _arv = lead.arv != null ? Number(lead.arv) : null

  // P0/P1 Decision Integrity Fix (2026-08-30) — real finding: this
  // response used to compute its own `computed_mao`/`computed_starting_
  // offer` with an ENTIRELY SEPARATE, legacy 0.75×ARV−reno−2450 formula
  // and a hand-duplicated copy of the negotiation-room model, both
  // independent of what buildPrompt() had already computed (canonically,
  // via calculateFlipMAO) and told the LLM to use. For Woodleigh
  // (ARV $200K, reno $39K) that legacy formula produced $108,550 — a
  // real, materially different number from the canonical $102,222 Flip
  // MAO the Deal page and the AI narrative itself both show. Persisting
  // $108,550 into lead.mao while the Deal page and the AI's own written
  // analysis said $102,222 is the confirmed decision-integrity defect
  // this fix removes. buildPrompt is now called once, and its own
  // canonical computedMao/anchorFinal are reused for the API response —
  // there is no longer a second, independent calculation to drift.

  // P0 Timeout Investigation & Fix (2026-08-30) — real finding: this
  // account's actual Netlify platform ceiling for synchronous function
  // execution is 26s (confirmed via `netlify api listAccountsForUser`),
  // not the 30s previously requested in netlify.toml (silently clamped).
  // Lowered from 22000ms to 20000ms so there is real, provable margin
  // under the true ceiling — not just margin under a number the platform
  // never actually honored. No prompt/model/financial-calculation change.
  const abortCtrl = new AbortController()
  const abortTimer = setTimeout(() => abortCtrl.abort(), 20000)

  // Part 2 diagnostics — stage timing, no secrets/prompt content logged.
  const t0 = Date.now()

  try {
    const { prompt: builtPrompt, prefill: builtPrefill, computedMao: computedMaoForResponse, computedStartingOffer } = buildPrompt(lead, underwriting_settings)
    const tPromptBuilt = Date.now()
    let resp
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1300,
          temperature: 0,
          system: SYSTEM_PROMPT,
          messages: [
            { role: 'user',      content: builtPrompt },
            { role: 'assistant', content: builtPrefill },
          ],
        }),
        signal: abortCtrl.signal,
      })
    } finally {
      clearTimeout(abortTimer)
    }
    const tAiDone = Date.now()

    if (!resp.ok) {
      const err = await resp.text()
      console.log(`[generate-core-analysis] FAILED prompt_build=${tPromptBuilt - t0}ms ai_call=${tAiDone - tPromptBuilt}ms total=${tAiDone - t0}ms status=${resp.status}`)
      return new Response(JSON.stringify({ ok: false, error: err }), { status: 502, headers: HEADERS })
    }

    const data = await resp.json()
    const raw = data.content?.[0]?.text?.trim() || ''
    // Prepend the prefill so the full output includes the section header
    const notes = builtPrefill + '\n' + raw
    const tTotal = Date.now() - t0
    console.log(`[generate-core-analysis] OK prompt_build=${tPromptBuilt - t0}ms ai_call=${tAiDone - tPromptBuilt}ms parse=${Date.now() - tAiDone}ms total=${tTotal}ms`)
    // Also return computed arv/mao so client can save them without fragile regex parsing
    return new Response(JSON.stringify({
      ok: true,
      notes,
      computed_arv: _arv,
      computed_mao: computedMaoForResponse,
      computed_starting_offer: computedStartingOffer,
    }), { status: 200, headers: HEADERS })
  } catch (e) {
    console.log(`[generate-core-analysis] EXCEPTION total=${Date.now() - t0}ms aborted=${abortCtrl.signal.aborted} error=${e.message}`)
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: HEADERS })
  }
}
