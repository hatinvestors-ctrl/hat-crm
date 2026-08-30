// Analyze a real estate deal using the HAT deal-analysis-agent prompt.
//
// POST /.netlify/functions/analyze-deal
// body: { lead_id, address, purchase_price, arv, renovation_cost, strategy }
//
// Required env vars: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_PAT

import { computeFlipBreakdown, computeBrrrrBreakdown } from '../../src/lib/calculations.js'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const SUPABASE_URL      = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

// Compact system prompt — financial model only, no verbose output format tables
const SYSTEM_PROMPT = `# Deal Analysis Agent

You are a real estate deal analysis agent using Tomer Carmelli's exact financial model. Your job is numbers only — you do not draft emails, contact lenders, or make decisions. You output analysis and a verdict.

## Required Inputs

Provide: property address + purchase price + renovation estimate + strategy (BRRRR or flip) + either expected monthly rent (BRRRR) or ARV (flip). If ARV is unknown, run 3 scenarios.

Optional but include if known: beds/baths, sq ft, year built, lot size, MLS#.

## HML Defaults (Rob @ 3 Shacks)

- Covers: 90% purchase + 100% renovation
- Rate: 12% annual | Points: 2% of total loan (purchase + reno)
- Loan type: Interest-only during hold
- Monthly loan payment = Total Loan × 1% (12% / 12)

## Purchase Costs (itemized)

**Title / closing costs (fixed):**
| Item | Default |
|------|---------|
| Title closing costs | $1,600 |

**HML lender costs:**
| Item | Default |
|------|---------|
| Loan points | 2% × total loan |
| Title lender insurance | $500 |
| Document stamps / mortgage | $200 |
| Intangible tax | $150 |

**Total Purchase Costs** = $1,600 + Points + $500 + $200 + $150

Down Payment = Purchase Price × 10%
**Total Cash Needed** = Down Payment + Total Purchase Costs

## Total All-In Cost

Purchase Price + Renovation + Total Purchase Costs + Total Holding Costs

## Holding Costs (per month)

| Item | Default |
|------|---------|
| Loan payment | Total Loan × 1%/mo |
| Property taxes | $208/mo ($2,500/yr) |
| Insurance | $100/mo ($1,200/yr) |
| HOA | $0 unless specified |
| Utilities | $0 unless specified |
| **Total per month** | sum |

Always calculate holding costs for the assumed holding period.
- Default holding period for **flips**: 3 months
- Default holding period for **BRRRR**: 6 months

## BRRRR Refinance

- Refi loan: 70% of ARV
- Rate: 6.9% | 30-year amortization
- Monthly mortgage factor at 6.9%/30yr: ≈ 0.006607 per dollar
- Refi closing costs: 3% of new loan

**Refi Cash Out** = New Loan Amount − Refi Closing Costs − HML Loan Repayment − Total Holding Costs

If Refi Cash Out is **negative**, that amount is additional cash out of pocket at refi.

**Total Cash Invested** = Total Cash Needed (at purchase) + any negative Refi Cash Out
If Refi Cash Out is positive (cash back), **Total Cash Invested** = Total Cash Needed − Cash Back (but never below $0)

## Post-Refi Annual Operating Costs

| Item | Default |
|------|---------|
| Property taxes | $2,500/yr ($208/mo) |
| Insurance | $1,200/yr ($100/mo) |

Use actual values if provided.

**NOI** = Annual Rent − Property Taxes − Insurance
**Cash Flow** = Monthly Rent − Refi Mortgage Payment − Property Taxes/mo − Insurance/mo

## Key Metrics

- **Total Cash Needed** = Down payment + Purchase costs
- **Total Cash Invested** = Cash left in deal after refi (see above)
- **Cap Rate (Purchase)** = NOI / Total All-In Cost
- **Cap Rate (Market)** = NOI / ARV
- **Cash-on-Cash (COC)** = Annual Cash Flow / Total Cash Invested
- **Gross Rent Multiplier** = ARV / Annual Rent
- **Debt Coverage Ratio** = NOI / Annual Mortgage Payment
- **Break Even Ratio** = (Operating Expenses + Mortgage) / Gross Rent
- **Rent to Value** = Monthly Rent / ARV
- **Return on Investment (ROI)** = (Total Profit at Year 1 sale) / Total Cash Invested
- **Equity Multiple** = Total Value Returned / Total Cash Invested

## Flip Metrics

- **Total Profit** = Sale Proceeds − Loan Repayment − Total Holding Costs − Total Cash Needed
- **ROI** = Total Profit / Total Cash Needed × 100
- **Annualized ROI** = ROI / Holding Period (months) × 12
- Minimum acceptable profit: $30,000, or $10,000 per rehab month

## Flip Analysis

- Net Sale (Sale Proceeds) = ARV × 93% (7% selling costs)

## MAO (Maximum Allowable Offer)

- MAO = 75% × ARV – Repairs – Closing costs – Minimum profit

---

## Style

Numbers-first, no fluff. Short and actionable. Flag clearly if inputs are estimates vs. confirmed. Always state assumed holding period explicitly.`

