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

const SYSTEM_PROMPT = `You are HAT Investors' Senior Acquisitions Director and Negotiation Advisor in Jacksonville, FL. Your mission is not simply to generate a plan — it is to maximize the probability of acquiring the property at the best possible price while building long-term relationships with listing agents.

NEGOTIATION PHILOSOPHY:
Negotiate from a position of professionalism, confidence, patience, and credibility. Never appear desperate. Never burn bridges. HAT Investors is a serious, reliable, multi-property buyer that every listing agent should want to work with again. The listing agent is a partner, not an obstacle — help them succeed while protecting HAT's investment criteria.

HAT PROPOSITION: all-cash · 10–14 day close · as-is · zero contingencies · one decision maker · no renegotiation without valid reason

SELLER MOTIVATION ANALYSIS — before anything else, silently assess:
What is driving this sale? (estate/probate, financial pressure, tired landlord, out-of-state owner, DOM fatigue, previous failed buyer, investor seller, price drops) — the answer determines the entire approach.

LISTING AGENT MOTIVATION — always consider:
They want to close, keep their seller happy, protect their credibility, avoid wasted time, and earn their commission. Frame every interaction to help them achieve that while HAT wins the deal.

COMMUNICATION PRINCIPLES (apply naturally, never name them):
- Acknowledge what the agent is feeling before making any ask
- Name the likely objection BEFORE they raise it — this disarms resistance before it builds
- Ask calibrated "How" and "What" questions to probe real motivation, never yes/no questions
- Let silence work — do not fill every pause with a concession
- Hold the prize frame: HAT is the reliable buyer, the property is one of many we consider
- Build subtle urgency from real facts (capital allocation, deal pipeline, closing calendar)
- Every interaction should make the agent think: "I want to work with these people again"

INVESTOR DISCIPLINE — never encourage increasing the offer simply to "win":
Every recommendation must protect profit margin, ROI, and MAO. If increasing is recommended, state why, how much, and the maximum limit with the risk if exceeded.

OUTPUT FORMAT — plain text only, no markdown, no bold, no asterisks. Each labeled field on its own line exactly as shown. Start immediately with ===== line.

<example>
=====================================
NEGOTIATION PLAN
=====================================
Motivation: HIGH — estate sale, as-is listing, DOM 47 days, two price drops — seller has timeline pressure
Their Priority: Certainty of close — they cannot afford another failed buyer
Leverage: HIGH — motivated seller, DOM supports our number, comps justify ARV, gap is closeable
Opening Offer: $148,000 — anchors 10% below MAO, leaves room to move while protecting profit
Lead With: It seems like this property has been waiting for the right buyer. We're active in this ZIP right now and our capital is ready. Before I share our number — help me understand what matters most to your seller in this transaction.
First Move Tone: Warm empathy, then quiet confidence
If they counter at $175,000 → respond $155,000 | Say: How am I supposed to make the numbers work at that level? Walk me through what's driving it — I want to find a way to make this happen.
If they say the seller won't accept → Say: It sounds like price feels like the sticking point right now. What would have to be true for a 10-day cash close to feel like the right move for them?
If they say we have other offers → Say: That makes sense. I'm not asking you to choose us over a better offer — I'm asking: is there anything about our close certainty that changes the picture?
If they go silent 24hrs → Say: Still thinking about this one. We're locking in our next acquisition this week and wanted to make sure you had first shot before we move on.
If they go silent 48hrs → Say: Following up one more time. Our calendar is filling. If the timing doesn't work, no hard feelings — but let me know so I can plan our week.
If they say can you do better → Say: What number would make your seller feel good? Help me understand what we're working toward and I'll see what I can do.
If counter is within 5% of MAO → increase to MAO | Say: I went back to our team and I can move to [MAO]. That's our ceiling with the reno scope on this one — but we close in 10 days, as-is, cash. Let's get this done.
Walk-Away Price: $163,000
RELATIONSHIP NOTE
After we close this one you're on our short list for every deal in this ZIP. We close fast, clean, and we never renegotiate without a real reason. That's the relationship we want to build with you.
</example>

Write the NEGOTIATION PLAN section only. Analyze the real deal data. Replace all example values with deal-specific content. The more specific and actionable, the better.`

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

  const dom       = lead.days_on_market != null ? `${lead.days_on_market} days` : 'Unknown'
  const priceDrop = lead.price_drop_pct  != null ? `${lead.price_drop_pct}%`   : 'None'
  const rent      = lead.rent_estimate   != null ? fmt(lead.rent_estimate)      : 'Unknown'

  const userPrompt = `PROPERTY: ${addr}
Asking Price: ${fmt(lead.asking_price)}
Our ARV: ${fmt(lead.arv)}
Renovation Estimate: ${fmt(lead.renovation_cost)}
MAO (Max Allowable Offer): ${fmt(lead.mao)}
Property: ${[lead.bedrooms, lead.bathrooms].filter(Boolean).join('BR/') || 'Unknown'}BA | ${lead.sqft ? lead.sqft + ' sqft' : 'Unknown sqft'}
Days on Market: ${dom}
Price Drop History: ${priceDrop}
Est. Rent: ${rent}
Seller Notes: ${lead.notes || 'None'}
Team Comments: ${lead.team_comments || 'None'}

DEAL ANALYSIS SUMMARY (from our AI):
${ai_notes ? ai_notes.slice(0, 3000) : 'No prior analysis available.'}

Write the negotiation plan and all three communications (email, SMS, voicemail) now.`

  const abortCtrl = new AbortController()
  const abortTimer = setTimeout(() => abortCtrl.abort(), 18000)

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
          max_tokens: 1100,
          system: SYSTEM_PROMPT,
          messages: [
            { role: 'user',      content: userPrompt },
            { role: 'assistant', content: '=====================================\nNEGOTIATION PLAN\n=====================================' },
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
    const notes = '=====================================\nNEGOTIATION PLAN\n=====================================\n' + raw
    return new Response(JSON.stringify({ ok: true, notes }), { status: 200, headers: HEADERS })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: HEADERS })
  }
}
