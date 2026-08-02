// parse-sow — HAT Investors
// POST /.netlify/functions/parse-sow
// body: { text: string }
// Returns: { ok, items: [{ category, description, estimated_cost }] }

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

const CATEGORIES = [
  'Foundation', 'Roofing', 'Exterior', 'HVAC', 'Plumbing', 'Electrical',
  'Insulation', 'Drywall', 'Flooring', 'Kitchen', 'Bathrooms', 'Painting',
  'Windows & Doors', 'Trim & Millwork', 'Landscaping', 'Permits & Fees',
  'Demo', 'Cleaning', 'Other',
]

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { headers: HEADERS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: HEADERS })

  try {
    const { text } = await req.json()
    if (!text?.trim()) return new Response(JSON.stringify({ ok: false, error: 'No text provided' }), { status: 400, headers: HEADERS })

    const prompt = `You are parsing a contractor Scope of Work (SOW) document for a real estate renovation project.

Extract every line item and return ONLY a JSON array. No explanation, no markdown — just the raw JSON array.

Each item must have:
- category: one of [${CATEGORIES.join(', ')}]
- description: short description of the work (max 80 chars)
- estimated_cost: number (dollars, no $ sign, no commas)

If a line has no cost, use 0.
If the category is unclear, use "Other".
Combine very similar items into one line.
Skip lines that are clearly headers, totals, or non-work items (like "Total", "Grand Total", "Labor", "Material" headers).

SOW text:
${text.slice(0, 8000)}

Return ONLY the JSON array, e.g.:
[{"category":"Kitchen","description":"Cabinet replacement and countertops","estimated_cost":8500},...]`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }, { role: 'assistant', content: '[' }],
      }),
    })

    const data = await res.json()
    const raw = '[' + (data.content?.[0]?.text || '').trim()

    let items
    try {
      items = JSON.parse(raw)
      if (!Array.isArray(items)) throw new Error('Not an array')
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'Could not parse AI response. Try a simpler format.' }), { status: 500, headers: HEADERS })
    }

    // Sanitize
    const cleaned = items
      .filter(i => i && typeof i === 'object')
      .map(i => ({
        category:       CATEGORIES.includes(i.category) ? i.category : 'Other',
        description:    String(i.description || '').slice(0, 120),
        estimated_cost: Math.max(0, Number(i.estimated_cost) || 0),
      }))
      .filter(i => i.description)

    return new Response(JSON.stringify({ ok: true, items: cleaned }), { headers: HEADERS })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: HEADERS })
  }
}