const _UNUSED_OUTPUT_FORMAT = `## Output Format — Flip

### 1. Property Summary
Address, beds/baths, sq ft, year built, lot size, MLS# (if known)

### 2. Purchase & Rehab Summary
| Item | Amount |
|------|--------|
| Purchase Price | |
| Rehab Costs | |
| Amount Financed (HML) | |
| Down Payment (10%) | |
| Purchase Costs | |
| **Total Cash Needed** | |
| ARV | |
| ARV per Sq Ft | |
| Price per Sq Ft | |

### 3. Financing
Loan amount, rate, type, monthly payment, LTC/LTV

### 4. Purchase Costs (itemized)
| Item | Amount |
|------|--------|
| Title closing costs | |
| Title lender insurance | |
| Loan points | |
| Doc stamps / mortgage | |
| Intangible tax | |
| **Total** | |

### 5. Holding Costs (at assumed holding period)
| Item | Total |
|------|-------|
| Loan payments | |
| Property taxes | |
| Insurance | |
| **Total** | |
| Per month | |

### 6. Sale & Profit
| Item | Amount |
|------|--------|
| After Repair Value | |
| Selling Costs (7%) | |
| Sale Proceeds | |
| Loan Repayment | |
| Holding Costs | |
| Cash Invested | |
| **Total Profit** | |

### 7. Investment Returns
| Metric | Value |
|--------|-------|
| ROI | |
| Annualized ROI | |

### 8. Profit Projections (sensitivity table)

| Holding Period | Loan Pmts | Taxes | Insurance | Total Holding | Total Profit | ROI | Ann. ROI |
|----------------|-----------|-------|-----------|---------------|--------------|-----|----------|
| 1 month | | | | | | | |
| 2 months | | | | | | | |
| 3 months | | | | | | | |
| 4 months | | | | | | | |
| 6 months | | | | | | | |

### 9. Scenarios (if ARV unknown)
| Metric | Conservative | Base | Optimistic |
|--------|-------------|------|------------|
| ARV | | | |
| All-In Cost | | | |
| Total Profit | | | |
| MAO | | | |
| ROI | | | |
| Ann. ROI | | | |

### 10. Verdict
**BUY** / **PASS** / **CONDITIONAL** — 2–3 sentences on what needs to be true.

### 11. Key Risks
2–3 bullets on what could kill this deal.

---

## Output Format — BRRRR

### 1. Property Summary
Address, beds/baths, sq ft, year built, lot size, MLS# (if known)

### 2. Purchase & Rehab Summary
| Item | Amount |
|------|--------|
| Purchase Price | |
| Rehab Costs | |
| Amount Financed (HML) | |
| Down Payment (10%) | |
| Purchase Costs | |
| **Total Cash Needed** | |
| ARV | |
| ARV per Sq Ft | |
| Price per Sq Ft | |

### 3. Financing (Purchase — HML)
Loan amount, rate, type, monthly payment, LTC/LTV

### 4. Purchase Costs (itemized)
| Item | Amount |
|------|--------|
| Title closing costs | |
| Title lender insurance | |
| Loan points | |
| Doc stamps / mortgage | |
| Intangible tax | |
| **Total** | |

### 5. Holding Costs (6-month default)
| Item | Total |
|------|-------|
| Loan payments | |
| Property taxes | |
| Insurance | |
| **Total** | |
| Per month | |

### 6. Refinance Analysis
| Item | Amount |
|------|--------|
| New Loan Amount (70% ARV) | |
| Refinance Costs (3%) | |
| Loan Repayment (HML) | |
| Holding Costs | |
| **Refi Cash Out** | |
| — | — |
| Initial Cash Invested | |
| Refi Cash Out (+ or −) | |
| **Total Cash Invested** | |

### 7. Financing (Refinance)
Loan type, rate, loan amount, LTV, monthly payment, annual payment

### 8. Cash Flow (Year 1, After Refinance)
| Item | Monthly | Yearly |
|------|---------|--------|
| Gross Rent | | |
| Vacancy | | |
| Operating Income | | |
| Operating Expenses | | |
| — Property Taxes | | |
| — Insurance | | |
| **Net Operating Income** | | |
| Loan Payments | | |
| **Cash Flow** | | |

### 9. Returns & Ratios (Year 1)
| Metric | Value |
|--------|-------|
| Cap Rate (Purchase Price) | |
| Cap Rate (Market / ARV) | |
| Cash on Cash Return | |
| Gross Rent Multiplier | |
| Rent to Value | |
| Debt Coverage Ratio | |
| Break Even Ratio | |

### 10. Buy & Hold Projections
Assume: 3% appreciation/yr, 2% income increase/yr, 2% expense increase/yr, 6% selling costs

| | Year 1 | Year 2 | Year 3 | Year 5 | Year 10 |
|---|---|---|---|---|---|
| Gross Rent | | | | | |
| Operating Expenses | | | | | |
| NOI | | | | | |
| Loan Payments | | | | | |
| **Cash Flow** | | | | | |
| Property Value | | | | | |
| Loan Balance | | | | | |
| **Total Equity** | | | | | |
| Total Profit (if sold) | | | | | |
| Cash on Cash | | | | | |

### 11. Verdict
**BUY** / **PASS** / **CONDITIONAL** — 2–3 sentences on what needs to be true.

### 12. Key Risks
2–3 bullets on what could kill this deal.

---

## Style

Numbers-first, no fluff. Short and actionable. Flag clearly if inputs are estimates vs. confirmed. Always state assumed holding period explicitly.

## Comps

**Sale comps:**
- Sold ≤ 12 months, same neighborhood (expand radius if needed — note explicitly)
- Include: distance, similarity %, beds/baths, sq ft, sale price, price/sq ft, sale date, days on market
- Include active + pending separately
- Adjustments: $50/sqft, $10K garage, $15–20K pool, $5–10K lot size

**Rental comps (BRRRR):**
- Active listings, same neighborhood
- Include: distance, similarity %, beds/baths, sq ft, listed rent, rent/sqft, last seen
- State estimated rent range and midpoint used in analysis`

