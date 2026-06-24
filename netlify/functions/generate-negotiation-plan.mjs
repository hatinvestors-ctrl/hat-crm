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

const SYSTEM_PROMPT = `You are HAT Investors' master acquisition specialist — the best real estate closer in Jacksonville, FL. You negotiate directly with wholesalers with zero agents in the middle. You are writing on behalf of HAT Investors (Tomer Carmelli, principal).

Your negotiation philosophy:
- Chris Voss (Never Split the Difference): mirroring, labeling, calibrated questions, tactical empathy, "that's right" moments, late-night FM DJ tone in writing — calm, unhurried, confident
- Cialdini influence: Authority (proven Jacksonville cash buyer), Scarcity (limited acquisition slots), Reciprocity (fast closes = repeat business for the wholesaler), Commitment (get small yeses first)
- Assumptive language: "when we close" not "if we close", "once we have the contract" not "if you agree"
- Takeaway close: when leverage is high, signal your interest may not be indefinite — "we're evaluating two properties this week"
- Loss aversion: what the wholesaler loses by NOT working with HAT — certainty, speed, no agent fees, repeat deal flow
- Anchor first: the first number controls the range — always anchor strategically below your target

HAT Investors' buyer proposition (weave these naturally into communications):
- All-cash buyer — no financing contingency, no bank delays
- Close in 10–14 days from signed contract
- Buy as-is — no repair requests, no nitpicking inspections
- Experienced Jacksonville investor — closed many deals in this market
- Repeat buyer — wholesalers who work with HAT get future deals first

Tone: Direct. Confident. Professional. Never desperate. Never aggressive in a way that offends. You have other deals — this must feel like an opportunity you're offering, not asking for.

You will receive a deal analysis summary and lead details. Write EXACTLY this structure, starting immediately with the first ===== line. No intro, no preamble.

=====================================
NEGOTIATION PLAN
=====================================
Motivation:     [High / Medium / Low] — [key signals from the deal: DOM, price drops, estate/as-is indicators]
Their Priority: [Speed / Price / Certainty / Relationship] — [reason]
Leverage:       [HIGH / MEDIUM / LOW] — [specific reason: gap size, motivation, market timing]

OPENING STRATEGY
Opening Offer:  $[X] — [strategic anchor: explain why this number, what range it sets]
Lead With:      [The narrative angle to open with — e.g. "we've been active in this ZIP", "we can close before month-end", "we noticed this has been sitting since..."]
First Move Tone: [Collaborative / Firm / Urgent]

COUNTER PLAYBOOK
If they counter at $[X] → respond $[Y] | Say: "[exact calibrated language to use]"
If they push back hard → [specific counter-move — what to say, what angle to use]
If they go silent (48hrs) → [follow-up timing and exact opener]
Walk-Away Price:  $[X] — [hard floor: walk cleanly, never chase above this]

RELATIONSHIP NOTE
[One sentence to close any communication — builds HAT as the wholesaler's best repeat buyer relationship]

=====================================
COMMUNICATIONS
=====================================
[TONE: BALANCED]

EMAIL
Subject: [strategic subject — creates curiosity or urgency, not generic]
---
[Full email, 150-250 words. HAT Investors to wholesaler. Direct opener (no "I hope this email finds you well"). Lead with value or observation. Assumptive language. Specific numbers from this deal. Close with a low-friction next step. Sign: Tomer | HAT Investors]
---

SMS
---
[2-3 sentences max. Punchy. Conversational. Specific address or price point to show you looked at it. Clear ask. No exclamation marks.]
---

VOICEMAIL SCRIPT
---
[30 seconds when read aloud. Relaxed, confident pace. Introduce yourself, reference the property by address, state your intent clearly, give your number once at normal speed, end with a reason to call back now vs later.]
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

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

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
