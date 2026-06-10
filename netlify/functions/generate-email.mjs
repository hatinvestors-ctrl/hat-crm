// AI-powered negotiation email generator.
//
// POST /.netlify/functions/generate-email
// body: { mode, lead, situation?, their_reply? }
//   mode: 'initial' | 'reply'
//   lead: { address, city, state, property_type, bedrooms, bathrooms, sqft,
//           year_built, asking_price, offer_price, arv, renovation_cost, mao,
//           rent_estimate, mls_status, listing_agent_name }
//   situation: string[]  (preset chips, reply mode only)
//   their_reply: string  (pasted seller email, reply mode only)
//
// Required env vars: ANTHROPIC_API_KEY

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

const SYSTEM_PROMPT = `You are Kevin Bachman, Broker/Owner of Bachman Property Brokers LLC.
You represent HAT Investors — a Jacksonville-based real estate investment company that actively buys, renovates, and holds properties across the Jacksonville metro area.

Your job is to write professional, ready-to-send negotiation emails on behalf of HAT Investors.

## Identity
- From: Kevin Bachman, Broker/Owner, Bachman Property Brokers LLC, (904) 748-9141
- Buyer client: HAT Investors (do NOT name individual people — never mention Tomer or any internal staff)
- HAT Investors buys as-is, cash, closes in 14–21 days, no financing contingency

## Tone & Style
- Professional but warm — you're building a relationship, not just transacting
- Confident without being aggressive
- Concise — agents are busy, get to the point
- No filler phrases like "I hope this email finds you well"
- Never use placeholders like [NAME] or [AMOUNT] — use the actual data provided

## Output Format
- Output ONLY the email body text — no subject line, no metadata
- Start with the greeting (e.g. "Hi Jane,")
- End with the signature block:
  Kevin Bachman
  Broker/Owner | Bachman Property Brokers LLC
  (904) 748-9141
- Plain text only — no markdown, no bullet points in the email itself unless natural in context

## Negotiation Principles
- Anchor with data, not opinion — reference ARV and renovation scope to justify numbers
- Acknowledge the other party's position before countering
- Use social proof subtly ("we've closed multiple deals in this zip code")
- Create soft urgency without pressure ("our buy box fills quickly this time of year")
- For ghosted leads: re-engage with a new angle — never repeat the same pitch
- For proof-of-funds requests: acknowledge confidently, pivot to speed and certainty advantage
- For "not interested": plant a seed for future deals, never burn the bridge
- For high counters: validate their number, then re-anchor with deal math (ARV - reno - profit margin)
- For leaseback/stay-longer requests: show flexibility, use it as a closing lever`

function buildUserPrompt({ mode, lead, situation, their_reply }) {
  const addr = [lead.address, lead.city, lead.state].filter(Boolean).join(', ')
  const fmt  = (n) => n ? `$${Number(n).toLocaleString()}` : 'not set'

  const offerPrice  = lead.offer_price  || lead.mao || null
  const askingPrice = lead.asking_price || null

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
    return `Write an initial outreach email to the listing agent for this property.

${leadContext}

Negotiation Strategy: ${gapStrategy}

Write the full email body now. No placeholders. Use all available data above.`
  }

  const situationText = situation.length > 0
    ? `Situation: ${situation.join(', ')}`
    : ''
  const replyText = their_reply?.trim()
    ? `Their response:\n"""\n${their_reply.trim()}\n"""`
    : ''

  return `Write a negotiation reply email for this property.

${leadContext}

Negotiation Strategy: ${gapStrategy}

${situationText}
${replyText}

Write the full reply email body now. Acknowledge their response/situation, apply the right negotiation strategy, and advance toward closing. No placeholders.`
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
    const { mode = 'initial', lead = {}, situation = [], their_reply = '' } = body

    if (!['initial', 'reply'].includes(mode)) {
      return new Response(JSON.stringify({ ok: false, error: 'mode must be initial or reply' }), { status: 400, headers: HEADERS })
    }

    const userPrompt = buildUserPrompt({ mode, lead, situation, their_reply })

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
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
    })

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      throw new Error(`Claude API error ${claudeRes.status}: ${errText}`)
    }

    const claudeData = await claudeRes.json()
    const emailBody  = claudeData.content?.[0]?.text?.trim() || ''

    return new Response(JSON.stringify({ ok: true, body: emailBody }), { status: 200, headers: HEADERS })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500, headers: HEADERS })
  }
}
