// Ask a follow-up question about a specific deal
// POST body: { lead, ai_notes, question, history: [{q, a}] }
// Returns: { ok, answer }

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: HEADERS })
  if (!ANTHROPIC_API_KEY) return new Response(JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY not configured.' }), { status: 500, headers: HEADERS })

  try {
    const { lead, ai_notes, question, history = [] } = await req.json().catch(() => ({}))
    if (!question?.trim()) return new Response(JSON.stringify({ ok: false, error: 'question is required.' }), { status: 400, headers: HEADERS })

    const addr = [lead?.address, lead?.city, lead?.zip_code].filter(Boolean).join(', ')
    const fmt  = n => n != null ? `$${Number(n).toLocaleString()}` : 'Unknown'

    const system = `You are a senior Jacksonville FL real estate investor advisor for HAT Investors. You have already analyzed a deal and the full analysis is below. Answer follow-up questions concisely and with specific numbers. Be direct and opinionated. No hedging.

PROPERTY: ${addr || 'Unknown'} | ${lead?.bedrooms || '?'}BR/${lead?.bathrooms || '?'}BA | ZIP ${lead?.zip_code || '?'}
Ask: ${fmt(lead?.asking_price)} | ARV: ${fmt(lead?.arv)} | Reno: ${fmt(lead?.renovation_cost)} | MAO: ${fmt(lead?.mao)}

FULL ANALYSIS:
${ai_notes || '(no prior analysis)'}

Answer in 3–6 sentences max. Use numbers. If the question is about a scenario change (e.g. different ARV, added bedroom), recalculate and show the new numbers explicitly.`

    // Build message history
    const messages = []
    for (const { q, a } of history.slice(-4)) {
      messages.push({ role: 'user', content: q })
      messages.push({ role: 'assistant', content: a })
    }
    messages.push({ role: 'user', content: question.trim() })

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system,
        messages,
      }),
    })

    if (!res.ok) {
      const t = await res.text()
      throw new Error(`Claude API error ${res.status}: ${t}`)
    }

    const data = await res.json()
    const answer = data.content?.[0]?.text?.trim() || ''
    if (!answer) throw new Error('Empty response from Claude.')

    return new Response(JSON.stringify({ ok: true, answer }), { status: 200, headers: HEADERS })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500, headers: HEADERS })
  }
}