// Underwriting Configuration V1, Part 5/19 — CONSOLIDATED (was a hand-copy
// of the exact same formula computeFlipBreakdown already implements in
// src/lib/calculations.js — confirmed byte-identical output for every
// existing case, since the two were already the same literals). Now
// delegates to the canonical function so a future underwriting-setting
// change (e.g. selling cost %, HML terms) reaches the AI's PRE-COMPUTED
// FINANCIALS block the same way it reaches the Deal page — eliminating
// the P0 drift risk the forensic audit found here. `settings` optional
// (resolved underwriting settings) — omitted, this is byte-identical to
// the pre-consolidation hand-copy.
function computeFlipMetrics(pp, arv, reno, holdMonths = 6, settings = null) {
  const b = computeFlipBreakdown(pp, arv, reno, holdMonths, settings)
  return {
    hmlLoan: b.hmlLoan, monthlyPmt: b.monthlyPmt, points: b.points, downPayment: b.downPayment,
    totalCashNeeded: b.totalCashNeeded, holdingPerMo: b.holdingPerMo, totalHolding: b.totalHolding,
    saleProceeds: b.saleProceeds, totalProfit: b.totalProfit, roi: b.roi, annualizedRoi: b.annualizedRoi,
  }
}

// P0/P1 Decision Integrity Fix (2026-08-30) — CONSOLIDATED, explicitly
// authorized by this task (Part 5). The Underwriting Configuration V1
// task (2026-08-26) deliberately left this hand-coded, because
// consolidating it onto the canonical computeBrrrrBreakdown would have
// silently changed real leads' AI-narrative BRRRR numbers — a STOP
// CONDITION at the time. That STOP CONDITION is explicitly lifted here:
// this task exists BECAUSE the two disagreeing — the hand-coded copy
// used a flat mortgage-payment multiplier (refiLoan * 0.006607, an
// undocumented ~6.93% rate) instead of real 30yr amortization at the
// canonical rate, clamped totalCashInvested to a $0 floor instead of the
// canonical signed value, and hardcoded refi LTV to 70% regardless of
// the workspace's actual configured setting (confirmed FAIL condition —
// this task's Part 6 requires the AI to see 75% when the workspace is
// configured for 75%, and the old hardcoded 0.70 here could never do
// that). Now delegates to the SAME canonical computeBrrrrBreakdown the
// Deal page uses, threaded with the SAME effective underwriting settings
// — the AI pipeline can no longer disagree with the Deal page on BRRRR
// math. No formula was invented; this is a straight swap onto the
// existing, already-validated canonical engine.
function computeBrrrrMetrics(pp, arv, reno, monthlyRent, holdMonths = 6, settings = null) {
  const b = computeBrrrrBreakdown(pp, arv, reno, monthlyRent, holdMonths, { settings })
  return {
    hmlLoan: b.hmlLoan, monthlyPmt: b.monthlyPmt, points: b.points, downPayment: b.downPayment,
    totalCashNeeded: b.totalCashNeeded, holdingPerMo: b.holdingPerMo, totalHolding: b.totalHolding,
    refiLoan: b.refiLoan, refiCosts: b.refiCosts, refiCashOut: b.refiCashOut,
    totalCashInvested: b.totalCashInvested, refiMoPmt: b.mortgagePayment,
    monthlyCF: b.monthlyCF, annualCF: b.annualCF, coc: b.coc,
  }
}

