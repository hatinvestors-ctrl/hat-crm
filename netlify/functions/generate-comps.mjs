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

// Pre-demo consistency & AI-authority fix (Part 8-11) — audit finding:
// this prompt previously asked the model to write its own "Conservative/
// Realistic/Optimistic ARV" and a CRM "Confidence Impact" line that could
// (and, on 8054 Paschal Street, DID) recommend an independent ARV
// ($185K realistic vs. canonical $220K) and an independent acquisition
// ceiling ("MAO ≤ $95–105K" vs. canonical Max Buy ~$113,528) — two
// numbers competing with the canonical engine's authoritative output.
// The canonical ARV/Max Buy are now passed to the model explicitly (see
// CANONICAL FINANCIALS in the user prompt below) with an explicit
// authority contract, and the template itself no longer has a slot for a
// second point-estimate ARV or a second acquisition ceiling — only an
// evidence-agreement/conflict read against the canonical numbers.
// Exported (additive only, no behavior change) so the canonical authority
// contract (Part 8-11) is directly unit-testable without a live LLM call —
// same pattern as generate-core-analysis.mjs's SYSTEM_PROMPT export.
export const SYSTEM_PROMPT = `You are a senior Jacksonville FL real estate investor providing market-evidence context for HAT Investors' underwriting.

CANONICAL AUTHORITY CONTRACT — READ FIRST:
The CANONICAL FINANCIALS block in the prompt (ARV, Max Buy, Projected Profit) is authoritative. Copy those numbers exactly wherever you reference them. Do NOT calculate, restate, or imply a different ARV. Do NOT calculate, restate, or imply a different Max Buy / MAO / acquisition ceiling. Your job is to explain, contextualize, and identify evidence that AGREES or CONFLICTS with the canonical numbers — never to produce a second, competing valuation. If market evidence conflicts with the canonical ARV, say so as a review flag ("Available market context does not strongly support the current $[canonical ARV] ARV — additional comp validation is recommended"), never as a replacement number.

JAX ARV benchmarks (fully renovated 3/2, for evidence context only — NOT a substitute for the canonical ARV above):
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
Market Range (evidence context, not a replacement ARV): $[low]–$[high] — [1 line: what basis, e.g. ZIP benchmark + bed/bath adjustments]
COMP: [street or area, ZIP] | [BR/BA] | [sqft] sqft | Sold $[X] | $[X]/sqft | [timeframe] | [condition]
Why relevant: [1 sentence]
COMP: [street or area, ZIP] | [BR/BA] | [sqft] sqft | Sold $[X] | $[X]/sqft | [timeframe] | [condition]
Why relevant: [1 sentence]
Evidence Read: [1–2 sentences — does this market evidence AGREE with, or CONFLICT with, the canonical ARV supplied? If it conflicts, phrase it as a review flag, per the Authority Contract above — never as a replacement ARV.]

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
COMP: [address], ZIP [X] | [BR/BA] | Ask $[X] | Prior HAT ARV Estimate $[X] | Reno $[X] | [offered $X / no offer] | Status: [status]
How used: [1–2 sentences — what this deal benchmarks for the current property. A past lead's stored ARV is HAT's own prior ESTIMATE, not a verified closed sale — never call it a "comp" or "sold" price.]
ZIP Pattern: [2–3 sentences — prior ARV estimates and asking-price range seen in this ZIP, reno costs, offer outcomes. Label asking prices as asking prices, not sales.]
Market Context: [1 sentence — does this internal HAT history AGREE with or CONFLICT WITH the canonical ARV supplied? Never state that it "increases confidence" to a specific dollar figure, and never recommend an alternate acquisition ceiling/MAO — the canonical Max Buy already supplied is authoritative.]`

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
    // Part 13 — labeled "Prior HAT ARV Estimate", never "Our ARV"/"comp",
    // so it can't be read as a verified sale for this different property.
    let row = `  • ${c.address}, ZIP ${c.zip_code} | ${size} | Ask ${fmt(c.asking_price)} | Prior HAT ARV Estimate ${fmt(c.arv)} | Reno ${fmt(c.renovation_cost)} | MAO ${fmt(c.mao)} | ${offer} | Status: ${status}`
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
Ask: ${fmt(pp)}

CANONICAL FINANCIALS (authoritative — copy exactly, do not recalculate or restate as a different number):
ARV: ${fmt(arv)}
Max Buy (MAO): ${fmt(mao)}
Renovation Budget: ${fmt(lead.renovation_cost)}${rentalMathBlock}${compsBlock}

Write the MARKET COMPS section, then the RENTAL COMPS section, then CRM COMPS USED if historical data was provided above. Every reference to "the ARV" or "Max Buy" in your output must use the CANONICAL FINANCIALS values above exactly.`

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
