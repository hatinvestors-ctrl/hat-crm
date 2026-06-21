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
Strategy:       [BRRRR / Flip / Rental Hold / INSPECTION PLAY / None]
Our ARV:        $[X]
Starting Offer: $[X]  ← opening bid (see Inspection Play note if applicable)
Target Price:   $[X]  ← MAO, makes deal work
Max Walk-Away:  $[X]  ← absolute ceiling; walk cleanly during inspection if seller won't come down
Summary:        [2 sentences — deal viability at MAO, what must be true to close]
[INSPECTION PLAY — include this block ONLY when ALL three conditions are true: (1) ask is 5–15% above MAO, (2) property is older/as-is/shows deferred maintenance that inspection will likely surface, (3) seller shows motivation signals. DO NOT recommend for gaps >20% or well-maintained properties.]
[If Inspection Play applies:]
Inspection Play: YES — offer $[ask price or $X above ask] to secure contract. Target $[X] reduction during 3-day inspection period based on [specific likely findings: roof age/HVAC/plumbing/electrical]. Net target price $[MAO]. Walk cleanly if seller holds above $[MAO + $X buffer]. Risk: [1 sentence on what could go wrong].
[Value-Add Opportunities: ONLY list items below that are genuinely worth doing for THIS specific property. Omit any that don't apply. Never force suggestions.]
[Include ONLY IF 1–2 BR: ] Bedroom Add:  YES — adds ~$[X] ARV, ~$[X] cost (e.g. convert dining room / garage / large closet)
[Include ONLY IF 1 bath: ] Bath Add:     YES — master ensuite adds ~$[X] ARV, ~$[X] cost; moves from 1/1 to 2/1 or 3/2 comp tier
[Include ONLY IF genuinely applicable — garage conversion, covered patio in strong rental ZIP, ADU potential, etc.:] Other Upside: [specific opportunity] — adds ~$[X] ARV or rental value, ~$[X] cost

=====================================
DEAL SCORE
=====================================
Total:              [X]/100
Price Gap:          [X]/25 — [ask vs MAO: % above MAO, closeable or not. Scoring: ≤MAO=25, 1-10% above=20, 11-20%=13, 21-30%=7, >30%=2]
Deal Math:          [X]/25 — [best exit at MAO: BRRRR cash left in $X OR flip net profit $X — whichever scores higher. BRRRR: <$20K=25, $20-35K=20, $35-50K=13, $50-70K=7, >$70K=2. Flip: >$50K=25, $35-50K=20, $20-35K=13, $10-20K=7, <$10K=2]
Cash Flow:          [X]/15 — [monthly income after PITIE at MAO. >$400/mo=15, $250-400=12, $100-250=8, $0-100=4, negative=0]
ZIP Quality:        [X]/15 — [A-tier(32205,32216)=15, B-tier(32210,32244,32211,32218,32219)=10, C-tier(32208,32254,32221)=6, unknown=5. State which tier and why: appreciation trend, rental demand, vacancy]
Seller Motivation:  [X]/10 — [estate/divorce/foreclosure/price drop >15%/as-is=9-10, price drop <15% OR DOM >90=6-8, DOM 30-90 with some signals=4-5, new listing DOM <30 no signals=1-3, institutional/retail=0-1]
ARV Confidence:     [X]/10 — [HIGH(3+ solid recent comps)=10, MEDIUM(2 comps, reasonable)=6, LOW(sparse/wide range/unusual)=2. State what drives the confidence level]
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
[ONLY include this section if CRM historical comps were provided above. This is one of the most important sections — it shows HAT Investors how their own past experience applies to this deal. Be specific and reference actual addresses and numbers from the CRM data.]
[For each past deal that is directly relevant to ARV, reno estimate, or offer strategy, list it:]
COMP: [address], ZIP [X] | [BR/BA] | Ask $[X] | Our ARV $[X] | Reno $[X] | [offered $X / no offer] | Status: [status]
How used: [1-2 sentences — specifically what this deal taught us: did the ARV hold up? did the seller negotiate down? what was the reno outcome? how does it benchmark the current property?]
[List ALL relevant comps from same ZIP first, then nearby ZIPs if useful]
[If we previously offered on a similar property in the same ZIP, call it out explicitly with the offer amount and outcome]
ZIP Pattern: [2-3 sentences — what the FULL CRM history for this ZIP tells us: typical ARV range for similar properties, reno cost patterns, seller motivation patterns, our offer success rate, any red flags or opportunities we've learned from past deals]
Confidence Impact: [1 sentence — does the CRM history INCREASE or DECREASE your confidence in the ARV and offer price for this deal, and why?]

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

  const fields = [
    'address','city','zip_code','bedrooms','bathrooms','sqft',
    'asking_price','arv','conservative_arv','aggressive_arv',
    'renovation_cost','mao','offer_price','rent_estimate',
    'status','notes','ai_notes','deal_analysis','created_at',
  ].join(',')

  const url = `${SUPABASE_URL}/rest/v1/leads?select=${fields}&or=(${zipFilter})&asking_price=not.is.null&order=created_at.desc&limit=30`

  const res = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  if (!res.ok) return []

  const rows = await res.json()
  return (rows || []).filter(r => r.address !== lead.address).slice(0, 15)
}

// Extract the single most useful line from ai_notes for a given field prefix
function extractAILine(aiNotes, prefix) {
  if (!aiNotes) return null
  const m = aiNotes.match(new RegExp(`^${prefix}:\\s*(.+)`, 'im'))
  return m ? m[1].trim().slice(0, 150) : null
}

function buildCompsBlock(comps, currentLead) {
  if (!comps.length) return ''

  const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—'
  const sameZip   = comps.filter(c => c.zip_code === currentLead.zip_code)
  const nearbyZip = comps.filter(c => c.zip_code !== currentLead.zip_code)

  const renderComp = (c) => {
    const size   = [c.bedrooms && `${c.bedrooms}BR`, c.bathrooms && `${c.bathrooms}BA`, c.sqft && `${c.sqft}sqft`].filter(Boolean).join('/')
    const status = (c.status || 'unknown').replace(/_/g, ' ')
    const offer  = c.offer_price ? `offered ${fmt(c.offer_price)}` : 'no offer'
    const arvRange = (c.conservative_arv || c.aggressive_arv)
      ? ` (conservative ${fmt(c.conservative_arv)} — aggressive ${fmt(c.aggressive_arv)})`
      : ''
    const rent = c.rent_estimate ? ` | rent est ${fmt(c.rent_estimate)}/mo` : ''

    let row = `  • ${c.address}, ZIP ${c.zip_code} | ${size} | Ask ${fmt(c.asking_price)} | Our ARV ${fmt(c.arv)}${arvRange} | Reno ${fmt(c.renovation_cost)} | MAO ${fmt(c.mao)}${rent} | ${offer} | Status: ${status}`

    // Pull key conclusions from AI analysis of this past deal
    const verdict  = extractAILine(c.ai_notes, 'Verdict')
    const summary  = extractAILine(c.ai_notes, 'Summary')
    const dealScore = extractAILine(c.ai_notes, 'Total')
    const arvUsed  = extractAILine(c.ai_notes, 'ARV Used')
    const confidence = extractAILine(c.ai_notes, 'Confidence')
    if (verdict)    row += `\n    → Our verdict: ${verdict}`
    if (summary)    row += `\n    → Summary: ${summary}`
    if (dealScore)  row += `\n    → Deal score: ${dealScore}`
    if (arvUsed)    row += `\n    → ARV rationale: ${arvUsed}`
    if (confidence) row += `\n    → ARV confidence: ${confidence}`

    // Agent notes (manual notes logged in CRM)
    if (c.notes?.trim()) row += `\n    → Agent notes: ${c.notes.trim().slice(0, 200).replace(/\n/g, ' ')}`

    // deal_analysis JSON (fast-calc verdict + score)
    if (c.deal_analysis) {
      try {
        const da = typeof c.deal_analysis === 'string' ? JSON.parse(c.deal_analysis) : c.deal_analysis
        if (da.verdict) row += `\n    → Calc verdict: ${da.verdict}${da.score != null ? ` | Score: ${da.score}` : ''}${da.net_profit != null ? ` | Net profit: ${fmt(da.net_profit)}` : ''}`
      } catch {}
    }

    return row
  }

  let block = '\n\n--- HAT CRM HISTORICAL DEALS — LEARN FROM THESE (same ZIP and nearby ZIPs) ---'
  block += '\nThese are real deals HAT Investors has analyzed or worked. Use them to calibrate ARV, reno costs, offer strategy, and ZIP-level patterns.'
  if (sameZip.length) {
    block += `\n\nSAME ZIP (${currentLead.zip_code}) — highest relevance:\n` + sameZip.map(renderComp).join('\n')
  }
  if (nearbyZip.length) {
    block += `\n\nNEARBY ZIPs — secondary reference:\n` + nearbyZip.map(renderComp).join('\n')
  }
  block += `\n\nHOW TO USE THIS DATA:
- ARV calibration: What ARV did we assign to similar BR/BA/sqft properties in this ZIP? Use that as your anchor — don't deviate without a specific reason.
- Reno benchmarks: What did we budget for reno on similar properties? Flag if this property needs more or less.
- Offer patterns: Did we offer on similar properties? At what price relative to ask? What happened?
- ZIP momentum: Are sellers accepting offers? Are properties going under contract, or sitting? What does the status distribution tell you?
- Deal quality trend: Are our scores improving? What deals did we WIN vs PASS and why?
Reference specific past deals by address in the CRM COMPS USED section whenever they're directly relevant.`

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
        max_tokens: 3500,
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
