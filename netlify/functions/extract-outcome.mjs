// netlify/functions/extract-outcome.mjs
// Capability #17, Section 5 — Natural-language note extraction.
//
// Stateless: takes Kevin's free-text note and returns ONLY structured
// suggestions for the Log Outcome form fields — outcome, seller price
// expectation, condition signal, follow-up timing, next action. It never
// writes to the database and never touches Buy Box/ARV/MAO/Flip-BRRRR
// economics/Opportunity score — this function has no DB write path at all,
// so it structurally cannot invent or persist deal data. Kevin sees the
// suggestions pre-filled in the form and must press Save himself — nothing
// here is auto-applied.
//
// POST body: { note: string }
// Auth: same Supabase session pattern as every other AI function here.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const HEADERS = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,authorization', 'access-control-allow-methods': 'POST,OPTIONS' }
function json(status, body) { return new Response(JSON.stringify(body), { status, headers: HEADERS }) }

async function authenticateRequest(req) {
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { data, error } = await anon.auth.getUser(token)
  if (error || !data?.user) return null
  return data.user
}

const OUTCOME_KEYS = ['no_answer', 'spoke_follow_up', 'offer_sent', 'offer_rejected', 'counter_received', 'need_more_info', 'not_interested', 'dead_lead']

const SYSTEM_PROMPT = `You extract STRUCTURED fields from a short free-text note an acquisitions rep just typed after contacting a seller/agent about a property lead, for HAT Investors (Jacksonville FL). You do NOT calculate anything, invent numbers, or infer facts not stated in the text. If a field isn't clearly supported by the text, return null (or empty array) for it — never guess.

Return ONLY valid JSON, no markdown fences, no other text, in exactly this shape:
{
  "outcome": one of ${JSON.stringify(OUTCOME_KEYS)} or null,
  "seller_expectation": number or null,
  "offer_amount": number or null,
  "counter_amount": number or null,
  "condition_signal": string or null,
  "follow_up_days": number or null,
  "next_action": string or null
}

outcome: pick the single closest match to what the note describes, or null if unclear.
seller_expectation/offer_amount/counter_amount: only if the note states a specific dollar figure for that exact thing.
follow_up_days: only if the note implies a specific timeframe (e.g. "call back in 3 days" → 3, "next week" → 7). Never invent a default.`

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Method not allowed' })
  if (!ANTHROPIC_API_KEY) return json(500, { ok: false, error: 'ANTHROPIC_API_KEY not configured' })

  const user = await authenticateRequest(req)
  if (!user) return json(401, { ok: false, error: 'Unauthorized' })

  try {
    const { note } = await req.json().catch(() => ({}))
    const text = String(note || '').trim()
    if (!text) return json(400, { ok: false, error: 'note is required' })

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: text.slice(0, 2000) }],
      }),
    })
    if (!claudeRes.ok) return json(502, { ok: false, error: `Claude API error ${claudeRes.status}` })
    const claudeData = await claudeRes.json()
    const raw = claudeData.content?.[0]?.text?.trim()
    if (!raw) return json(502, { ok: false, error: 'Empty AI response' })

    let parsed
    try {
      const cleaned = raw.replace(/^```json\s*|\s*```$/g, '').trim()
      const m = cleaned.match(/\{[\s\S]*\}/)
      parsed = JSON.parse(m ? m[0] : cleaned)
    } catch {
      return json(502, { ok: false, error: 'AI response was not valid JSON' })
    }

    const suggestion = {
      outcome: OUTCOME_KEYS.includes(parsed.outcome) ? parsed.outcome : null,
      seller_expectation: typeof parsed.seller_expectation === 'number' ? parsed.seller_expectation : null,
      offer_amount: typeof parsed.offer_amount === 'number' ? parsed.offer_amount : null,
      counter_amount: typeof parsed.counter_amount === 'number' ? parsed.counter_amount : null,
      condition_signal: parsed.condition_signal ? String(parsed.condition_signal).slice(0, 200) : null,
      follow_up_days: typeof parsed.follow_up_days === 'number' ? Math.round(parsed.follow_up_days) : null,
      next_action: parsed.next_action ? String(parsed.next_action).slice(0, 200) : null,
    }

    return json(200, { ok: true, suggestion })
  } catch (err) {
    console.error('[extract-outcome] error', err)
    return json(500, { ok: false, error: err.message || 'Internal error' })
  }
}
