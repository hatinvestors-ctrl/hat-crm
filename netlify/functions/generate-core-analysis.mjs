// Core deal analysis — HAT Investors
// Generates: RECOMMENDED ACTION, DEAL SCORE, DEAL SNAPSHOT, PROS, CONS, CRM WORKFLOW
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

const SYSTEM_PROMPT = `You are a senior Jacksonville FL real estate investor writing internal deal notes for HAT Investors. Audience: Tomer Carmelli (principal) and Kevin Bachman (acquisition broker). Be declarative, number-driven, opinionated. No hedging.

JAX ARV (3/2 renovated): 32208/32219 $160–240K | 32210/32244/32221 $220–320K | 32205/32216 $230–380K | 32211 $155–200K | Clay Co $200–300K
Adjustments: 2BR −$20K | 4BR +$15K | 1BA only −$20K | <1,000sqft −$15K | CBS/brick +$7K
Rent: 2BR $1,200 | 3/2 $1,550 | 4/2 $2,000/mo
BRRRR: HML = 90% purchase + 100% reno @ 12%/yr | HML costs = 2% points + $1,500 fees + 12%/yr × 5.5mo avg | Refi = 70% ARV @ 6.875%/30yr | Cash left in <$30K great, $30–60K ok, >$60K fails
Flip carry+close = 8% ARV. MAO = 0.75 × ARV − reno.

Write EXACTLY these 6 sections in order. No markdown headers. No intro. Start immediately with the first ===== line.

=====================================
RECOMMENDED ACTION
=====================================
Verdict:        [EXACTLY one: BUY NOW / OFFER & NEGOTIATE / WATCH / DEAD LEAD]
At Ask:         [WORKS / FAILS / MARGINAL] — [one line why]
At MAO:         [WORKS / FAILS / MARGINAL] — [one line why]
Gap:            $[X] off ask to reach MAO ([X]% reduction needed)
Strategy:       [BRRRR / Flip / Rental Hold / INSPECTION PLAY / None]
Our ARV:        $[X]
Starting Offer: $[X]
Target Price:   $[X]
Max Walk-Away:  $[X]
Summary:        [2 sentences — deal viability at MAO, what must be true to close]
[INSPECTION PLAY — include ONLY when: ask is 5–15% above MAO AND property is older/as-is AND seller shows motivation. Skip entirely otherwise.]
[Value-Add — include ONLY if genuinely applicable for THIS property. Omit any that don't apply.]
[Include ONLY IF 1–2 BR: ] Bedroom Add:  YES — adds ~$[X] ARV, ~$[X] cost
[Include ONLY IF 1 bath: ] Bath Add:     YES — master ensuite adds ~$[X] ARV, ~$[X] cost
[Include ONLY IF genuinely applicable:] Other Upside: [specific opportunity] — adds ~$[X] ARV or rental value, ~$[X] cost

=====================================
DEAL SCORE
=====================================
Total:              [X]/100
Price Gap:          [X]/20 — [ask vs MAO: % above MAO. Scoring: ≤MAO=20, 1-10% above=16, 11-20%=10, 21-30%=5, >30%=1]
Deal Math:          [X]/25 — [BRRRR cash left in $X OR flip net profit $X. BRRRR: <$20K=25, $20-35K=20, $35-50K=13, $50-70K=7, >$70K=2. Flip: >$50K=25, $35-50K=20, $20-35K=13, $10-20K=7, <$10K=2. No ARV→cap 7. No reno→cap 7.]
Cash Flow:          [X]/10 — [monthly after PITIE at MAO. >$400=10, $250-400=8, $100-250=5, $0-100=2, neg=0. No rent+ARV→cap 2]
ZIP Quality:        [X]/15 — [A(32205,32216)=15, B(32210,32244,32211,32218,32219)=10, C(32208,32254,32221)=6, unknown=5]
Seller Motivation:  [X]/20 — [estate/probate/divorce/foreclosure=+7, price drop >15%=+6, as-is signals=+4, DOM>90=+5, DOM 60-90=+3, DOM 30-60=+1, new listing=0, institutional seller=-3. Cap 20. No signals→cap 6]
ARV Confidence:     [X]/10 — [HIGH(3+ comps)=10, MEDIUM(2)=6, LOW(sparse)=2. No ARV provided→2]
Verdict:            [EXCEPTIONAL ≥80 / STRONG 65–79 / WATCH 45–64 / MARGINAL 25–44 / DEAD <25]

=====================================
DEAL SNAPSHOT
=====================================
Profile:    [X]BR/[X]BA | [sqft] sqft | ZIP [X] | [property type]
Ask:        $[X] | $[X]/sqft ([below/at/above] ZIP investor floor ~$[X]/sqft)
Condition:  [Light cosmetic / Medium / Heavy / Unknown] — [1 line reason]
DOM:        [X days / Unknown] | Price history: [drop of $X / no change / unknown]
Motivation: [estate / price drop / as-is / tired landlord / unknown]
HOA:        [None / $X/mo / Unknown]

=====================================
PROS — WHY THIS DEAL IS INTERESTING
=====================================
1. [market/zip signal with specific number]
2. [seller motivation or price positioning signal]
3. [property upside — construction, layout, lot, bedroom add potential]

=====================================
CONS — RISKS AND RED FLAGS
=====================================
1. [price or spread risk with numbers]
2. [property or condition risk]
3. [market or exit risk]

=====================================
CRM WORKFLOW
=====================================
Set Status: [new_lead / contacted / offer_sent / negotiating / dead_lead / follow_up]
Make Offer: [YES — $[X] / NO / NOT YET]
Priority:   [HIGH — act today / MEDIUM — this week / LOW — watch]`

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

  let brrrrBlock = ''
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
    brrrrBlock = `\nBRRRR: HML ${fmt(hml)} | HML costs ${fmt(hmlCosts)} (${fmt(hmlPoints)} pts + $1,500 fees + ${fmt(hmlInterest)} interest) | All-in ${fmt(allIn)} | Refi ${fmt(refi)} | Cash left in ${fmt(cashLeftIn)} (${cashLeftIn < 30000 ? 'GREAT' : cashLeftIn < 60000 ? 'OK' : 'FAILS'}) | Cash flow ~$${cashflow}/mo`
  }

  let flipBlock = ''
  if (pp && arv && reno != null) {
    const allIn      = pp + reno
    const grossProfit = arv - allIn
    const carryClose = arv * 0.08
    const netProfit  = grossProfit - carryClose
    flipBlock = `\nFlip: All-in ${fmt(allIn)} | Net profit ${fmt(netProfit)} (${netProfit >= 40000 ? 'STRONG' : netProfit >= 25000 ? 'THIN' : 'FAILS'})`
  }

  return `${addr} | ${lead.bedrooms || '?'}BR/${lead.bathrooms || '?'}BA | ${sqft || '?'} sqft | ZIP ${lead.zip_code || '?'}
Ask: ${fmt(pp)} | MAO: ${fmt(mao)} | ARV: ${fmt(arv)} | Reno: ${fmt(reno)} | Rent est: ${fmt(rent)}${brrrrBlock}${flipBlock}
Notes: ${lead.notes || 'None'}

Write all 6 sections using the deal data above.`
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
          max_tokens: 1200,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildPrompt(lead) }],
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
    const notes = data.content?.[0]?.text?.trim() || ''
    return new Response(JSON.stringify({ ok: true, notes }), { status: 200, headers: HEADERS })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: HEADERS })
  }
}
