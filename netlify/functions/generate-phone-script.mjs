// AI-powered phone script generator for agent-to-agent calls.
//
// POST /.netlify/functions/generate-phone-script
// body: { stage, tone, lead }
//   stage: 'first_contact' | 'after_offer' | 'negotiate' | 'competing' | 'followup'
//   tone:  'warm' | 'confident' | 'assertive' | 'urgent' | 'empathetic'
//   lead:  { address, city, state, property_type, bedrooms, bathrooms, sqft,
//            year_built, asking_price, offer_price, arv, renovation_cost, mao,
//            rent_estimate, mls_status, listing_agent_name }
//
// Returns: { ok, context, script }
//   context: 2-sentence situation summary for the agent reading the script
//   script:  word-for-word phone script with [PAUSE], objection branches, etc.
//
// Required env vars: ANTHROPIC_API_KEY

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

const SYSTEM_PROMPT = `You are a master real estate negotiation coach writing word-for-word phone scripts.

The script is spoken by Kevin Bachman, Broker/Owner of Bachman Property Brokers LLC, who represents HAT Investors as the buying agent.
He is calling the listing agent (the agent representing the seller).

## Identity on the Call
- Caller: Kevin Bachman, Broker/Owner, Bachman Property Brokers LLC
- His client: HAT Investors — a Jacksonville-based investment company
- HAT Investors buys as-is, cash-equivalent (pre-approved HML), closes in 14–21 days
- NEVER mention Tomer or any individual name from HAT Investors

## HAT's 6 Key Advantages to Weave In (where relevant)
1. Cash-equivalent close — HML through Rob @ 3 Shacks Capital, committed capital, no underwriting
2. Close in 5–14 business days once title is clear — no bank delays
3. As-is purchase — no repair requests, no re-trades after signing
4. Inspection done AT the showing — contractor on-site, no surprises
5. Strong earnest money ($5k–$10k) — we perform, every time
6. Flexible closing date — we close on the seller's timeline

## Script Format Rules (STRICT)
1. Start with CONTEXT: two sentences explaining the deal situation and what psychological angle the script uses. Label it exactly "CONTEXT:" on its own line.
2. Then a blank line.
3. Then SCRIPT: on its own line.
4. Then the full word-for-word script.
5. Format the script with:
   - Normal dialogue text for what Kevin says
   - [PAUSE — let them respond] where Kevin should stop and listen
   - [IF THEY SAY: "..."] followed by an indented handling branch for objections
   - [GOAL CHECK: ...] brief coaching note at decision points
   - Bold key phrases by wrapping them in ** (e.g., **cash-equivalent close**)
   - Use natural conversational language — not stiff or corporate
6. End with a clear close and next-step ask.
7. The script should feel human and natural, not read like a robot. Real pauses, real objection branches.

## Psychology Principles to Apply
- Reciprocity: be generous with information first, then make the ask
- Social proof: "we've closed X deals in this zip code" (use area, not specific number)
- Scarcity/urgency: our capital is active and we have other deals to look at
- Contrast principle: compare our clean certainty to the risk of financed buyers
- Loss aversion: help them visualize what the seller loses with a messy financed buyer
- Commitment: reference any prior positive interaction, anchor them to their own words
- Liking: find common ground, be personable, ask about them
- Authority: Kevin is a broker with experience — not a cold caller`

