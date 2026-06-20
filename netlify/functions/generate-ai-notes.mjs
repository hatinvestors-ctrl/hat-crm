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

const SYSTEM_PROMPT = `You are a Jacksonville FL real estate investor writing internal deal notes for HAT Investors. Audience: Tomer (principal) and Kevin (broker). Direct, number-driven, no hedging. One line per field — no extra text.

JAX ARV reference (3/2 renovated): 32208/32219: $160–240K | 32210/32244/32221: $220–320K | 32205/32216: $230–380K | 32211: $155–200K | Clay Co: $200–300K
Adjustments: 2BR −$20K | 4BR +$15K | 1BA −$20K | <1000sqft −$15K
Rent: 2BR $1,200 | 3/2 $1,550 | 4/2 $2,000/mo. BRRRR refi: 70% ARV @6.875%/30yr. Cash left in: <$30K great, >$60K fails. MAO = 0.75×ARV − reno.

Output EXACTLY these 6 sections in order. No markdown. No extra lines. Start immediately.

=====================================
RECOMMENDED ACTION
=====================================
Verdict:        [BUY / PASS / WATCH]
Strategy:       [BRRRR / Flip / Rental Hold / Pass]
Our ARV:        $[X]
Starting Offer: $[X]
Target Price:   $[X]
Max Walk-Away:  $[X]
Why:            [1 sentence — the single most important reason]

=====================================
DEAL SNAPSHOT
=====================================
Profile:    [X]BR/[X]BA | [sqft]sqft | [ZIP] | [property type]
Ask:        $[X] ($[X]/sqft vs ZIP floor ~$[X]/sqft)
Condition:  [Light / Medium / Heavy / Unknown] — [reason in 5 words]
DOM:        [X days / Unknown]
Motivation: [price drop / estate / as-is / unknown — 1 signal]

=====================================
DEAL MATH — THREE SCENARIOS
=====================================
BRRRR:   All-in $[X] | Refi $[X] | Cash left $[X] ([GREAT/OK/FAILS]) | Cash flow $[X]/mo
Flip:    All-in $[X] | Net profit $[X] ([STRONG/THIN/FAILS])
Rental:  All-in $[X] | Rent $[X]/mo | Gross yield [X]%
Best:    [BRRRR / Flip / Rental / None]

=====================================
KEY INSIGHTS & HIDDEN SIGNALS
=====================================
• [most important insight — seller psychology, market timing, or property edge]
• [second insight — negotiation angle or risk]
• [third insight — watch trigger or upside]

=====================================
NEXT ACTION
=====================================
Action:     [CALL TODAY / MAKE OFFER / SCHEDULE WALK / WATCH / PASS]
Offer:      $[X]–$[X] (target $[X])
Walk:       [Required / Not needed / Only if price drops to $X]
Call:       [2 sentences verbatim for Kevin to say]
Follow-up:  [exact trigger]

=====================================
CRM WORKFLOW
=====================================
Set Status:        [new_lead / contacted / offer_sent / negotiating / dead_lead / follow_up]
Make Offer:        [YES — $[X] / NO / NOT YET]
Follow-Up In:      [X days / N/A]
Follow-Up Trigger: [exact condition]
Priority:          [HIGH / MEDIUM / LOW]
Notes for CRM:     [1 sentence]`

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
  let brrrrBlock = ''
  if (pp && arv && reno != null) {
    const hml        = pp * 0.90 + reno
    const allIn      = pp + reno
    const refi       = arv * 0.70
    const cashLeftIn = allIn - refi
    const rentEstimate = rent || (lead.bedrooms >= 4 ? 2000 : lead.bedrooms === 3 ? 1600 : 1300)
    const loanFactor = refi <= 150000 ? 985 : refi <= 180000 ? 1182 : refi <= 200000 ? 1314 : refi <= 220000 ? 1445 : Math.round(refi * 0.006607)
    const cashflow   = rentEstimate - loanFactor - 208 - 100
    brrrrBlock = `
Pre-computed BRRRR numbers (use these — do not recalculate):
  HML loan: ${fmt(hml)}
  All-in (purchase + reno): ${fmt(allIn)}
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

  return `Fill in the 3 required sections for this deal. Be concise — one line per field. No extra text.

${addr} | ${lead.bedrooms || '?'}BR/${lead.bathrooms || '?'}BA | ${lead.sqft || '?'} sqft | ZIP ${lead.zip_code || '?'}
Ask: ${fmt(pp)} | ARV: ${fmt(arv)} | Reno: ${fmt(reno)} | MAO: ${fmt(mao)} | Rent: ${fmt(rent)}${brrrrBlock}${flipBlock}`
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
      body: JSON.stringify({ notes, updated_at: new Date().toISOString() }),
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
    if (!lead.asking_price && !lead.arv) {
      return new Response(JSON.stringify({ ok: false, error: 'lead must have at least asking_price or arv.' }), { status: 400, headers: HEADERS })
    }

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(lead) }],
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