function fmt(n) { return n == null ? 'N/A' : '$' + Math.round(n).toLocaleString('en-US') }
function pct(n) { return n == null ? 'N/A' : n.toFixed(1) + '%' }

// Exported (additive only, no behavior change) so this prompt-building
// function — including the PRE-COMPUTED FINANCIALS block that must stay
// canonical — is directly unit-testable without a live LLM call, matching
// the pattern already used for buildPrompt/SYSTEM_PROMPT elsewhere.
export function buildUserPrompt({ address, purchase_price, arv, renovation_cost, monthly_rent, strategy, hold_months, underwriting_settings = null }) {
  const pp   = Number(purchase_price)
  const rv   = Number(arv)
  const reno = Number(renovation_cost || 0)
  const rent = Number(monthly_rent || 0)
  const holdMonths = Number(hold_months) > 0 ? Number(hold_months) : 6
  const renoUnknown = renovation_cost == null || renovation_cost === '' || renovation_cost === 0
  const strategyLabel = strategy === 'brrrr' ? 'BRRRR' : 'flip'

  let computedBlock = ''
  let jsonDefaults = {}

  if (strategyLabel === 'flip') {
    const m = computeFlipMetrics(pp, rv, reno, holdMonths, underwriting_settings)
    // Capability #19.1, Section 6 — HAT's minimum acceptable Flip profit is
    // $30,000 (FLIP_MIN_PROFIT_TARGET in src/lib/calculations.js); a deal
    // that clears it is BUY, full stop — no longer demoted to CONDITIONAL
    // by the old $40K bar. Score (continuous, below) still reflects the
    // difference between an acceptable and an excellent margin.
    const verdict = m.totalProfit >= 30000 ? 'BUY' : 'PASS'
    const score = Math.max(0, Math.min(100, Math.round(50 + (m.totalProfit - 30000) / 1500)))
    computedBlock = `
PRE-COMPUTED FINANCIALS (use these exact numbers — do not recalculate):
- HML Loan (90% purchase + 100% reno): ${fmt(m.hmlLoan)}
- Monthly loan payment (1%/mo): ${fmt(m.monthlyPmt)}
- Points (2%): ${fmt(m.points)}
- Down payment (10%): ${fmt(m.downPayment)}
- Fixed purchase costs (title, insurance, doc stamps, intangible): $2,450
- Total Cash Needed: ${fmt(m.totalCashNeeded)}
- Holding costs/mo (loan + taxes $208 + insurance $100): ${fmt(m.holdingPerMo)}
- Total holding (${holdMonths} months): ${fmt(m.totalHolding)}
- Sale proceeds (ARV × 93%): ${fmt(m.saleProceeds)}
- Total Profit = Sale Proceeds − HML Loan − Holding − Cash Needed: ${fmt(m.totalProfit)}
- ROI: ${pct(m.roi)}
- Annualized ROI (×12/${holdMonths}): ${pct(m.annualizedRoi)}
`
    jsonDefaults = { verdict, score, profit: Math.round(m.totalProfit), roi: Math.round(m.roi * 10) / 10, annualized_roi: Math.round(m.annualizedRoi * 10) / 10, total_cash_needed: Math.round(m.totalCashNeeded) }
  } else {
    const m = computeBrrrrMetrics(pp, rv, reno, rent, holdMonths, underwriting_settings)
    // Capability #19.1, Section 8 — HAT's BRRRR requirement is binary:
    // positive monthly cash flow AND less than $30K cash left in after
    // refinance (BRRRR_MAX_CASH_LEFT_IN). Replaces the old CoC-tiered
    // BUY/CONDITIONAL/PASS bands.
    const verdict = (m.monthlyCF ?? 0) > 0 && (m.totalCashInvested ?? Infinity) < 30000 ? 'BUY' : 'PASS'
    const score = m.coc != null ? Math.max(0, Math.min(100, Math.round(50 + (m.coc - 6) * 5))) : 20
    // P0/P1 Decision Integrity Fix (2026-08-30) — LTV/refi-cost % labels
    // were hardcoded text ("70% ARV", "3%") regardless of the actual
    // settings used to compute m.refiLoan/m.refiCosts above — a Part 6
    // FAIL condition (the AI would print "70% ARV" even when computed at
    // a workspace-configured 75%). Now reads the same effective values.
    const refiLtvPctDisplay   = underwriting_settings?.refi_ltv_pct ?? 70
    const refiCostsPctDisplay = underwriting_settings?.refi_costs_pct ?? 3
    computedBlock = `
PRE-COMPUTED FINANCIALS (use these exact numbers — do not recalculate):
- HML Loan: ${fmt(m.hmlLoan)}
- Total Cash Needed: ${fmt(m.totalCashNeeded)}
- Total Holding (${holdMonths} months): ${fmt(m.totalHolding)}
- Refi Loan (${refiLtvPctDisplay}% ARV): ${fmt(m.refiLoan)}
- Refi Costs (${refiCostsPctDisplay}%): ${fmt(m.refiCosts)}
- Refi Cash Out: ${fmt(m.refiCashOut)}
- Total Cash Invested after refi: ${fmt(m.totalCashInvested)}
- Refi monthly mortgage: ${fmt(m.refiMoPmt)}
- Monthly Cash Flow (rent − mortgage − taxes − insurance): ${fmt(m.monthlyCF)}
- Annual Cash Flow: ${fmt(m.annualCF)}
- Cash-on-Cash Return: ${m.coc != null ? pct(m.coc) : 'N/A (no rent provided)'}
`
    jsonDefaults = { verdict, score, profit: Math.round(m.annualCF ?? 0), roi: Math.round((m.coc ?? 0) * 10) / 10, annualized_roi: Math.round((m.coc ?? 0) * 10) / 10, total_cash_needed: Math.round(m.totalCashInvested) }
  }

  const renoWarning = renoUnknown
    ? '\n⚠ RENOVATION COST UNKNOWN — analysis assumes $0 reno. Score and profit are INFLATED. The recommendation MUST explicitly warn that a contractor estimate is needed before any decision.\n'
    : ''

  return `Analyze this ${strategyLabel} deal for ${address || 'the property below'}.

INPUTS:
- Purchase Price: ${fmt(pp)}
- Renovation Cost: ${renoUnknown ? 'UNKNOWN (assumed $0 — see warning below)' : fmt(reno)}
- ARV: ${fmt(rv)}${rent > 0 ? `\n- Monthly Rent: ${fmt(rent)}` : ''}
- Strategy: ${strategyLabel}
${renoWarning}${computedBlock}
The numbers above are correct. Do NOT recompute them. Write 2-3 sentences of qualitative commentary on the deal quality, market risk, and what needs to be confirmed. Then output the JSON block below with the exact computed values filled in.

\`\`\`json
{
  "verdict": "${jsonDefaults.verdict}",
  "score": ${jsonDefaults.score},
  "profit": ${jsonDefaults.profit},
  "roi": ${jsonDefaults.roi},
  "annualized_roi": ${jsonDefaults.annualized_roi},
  "total_cash_needed": ${jsonDefaults.total_cash_needed},
  "recommendation": "YOUR 2-3 SENTENCE QUALITATIVE SUMMARY HERE.",
  "key_risks": ["Risk one", "Risk two", "Risk three"]
}
\`\`\``
}

