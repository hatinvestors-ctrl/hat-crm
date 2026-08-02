// Comps analysis — HAT Investors
// Generates: MARKET COMPS, CRM COMPS USED (if CRM data available)
// Fetches historical CRM deals for the same ZIP cluster.
//
// POST /.netlify/functions/generate-comps
// body: { lead: { address, city, state, zip_code, bedrooms, bathrooms, sqft, asking_price, arv, renovation_cost, mao } }
// Returns: { ok, notes: string }

const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY
const SUPABASE_URL       = process.env.SUPABASE_URL  || process.env.VITE_SUPABASE_URL
const SUPABASE_KEY       = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

const SYSTEM_PROMPT = `You are a senior Jacksonville FL real estate investor providing ARV and rental comp analysis for HAT Investors.

JAX ARV benchmarks (fully renovated 3/2):
32208/32219: $160–240K | 32210/32244/32221: $220–320K | 32205/32216: $230–380K | 32211: $155–200K | Clay Co: $200–300K
Adjustments: 2BR −$20K | 4BR +$15K | 1BA only −$20K | <1,000sqft −$15K | CBS/brick +$7K

JAX Rental benchmarks (renovated):
32208/32219: 3/2 $1,350–$1,550 | 32210/32244: 3/2 $1,450–$1,700 | 32205/32216: 3/2 $1,600–$2,000 | 32211: 3/2 $1,300–$1,500
Adjustments: 1BA only −$150/mo | 4BR +$200/mo | <1,000sqft −$100/mo

Write EXACTLY these sections in order. No intro. Start with the first ===== line.
Include CRM COMPS USED only if historical CRM deals were provided — omit entirely if none.

=====================================
MARKET COMPS
=====================================
Conservative ARV: $[X] — [1 line: worst-case comp basis]
Realistic ARV:    $[X] — [1 line: most likely outcome, used for deal math]
Optimistic ARV:   $[X] — [1 line: upside if condition/timing favors]
COMP: [street or area, ZIP] | [BR/BA] | [sqft] sqft | Sold $[X] | $[X]/sqft | [timeframe] | [condition]
Why relevant: [1 sentence]
COMP: [street or area, ZIP] | [BR/BA] | [sqft] sqft | Sold $[X] | $[X]/sqft | [timeframe] | [condition]
Why relevant: [1 sentence]
ARV Conclusion: [1–2 sentences — how comps land on the ARV used, what pushes it higher or lower]

=====================================
RENTAL COMPS
=====================================
Conservative Rent: $[X]/mo — [1 line: low end basis, e.g. 1BA discount, below-avg condition]
Realistic Rent:    $[X]/mo — [1 line: most likely rent for this bed/bath/ZIP post-reno]
Optimistic Rent:   $[X]/mo — [1 line: upside if fully updated, premium finishes]
RENTAL: [area description], ZIP [X] | [BR/BA] | [sqft] sqft | $[X]/mo | [condition/note]
RENTAL: [area description], ZIP [X] | [BR/BA] | [sqft] sqft | $[X]/mo | [condition/note]
1% Rule (rent ÷ all-in cost = purchase+reno, NOT purchase alone): [X]% at ask all-in | [X]% at MAO all-in
Rent Verdict: [STRONG / MEETS THRESHOLD / BELOW THRESHOLD] — [1 sentence on whether rent validates BRRRR strategy]
Cash Flow Range (use pre-computed mortgage from prompt):
At conservative rent: ~$[X]/mo net
At realistic rent:    ~$[X]/mo net
At optimistic rent:   ~$[X]/mo net

=====================================
CRM COMPS USED
=====================================
[Only if CRM deals were provided. For each relevant past deal:]
COMP: [address], ZIP [X] | [BR/BA] | Ask $[X] | Our ARV $[X] | Reno $[X] | [offered $X / no offer] | Status: [status]
How used: [1–2 sentences — what this deal benchmarks for the current property]
ZIP Pattern: [2–3 sentences — ARV range, reno costs, offer success rate in this ZIP]
Confidence Impact: [1 sentence — does CRM history increase or decrease ARV confidence?]`

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

async function fetchComps(lead) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !lead.zip_code) return []
  const zips = ZIP_CLUSTERS[lead.zip_code] || [lead.zip_code]
  const zipFilter = zips.map(z => `zip_code.eq.${z}`).join(',')
  const fields = 'address,city,zip_code,bedrooms,bathrooms,sqft,asking_price,arv,conservative_arv,aggressive_arv,renovation_cost,mao,offer_price,rent_estimate,status,notes,ai_notes,deal_analysis,created_at'
  const url = `${SUPABASE_URL}/rest/v1/leads?select=${fields}&or=(${zipFilter})&asking_price=not.is.null&order=created_at.desc&limit=20`
  try {
    const res = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } })
    if (!res.ok) return []
    const rows = await res.json()
    return (rows || []).filter(r => r.address !== lead.address).slice(0, 8)
  } catch {
    return []
  }
}

function extractAILine(aiNotes, prefix) {
  if (!aiNotes) return null
  const m = aiNotes.match(new RegExp(`^${prefix}:\\s*(.+)`, 'im'))
  return m ? m[1].trim().slice(0, 150) : null
}

