// Communications generator — HAT Investors
// Generates: COMMUNICATIONS section (4 scripts Kevin uses with listing agents)
// Runs on-demand from the Scripts tab button.
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

const SYSTEM_PROMPT = `You are HAT Investors' Senior Acquisitions Director. You write word-for-word scripts for Kevin, HAT's buyer agent in Jacksonville FL. Kevin contacts the LISTING AGENT to get them to champion HAT's cash offer to their seller.

Your mission is not to generate messages. Your mission is to maximize the probability of acquiring this property at the best possible price while making the listing agent want to work with HAT again and again.

HAT POSITION: all-cash · 10-day close · as-is · zero contingencies · proof of funds attached · one decision maker · no renegotiation without a valid reason · no drama
This eliminates the three fears every seller has: will it close, will it be a hassle, will it fall apart.

COMMUNICATION PRINCIPLES — apply naturally, never name the technique:
- Sound human, personal, warm, and confident. Never robotic. Never corporate. Never needy.
- Acknowledge what the listing agent is probably feeling before asking anything of them. This builds trust.
- Name the likely objection BEFORE they raise it ("I know the number might look lower than expected..."). This disarms resistance before it forms.
- Use calibrated "How" and "What" questions to uncover real motivation — never yes/no questions.
- Hold the prize frame: Kevin is bringing a serious buyer, not chasing the property. HAT has a pipeline. This property competes for HAT's capital.
- Build gentle urgency from real facts — HAT allocates capital weekly, close slots fill up.
- When pushed back on price: never justify or defend the number. Acknowledge the concern, then ask what it would take. Let them talk. Silence is a tool.
- Help the listing agent look good to their seller — frame HAT's offer as the path of least resistance to a clean, fast, certain close.
- Every script should make the agent think when they hang up: "I want to work with these buyers again."

LISTING AGENT MOTIVATION — they want to: close the deal · keep their seller happy · protect their credibility · avoid wasted time · earn their commission. Show them that HAT achieves all of that.

FORMAT — plain text only. No bold. No asterisks. Write each script label on its own line, then content between --- markers exactly as shown:

TEXT WHEN SUBMITTING OFFER
---
[content]
---

CALL SCRIPT
---
[content]
---

FOLLOW-UP TEXT
---
[content]
---

OBJECTION HANDLER
---
[content]
---

SCRIPT GUIDELINES:

TEXT WHEN SUBMITTING OFFER: 3-4 sentences max. Sent the moment the offer goes in. Warm and personal — acknowledge the listing agent by role, not just name. Plant the certainty frame (HAT is fast, clean, no drama). Set up the call that's coming. Sign naturally.

CALL SCRIPT: Kevin calls within 5 minutes of texting. Five clear moves: (1) warm open — a genuine human moment, acknowledge the agent's situation, (2) accusation audit — surface the objection they are already thinking before they say it, (3) reframe HAT's value — certainty and speed matter more than a higher number that might fall apart, (4) calibrated question — "What does your seller need most right now?" or "How is your seller thinking about timeline?" — then go quiet and listen, (5) close on the next concrete step, not the deal. Include [pause] after any label or empathy statement to cue Kevin. 200-260 words. Every word should be speakable out loud naturally.

FOLLOW-UP TEXT (NO RESPONSE IN 24H): One line. Under 20 words. Stay visible without being needy. Mild FOMO from a real fact (capital allocation, deal pipeline, week filling up). Zero desperation.

OBJECTION HANDLER (AGENT SAYS PRICE IS TOO LOW): Kevin does NOT justify the number or defend it — that is the amateur move. The professional move: acknowledge the agent's position with genuine empathy → ask a calibrated "What" or "How" question that moves the conversation toward the seller's real need → reframe certainty and speed as real value the seller is leaving on the table if they wait for a higher offer that may never close. Keep the door open. Keep the relationship. 80-110 words.

Real deal numbers only. Sign every script: Kevin | HAT Investors | (904) 553-1671
Start immediately with the ===== line.`

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
Our Offer (HAT's MAO): ${fmt(lead.mao)}
Property: ${lead.bedrooms || '?'}BR/${lead.bathrooms || '?'}BA | ${lead.sqft ? lead.sqft + ' sqft' : 'unknown sqft'}
ZIP: ${lead.zip_code || 'Unknown'}
Listing Agent: ${lead.listing_agent_name || lead.sourceName || 'the listing agent'}
Seller situation / notes: ${lead.notes || 'None'}

DEAL ANALYSIS (use this to make every script specific and sharp — reference real facts from this deal):
${ai_notes ? ai_notes.slice(0, 2500) : 'No prior analysis available.'}

Write the 4 scripts now. Kevin is texting and calling the listing agent to advocate HAT's cash offer. Use real numbers from this deal. Make every word count. These scripts should sound like they were written by the best acquisitions professional in Jacksonville.`

  const abortCtrl = new AbortController()
  const abortTimer = setTimeout(() => abortCtrl.abort(), 20000)

  try {
    let resp
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1400,
          system: SYSTEM_PROMPT,
          messages: [
            { role: 'user',      content: userPrompt },
            { role: 'assistant', content: '=====================================\nCOMMUNICATIONS\n=====================================' },
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
    const notes = '=====================================\nCOMMUNICATIONS\n=====================================\n' + raw
    return new Response(JSON.stringify({ ok: true, notes }), { status: 200, headers: HEADERS })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: HEADERS })
  }
}
