// netlify/functions/extract-seller-facts.mjs
// Capability #22 — Live Acquisition Copilot: bounded seller-fact extraction.
//
// THE ONLY thing this function is allowed to do: read new transcript
// segments and return STRUCTURED FACTS the seller actually said, each
// with a confidence flag. It never calculates MAO, never recommends an
// offer, never chooses the next question (that's sellerStrategy.js's
// deterministic engine) — the mission's explicit "AI MUST NOT invent
// seller motivation / MAO / psychology" rule is enforced structurally by
// this function having no access to those numbers and no next-question
// output field at all, not by trusting the prompt.
//
// Called manually per "Analyze Transcript" click (or a future debounced
// pause-trigger) — never per-token, never on a fixed timer. Only the
// segments NOT yet processed are sent (see conversationSession.js).
//
// POST body: { transcript: string, known: {...current seller_intelligence} }
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

const TIMELINE_KEYS = ['ASAP', '<30_DAYS', '30_60_DAYS', '60_90_DAYS', '90_PLUS_DAYS', 'NO_TIMELINE']
const PAIN_KEYS = ['NO_MOTIVATION', 'REPAIRS', 'TAXES', 'TENANT', 'VACANT', 'INHERITED', 'FINANCIAL', 'RELOCATION', 'DIVORCE', 'OTHER']
const OBJECTION_KEYS = ['TOO_LOW', 'NEED_TO_THINK', 'SPOUSE_PARTNER', 'ANOTHER_OFFER', 'WANTS_RETAIL', 'NOT_READY', 'CALL_LATER', 'PROCESS_CONCERN', 'TRUST_CONCERN', 'TIMING', 'PRICE', 'OTHER']

