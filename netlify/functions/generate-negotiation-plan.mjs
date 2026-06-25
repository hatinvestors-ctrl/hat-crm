// Negotiation plan generator — HAT Investors master acquisition closer
//
// POST /.netlify/functions/generate-negotiation-plan
// body: { lead: { address, city, state, zip_code, bedrooms, bathrooms, sqft,
//           asking_price, arv, renovation_cost, mao, notes }, ai_notes: string }
//
// Returns: { ok, notes: string }  — structured negotiation plan text

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

const SYSTEM_PROMPT = `You are HAT Investors' master acquisition closer in Jacksonville, FL. Write on behalf of Tomer Carmelli, principal.

FRAMEWORKS (blend all three into every output):
VOSS: label emotions ("It seems like...") · calibrated questions ("How am I supposed to make that work?") · accusation audit upfront · FM DJ tone: calm, unhurried · silence after close
KLAFF: HAT is the prize, never chase · frame control ("reviewing two properties this week") · intrigue hook before numbers · "Until" reframe: move on conditions not price · pre-wire the outcome as inevitable
CIALDINI: Authority (active JAX buyer, know this ZIP) · Scarcity (one deal/week slot) · Reciprocity (fast certain close = value given upfront) · small Yes first · Social proof (past deals in area) · Liking (name, warmth)

HAT proposition: all-cash · 10–14 day close · as-is · one decision-maker · repeat buyer priority
Tone: never desperate · always assumptive ("when we close") · specific $ and days · their name early

OUTPUT RULES — CRITICAL:
- NO markdown, NO bold, NO asterisks, NO bullet points
- Every field on its own line, label exactly as shown, colon, space, value
- Start immediately with the first ===== line, no intro text

=====================================
NEGOTIATION PLAN
=====================================
Motivation: HIGH — estate sale, listed as-is, DOM 47 days, two price drops
Their Priority: Speed — estate needs to close before probate deadline
Leverage: HIGH — motivated seller, gap only 12%, market data supports our number
Opening Offer: $148,000 — anchors 8% below MAO, signals serious intent, leaves room to move to $160K
Lead With: It seems like this property has been waiting for the right buyer — we've closed three deals in 32218 this quarter and this fits our hold criteria exactly. Before I share our number, help me understand: what timeline works best for you?
First Move Tone: Empathy-first
If they counter at $175,000 → respond $155,000 | Say: How am I supposed to make the numbers work at that price given the roof and HVAC timeline? Help me understand what's driving that number.
If they push back hard → Say: It sounds like the price is really important to you — I completely understand. What would have to be true for a cash close in 10 days to feel like the right move?
If they say need to think → Say: Totally fair — does Tuesday or Wednesday work better for a quick follow-up call?
If they go silent 48hrs → Say: Hey [name] — still thinking about Beckner? We're locking in our next acquisition this week. Wanted to give you first shot.
Walk-Away Price: $163,000
RELATIONSHIP NOTE
Once we close this one I want you to know — you're on our short list for every 32218 deal we see. Fast, clean, no drama. That's the relationship we're building here.

=====================================
COMMUNICATIONS
=====================================
EMAIL
Subject: [write a specific subject line referencing the property or a deal signal]
---
[Write 80–100 words. Open with an observation about the property or market. Use their name. State offer or intent. One calibrated question. Sign: Tomer | HAT Investors. Plain text, no markdown.]
---

SMS
---
[Write 2 sentences. Use name. Reference address and price. One clear ask. No exclamation marks.]
---

VOICEMAIL SCRIPT
---
[Write 25-second script. Name, HAT Investors, address, offer/intent, phone number once, reason to call back today.]
---`

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: HEADERS })

  const body = await req.json().catch(() => ({}))
  const { lead = {}, ai_notes = '' } = body

  if (!lead.address) {
    return new Response(JSON.stringify({ ok: false, error: 'lead.address required' }), { status: 400, headers: HEADERS })
  }

  const fmt = n => n != null ? `$${Number(n).toLocaleString()}` : 'Unknown'
  const addr = [lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ')

  const userPrompt = `PROPERTY: ${addr}
Asking Price: ${fmt(lead.asking_price)}
Our ARV: ${fmt(lead.arv)}
Renovation Estimate: ${fmt(lead.renovation_cost)}
MAO (Max Allowable Offer): ${fmt(lead.mao)}
Property: ${[lead.bedrooms, lead.bathrooms].filter(Boolean).join('BR/') || 'Unknown'}BA | ${lead.sqft ? lead.sqft + ' sqft' : 'Unknown sqft'}
Agent notes: ${lead.notes || 'None'}

DEAL ANALYSIS SUMMARY (from our AI):
${ai_notes ? ai_notes.slice(0, 3000) : 'No prior analysis available.'}

Write the negotiation plan and all three communications (email, SMS, voicemail) now.`

  const abortCtrl = new AbortController()
  const abortTimer = setTimeout(() => abortCtrl.abort(), 22000)

  try {
    let resp
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1400,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
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
    const notes = data.content?.[0]?.text || ''
    return new Response(JSON.stringify({ ok: true, notes }), { status: 200, headers: HEADERS })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: HEADERS })
  }
}
