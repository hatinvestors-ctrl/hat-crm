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

Seller types: WHOLESALER=speed/certainty>price · ESTATE=empathy first · TIRED LANDLORD=validate pain · DIVORCE=speed+clean · FORECLOSURE=you stop the clock · MLS AGENT=clean offer easy process
HAT proposition: all-cash · 10–14 day close · as-is · one decision-maker · repeat buyer priority
Tone: never desperate · assumptive always ("when we close") · specific $ and days · their name early · no filler openers

Write EXACTLY this structure. Start with first ===== line. No preamble. Be concise — every field one line only.

=====================================
NEGOTIATION PLAN
=====================================
Seller Type:     [type] — [key signals]
Motivation:      [HIGH/MEDIUM/LOW] — [evidence]
Their Priority:  [Speed/Price/Certainty/Relationship] — [reason]
Leverage:        [HIGH/MEDIUM/LOW] — [reason]

OPENING STRATEGY
Opening Offer:   $[X] — [anchor rationale, 1 line]
Lead With:       [Klaff hook or Voss label — 1 specific sentence to open with]
First Move Tone: [Collaborative/Firm/Empathy-first]

COUNTER PLAYBOOK
If they counter at $[X] → $[Y] | "[exact words to say]"
If they push back hard → "[accusation audit — exact words]"
If they say need to think → "[next-step lock — exact words]"
If they go silent 48hrs → "[exact follow-up opener]"
Walk-Away Price: $[X]

RELATIONSHIP NOTE
[1 sentence — HAT as repeat buyer relationship]

=====================================
COMMUNICATIONS
=====================================
EMAIL
Subject: [specific subject]
---
[80–100 words. Observation opener, their name, offer/intent, one calibrated question. Sign: Tomer | HAT Investors]
---

SMS
---
[2 sentences. Name, address, one ask. No exclamation marks.]
---

VOICEMAIL SCRIPT
---
[25 seconds. Name, company, address, offer/intent, number once, reason to call today.]
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
