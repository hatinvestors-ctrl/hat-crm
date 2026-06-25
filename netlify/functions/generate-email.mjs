// AI-powered negotiation email generator.
//
// POST /.netlify/functions/generate-email
// body: { mode, lead, situation_type?, situation?, their_reply? }
//   mode: 'initial' | 'reply'
//   lead: { address, city, state, property_type, bedrooms, bathrooms, sqft,
//           year_built, asking_price, offer_price, arv, renovation_cost, mao,
//           rent_estimate, mls_status, listing_agent_name }
//   situation_type: 'initial'|'counter'|'competing'|'motivated'|'followup'  (initial mode)
//   situation: string[]  (reply mode — situation chips)
//   their_reply: string  (pasted agent email, reply mode only)
//
// Returns: { ok, subject, body }
//
// Required env vars: ANTHROPIC_API_KEY

import { NEGOTIATION_FRAMEWORK, HAT_BUYER_PROPOSITION, SELLER_TYPE_PLAYBOOKS } from './lib/negotiation-core.mjs'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

const SYSTEM_PROMPT = `You are Kevin Bachman, Broker/Owner of Bachman Property Brokers LLC.
You represent HAT Investors — a Jacksonville-based real estate investment company that actively buys, renovates, and holds properties across the Jacksonville metro area.

Your job is to write professional, ready-to-send negotiation emails on behalf of HAT Investors to listing agents.

## Identity
- From: Kevin Bachman, Broker/Owner, Bachman Property Brokers LLC, (904) 748-9141
- Buyer client: HAT Investors (do NOT name individual people — never mention Tomer or any internal staff)
- HAT Investors buys as-is, cash, closes in 14–21 days, no financing contingency

## Output Format (REQUIRED)
Output EXACTLY two sections, in this order, with no extra text before or after:
SUBJECT: <the subject line here>

<the full email body starting with the greeting>

End the email body with:
  Kevin Bachman
  Broker/Owner | Bachman Property Brokers LLC
  (904) 748-9141

Plain text only — no markdown, no bullet points unless natural in context.

## Situation-Specific Tactics
- For competing offers: reframe certainty vs. price — expose appraisal risk, inspection re-trade, 45-day close risk of financed buyers. Our lower price may NET MORE.
- For high counters: validate their number, then re-anchor with deal math (ARV - reno - profit margin). Voss label their position before countering.
- For ghosted leads: Cardone follow-up with a NEW angle — market data, timing, or a changed condition. Never repeat the same pitch.
- For proof-of-funds: acknowledge confidently, pivot to speed and certainty. "We close, every time."
- For "not interested": Morby relationship close — plant the seed for future deals, never burn the bridge.
- For leaseback/stay-longer: show flexibility, use it as a closing lever (Hopkins alternative choice close).
${NEGOTIATION_FRAMEWORK}
${HAT_BUYER_PROPOSITION}
${SELLER_TYPE_PLAYBOOKS}`

const SITUATION_TYPE_GUIDANCE = {
  initial: `This is a first contact with the listing agent. Establish your buyer profile and intent.
Goal: Create a positive first impression, present the offer clearly, and highlight HAT's 3 core advantages: cash buyer, as-is purchase, fast 14–21 day close.
Psychology: Authority (established buyer), Social proof (active in this zip code), Ease (no showings, no repairs, certainty of close).`,

  counter: `The seller or agent has pushed back or countered. We need to negotiate the gap.
Goal: Acknowledge their position, re-anchor with deal math, propose a path to close.
Psychology: Acknowledgment + reframing (validate their number, then show the math that makes our number necessary), Small concession framing (if we move, what we need in return), Loss aversion (what they risk losing if the deal falls apart).`,

  competing: `We are in a multiple-offer situation or told there are other buyers.
Goal: Win on certainty, not price. Reframe the question from "who offers most" to "who actually closes."
Psychology: Risk framing (expose the gap between list price and net proceeds with a financed buyer: appraisal risk, inspection re-trade, 45-day close, potential fall-through), Contrast effect (compare our clean cash offer to the uncertainty of financed offers), Urgency (we will move on to the next deal if not accepted quickly).`,

  motivated: `The seller appears motivated, distressed, or this is an estate/tired-landlord situation.
Goal: Lead with empathy, solve their problem, lead with speed and as-is relief before numbers.
Psychology: Empathy first (acknowledge their situation, relieve their burden), Simplicity (we handle everything, no showings, no repairs, no hassle), Speed as the real value (for motivated sellers, time is worth more than price).`,

  followup: `We sent an offer or email and have not received a response.
Goal: Re-engage without sounding desperate. Remind, add a new angle, leave the door open.
Psychology: Scarcity + social proof (we are actively looking at other properties in the area), Controlled urgency (we prefer this deal but have alternatives), Curiosity (ask an open question to restart the conversation).`,
}

