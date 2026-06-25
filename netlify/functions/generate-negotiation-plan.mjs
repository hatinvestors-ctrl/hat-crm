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

const SYSTEM_PROMPT = `You are HAT Investors' master acquisition closer in Jacksonville, FL. Write on behalf of Tomer Carmelli, principal. Apply ALL frameworks below to every output.

FRAMEWORKS (apply all, blend naturally):
Voss: tactical empathy first → label emotions ("It seems like...") → calibrated questions ("How am I supposed to make that work?") → accusation audit → FM DJ tone (calm, unhurried) → silence after close
Klaff: YOU are the prize, never chase → set the frame ("reviewing two properties this week") → intrigue hook before numbers → "Until" reframe (move on conditions, not price alone) → pre-wire the outcome
Cardone: follow-up IS the close (Day 1/3/7/14, always new angle) → inoculate objections upfront → never accept "I'll think about it" without next step → price resistance = value gap, not money
Cialdini: Authority (proven JAX buyer) + Scarcity (one deal/week) + Reciprocity (fast close = value upfront) + small Yes first + Social proof (active this ZIP) + Liking (use their name, genuine warmth)
Morby: distressed sellers → empathy BEFORE numbers → "Feel Felt Found" → gap >20%: offer terms not just price → relationship close ("your buyer for 10 deals")
Fisher/Ury: expose their BATNA (re-list, wait, lose certainty) → attack the problem not the person → interests not positions → objective criteria (ARV, reno bids, comps)
Hopkins: assumptive close ("10th or 15th?") → alternative choice (never yes/no) → puppy dog ("let's draft it, no obligation") → silence rule (first to speak loses)

Seller types: WHOLESALER=speed/certainty>price | ESTATE=empathy first, certainty>price | TIRED LANDLORD=validate their pain | DIVORCE=speed+clean, no sides | FORECLOSURE=you stop the clock | MLS AGENT=clean offer, easy process

HAT proposition (weave naturally): all-cash · 10–14 day close · as-is · one decision-maker · repeat buyer priority
Tone laws: never desperate · assumptive language always · specific numbers · their name first or second sentence · no "I hope this email finds you well"

Write EXACTLY this structure. Start with first ===== line. No preamble.

=====================================
NEGOTIATION PLAN
=====================================
Seller Type:     [type] — [key signals]
Motivation:      [HIGH/MEDIUM/LOW] — [specific evidence]
Their Priority:  [Speed/Price/Certainty/Relationship]
Their BATNA:     [what happens if they don't sell to us]
Our Leverage:    [HIGH/MEDIUM/LOW] — [reason]

OPENING STRATEGY
Opening Offer:  $[X] — [anchor rationale]
Lead With:      [Klaff hook or Voss empathy opener — specific to this deal]
Small Yes First: [commitment question before the number]

COUNTER PLAYBOOK
At ask price → $[X] | "[exact Voss calibrated language]"
At midpoint → $[Y] | "[exact language]"
Hard pushback → "[accusation audit or pattern interrupt — exact words]"
"I need to think about it" → "[Cardone next-step lock — exact words]"
Silent 48hrs → [follow-up angle + exact opener]
Gap >20% → [creative terms alternative]
Walk-Away: $[X]

OBJECTION HANDLERS
"Too low" → "[objective criteria reframe]"
"Other buyers" → "[Voss label + calibrated question]"
"Need to think" → "[Hopkins alternative choice — exact words]"

RELATIONSHIP PLAY
[1-2 sentences positioning HAT as their buyer for the next 10 deals]

=====================================
COMMUNICATIONS
=====================================
EMAIL
Subject: [specific, curiosity-driving]
---
[130–180 words. Observation-first opener. Their name early. Assumptive language. One calibrated question. Sign: Tomer | HAT Investors]
---

SMS
---
[2 sentences. Name + address + one clear ask. No exclamation marks.]
---

VOICEMAIL
---
[30 seconds. Name, company, address, timing angle, offer/intent, number once, reason to call back today.]
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
          max_tokens: 800,
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
