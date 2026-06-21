// AI investor notes generator — HAT Investors
//
// POST /.netlify/functions/generate-ai-notes
// body: { lead_id, lead: { address, city, state, zip_code, bedrooms, bathrooms, sqft,
//           asking_price, arv, conservative_arv, aggressive_arv, renovation_cost, mao,
//           rent_estimate, property_type, notes } }
//
// Returns: { ok, notes: string }
// Also saves generated notes to leads.notes in Supabase.
//
// Required env vars: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const SUPABASE_URL      = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

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
BRRRR: HML = 90% purchase + 100% reno @ 12%/yr | HML costs = 2% points + $1,500 fees + 12%/yr interest × 5.5mo avg | True all-in = purchase + reno + HML costs | Refi = 70% ARV @ 6.875%/30yr | Cash left in <$30K great, $30–60K ok, >$60K fails
Flip carry+close = 8% ARV. MAO = 0.75 × ARV − reno.

Write EXACTLY these sections in this order. No markdown headers (##). No intro. Start immediately with the first ===== line.
Include the CRM COMPS USED section ONLY if historical CRM comps were provided. Omit it entirely if no comps were given.
Deal Score scoring rules: score each sub-category honestly based on the numbers. Total must equal sum of sub-scores.

=====================================
RECOMMENDED ACTION
=====================================
Verdict:        [use EXACTLY one of these 4 options:]
                BUY NOW — ask is at or below MAO, deal works today, move fast
                OFFER & NEGOTIATE — ask is above MAO but gap is closeable (<25% off); make offer at MAO, let seller decide
                WATCH — gap too wide (>25%) OR numbers marginal; log it, set follow-up, re-engage if price drops
                DEAD LEAD — fundamentals broken at any realistic price (flood zone, title issues, teardown economics)
At Ask:         [WORKS / FAILS / MARGINAL] — [one line why: spread, cash left in, cash flow]
At MAO:         [WORKS / FAILS / MARGINAL] — [one line why]
Gap:            $[X] off ask to reach MAO ([X]% reduction needed)
Strategy:       [BRRRR / Flip / Rental Hold / None]
Our ARV:        $[X]
Starting Offer: $[X]  ← opening ask (can walk if rejected)
Target Price:   $[X]  ← MAO, makes deal work
Max Walk-Away:  $[X]  ← absolute ceiling
Summary:        [2 sentences — deal viability at MAO, what must be true to close]
[Value-Add Opportunities: ONLY list items below that are genuinely worth doing for THIS specific property. Omit any that don't apply. Never force suggestions.]
[Include ONLY IF 1–2 BR: ] Bedroom Add:  YES — adds ~$[X] ARV, ~$[X] cost (e.g. convert dining room / garage / large closet)
[Include ONLY IF 1 bath: ] Bath Add:     YES — master ensuite adds ~$[X] ARV, ~$[X] cost; moves from 1/1 to 2/1 or 3/2 comp tier
[Include ONLY IF genuinely applicable — garage conversion, covered patio in strong rental ZIP, ADU potential, etc.:] Other Upside: [specific opportunity] — adds ~$[X] ARV or rental value, ~$[X] cost

=====================================
DEAL SCORE
=====================================
Total:               [X]/100
Spread Quality:      [X]/25 — [one line: how close is ask to MAO, is gap closeable]
BRRRR Math:          [X]/25 — [one line: cash left in at MAO, EXCELLENT/ACCEPTABLE/FAILS]
Cash Flow:           [X]/20 — [one line: monthly cash flow at MAO, positive/negative/marginal]
Market Confidence:   [X]/20 — [one line: ARV confidence based on comps and ZIP knowledge]
Negotiation Position:[X]/10 — [one line: motivation signals, DOM, price history, gap size]
Verdict:             [STRONG ≥75 / SOLID 55–74 / MARGINAL 35–54 / WEAK <35]

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
ARV ANALYSIS & COMP SUPPORT
=====================================
ARV Used:       $[X]
ZIP Benchmark:  [what 3/2 renovated sells for in this ZIP and why]
Adjustments:    [list each: beds, baths, sqft, construction — with $ impact]
Confidence:     [HIGH / MEDIUM / LOW] — [reason in 1 sentence]
Watch if wrong: [what would change the ARV and by how much]

=====================================
MARKET COMPS
=====================================
[Always include at least 2 real sold comps that justify the ARV. Use your JAX market knowledge. Format each as:]
COMP: [street name or area, e.g. "Mango Ave, 32208"] | [BR/BA] | [sqft] sqft | Sold $[X] | $[X]/sqft | [timeframe, e.g. "sold 3 months ago"] | [condition: renovated / cosmetic / as-is]
Why relevant: [1 sentence — how this comp supports or adjusts the ARV for THIS property]
ARV Conclusion: [1–2 sentences — how the comps together land on the ARV used, what would push it higher or lower]

=====================================
CRM COMPS USED
=====================================
[ONLY include this section if CRM historical comps were provided above. List each relevant comp used to inform the ARV and offer strategy. Format each as:]
COMP: [address], ZIP [X] | [BR/BA] | Ask $[X] | ARV $[X] | Reno $[X] | [offered $X / no offer] | Status: [status]
How used: [1 sentence — what this comp told you about ARV, reno, or offer price for THIS property]
[If we previously offered on a similar property in the same ZIP, call it out explicitly.]
Overall: [1-2 sentences — what the CRM history tells us collectively about this ZIP and deal type]

=====================================
DEAL MATH — THREE SCENARIOS
=====================================
BRRRR:  HML $[X] | HML costs $[X] (points + fees + interest) | True all-in $[X] | Refi $[X] | Cash left $[X] ([GREAT/OK/FAILS]) | Rent $[X] − P&I $[X] − exp $308 = $[X]/mo cash flow
Flip:   All-in $[X] | ARV $[X] | Carry+close $[X] | Net profit $[X] ([STRONG ≥$40K / THIN / FAILS])
Rental: All-in $[X] | Rent $[X]/mo | Gross yield [X]% | Cap rate [X]%
Verdict: [which scenario works and why in 1 sentence, or why none work]

=====================================
PROS — WHY THIS DEAL IS INTERESTING
=====================================
1. [market/zip signal with specific number]
2. [seller motivation or price positioning signal]
3. [property upside — construction, layout, lot, bedroom add potential]
4. [negotiation or competitive advantage]

=====================================
CONS — RISKS AND RED FLAGS
=====================================
1. [price or spread risk with numbers]
2. [property or condition risk]
3. [market or exit risk]
4. [financial risk — cash in, reno overrun, financing]

=====================================
NEXT ACTION
=====================================
Action:      [CALL TODAY / MAKE OFFER / SCHEDULE WALK / WATCH / PASS]
Offer range: $[X]–$[X]  (target $[X])
Walk:        [Required / Not needed / Only if price drops to $X]
Agent call:  [3 sentences verbatim — what Tomer or Kevin says on the phone]
Follow-up:   [exact condition or date — never "check back later"]
If pass:     [exact price or condition that would change this to a BUY]

=====================================
CRM WORKFLOW
=====================================
Set Status:        [new_lead / contacted / offer_sent / negotiating / dead_lead / follow_up]
Make Offer:        [YES — $[X] / NO / NOT YET]
Offer Amount:      $[X]  (if Make Offer = YES)
Follow-Up In:      [X days / N/A]
Follow-Up Trigger: [exact condition to re-check]
Priority:          [HIGH — act today / MEDIUM — this week / LOW — watch]
Notes for CRM:     [1-2 sentences to log — specific, actionable, written as Tomer would write it]`

function buildUserPrompt(lead) {
  const addr = [lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ')
  const fmt  = (n) => n != null ? `$${Number(n).toLocaleString()}` : 'Unknown'
  const num  = (n) => n != null ? Number(n) : null

  const pp   = num(lead.asking_price)
  const arv  = num(lead.arv)
  const reno = num(lead.renovation_cost)
  const rent = num(lead.rent_estimate)
  const mao  = num(lead.mao)
  const sqft = num(lead.sqft)
  const ppsf = pp && sqft ? Math.round(pp / sqft) : null

  // Pre-compute BRRRR scenario so Claude has exact numbers
  // HML costs: 2% origination points + $1,500 lender fees + 12%/yr interest over 5.5 months avg hold
  let brrrrBlock = ''
  if (pp && arv && reno != null) {
    const hml         = pp * 0.90 + reno          // 90% purchase + 100% reno
    const hmlPoints   = Math.round(hml * 0.02)    // 2% origination points
    const hmlFees     = 1500                       // flat lender fees
    const hmlInterest = Math.round(hml * 0.12 * (5.5 / 12))  // 12%/yr × 5.5 months
    const hmlCosts    = hmlPoints + hmlFees + hmlInterest
    const allIn       = pp + reno + hmlCosts       // true all-in including HML carry
    const refi        = arv * 0.70
    const cashLeftIn  = allIn - refi
    const rentEstimate = rent || (lead.bedrooms >= 4 ? 2000 : lead.bedrooms === 3 ? 1600 : 1300)
    const loanFactor  = refi <= 150000 ? 985 : refi <= 180000 ? 1182 : refi <= 200000 ? 1314 : refi <= 220000 ? 1445 : Math.round(refi * 0.006607)
    const cashflow    = rentEstimate - loanFactor - 208 - 100
    brrrrBlock = `
Pre-computed BRRRR numbers (use these — do not recalculate):
  HML loan: ${fmt(hml)}
  HML costs breakdown: ${fmt(hmlPoints)} points (2%) + $1,500 fees + ${fmt(hmlInterest)} interest (12%/yr × 5.5mo) = ${fmt(hmlCosts)} total HML carry
  True all-in (purchase + reno + HML costs): ${fmt(allIn)}
  Refi (70% ARV): ${fmt(refi)}
  Cash left in: ${fmt(cashLeftIn)} (${cashLeftIn < 30000 ? 'EXCELLENT' : cashLeftIn < 60000 ? 'ACCEPTABLE' : 'HIGH — BRRRR FAILS'})
  Refi P&I: ~$${loanFactor}/mo
  Est. monthly cash flow (rent $${rentEstimate} - P&I $${loanFactor} - taxes $208 - ins $100): $${cashflow}/mo`
  }

  // Pre-compute Flip scenario
  let flipBlock = ''
  if (pp && arv && reno != null) {
    const allIn      = pp + reno
    const grossProfit = arv - allIn
    const carryClose = arv * 0.08
    const netProfit  = grossProfit - carryClose
    flipBlock = `
Pre-computed Flip numbers (use these — do not recalculate):
  All-in (purchase + reno): ${fmt(allIn)}
  Gross profit (ARV - all-in): ${fmt(grossProfit)}
  Carry + close (8% ARV): ${fmt(carryClose)}
  Net flip profit: ${fmt(netProfit)} (${netProfit >= 40000 ? 'STRONG' : netProfit >= 25000 ? 'THIN' : 'FAILS'})`
  }

  return `Generate investor notes for this property. All analysis is based on the SELLER'S ASKING PRICE of ${fmt(pp)} — evaluate whether this deal works at what the seller is asking, then recommend what we should offer.

${addr} | ${lead.bedrooms || '?'}BR/${lead.bathrooms || '?'}BA | ${lead.sqft || '?'} sqft | ZIP ${lead.zip_code || '?'}
Seller Ask: ${fmt(pp)} (this is the price being analyzed) | Our MAO: ${fmt(mao)} | ARV: ${fmt(arv)} | Reno: ${fmt(reno)} | Rent estimate: ${fmt(rent)}${brrrrBlock}${flipBlock}`
}

// JAX ZIP clusters — used to find "nearby" comps when same ZIP has <2 results
const ZIP_CLUSTERS = {
  '32208': ['32208','32219','32218'],
  '32219': ['32219','32208','32218'],
  '32218': ['32218','32208','32219'],
  '32210': ['32210','32244','32221'],
  '32244': ['32244','32210','32221'],
  '32221': ['32221','32210','32244'],
  '32205': ['32205','32216','32254'],
  '32216': ['32216','32205','32211'],
  '32211': ['32211','32216','32205'],
  '32254': ['32254','32205','32210'],
}

async function fetchComparableLeads(lead) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !lead.zip_code) return []

  const zips = ZIP_CLUSTERS[lead.zip_code] || [lead.zip_code]
  const zipFilter = zips.map(z => `zip_code.eq.${z}`).join(',')

  // Exclude current lead; fetch leads with enough data to be useful
  const url = `${SUPABASE_URL}/rest/v1/leads?select=address,city,zip_code,bedrooms,bathrooms,sqft,asking_price,arv,renovation_cost,mao,offer_price,status,notes&or=(${zipFilter})&asking_price=not.is.null&order=created_at.desc&limit=20`

  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  })
  if (!res.ok) return []

  const rows = await res.json()
  // Exclude the current lead itself
  return (rows || []).filter(r => r.address !== lead.address).slice(0, 10)
}

function buildCompsBlock(comps, currentLead) {
  if (!comps.length) return ''

  const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—'

  // Separate same-ZIP from nearby-ZIP
  const sameZip  = comps.filter(c => c.zip_code === currentLead.zip_code)
  const nearbyZip = comps.filter(c => c.zip_code !== currentLead.zip_code)

  const renderRow = (c) => {
    const br     = c.bedrooms  ? `${c.bedrooms}BR` : ''
    const ba     = c.bathrooms ? `${c.bathrooms}BA` : ''
    const sqft   = c.sqft      ? `${c.sqft}sqft`   : ''
    const size   = [br, ba, sqft].filter(Boolean).join('/')
    const ask    = fmt(c.asking_price)
    const arv    = fmt(c.arv)
    const reno   = fmt(c.renovation_cost)
    const offer  = c.offer_price ? `offered ${fmt(c.offer_price)}` : 'no offer recorded'
    const status = c.status ? c.status.replace(/_/g, ' ') : 'unknown'
    return `  • ${c.address}, ZIP ${c.zip_code} | ${size} | Ask ${ask} | ARV ${arv} | Reno ${reno} | ${offer} | Status: ${status}`
  }

  let block = '\n\n--- HAT CRM HISTORICAL COMPS (learn from these, reference in your analysis) ---'
  if (sameZip.length) {
    block += `\nSame ZIP (${currentLead.zip_code}):\n` + sameZip.map(renderRow).join('\n')
  }
  if (nearbyZip.length) {
    block += `\nNearby ZIPs:\n` + nearbyZip.map(renderRow).join('\n')
  }
  block += '\nUse these to calibrate ARV, validate reno estimates, and reference prior offer strategy. If we offered on a similar property, note it explicitly in your analysis.'
  return block
}

async function saveNotes(leadId, notes) {
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
      body: JSON.stringify({ ai_notes: notes, updated_at: new Date().toISOString() }),
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
    const body    = await req.json().catch(() => ({}))
    const { lead_id, lead, skip_save = false } = body

    if (!lead) {
      return new Response(JSON.stringify({ ok: false, error: 'lead object is required.' }), { status: 400, headers: HEADERS })
    }
    if (!lead.asking_price) {
      return new Response(JSON.stringify({ ok: false, error: 'NO_ASKING_PRICE' }), { status: 400, headers: HEADERS })
    }

    // Fetch CRM historical comps in parallel with nothing else — fast Supabase query
    const comps = await fetchComparableLeads(lead).catch(() => [])
    const userPrompt = buildUserPrompt(lead) + buildCompsBlock(comps, lead)

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      throw new Error(`Claude API error ${claudeRes.status}: ${errText}`)
    }

    const claudeData = await claudeRes.json()
    const notes = claudeData.content?.[0]?.text?.trim() || ''

    if (!notes) throw new Error('Claude returned empty notes.')

    if (!skip_save && lead_id) {
      if (!SUPABASE_URL || !SUPABASE_KEY) {
        return new Response(JSON.stringify({ ok: false, error: 'Supabase credentials not configured.' }), { status: 500, headers: HEADERS })
      }
      await saveNotes(lead_id, notes)
    }

    return new Response(JSON.stringify({ ok: true, notes }), { status: 200, headers: HEADERS })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500, headers: HEADERS })
  }
}