function parseJsonBlock(text) {
  const match = text.match(/```json\s*([\s\S]*?)```/)
  if (!match) return null
  try { return JSON.parse(match[1].trim()) } catch { return null }
}

async function saveAnalysis(leadId, analysisObj) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`,
    {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ deal_analysis: analysisObj }),
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Supabase save failed: ${res.status} ${text}`)
  }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: HEADERS })
  }

  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY not configured.' }), { status: 500, headers: HEADERS })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const { lead_id, address, purchase_price, arv, renovation_cost, monthly_rent = null, strategy = 'flip', skip_save = false, reno_was_estimated = false, asking_price = null, underwriting_settings = null, hold_months = null } = body

    if (!purchase_price) return new Response(JSON.stringify({ ok: false, error: 'purchase_price is required.' }), { status: 400, headers: HEADERS })
    if (!arv)            return new Response(JSON.stringify({ ok: false, error: 'arv is required.' }), { status: 400, headers: HEADERS })

    // P0 Timeout Investigation & Fix (2026-08-30) — real finding: this
    // call had NO internal timeout guard at all, relying entirely on the
    // netlify.toml `timeout = 120` config — a budget that never actually
    // existed. Netlify's real platform ceiling for this account is 26s
    // (see netlify.toml's comment on this function for how that was
    // confirmed); anything past that is hard-killed with a non-JSON
    // response regardless of what the config file says. This abort at
    // 20s guarantees the function ALWAYS returns valid JSON (a real error
    // message, gracefully handled by the client) before Netlify's own
    // platform-level kill can produce an opaque, ungraceful failure —
    // matching the pattern already used by analyze-deal's sibling
    // functions (generate-core-analysis, generate-comps,
    // generate-negotiation-plan). Does not touch the prompt, the model,
    // or any financial calculation.
    const abortCtrl = new AbortController()
    const abortTimer = setTimeout(() => abortCtrl.abort(), 20000)
    let claudeRes
    try {
      claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          // P0/P1 Decision Integrity Fix (2026-08-30) — real finding:
          // hold_months was already destructured in buildUserPrompt's
          // signature but never actually forwarded from this call site,
          // so it silently always fell back to 6 months regardless of
          // what the client sent (or the effective workspace default).
          // The client (DealAnalysisCard.jsx) already sends the resolved
          // value — it just wasn't being read here.
          messages: [{ role: 'user', content: buildUserPrompt({ address, purchase_price, arv, renovation_cost, monthly_rent, strategy, hold_months, underwriting_settings }) }],
        }),
        signal: abortCtrl.signal,
      })
    } finally {
      clearTimeout(abortTimer)
    }

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      throw new Error(`Claude API error ${claudeRes.status}: ${errText}`)
    }

    const claudeData = await claudeRes.json()
    const markdown   = claudeData.content?.[0]?.text || ''
    const summary    = parseJsonBlock(markdown) || {}

    const analysisObj = {
      verdict:           summary.verdict           || 'UNKNOWN',
      score:             summary.score             ?? null,
      strategy,
      profit:            summary.profit            ?? null,
      roi:               summary.roi               ?? null,
      annualized_roi:    summary.annualized_roi    ?? null,
      total_cash_needed: summary.total_cash_needed ?? null,
      recommendation:    summary.recommendation    || '',
      key_risks:         summary.key_risks         || [],
      markdown,
      analyzed_at:       new Date().toISOString(),
      reno_unknown: !renovation_cost && !reno_was_estimated,
      // Analysis Readiness + Decision Integrity Fix, Part 9 — the frozen
      // "what was this analysis actually generated against" snapshot.
      // Additive only: purchase_price/arv/renovation_cost/reno_was_estimated
      // are UNCHANGED (same values, same meaning, same math). strategy/
      // asking_price/monthly_rent are NEW fields added here so
      // useDealStaleness (src/hooks/useDealStaleness.js) can detect drift
      // on those material inputs too — this does not touch how any of
      // these numbers are calculated, only what gets remembered about them.
      inputs: {
        purchase_price:   Number(purchase_price),
        arv:              Number(arv),
        renovation_cost:  renovation_cost != null ? Number(renovation_cost) : null,
        reno_was_estimated,
        strategy,
        asking_price:     asking_price != null ? Number(asking_price) : null,
        rent_estimate:    strategy === 'brrrr' && monthly_rent != null ? Number(monthly_rent) : null,
        // Underwriting Configuration V1, Part 12 — the EFFECTIVE settings
        // actually used for this generation (not just the raw workspace
        // config), so useDealStaleness can detect drift precisely. Null
        // when the caller didn't pass any (legacy/unwired caller) — never
        // fabricated.
        underwriting: underwriting_settings || null,
      },
    }

    if (!skip_save && lead_id) {
      if (!SUPABASE_URL || !SUPABASE_KEY) {
        return new Response(JSON.stringify({ ok: false, error: 'Supabase credentials not configured.' }), { status: 500, headers: HEADERS })
      }
      await saveAnalysis(lead_id, analysisObj)
    }

    return new Response(JSON.stringify({ ok: true, analysis: analysisObj }), { status: 200, headers: HEADERS })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500, headers: HEADERS })
  }
}