function buildCompsBlock(comps, lead) {
  if (!comps.length) return ''
  const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—'
  const sameZip   = comps.filter(c => c.zip_code === lead.zip_code)
  const nearbyZip = comps.filter(c => c.zip_code !== lead.zip_code)

  const renderComp = (c) => {
    const size   = [c.bedrooms && `${c.bedrooms}BR`, c.bathrooms && `${c.bathrooms}BA`, c.sqft && `${c.sqft}sqft`].filter(Boolean).join('/')
    const status = (c.status || 'unknown').replace(/_/g, ' ')
    const offer  = c.offer_price ? `offered ${fmt(c.offer_price)}` : 'no offer'
    let row = `  • ${c.address}, ZIP ${c.zip_code} | ${size} | Ask ${fmt(c.asking_price)} | Our ARV ${fmt(c.arv)} | Reno ${fmt(c.renovation_cost)} | MAO ${fmt(c.mao)} | ${offer} | Status: ${status}`
    const verdict   = extractAILine(c.ai_notes, 'Verdict')
    const summary   = extractAILine(c.ai_notes, 'Summary')
    const dealScore = extractAILine(c.ai_notes, 'Total')
    if (verdict)   row += `\n    → Verdict: ${verdict}`
    if (summary)   row += `\n    → Summary: ${summary}`
    if (dealScore) row += `\n    → Score: ${dealScore}`
    if (c.notes?.trim()) row += `\n    → Notes: ${c.notes.trim().slice(0, 150).replace(/\n/g, ' ')}`
    return row
  }

  let block = '\n\nHAT CRM HISTORICAL DEALS (same ZIP and nearby ZIPs — use to calibrate ARV, reno, offer strategy):'
  if (sameZip.length)   block += `\nSAME ZIP (${lead.zip_code}):\n` + sameZip.map(renderComp).join('\n')
  if (nearbyZip.length) block += `\nNEARBY ZIPs:\n` + nearbyZip.map(renderComp).join('\n')
  return block
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: HEADERS })

  const body = await req.json().catch(() => ({}))
  const { lead = {} } = body

  if (!lead.address) return new Response(JSON.stringify({ ok: false, error: 'lead.address required' }), { status: 400, headers: HEADERS })

  const fmt  = (n) => n != null ? `$${Number(n).toLocaleString()}` : 'Unknown'
  const addr = [lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ')

  const comps = await fetchComps(lead)
  const compsBlock = buildCompsBlock(comps, lead)

  // Pre-compute rental cash flow for AI to use (avoids AI math errors)
  const pp   = lead.asking_price ? Number(lead.asking_price) : null
  const arv  = lead.arv ? Number(lead.arv) : null
  const mao  = lead.mao ? Number(lead.mao) : null
  const refi = arv ? Math.round(arv * 0.70) : null
  const loanFactor = refi
    ? (refi <= 150000 ? 985 : refi <= 180000 ? 1182 : refi <= 200000 ? 1314 : refi <= 220000 ? 1445 : Math.round(refi * 0.006607))
    : null
  const fixedCosts = 208 + 100  // insurance + vacancy approx
  const cfBase = loanFactor ? -(loanFactor + fixedCosts) : null  // rent - this = net cash flow

  const reno    = lead.renovation_cost ? Number(lead.renovation_cost) : null
  const allInPP = pp && reno ? pp + reno : null  // total investment before refi
  const allInMAO = mao && reno ? mao + reno : null

  // 1% rule: CORRECT calculation is rent / total-all-in (purchase + reno), NOT just purchase price
  // Using purchase-price-only overstates the yield on value-add deals
  const oneRuleAsk = (pp && allInPP) ? ((1600 / allInPP) * 100).toFixed(2) : null  // placeholder, AI fills actual rent
  const oneRuleMAO = (mao && allInMAO) ? ((1600 / allInMAO) * 100).toFixed(2) : null

  const rentalMathBlock = (refi && loanFactor) ? `
Pre-computed BRRRR mortgage (use for Cash Flow Range — do not recalculate):
Refi at 70% ARV: ${fmt(refi)} | Monthly payment: $${loanFactor}/mo | Fixed costs (insurance+mgmt): $${fixedCosts}/mo
Net cash flow = Monthly rent − $${loanFactor + fixedCosts}/mo

1% Rule — CRITICAL: calculate as rent / (purchase + reno), NOT rent / purchase alone. Reno is real capital deployed.
All-in at ask: ${fmt(pp)} ask + ${fmt(reno)} reno = ${fmt(allInPP)} total → 1% threshold rent = ${allInPP ? '$' + Math.round(allInPP * 0.01).toLocaleString() : '?'}/mo
All-in at MAO: ${fmt(mao)} MAO + ${fmt(reno)} reno = ${fmt(allInMAO)} total → 1% threshold rent = ${allInMAO ? '$' + Math.round(allInMAO * 0.01).toLocaleString() : '?'}/mo
Use realistic rent estimate to compute actual 1% rule result for both scenarios.` : ''

  const userPrompt = `Property: ${addr} | ${lead.bedrooms || '?'}BR/${lead.bathrooms || '?'}BA | ${lead.sqft || '?'} sqft | ZIP ${lead.zip_code || '?'}
Ask: ${fmt(pp)} | Our ARV: ${fmt(arv)} | Reno: ${fmt(lead.renovation_cost)} | MAO: ${fmt(mao)}${rentalMathBlock}${compsBlock}

Write the MARKET COMPS section, then the RENTAL COMPS section, then CRM COMPS USED if historical data was provided above.`

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
          max_tokens: 1600,
          temperature: 0,
          system: SYSTEM_PROMPT,
          messages: [
            { role: 'user',      content: userPrompt },
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
    const notes = '=====================================\n' + raw
    return new Response(JSON.stringify({ ok: true, notes }), { status: 200, headers: HEADERS })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: HEADERS })
  }
}