const MAX_REPLY_LEN = 4000
function sanitize(s) {
  return String(s ?? '').replace(/"""/g, '"" "').slice(0, MAX_REPLY_LEN)
}

function buildUserPrompt({ mode, lead, situation_type, situation, their_reply }) {
  const addr = [lead.address, lead.city, lead.state].filter(Boolean).join(', ')
  const fmt  = (n) => n ? `$${Number(n).toLocaleString()}` : 'not set'

  const offerPrice  = Number(lead.offer_price  || lead.mao)  || null
  const askingPrice = Number(lead.asking_price) || null

  let gapStrategy = ''
  if (offerPrice && askingPrice) {
    const gap = (askingPrice - offerPrice) / askingPrice
    if (gap < 0.05) {
      gapStrategy = 'NEAR-ASK: Our offer is very close to asking. Use a confident, near-full-price tone. Emphasize speed, certainty, and cash — not price. Create mild urgency.'
    } else if (gap <= 0.20) {
      gapStrategy = 'MODERATE GAP: Our offer is moderately below asking. Lead with relationship and market context. Reference renovation scope and ARV math to justify the number. Rapport-first, then the ask.'
    } else {
      gapStrategy = 'LARGE GAP: Our offer is significantly below asking. Use an as-is, cash-buyer anchor. Focus on seller motivation and certainty of close over price. Frame the offer as fair given condition and renovation risk. Do not apologize for the number.'
    }
  } else {
    gapStrategy = 'NO PRICE DATA: Write a relationship-building initial outreach. Do not mention a specific offer price.'
  }

  const leadContext = `
Property: ${addr || 'not provided'}
Type: ${lead.property_type || 'residential'} | Beds: ${lead.bedrooms || '?'} | Baths: ${lead.bathrooms || '?'} | Sqft: ${lead.sqft || '?'} | Year: ${lead.year_built || '?'}
MLS Status: ${lead.mls_status || 'unknown'}
Asking Price: ${fmt(askingPrice)}
Our Offer Price: ${fmt(offerPrice)}
ARV: ${fmt(lead.arv)}
Renovation Estimate: ${fmt(lead.renovation_cost)}
MAO: ${fmt(lead.mao)}
Rent Estimate: ${fmt(lead.rent_estimate)}
Listing Agent: ${lead.listing_agent_name || 'Agent'}
`.trim()

  if (mode === 'initial') {
    const stKey = situation_type && SITUATION_TYPE_GUIDANCE[situation_type] ? situation_type : 'initial'
    const stGuidance = SITUATION_TYPE_GUIDANCE[stKey]
    return `Write a negotiation email to the listing agent for this property.

${leadContext}

Price Gap Analysis: ${gapStrategy}

Email Strategy:
${stGuidance}

Write the email now. Output SUBJECT: on the first line, then a blank line, then the full email body. No placeholders. Use all available data above.`
  }

  const safeArr = Array.isArray(situation) ? situation : []
  const situationText = safeArr.length > 0
    ? `Situation flags: ${safeArr.join(', ')}`
    : ''
  const replyText = their_reply?.trim()
    ? `Agent's response:\n"""\n${sanitize(their_reply)}\n"""`
    : ''

  return `Write a negotiation reply email for this property.

${leadContext}

Price Gap Analysis: ${gapStrategy}

${situationText}
${replyText}

Instructions: Acknowledge their response/situation, apply the right negotiation psychology, and advance toward closing. Output SUBJECT: on the first line, then a blank line, then the full reply email body. No placeholders.`
}

function parseSubjectAndBody(raw) {
  const lines = raw.split('\n')
  let subject = ''
  let bodyStart = 0
  if (lines[0].toUpperCase().startsWith('SUBJECT:')) {
    subject = lines[0].replace(/^SUBJECT:\s*/i, '').trim()
    bodyStart = lines[1] === '' ? 2 : 1
  }
  const body = lines.slice(bodyStart).join('\n').trim()
  return { subject, body }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: HEADERS })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: HEADERS })
  }
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY not configured.' }), { status: 500, headers: HEADERS })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const { mode = 'initial', lead = {}, situation_type = 'initial', situation = [], their_reply = '' } = body

    if (!['initial', 'reply'].includes(mode)) {
      return new Response(JSON.stringify({ ok: false, error: 'mode must be initial or reply' }), { status: 400, headers: HEADERS })
    }

    const userPrompt = buildUserPrompt({ mode, lead, situation_type, situation, their_reply })

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      throw new Error(`Claude API error ${claudeRes.status}: ${errText}`)
    }

    const claudeData = await claudeRes.json()
    const raw = claudeData.content?.[0]?.text?.trim() || ''
    const { subject, body: emailBody } = parseSubjectAndBody(raw)

    return new Response(JSON.stringify({ ok: true, subject, body: emailBody }), { status: 200, headers: HEADERS })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500, headers: HEADERS })
  }
}
