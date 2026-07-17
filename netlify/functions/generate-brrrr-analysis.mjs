// BRRRR Project AI Analysis
// Generates investor analysis for an active BRRRR project:
// deal verdict, rent sensitivity, risks, action items
//
// POST /.netlify/functions/generate-brrrr-analysis
// body: { address, calc: { ...calcBRRRR output } }
// Returns: { ok, analysis: string }

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

const SYSTEM_PROMPT = `You are a senior Jacksonville FL real estate investor writing an internal BRRRR deal review for HAT Investors. Be declarative, number-driven, opinionated. No hedging. No filler.

Context about HAT Investors:
- We self-manage our rentals — no property management fee.
- We do not factor vacancy or maintenance reserves into cash flow projections.
- Cash flow = Rent − Mortgage P&I − Property Taxes − Insurance.
- We use 12% HML for acquisition, refinance at 70% LTV on a 30yr fixed.
- Jacksonville FL market. Typical rent for 3/2 SFH: $1,350–$1,650/mo depending on condition and zip.

Write EXACTLY these 4 sections. No markdown. No intro. Start immediately with the first === line.

=====================================
BRRRR VERDICT
=====================================
One sentence: is this a good BRRRR or not, and why. Be blunt.

=====================================
DEAL SCORECARD
=====================================
Grade the deal on each dimension (STRONG / OK / WEAK / FAILS):
Cash Recapture:   [X]% recovered at refi — [STRONG ≥90% / OK 60-89% / WEAK 30-59% / FAILS <30%]
Cash Flow:        $[X]/mo — [STRONG ≥$200 / OK $1-199 / BREAK-EVEN $0 / NEGATIVE]
Equity Position:  $[X] locked in — [STRONG ≥$50K / OK $30-50K / WEAK <$30K]
All-In vs ARV:    [X]% — [STRONG ≤70% / OK 71-80% / RISKY >80%]
Capital At Risk:  $[X] still in deal — [LOW <$15K / MEDIUM $15-30K / HIGH >$30K]

=====================================
RENT ANALYSIS
=====================================
State the current rent, what the deal does at that rent, and what rent range makes this work.
Include: breakeven rent, rent for $100/mo positive CF, rent for $200/mo positive CF.
Give a specific opinion: is the current rent the floor, the market rate, or above market for this zip?
What should they push for at lease signing?

=====================================
ACTION ITEMS
=====================================
3–5 specific, numbered actions the investor should take now. Be concrete — no generic advice.`

function fmt(n) {
  if (n == null || isNaN(Number(n))) return '?'
  return '$' + Math.round(Number(n)).toLocaleString()
}
function pct(n) {
  if (n == null || isNaN(Number(n))) return '?'
  return (Number(n) * 100).toFixed(1) + '%'
}

function buildPrompt({ address, calc }) {
  const c = calc

  // Compute breakeven and target rents
  // Cash flow = rent - P&I - taxes - insurance
  // breakeven: rent = P&I + taxes + insurance
  const fixedCosts     = (c.refiMonthlyPI || 0) + (c.monthlyTax || 0) + (c.monthlyInsurance || 0)
  const breakevenRent  = Math.round(fixedCosts)
  const rent100        = Math.round(fixedCosts + 100)
  const rent200        = Math.round(fixedCosts + 200)
  const cashRecapturePct = c.totalCashIn > 0 ? ((c.refiCashOut / c.totalCashIn) * 100).toFixed(1) : '0'

  return `BRRRR PROJECT: ${address}

=== PRE-COMPUTED DEAL NUMBERS (use these exactly — do not recalculate) ===
Purchase price:       ${fmt(c.purchasePrice)}
Total HML loan:       ${fmt(c.totalLoan)}  (purchase + reno escrow)
HML rate:             12% → ${fmt(c.monthlyInterest)}/mo interest-only
Hold period:          ${c.holdMonths} months
Total cash invested:  ${fmt(c.totalCashIn)}  (close + reno gap + carrying costs)
All-in project cost:  ${fmt(c.totalAllIn)}
ARV:                  ${fmt(c.purchasePrice != null ? c.totalAllIn / (c.allInVsARV || 1) : null)}  (from calc: all-in/ARV = ${pct(c.allInVsARV)})

Refi loan (70% LTV):  ${fmt(c.refiLoan)}
HML payoff:           ${fmt(c.loanPayoff)}
Refi closing costs:   ${fmt(c.refiClosingCosts)}
Cash out at refi:     ${fmt(c.refiCashOut)}
Cash recaptured:      ${cashRecapturePct}%  (perfect BRRRR = 100%+)
Net cash in deal:     ${fmt(c.netCashInDeal)}
Equity at refi:       ${fmt(c.equityAtRefi)}

Refi loan:            ${fmt(c.refiLoan)} @ ${pct(c.refiRate)} 30yr → ${fmt(c.refiMonthlyPI)}/mo P&I

Current rent:         ${fmt(c.monthlyRent)}/mo
Monthly P&I:          ${fmt(c.refiMonthlyPI)}
Taxes:                ${fmt(c.monthlyTax)}/mo
Insurance:            ${fmt(c.monthlyInsurance)}/mo
Monthly cash flow:    ${fmt(c.monthlyCashFlow)}/mo  (rent - P&I - taxes - ins)
Annual cash flow:     ${fmt(c.annualCashFlow)}/yr
Cap rate:             ${pct(c.capRate)}

Breakeven rent:       $${breakevenRent}/mo
Rent for +$100/mo:    $${rent100}/mo
Rent for +$200/mo:    $${rent200}/mo

Write the 4 sections now.`
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: HEADERS })

  const body = await req.json().catch(() => ({}))
  const { address, calc } = body

  if (!address) return new Response(JSON.stringify({ ok: false, error: 'address required' }), { status: 400, headers: HEADERS })
  if (!calc)    return new Response(JSON.stringify({ ok: false, error: 'calc required' }), { status: 400, headers: HEADERS })

  const abortCtrl  = new AbortController()
  const abortTimer = setTimeout(() => abortCtrl.abort(), 22000)

  try {
    let resp
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 900,
          temperature: 0,
          system: SYSTEM_PROMPT,
          messages: [
            { role: 'user',      content: buildPrompt({ address, calc }) },
            { role: 'assistant', content: '=====================================' },
          ],
        }),
        signal: abortCtrl.signal,
      })
    } finally {
      clearTimeout(abortTimer)
    }

    if (!resp.ok) {
      const err = await resp.text()
      return new Response(JSON.stringify({ ok: false, error: err }), { status: 502, headers: HEADERS })
    }

    const data     = await resp.json()
    const raw      = data.content?.[0]?.text?.trim() || ''
    const analysis = '=====================================\n' + raw
    return new Response(JSON.stringify({ ok: true, analysis }), { status: 200, headers: HEADERS })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: HEADERS })
  }
}
