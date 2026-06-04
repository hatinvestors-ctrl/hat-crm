// netlify/functions/generate-report.mjs
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

const SYSTEM_PROMPTS = {
  lender: `You are writing a professional deal review email from HAT Investors to their hard money lender Rob at 3 Shacks Capital.
Tone: professional, confident, numbers-first. Like a seasoned investor presenting a deal to their trusted lender.
Structure (use these exact sections):
1. Opening (1-2 sentences — warm, professional greeting)
2. Quick Background (how the property was found, initial offer, any negotiation history from notes)
3. Property Highlights — Pros (bullet list) and Challenges (bullet list)
4. Sold Comps (if available in notes — list as "Address – beds/baths, sqft – Sold $X". If no comps in notes, write "Comparable sales package to follow separately.")
5. Deal Numbers — a scenario table: Conservative / Realistic / Aggressive with ARV, Renovation, Purchase Price, Estimated Profit
6. Ask (request pre-approval indication and thoughts on numbers)
7. Sign-off: "Thanks, Hemi Sher & Tomer Carmelli | HAT Investors LLC"
Company: HAT Investors LLC / OHTC Investments. Market: Jacksonville, FL. Never mention principal names in body prose, only in sign-off.`,

  agent: `You are writing a cash buyer inquiry email from HAT Investors to a listing agent.
Tone: direct, decisive, professional. Agents value buyers who are easy to work with.
Structure:
1. One-line intro (who we are — local Jacksonville investor, high-volume buyer)
2. Cash offer details (amount, close timeline 14-21 days, no financing contingency, as-is)
3. Why we're a strong buyer (cash/HML, fast close, no contingency, experienced)
4. 2-3 questions about the property (seller motivation, known issues, prior offers)
5. Sign-off: "Best, [Your Name] | HAT Investors"
Keep it under 200 words. Agents receive many emails — be brief and credible.`,

  seller: `You are writing a direct outreach email from HAT Investors to a property owner (FSBO or direct seller).
Tone: warm, simple, respectful. No real estate jargon. The seller may not be experienced.
Structure:
1. Friendly introduction (who we are, local Jacksonville company, we buy homes as-is)
2. What we like about their property (reference specific features from the lead data)
3. Our offer (amount, simple process, no repairs needed, fast close)
4. The process in plain language ("Here's how it works: we sign a simple agreement, do a quick walkthrough, and close in about 3 weeks — all cash")
5. Call to action (call or reply to discuss)
6. Sign-off: "Warm regards, HAT Investors Team"
Keep it genuine and human. No pressure tactics.`,

  wholesaler: `You are writing a short investor-to-investor message from HAT Investors to a wholesaler.
Tone: brief, direct, decisive. Wholesalers talk fast.
Structure:
1. One sentence: who we are and that we're interested
2. Our MAO range (calculated from the lead data)
3. What we need (clear title, 14-21 day close, walkthrough access)
4. Sign-off: "— HAT Investors | Jacksonville, FL"
Maximum 100 words. Do not add fluff.`,

  general: `You are writing a comprehensive internal deal summary for HAT Investors.
Tone: factual, analytical, no fluff.
Structure:
1. Property Overview (address, beds/baths, sqft, year built, condition summary)
2. Financial Summary (ARV, purchase price, renovation cost, MAO, estimated profit)
3. Scenario Analysis (table: Conservative / Realistic / Aggressive — ARV, Reno, Purchase, Profit, ROI)
4. Deal Analysis (verdict if available, key risks, recommendation)
5. Notes & History (lead notes and any recent activity)
6. Status (current pipeline status, assigned to, follow-up date)
This is for internal use only — be comprehensive and honest about risks.`,
}

const LENGTH_INSTRUCTIONS = {
  brief: 'Keep the report under 150 words. Skip detailed comps and scenario table narrative. Use the scenario table but keep each cell minimal.',
  standard: 'Target approximately 350 words. Include the full scenario table and 2-3 comps if available.',
  detailed: 'Target approximately 600+ words. Include full comps list, complete scenario narrative, all risks and notes details.',
}