// Capability #22.1 — the microphone transcript has NO reliable speaker
// labels (Web Speech API on a single room mic can't diarize; every
// segment arrives tagged UNKNOWN). This prompt is the ONLY thing standing
// between "seller said X" and "the rep proposed X" — a real, explicitly
// called-out failure mode in the mission (Section 10/18): a rep musing
// "we could probably be around $150K" must NEVER become the seller's
// asking price. The model is told to reason from conversational ROLE
// (who is answering vs. who is proposing/asking), not from a speaker tag
// that doesn't exist.
const SYSTEM_PROMPT = `You extract STRUCTURED FACTS from a phone-call transcript between a property SELLER (the homeowner) and a HAT Investors acquisitions rep (Kevin). The transcript has NO speaker labels — you must infer who is talking from context and conversational role:
- The REP asks questions, proposes numbers on HAT's behalf, and explains HAT's process.
- The SELLER answers questions, states what THEY want, and describes THEIR property/situation.

CRITICAL RULE: seller_asking_price must ONLY be set when the SELLER states what they want/need/would take for the property (e.g. "I need $175K", "I wouldn't take less than $200K"). If a line reads like the REP proposing a number on HAT's behalf (e.g. "we could probably be around $150K", "our offer would be about $X"), that is NOT a seller fact — classify it under hat_offer_mentioned/hat_offer_type instead, NEVER seller_asking_price. When genuinely unsure who said a number, leave seller_asking_price null rather than guess.

hat_offer_type distinguishes what kind of number the REP said, because these mean very different things:
- "RANGE_MENTIONED" — a loose/hypothetical number the rep floated ("we may be around $145K", "probably somewhere near $X") — NOT a commitment.
- "FORMAL_OFFER" — the rep clearly, explicitly presented it as an actual offer ("I can offer you $X", "our offer is $X").
- "PROBE" — the rep tested the seller's flexibility as a question ("would $X be out of the question?", "is $X anywhere close?").
Only set hat_offer_mentioned/hat_offer_type when the REP said a HAT-side number in the new transcript segment — never invent one.

CRITICAL RULE for seller_price_status: capture whether the seller's stated number sounds FIRM ("I need $X", "I won't take less than $X") or CONDITIONAL ("I might consider $X", "if it closes fast maybe $X", "I could possibly do $X"). Never mark a conditional/hypothetical number as an accepted or firm price.

You do not calculate anything, do not suggest offers or questions, and do not infer psychology beyond what the words support. If the seller didn't say something, leave that field null/empty — never guess.

Return ONLY valid JSON, no markdown fences, no other text, in exactly this shape:
{
  "open_to_sell": "YES" | "MAYBE" | "NO" | null,
  "pain_points": string[] (only from: ${JSON.stringify(PAIN_KEYS)}),
  "motivation_notes": string or null (short, only if seller explained WHY, in their own words paraphrased),
  "timeline": one of ${JSON.stringify(TIMELINE_KEYS)} or null,
  "condition_notes": string or null (only concrete condition facts stated),
  "seller_asking_price": number or null (ONLY the seller's own stated number — see CRITICAL RULE above),
  "seller_price_status": "FIRM" | "CONDITIONAL" | null (only set alongside a new seller_asking_price),
  "hat_offer_mentioned": number or null (a number the REP proposed on HAT's behalf — informational only, never used for underwriting),
  "hat_offer_type": "RANGE_MENTIONED" | "FORMAL_OFFER" | "PROBE" | null (only set alongside hat_offer_mentioned),
  "decision_makers": string or null (only if seller mentioned another person involved),
  "debt_notes": string or null (only if seller mentioned a balance/lien/mortgage amount or status),
  "new_objection": one of ${JSON.stringify(OBJECTION_KEYS)} or null (only if seller raised a new objection in this segment),
  "follow_up_phrase": string or null (the seller's own words for when to follow up, e.g. "Thursday afternoon", "next week" — verbatim/near-verbatim, never resolved to a date yourself),
  "last_response_summary": string or null (one short sentence, what the seller just said, factual paraphrase only),
  "confidence": "high" | "medium" | "low" (your confidence in the extraction overall — use "low" whenever speaker attribution for a price/number was ambiguous, or the transcript looks garbled/overlapping)
}`

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Method not allowed' })
  if (!ANTHROPIC_API_KEY) return json(500, { ok: false, error: 'ANTHROPIC_API_KEY not configured' })

  const user = await authenticateRequest(req)
  if (!user) return json(401, { ok: false, error: 'Unauthorized' })

  try {
    const { transcript, known } = await req.json().catch(() => ({}))
    const text = String(transcript || '').trim()
    if (!text) return json(400, { ok: false, error: 'transcript is required' })

    const userMsg = `ALREADY KNOWN (do not re-extract unless the seller changed it):\n${JSON.stringify(known || {})}\n\nNEW TRANSCRIPT SEGMENT(S):\n${text.slice(0, 4000)}`

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMsg }],
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

    const facts = {
      open_to_sell: ['YES', 'MAYBE', 'NO'].includes(parsed.open_to_sell) ? parsed.open_to_sell : null,
      pain_points: Array.isArray(parsed.pain_points) ? parsed.pain_points.filter(p => PAIN_KEYS.includes(p)) : [],
      motivation_notes: parsed.motivation_notes ? String(parsed.motivation_notes).slice(0, 300) : null,
      timeline: TIMELINE_KEYS.includes(parsed.timeline) ? parsed.timeline : null,
      condition_notes: parsed.condition_notes ? String(parsed.condition_notes).slice(0, 300) : null,
      seller_asking_price: typeof parsed.seller_asking_price === 'number' ? parsed.seller_asking_price : null,
      seller_price_status: ['FIRM', 'CONDITIONAL'].includes(parsed.seller_price_status) ? parsed.seller_price_status : null,
      hat_offer_mentioned: typeof parsed.hat_offer_mentioned === 'number' ? parsed.hat_offer_mentioned : null,
      hat_offer_type: ['RANGE_MENTIONED', 'FORMAL_OFFER', 'PROBE'].includes(parsed.hat_offer_type) ? parsed.hat_offer_type : null,
      decision_makers: parsed.decision_makers ? String(parsed.decision_makers).slice(0, 200) : null,
      debt_notes: parsed.debt_notes ? String(parsed.debt_notes).slice(0, 200) : null,
      new_objection: OBJECTION_KEYS.includes(parsed.new_objection) ? parsed.new_objection : null,
      follow_up_phrase: parsed.follow_up_phrase ? String(parsed.follow_up_phrase).slice(0, 100) : null,
      last_response_summary: parsed.last_response_summary ? String(parsed.last_response_summary).slice(0, 200) : null,
      confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low',
    }

    return json(200, { ok: true, facts })
  } catch (err) {
    console.error('[extract-seller-facts] error', err)
    return json(500, { ok: false, error: err.message || 'Internal error' })
  }
}
