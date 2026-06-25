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

const SYSTEM_PROMPT = `You are a senior Jacksonville FL real estate investor providing ARV comp analysis for HAT Investors.

JAX ARV benchmarks (fully renovated 3/2):
32208/32219: $160–240K | 32210/32244/32221: $220–320K | 32205/32216: $230–380K | 32211: $155–200K | Clay Co: $200–300K
Adjustments: 2BR −$20K | 4BR +$15K | 1BA only −$20K | <1,000sqft −$15K | CBS/brick +$7K

Write EXACTLY these sections. No intro. Start with the first ===== line.
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

  const userPrompt = `Property: ${addr} | ${lead.bedrooms || '?'}BR/${lead.bathrooms || '?'}BA | ${lead.sqft || '?'} sqft | ZIP ${lead.zip_code || '?'}
Ask: ${fmt(lead.asking_price)} | Our ARV: ${fmt(lead.arv)} | Reno: ${fmt(lead.renovation_cost)} | MAO: ${fmt(lead.mao)}${compsBlock}

Write the MARKET COMPS section (and CRM COMPS USED if historical data was provided above).`

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
          max_tokens: 800,
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
