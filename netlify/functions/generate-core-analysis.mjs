// Core deal analysis — HAT Investors
// Generates: DEAL SCORE, DEAL SNAPSHOT, RECOMMENDED ACTION, PROS, CONS, CRM WORKFLOW
// DEAL SCORE + DEAL SNAPSHOT come FIRST so Summary tab always appears even if truncated.
// No comps fetch — fast, always completes within budget.
//
// POST /.netlify/functions/generate-core-analysis
// body: { lead: { address, city, state, zip_code, bedrooms, bathrooms, sqft,
//           asking_price, arv, renovation_cost, mao, rent_estimate, notes } }
// Returns: { ok, notes: string }

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

const SYSTEM_PROMPT = `You are a senior Jacksonville FL real estate investor writing internal deal notes for HAT Investors. Be declarative, number-driven, opinionated. No hedging.

JAX ARV (3/2 renovated): 32208/32219 $160-240K | 32210/32244/32221 $220-320K | 32205/32216 $230-380K | 32211 $155-200K | Clay Co $200-300K
Adjustments: 2BR -$20K | 4BR +$15K | 1BA only -$20K | <1,000sqft -$15K
Rent: 2BR $1,200 | 3/2 $1,550 | 4/2 $2,000/mo
BRRRR: Refi = 70% ARV @ 6.875%/30yr. Cash left in <$30K great, $30-60K ok, >$60K fails.
Flip: carry+close = 8% ARV. MAO = 0.75 x ARV - reno.

CRITICAL: Use the PRE-COMPUTED DEAL MATH values provided in the prompt exactly as given. Do not recalculate MAO, cash-left-in, or net profit.

VERDICT PHILOSOPHY — VERY IMPORTANT:
We NEVER pay asking price. We always make an offer at or below MAO. Therefore:
- DEAD LEAD means the deal math FAILS EVEN AT MAO (cash-left-in too high AND flip profit negative) OR the ZIP/property has no realistic exit. Asking price above MAO alone is NEVER a reason for DEAD LEAD.
- When deal WORKS AT MAO but ask > MAO: the job is to get the price down. Use MAKE OFFER, NEGOTIATE, or WATCH depending on the gap and seller signals.
- Verdict is about whether a profitable deal is ACHIEVABLE — not whether the seller is asking too much today.

Verdict rules (base on deal math AT MAO):
MAKE OFFER:  deal works at MAO, gap <25% off ask — send offer now
NEGOTIATE:   deal works at MAO, gap 25-45% off ask — motivated seller or long DOM needed
LONG SHOT:   deal works at MAO, gap >45% off ask — only works if seller is distressed
WATCH:       deal barely works at MAO (marginal math), monitor for price drops
DEAD LEAD:   deal FAILS at MAO (math broken even at our price) OR no viable exit strategy

Write EXACTLY these 6 sections in this order. No markdown. No intro. Start immediately with the first ===== line.

=====================================
DEAL SCORE
=====================================
Total:             [X]/100
Price Gap:         [X]/20 - [gap from ask to MAO. <=0%=20, 1-15%=16, 16-25%=12, 26-35%=8, 36-45%=4, >45%=1]
Deal Math:         [X]/25 - [BRRRR/flip math AT MAO. Strong=25, OK=18, Marginal=10, Fails=0]
Cash Flow:         [X]/10 - [monthly after PITIE at refi. >$400=10, $250-400=8, $100-250=5, $0-100=2, neg=0]
ZIP Quality:       [X]/15 - [A(32205,32216)=15, B(32210,32244,32211,32218,32219)=10, C(32208,32254,32221)=6]
Seller Motivation: [X]/20 - [estate/probate=+7, price drop>15%=+6, as-is=+4, DOM>90=+5, DOM60-90=+3, DOM30-60=+1. Cap 20]
ARV Confidence:    [X]/10 - [HIGH=10, MEDIUM=6, LOW=2]
Verdict:           [MAKE OFFER / NEGOTIATE / LONG SHOT / WATCH / DEAD LEAD]

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
Starting Offer:    $[X] (anchor below MAO to leave room to negotiate up)
Target Price:      $[X]
Max Walk-Away:     $[X]
How to Get There:  [2-3 sentences: what negotiation angle to use, what seller signals to look for, what follow-up cadence to run to move seller from ask to our price]

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

function buildPrompt(lead) {
  const addr = [lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ')
  const fmt  = (n) => n != null ? `$${Number(n).toLocaleString()}` : 'Unknown'
  const num  = (n) => n != null ? Number(n) : null

  const pp   = num(lead.asking_price)
  const arv  = num(lead.arv)
  const reno = num(lead.renovation_cost)
  const rent = num(lead.rent_estimate)
  const mao  = num(lead.mao)
  const sqft = num(lead.sqft)

  // Pre-compute MAO so the AI never has to estimate it
  const renoForMao  = reno != null ? reno : 0
  const computedMao = arv ? Math.round(arv * 0.75 - renoForMao - 2450) : mao

  let computedBlock = ''
  let brrrrResult = null
  let flipResult  = null

  if (pp && arv && reno != null) {
    const hml         = pp * 0.90 + reno
    const hmlPoints   = Math.round(hml * 0.02)
    const hmlFees     = 1500
    const hmlInterest = Math.round(hml * 0.12 * (5.5 / 12))
    const hmlCosts    = hmlPoints + hmlFees + hmlInterest
    const allIn       = pp + reno + hmlCosts
    const refi        = arv * 0.70
    const cashLeftIn  = allIn - refi
    const rentEst     = rent || (lead.bedrooms >= 4 ? 2000 : lead.bedrooms === 3 ? 1600 : 1300)
    const loanFactor  = refi <= 150000 ? 985 : refi <= 180000 ? 1182 : refi <= 200000 ? 1314 : refi <= 220000 ? 1445 : Math.round(refi * 0.006607)
    const cashflow    = rentEst - loanFactor - 208 - 100
    brrrrResult = { allIn, refi, cashLeftIn, cashflow, label: cashLeftIn < 30000 ? 'GREAT' : cashLeftIn < 60000 ? 'OK' : 'FAILS' }

    const flipAllIn   = pp + reno
    const carryClose  = arv * 0.08
    const netProfit   = arv - flipAllIn - carryClose
    flipResult = { allIn: flipAllIn, netProfit, label: netProfit >= 40000 ? 'STRONG' : netProfit >= 25000 ? 'THIN' : 'FAILS' }

    computedBlock = `
