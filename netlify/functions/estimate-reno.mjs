// estimate-reno — HAT Investors
// POST /.netlify/functions/estimate-reno
// Estimates renovation cost from lead notes + property attributes when renovation_cost is unknown.
//
// body: { notes, year_built, sqft, bedrooms, bathrooms, property_type, asking_price, arv }
// Returns: { ok, low, high, midpoint, confidence: 'high'|'medium'|'low', reasoning }
//          low/high/midpoint are null when confidence is 'low' (not enough data to guess)

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { headers: HEADERS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: HEADERS })

  try {
    const { notes, year_built, sqft, bedrooms, bathrooms, property_type, asking_price, arv } = await req.json()

    const hasNotes    = notes && notes.trim().length > 20
    const hasSqft     = sqft && Number(sqft) > 0
    const hasYearBuilt = year_built && Number(year_built) > 0

    // If we have absolutely nothing useful, return low confidence immediately
    if (!hasNotes && !hasSqft && !hasYearBuilt) {
      return new Response(JSON.stringify({
        ok: true, confidence: 'low', low: null, high: null, midpoint: null,
        reasoning: 'Not enough property information to estimate renovation cost.',
      }), { headers: HEADERS })
    }

    const sqftNum  = Number(sqft) || 0
    const yrBuilt  = Number(year_built) || 0
    const arvNum   = Number(arv) || 0
    const askNum   = Number(asking_price) || 0

    // Build heuristic context for the AI
    const yrTier = yrBuilt < 1970 ? 'pre-1970 (likely full gut or major systems)'
      : yrBuilt < 1990 ? '1970-1990 (dated — kitchens, baths, electrical likely need work)'
      : yrBuilt < 2005 ? '1990-2005 (moderate updates likely)'
      : 'post-2005 (usually cosmetic only unless distressed)'

    const arvPricePerSqft = arvNum > 0 && sqftNum > 0 ? (arvNum / sqftNum).toFixed(0) : null
    const askPricePerSqft = askNum > 0 && sqftNum > 0 ? (askNum / sqftNum).toFixed(0) : null

    const prompt = `You are a Florida real estate investor estimating renovation cost for a house.

PROPERTY DATA:
- Type: ${property_type || 'single family'}
- Size: ${sqftNum > 0 ? `${sqftNum} sqft` : 'unknown'}
- Beds/Baths: ${bedrooms || '?'}bd / ${bathrooms || '?'}ba
- Year Built: ${yrBuilt > 0 ? `${yrBuilt} (${yrTier})` : 'unknown'}
- Asking Price: ${askNum > 0 ? '$' + askNum.toLocaleString() : 'unknown'}${askPricePerSqft ? ` ($${askPricePerSqft}/sqft)` : ''}
- ARV: ${arvNum > 0 ? '$' + arvNum.toLocaleString() : 'unknown'}${arvPricePerSqft ? ` ($${arvPricePerSqft}/sqft)` : ''}
${hasNotes ? `- Notes: ${notes.slice(0, 1000)}` : '- Notes: none'}

INDUSTRY BASELINE (Florida SFH):
- Light cosmetic (paint, flooring, fixtures): $5–$15/sqft
- Medium rehab (kitchen, baths, roof): $15–$30/sqft
- Full gut / distressed: $35–$60/sqft
- If year built < 1970 and unknown condition, assume at least medium

TASK: Estimate the renovation budget for this property.

Output ONLY a JSON object, no explanation:
{
  "low": <dollar amount, round to nearest 1000>,
  "high": <dollar amount, round to nearest 1000>,
  "midpoint": <dollar amount, round to nearest 500>,
  "confidence": "<high if notes clearly describe condition, medium if only property attributes, low if guessing>",
  "reasoning": "<one sentence: what drove the estimate>"
}

If truly insufficient data, output: {"confidence":"low","low":null,"high":null,"midpoint":null,"reasoning":"..."}
Only output the JSON, nothing else.`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: '{' },
        ],
      }),
    })

    const data = await res.json()
    const raw  = '{' + (data.content?.[0]?.text || '').trim()

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'Could not parse AI response.' }), { status: 500, headers: HEADERS })
    }

    return new Response(JSON.stringify({
      ok:         true,
      confidence: parsed.confidence || 'low',
      low:        parsed.low        != null ? Math.round(Number(parsed.low))      : null,
      high:       parsed.high       != null ? Math.round(Number(parsed.high))     : null,
      midpoint:   parsed.midpoint   != null ? Math.round(Number(parsed.midpoint)) : null,
      reasoning:  parsed.reasoning  || '',
    }), { headers: HEADERS })

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: HEADERS })
  }
}
