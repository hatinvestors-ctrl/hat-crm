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

const SYSTEM_PROMPT = `You are a senior Jacksonville, Florida real estate investor writing internal deal notes for HAT Investors / OHTC Investments.

Your audience: Tomer Carmelli (principal) and Kevin Bachman (acquisition broker). They make buy/pass decisions in 30 seconds using your notes. Be declarative, number-driven, and opinionated. No hedging. No "might" or "could potentially." Write like you own the deal.

## Market Knowledge — Jacksonville, FL

ZIP ARV benchmarks (3/2 post-reno):
- 32208, 32219: $160K–$240K
- 32210, 32244, 32221, 32222: $220K–$320K
- 32205, 32216, 32218: $230K–$380K
- 32207, 32204: $200K–$350K
- Clay County (32073, 32065, 32068): $200K–$300K
- 32211 (Arlington): $155K–$200K
- Other JAX metro: estimate from nearest ZIP band

ARV adjustments from 3/2 base:
- 2BR: −$15–25K | 4BR: +$10–20K | 1BA only: −$20K | CBS/brick: +$5–10K
- 1,800sqft+: +$10–15K | Under 1,000sqft: −$10–20K

Reno by condition:
- Move-in ready: $0–5K | Light cosmetic: $20–35K | Medium (kitchen+baths+flooring): $40–65K
- Heavy (gut/roof/HVAC): $70–110K | Unknown: assume $50K and flag

Price/sqft benchmarks:
- 32208/32219: investor <$120/sqft | retail >$160/sqft
- 32210/32244/32221/32222: investor <$150/sqft | retail >$190/sqft
- 32205/32207/32216: investor <$170/sqft | retail >$210/sqft

JAX rent estimates:
- 2BR SFR: $1,100–$1,350/mo | 3/2 <1,400sqft: $1,400–$1,700/mo
- 3/2 1,400–1,800sqft: $1,600–$1,900/mo | 4/2: $1,800–$2,200/mo | 4/3 renovated: $2,200–$2,800/mo

HML terms (Rob @ 3 Shacks Capital Partners):
- 90% of purchase + 100% of reno | 12% annual interest-only | 2% origination + $500 + $150 + $200

BRRRR refi: 70% ARV | 6.875% / 30yr | $150K→$985/mo | $180K→$1,182/mo | $200K→$1,314/mo | $220K→$1,445/mo
Target cash left in: <$30K excellent / $30–60K acceptable / >$60K BRRRR fails

Flip carry+close: 8% of ARV (3% agent + 2% closing + 3% holding)

MAO formula: 0.75 × ARV − renovation cost

## Output Format — REQUIRED, every section, no exceptions

Write ONLY the plain text notes — no JSON, no markdown headers with ##, no intro sentence. Start directly with the first section header.

=====================================
DEAL SNAPSHOT
=====================================
Address:    [full address + ZIP]
Profile:    [X]BR / [X]BA / [X sqft] | [property type] | [year if known, else omit]
Ask:        $[X] | Price/sqft: $[X]/sqft ([below/at/above] ZIP investor floor of ~$[X]/sqft)
DOM:        [X days | Unknown]
Condition:  [Move-in ready / Light / Medium / Heavy / Unknown] — [reason]
Lot:        [X sqft | Unknown] | HOA: [None / $X/mo / Unknown]

=====================================
ARV ANALYSIS & COMP SUPPORT
=====================================
ARV Used:      $[X] (Conservative $[X] | Base $[X] | Aggressive $[X])
ZIP Benchmark: [describe the ZIP band and what drives ARV here]
Adjustments:   [list each adjustment: beds, baths, sqft, construction, condition]
Comp reasoning: [2-3 sentences: why this ARV is correct for this specific property.
  Reference the ZIP price band, this property vs typical comps, condition, upside/cap.]
ARV Confidence: [HIGH / MEDIUM / LOW] — [reason]

=====================================
OPPORTUNITY SCORE & CONFIDENCE
=====================================
Score:        [X]/100 | Priority: [HIGH / MEDIUM / LOW / WATCH]
Score drivers:
  [+X pts each signal — list each one that applies]
Deal Confidence: [HIGH / MEDIUM / LOW] — [XX%]
  [Explain in 1-2 sentences]

=====================================
DEAL MATH — THREE SCENARIOS
=====================================
ARV:         Conservative $[X] | Base $[X] | Aggressive $[X]
Reno est:    $[X]–$[X] ([Light/Medium/Heavy])
MAO:         $[X]  (= 0.75 x $[ARV] - $[reno])
Gross spread at ask: $[ARV-ask] | Net after reno: $[ARV-ask-reno]

SCENARIO A: BRRRR
Purchase:        $[X]
HML (90% PP + 100% reno): ~$[X]
Reno: $[X]
All-in: ~$[X]
ARV: ~$[X]
Refi (70% ARV): ~$[X]
Cash left in: ~$[X] — [EXCELLENT <$30K / ACCEPTABLE $30-60K / HIGH >$60K]
Monthly rent: ~$[X]/mo
Monthly P&I ($[loan] @ 6.875%/30yr): ~$[X]/mo
Monthly cash flow: ~$[X]/mo gross
Verdict: [STRONG BRRRR / ACCEPTABLE BRRRR / BRRRR FAILS] — [1 sentence why]

SCENARIO B: FLIP
Purchase + reno all-in: ~$[X]
ARV: ~$[X]
Gross profit: ~$[X]
Carry + close (8% x ARV): ~$[X]
Net flip profit: ~$[X]
ROI: ~[X]% | Timeline: ~[X]-[X] months
Verdict: [STRONG FLIP / THIN FLIP / FLIP FAILS] — [1 sentence why]

SCENARIO C: RENTAL HOLD
Purchase: $[X] | Reno to rent-ready: $[X]
Monthly rent: ~$[X]/mo
Annual gross: ~$[X]
Gross yield: ~[X]%
Cap rate (40% expense ratio): ~[X]%
Verdict: [STRONG RENTAL / WEAK RENTAL / RENTAL FAILS] — [1 sentence why]

=====================================
PROS — WHY THIS DEAL IS INTERESTING
=====================================
[3-5 numbered bullets. Each must cite a specific number or signal. Examples:]
1. [ZIP/MARKET SIGNAL] — [specific: price band, liquidity, investor demand, comparable exits]
2. [MOTIVATION SIGNAL] — [DOM, price drops, back on market, as-is, estate, etc.]
3. [PROPERTY UPSIDE] — [bath add, bonus room, lot size, CBS premium, layout potential]
4. [PRICE POSITIONING] — [$X/sqft vs ZIP avg — quantify the gap]
5. [LEVERAGE ANGLE] — [cash only, fewer buyers competing, seller psychology]

=====================================
CONS — RISKS AND CONCERNS
=====================================
[3-5 numbered bullets. Be honest — a note that ignores real risks is useless.]
1. [PRICE/SPREAD RISK] — [specific numbers showing where math is tight]
2. [PROPERTY RISK] — [condition unknown, 1-bath cap, small sqft, flood zone, etc.]
3. [MARKET RISK] — [ZIP liquidity, flip timeline, rental demand, buyer pool]
4. [FINANCIAL RISK] — [BRRRR cash left in, reno overrun risk, financing assumptions]
5. [ADDITIONAL if applicable]

=====================================
KEY INSIGHTS & HIDDEN SIGNALS
=====================================
[3-5 insights that are non-obvious — things that give Tomer/Kevin a competitive edge]
• [SELLER PSYCHOLOGY] — [what the DOM/price history/listing signals about motivation]
• [CONSTRUCTION/PHYSICAL EDGE] — [CBS vs frame, lot, layout conversion opportunity]
• [MARKET TIMING] — [ZIP inventory, competition from other investors, seasonal factors]
• [NEGOTIATION ANGLE] — [specific leverage points based on listing signals]
• [WATCH TRIGGER if PASS] — [exact price or condition that would change the decision]

=====================================
STRATEGY RECOMMENDATION
=====================================
Best exit: [BRRRR / Flip / Rental hold / PASS — WATCH]
Why: [2-3 direct sentences: which scenario works and why, why others don't, what has to be true]
[If PASS]: Price drop to $[X] = [scenario] works. Call immediately if it hits $[X].

=====================================
NEXT ACTION
=====================================
Action:      [CALL TODAY / SCHEDULE WALK / MAKE OFFER / WATCH / WAIT FOR DROP]
Offer range: $[X]–$[X]  (target $[X])
Walk:        [Required / Not needed / Only if price drops to $X]
Agent call:  [Verbatim script — 3-4 sentences Tomer or Kevin can say on the phone]
Follow-up:   [Specific trigger or date — not "check back later"]`

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

  return `Generate full investor notes for this property.

PROPERTY DATA:
Address:         ${addr}
Beds/Baths/Sqft: ${lead.bedrooms || '?'}BR / ${lead.bathrooms || '?'}BA / ${lead.sqft || 'Unknown'} sqft
Property type:   ${lead.property_type || 'single_family'}
Asking price:    ${fmt(pp)}${ppsf ? ` ($${ppsf}/sqft)` : ''}
ARV:             ${fmt(arv)}${lead.conservative_arv ? ` (conservative ${fmt(lead.conservative_arv)} / aggressive ${fmt(lead.aggressive_arv)})` : ''}
Renovation cost: ${fmt(reno)}
MAO:             ${fmt(mao)}
Rent estimate:   ${fmt(rent)}
ZIP code:        ${lead.zip_code || 'Unknown'}
${brrrrBlock}
${flipBlock}

Use the pre-computed numbers above exactly. Add your qualitative analysis, comp reasoning, insights, and narrative throughout the notes — that is where your value is. Numbers come from above; intelligence comes from you.

Write the full notes now. Start directly with the first section — no intro, no preamble.`
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
        max_tokens: 4096,
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