const STAGE_GUIDANCE = {
  first_contact: {
    label: 'First Contact',
    objective: 'Introduce Kevin and HAT Investors, qualify the deal, plant the seed before the offer is submitted.',
    psychology: 'Liking + Authority: establish credibility and warmth before making any ask. Do not lead with price — lead with capability and track record. The goal is to be the agent they WANT to work with.',
    call_flow: 'Intro → qualify the property → establish buyer profile → mention you\'ve done your homework → warm close asking for the best way to submit',
  },
  after_offer: {
    label: 'After Offer Sent',
    objective: 'Follow up after submitting an offer with no response. Find out where things stand and re-anchor HAT\'s advantages.',
    psychology: 'Reciprocity + commitment: reference the professional offer you submitted (they owe you a reply). Use social proof and scarcity subtly — you have other deals to look at but prefer this one. Avoid desperation.',
    call_flow: 'Warm opener → confirm they received the offer → ask what the seller\'s reaction was → address any hesitation → re-anchor terms → ask for a counter or decision timeline',
  },
  negotiate: {
    label: 'Negotiate on the Call',
    objective: 'Seller pushed back or countered. Hold the number or find creative paths to close on the call.',
    psychology: 'Acknowledge + reframe + loss aversion: validate their position before countering. Use deal math to justify the number (not opinion). Create mild fear of what happens if this deal falls through. Offer term concessions before price concessions.',
    call_flow: 'Acknowledge their counter → show the math (ARV - reno - costs = our number) → explore term flexibility (faster close, higher deposit, leaseback) → last resort: small move with a reason attached → strong close',
  },
  competing: {
    label: 'Competing Offers',
    objective: 'Seller has multiple offers. Win on certainty and net proceeds, not list price.',
    psychology: 'Contrast + loss aversion: make the agent do the math on what a financed buyer actually nets the seller (appraisal risk, inspection re-trade, 45-day wait, possible fall-through). Our offer at a lower price may NET MORE and close for certain. Paint the picture of the nightmare scenario with a financed buyer.',
    call_flow: 'Acknowledge the situation with confidence → pivot to certainty vs. price → walk through the financed buyer risk scenario → show how our offer compares on net proceeds and certainty → ask for best-and-final or a chance to be highest-and-best',
  },
  followup: {
    label: 'Follow-Up / No Response',
    objective: 'Re-engage after going dark. Get an answer — yes, no, or a counter.',
    psychology: 'Scarcity + reciprocity: position yourself as professionally following up (they owe you a response). Hint that you have other active deals so your capital is not waiting. Give them an easy face-saving out ("if you went another direction, just let me know — I appreciate the courtesy"). This creates urgency without pressure.',
    call_flow: 'Brief warm opener → reference previous offer/call → create soft urgency (other active deals) → give them easy face-saving out → ask the direct question: where do things stand?',
  },
}

const TONE_GUIDANCE = {
  warm:        'Warm & Friendly: conversational, build rapport first, smile comes through in the voice. Prioritize liking and trust over efficiency.',
  confident:   'Confident & Professional: calm authority, measured pace, no hedging. Sound like someone who does 20 deals a year and knows exactly what they\'re doing.',
  assertive:   'Assertive: direct, no fluff, gets to the point fast. Respectful but firm. Makes it clear the offer is solid and not moving much. Does not chase.',
  urgent:      'Urgent: creates real time pressure — our capital is active, we have two other deals we\'re evaluating this week, we need an answer. Not aggressive but genuinely in demand.',
  empathetic:  'Empathetic: lead with understanding the seller\'s situation. Slow down, listen more than talk. This tone works best for motivated sellers, estate situations, or emotional sellers.',
}