function buildUserPrompt(lead, recipientType, length) {
  const fmt = (v) => v != null ? `$${Number(v).toLocaleString()}` : '—'

  function scenarioProfit(arv, pp, reno, holdMonths = 3) {
    if (!arv || !pp) return null
    const loan = pp * 0.9 + reno
    const cashNeeded = pp * 0.1 + loan * 0.02 + 2450
    const holdCost = (loan * 0.01 + 308) * holdMonths
    return Math.round(arv * 0.93 - loan - holdCost - cashNeeded)
  }

  const conProfit = scenarioProfit(lead.conservative_arv, lead.conservative_offer_price || lead.offer_price, lead.conservative_renovation_cost || lead.renovation_cost)
  const reaProfit = scenarioProfit(lead.arv, lead.offer_price || lead.asking_price, lead.renovation_cost)
  const aggProfit = scenarioProfit(lead.aggressive_arv, lead.aggressive_offer_price || lead.offer_price, lead.aggressive_renovation_cost || lead.renovation_cost)

  const address = [lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ')

  const lines = [
    `PROPERTY: ${address}`,
    lead.bedrooms ? `Beds/Baths: ${lead.bedrooms}/${lead.bathrooms}` : '',
    lead.sqft ? `Sqft: ${lead.sqft}` : '',
    lead.year_built ? `Year Built: ${lead.year_built}` : '',
    lead.has_garage != null ? `Garage: ${lead.has_garage ? 'Yes' : 'No'}` : '',
    '',
    'FINANCIALS:',
    `ARV (Realistic): ${fmt(lead.arv)}`,
    `Asking Price: ${fmt(lead.asking_price)}`,
    `Our Offer / Purchase Price: ${fmt(lead.offer_price || lead.asking_price)}`,
    `Renovation Cost: ${fmt(lead.renovation_cost)}`,
    `MAO (75% ARV - Reno): ${fmt(lead.mao)}`,
    lead.rent_estimate ? `Monthly Rent Estimate: ${fmt(lead.rent_estimate)}` : '',
    '',
    'SCENARIOS:',
    `Conservative — ARV: ${fmt(lead.conservative_arv)}, Reno: ${fmt(lead.conservative_renovation_cost || lead.renovation_cost)}, Purchase: ${fmt(lead.conservative_offer_price || lead.offer_price)}, Est. Profit: ${conProfit != null ? fmt(conProfit) : '—'}`,
    `Realistic — ARV: ${fmt(lead.arv)}, Reno: ${fmt(lead.renovation_cost)}, Purchase: ${fmt(lead.offer_price || lead.asking_price)}, Est. Profit: ${reaProfit != null ? fmt(reaProfit) : '—'}`,
    `Aggressive — ARV: ${fmt(lead.aggressive_arv)}, Reno: ${fmt(lead.aggressive_renovation_cost || lead.renovation_cost)}, Purchase: ${fmt(lead.aggressive_offer_price || lead.offer_price)}, Est. Profit: ${aggProfit != null ? fmt(aggProfit) : '—'}`,
    '',
    lead.notes ? `NOTES:\n${String(lead.notes).slice(0, 500)}` : '',
    lead.recent_notes?.length ? `RECENT ACTIVITY:\n${lead.recent_notes.slice(0, 5).join('\n')}` : '',
    lead.deal_analysis ? `DEAL ANALYSIS: Verdict: ${lead.deal_analysis.verdict}, Profit: ${fmt(lead.deal_analysis.profit)}, ROI: ${lead.deal_analysis.roi}%, Risks: ${(lead.deal_analysis.key_risks || []).join('; ')}` : '',
    lead.status ? `CRM STATUS: ${lead.status}` : '',
  ].filter(Boolean).join('\n')

  return `${LENGTH_INSTRUCTIONS[length] || LENGTH_INSTRUCTIONS.standard}

Write the report now. Lead data:

${lines}

After the report body, on a new line write exactly:
SUBJECT: [the email subject line you recommend]`
}

function extractSubject(text) {
  const match = text.match(/\nSUBJECT:\s*(.+)$/m)
  return match ? match[1].trim() : ''
}

function stripSubjectLine(text) {
  return text.replace(/\nSUBJECT:\s*.+$/m, '').trim()
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: HEADERS })

  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY not configured.' }), { status: 500, headers: HEADERS })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const { lead, recipient_type = 'lender', length = 'standard' } = body

    if (!lead) return new Response(JSON.stringify({ ok: false, error: 'lead is required.' }), { status: 400, headers: HEADERS })

    const systemPrompt = SYSTEM_PROMPTS[recipient_type] || SYSTEM_PROMPTS.lender
    const userPrompt   = buildUserPrompt(lead, recipient_type, length)

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: length === 'brief' ? 400 : length === 'standard' ? 800 : 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Claude API error ${res.status}: ${err}`)
    }

    const data    = await res.json()
    const full    = data.content?.[0]?.text || ''
    const subject = extractSubject(full)
    const report  = stripSubjectLine(full)

    return new Response(JSON.stringify({ ok: true, subject, report }), { status: 200, headers: HEADERS })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500, headers: HEADERS })
  }
}