PRE-COMPUTED DEAL MATH (use these exact numbers — do not recalculate):
MAO (75%×ARV−Reno−closing): ${fmt(computedMao)}
Price gap: Ask ${fmt(pp)} vs MAO ${fmt(computedMao)} = ${computedMao ? (((pp - computedMao) / computedMao) * 100).toFixed(1) : '?'}% ${pp <= computedMao ? 'AT/BELOW MAO ✓' : 'ABOVE MAO ✗'}
BRRRR: All-in ${fmt(brrrrResult.allIn)} | Refi ${fmt(brrrrResult.refi)} | Cash left in ${fmt(brrrrResult.cashLeftIn)} → ${brrrrResult.label} | Cash flow ~$${cashflow}/mo
Flip:  All-in ${fmt(flipResult.allIn)} | Net profit ${fmt(flipResult.netProfit)} → ${flipResult.label}`
  }

  const arvLabel = arv != null ? `ARV: ${fmt(arv)} [INVESTOR-PROVIDED]` : 'ARV: Unknown'

  return `${addr} | ${lead.bedrooms || '?'}BR/${lead.bathrooms || '?'}BA | ${sqft || '?'} sqft | ZIP ${lead.zip_code || '?'}
Ask: ${fmt(pp)} | ${arvLabel} | Reno: ${fmt(reno != null ? reno : null)} | Rent: ${fmt(rent)}${computedBlock}
Notes: ${lead.notes || 'None'}

Write all 6 sections now using the deal data above. For DEAL SCORE use the PRE-COMPUTED values above exactly.`
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: HEADERS })

  const body = await req.json().catch(() => ({}))
  const { lead = {} } = body

  if (!lead.address) return new Response(JSON.stringify({ ok: false, error: 'lead.address required' }), { status: 400, headers: HEADERS })
  if (!lead.asking_price) return new Response(JSON.stringify({ ok: false, error: 'NO_ASKING_PRICE' }), { status: 400, headers: HEADERS })

  const abortCtrl = new AbortController()
  const abortTimer = setTimeout(() => abortCtrl.abort(), 22000)

  try {
    let resp
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1300,
          system: SYSTEM_PROMPT,
          messages: [
            { role: 'user',      content: buildPrompt(lead) },
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

    const data = await resp.json()
    const raw = data.content?.[0]?.text?.trim() || ''
    // Prepend the prefill separator — Claude returns only what it added after it
    const notes = '=====================================\n' + raw
    return new Response(JSON.stringify({ ok: true, notes }), { status: 200, headers: HEADERS })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: HEADERS })
  }
}
