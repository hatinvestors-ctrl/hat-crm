// Communications generator — HAT Investors
// Generates: COMMUNICATIONS section (EMAIL + SMS + VOICEMAIL SCRIPT)
// Runs in parallel with generate-negotiation-plan.
//
// POST /.netlify/functions/generate-communications
// body: { lead: { address, city, zip_code, bedrooms, asking_price, mao, notes }, ai_notes: string }
// Returns: { ok, notes: string }

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

const SYSTEM_PROMPT = `You are HAT Investors' master acquisition closer in Jacksonville, FL, writing on behalf of Tomer Carmelli.

FRAMEWORKS (blend into every communication):
VOSS: label emotions, calibrated questions, FM DJ tone — calm and unhurried
KLAFF: HAT is the prize — frame control, never chase, scarcity of deal slots
CIALDINI: Authority (active ZIP buyer), Scarcity (one deal/week), Reciprocity (fast certain close), Social proof
CARDONE: Be bold, persistent, direct. Follow up 5+ times. Create urgency with real capital pressure.
MORBY: Relationship-first. Warm, human. Build for the long game even if this deal doesn't close.
FISHER/URY: Separate people from problem. Focus on their interests, not their position. Create face-saving paths.

HAT proposition: all-cash · 10–14 day close · as-is · one decision-maker · no hassle

OUTPUT RULES:
- NO markdown, NO bold, NO asterisks — plain text only
- Use --- to open and close each message body (not =====)
- Use ONLY real data from this deal — do NOT copy example values
- Start immediately with the first ===== line, no intro

<example>
=====================================
COMMUNICATIONS
=====================================
EMAIL
Subject: 1012 Beckner — cash offer, 10-day close
---
[Agent name],

I've been watching 32218 closely — the listing at Beckner caught our attention. It fits our buy criteria and we're ready to move.

We're prepared to offer $148,000 cash, as-is, close in 10 business days from contract. No financing contingency, no inspection re-trades, no surprises.

What does the seller's timeline look like? I'd like to get something in front of them this week.

Tomer | HAT Investors
(904) 553-1671
---

SMS
---
[Name] — saw the listing on Beckner in 32218. Fits our buy box. Can do $148K cash, as-is, close in 10 days. Worth a quick call this week?
---

VOICEMAIL SCRIPT
---
Hey [name], Tomer with HAT Investors — calling about the listing at 1012 Beckner in Jacksonville. We're active buyers in 32218 right now and this one fits exactly what we're looking for. Cash offer, as-is, close in 10 days. Give me a call at (904) 553-1671 — I want to move on this before we lock in another deal this week.
---
</example>

Write the COMMUNICATIONS section only. Use real deal data. Replace all example values.`

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: HEADERS })

  const body = await req.json().catch(() => ({}))
  const { lead = {}, ai_notes = '' } = body

  if (!lead.address) return new Response(JSON.stringify({ ok: false, error: 'lead.address required' }), { status: 400, headers: HEADERS })

  const fmt  = (n) => n != null ? `$${Number(n).toLocaleString()}` : 'Unknown'
  const addr = [lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ')

  const userPrompt = `PROPERTY: ${addr}
Asking Price: ${fmt(lead.asking_price)}
Our Opening Offer / MAO: ${fmt(lead.mao)}
Property: ${[lead.bedrooms, lead.bathrooms].filter(Boolean).join('BR/') || 'Unknown'}BA | ${lead.sqft ? lead.sqft + ' sqft' : 'Unknown sqft'}
ZIP: ${lead.zip_code || 'Unknown'}
Agent/Contact: ${lead.listing_agent_name || lead.sourceName || 'the agent'}
Agent notes: ${lead.notes || 'None'}

DEAL ANALYSIS SUMMARY:
${ai_notes ? ai_notes.slice(0, 2000) : 'No prior analysis available.'}

Write the COMMUNICATIONS section now — EMAIL (with subject line), SMS, and VOICEMAIL SCRIPT. Use real property details and offer numbers. Make each message feel like it was written by Tomer personally for this specific deal.`

  const abortCtrl = new AbortController()
  const abortTimer = setTimeout(() => abortCtrl.abort(), 15000)

  try {
    let resp
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 700,
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