function buildPrompt({ stage, tone, lead }) {
  const addr     = [lead.address, lead.city, lead.state].filter(Boolean).join(', ')
  const fmt      = (n) => n ? `$${Number(n).toLocaleString()}` : 'not set'
  const offer    = Number(lead.offer_price || lead.mao) || null
  const asking   = Number(lead.asking_price) || null
  const arv      = Number(lead.arv) || null
  const reno     = Number(lead.renovation_cost) || null

  let gapAnalysis = ''
  if (offer && asking) {
    const gap    = asking - offer
    const gapPct = ((gap / asking) * 100).toFixed(1)
    if (gap < 0)       gapAnalysis = `Our offer is ABOVE asking by ${fmt(Math.abs(gap))}. Strong position — emphasize speed and certainty as the real value.`
    else if (gap < 2000) gapAnalysis = `Offer is essentially at asking. Emphasize certainty and speed — this should be an easy close.`
    else if (gap / asking < 0.05) gapAnalysis = `Small gap of ${fmt(gap)} (${gapPct}%). This is very closeable. Light negotiation needed.`
    else if (gap / asking <= 0.20) gapAnalysis = `Moderate gap of ${fmt(gap)} (${gapPct}%). Use math to justify. Explore term flexibility before price.`
    else gapAnalysis = `Large gap of ${fmt(gap)} (${gapPct}%). This needs strong justification. Lead with as-is reality and ARV math. Be prepared for pushback.`
  } else {
    gapAnalysis = 'No offer price set. Focus on relationship building and gathering information.'
  }

  const sg = STAGE_GUIDANCE[stage] || STAGE_GUIDANCE.first_contact
  const tg = TONE_GUIDANCE[tone]   || TONE_GUIDANCE.confident

  const leadContext = `
Property: ${addr || 'not provided'}
Property Type: ${lead.property_type || 'residential'} | ${lead.bedrooms || '?'} bed / ${lead.bathrooms || '?'} bath | ${lead.sqft ? lead.sqft + ' sqft' : 'sqft unknown'} | Built ${lead.year_built || 'unknown'}
MLS Status: ${lead.mls_status || 'unknown'}
Asking Price: ${fmt(asking)}
Our Offer: ${fmt(offer)}
ARV (After Repair Value): ${fmt(arv)}
Renovation Estimate: ${fmt(reno)}
Listing Agent Name: ${lead.listing_agent_name || 'the agent'}
`.trim()

  return `Write a phone script for this exact deal.

## Deal Data
${leadContext}

## Price Gap Analysis
${gapAnalysis}

## Call Stage
${sg.label}: ${sg.objective}
Psychology to use: ${sg.psychology}
Call flow: ${sg.call_flow}

## Tone
${tg}

## Instructions
1. First write CONTEXT: (two sharp sentences: what the deal situation is and what psychological angle the script uses — help the agent understand WHY this script works this way)
2. Then write SCRIPT: followed by the full word-for-word script
3. Use the deal numbers. Use the listing agent's name where given. Do not mention Tomer or any buyer's personal name. Kevin represents HAT Investors.
4. Include [PAUSE] markers, [IF THEY SAY: "..."] objection branches, and [GOAL CHECK] coaching notes.
5. Make it feel human and natural, not robotic. This is a real call between two real agents.
6. End with a clear ask for a specific next step.

Write the script now.`
}

function parseContextAndScript(raw) {
  const lines = raw.split('\n')
  let context = ''
  let scriptLines = []
  let inScript = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!inScript && line.trim().toUpperCase().startsWith('CONTEXT:')) {
      // Collect context — could be same line or next lines until SCRIPT:
      const same = line.replace(/^CONTEXT:\s*/i, '').trim()
      if (same) context += same + ' '
      // Keep collecting until SCRIPT: line
      let j = i + 1
      while (j < lines.length && !lines[j].trim().toUpperCase().startsWith('SCRIPT:')) {
        const l = lines[j].trim()
        if (l) context += l + ' '
        j++
      }
      context = context.trim()
      i = j // skip to SCRIPT: line
      inScript = true
      continue
    }
    if (!inScript && line.trim().toUpperCase().startsWith('SCRIPT:')) {
      inScript = true
      const rest = line.replace(/^SCRIPT:\s*/i, '').trim()
      if (rest) scriptLines.push(rest)
      continue
    }
    if (inScript) {
      scriptLines.push(line)
    }
  }

  // If parsing failed, treat whole thing as script
  if (!context && !scriptLines.length) {
    return { context: '', script: raw.trim() }
  }

  return { context: context || '', script: scriptLines.join('\n').trim() }
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
    const { stage = 'first_contact', tone = 'confident', lead = {} } = body

    const userPrompt = buildPrompt({ stage, tone, lead })

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
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
    const { context, script } = parseContextAndScript(raw)

    return new Response(JSON.stringify({ ok: true, context, script }), { status: 200, headers: HEADERS })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500, headers: HEADERS })
  }
}
