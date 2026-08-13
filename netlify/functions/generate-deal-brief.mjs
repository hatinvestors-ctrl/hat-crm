// netlify/functions/generate-deal-brief.mjs
// Capability #16 — AI Acquisition Copilot / Deal Brief.
//
// Server-side only. Manual generation ONLY — called exactly once per
// "Generate Deal Brief" click (Section 9); never on a schedule, never on
// page load, never in a loop. AI receives ONLY the bounded, pre-computed
// context from src/lib/dealBriefInputs.js (buildDealBriefContext) — it
// never sees raw scoring weights and is never asked to compute Buy Box,
// MAO, Opportunity, Confidence, or Urgency; those arrive already decided.
//
// POST body: { lead_id }
// Auth: same Supabase session pattern as every other AI function here.

import { createClient } from '@supabase/supabase-js'
import { buildDealBriefContext, computeDealBriefInputHash } from '../../src/lib/dealBriefInputs.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
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

const SYSTEM_PROMPT = `You are an acquisitions assistant for HAT Investors, a Jacksonville FL real estate investment company. You turn ALREADY-DECIDED, pre-computed deal intelligence into a short, practical playbook for Kevin (the acquisitions lead) to execute today.

HARD RULES:
- You do NOT calculate or restate Buy Box fit, MAO, Opportunity, Confidence, Urgency, or price numbers — those are given to you as facts, already decided. Never contradict or "improve" them.
- price_guidance.mao is a STRATEGY-SPECIFIC maximum (price_guidance.strategy tells you which — FLIP or BRRRR). Always name the strategy when you mention it, e.g. "For a Flip, HAT should not exceed $152K" or "The maximum supported BRRRR purchase price is $139K" — never say a bare "MAO" with no strategy attached.
- Use ONLY the facts given. Never invent seller motivation, condition details, financial figures, or names not provided.
- Be concise. This is a scan, not a report.
- For off-market/distressed leads: outreach must be neutral, respectful, and NEVER reference foreclosure/distress/liens/financial hardship, EVEN INDIRECTLY. Do not use phrases like "situations where traditional options aren't working out," "time-sensitive situation," "no strings attached," "we can help," or anything implying you know about the owner's financial, legal, or personal circumstances. The message should read exactly like reaching out about any ordinary property purchase — e.g. "I'm reaching out regarding the property at [address]. We purchase properties directly in the area and wanted to see whether you'd be open to discussing a possible sale." Nothing more.
- If contact info is not available (off-market, "contact_ready": false), the message field must explain what research step comes first — never draft outreach text.
- Never fabricate a person's name — use it only if given.
- If "last_contact" is present in the context (Kevin's most recent logged outcome), use it: the "summary" must state WHAT HAPPENED last time and WHY CONTACT NOW (reference days_since_contact, the prior outcome, and any seller/offer/counter figures given). "questions" must build on what's already known — never re-ask something last_contact already answered. If last_contact is null/absent, this is a first contact — say so plainly, don't imply a prior conversation.

Return ONLY valid JSON, no markdown fences, no other text, in exactly this shape:
{
  "summary": "2-3 sentences max — what this opportunity is and why it matters right now",
  "why": ["max 5 short bullets, evidence-based"],
  "missing": ["max 5 short bullets — what's genuinely missing/unverified"],
  "questions": ["max 5 short, specific questions to ask, tailored to what's actually missing"],
  "objective": "one sentence — the single goal of working this lead right now",
  "message_sms": "a short, natural SMS-length message (or null if not appropriate — e.g. contact not ready)",
  "message_email": "a short, natural email (or null if not appropriate)",
  "risk_notes": ["max 5 short bullets — anything concerning, or empty array"]
}`

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Method not allowed' })
  if (!ANTHROPIC_API_KEY) return json(500, { ok: false, error: 'ANTHROPIC_API_KEY not configured' })

  const user = await authenticateRequest(req)
  if (!user) return json(401, { ok: false, error: 'Unauthorized' })

  try {
    const { lead_id } = await req.json().catch(() => ({}))
    if (!lead_id) return json(400, { ok: false, error: 'lead_id is required' })

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data: lead, error: leadErr } = await supabase.from('leads').select('*').eq('id', lead_id).single()
    if (leadErr || !lead) return json(404, { ok: false, error: 'Lead not found' })
    if (!lead.decision_v2) return json(400, { ok: false, error: 'NO_V2_DECISION — run V2 recalculation first' })

    // Capability #17, Section 9 — last logged outcome (Log Outcome flow),
    // read-only, gives the Copilot WHAT HAPPENED / WHAT CHANGED / WHY
    // CONTACT NOW context without a new table or re-deriving it client-side.
    let contactHistory = null
    const { data: lastOutcomeRow } = await supabase
      .from('lead_activities')
      .select('content, metadata, created_at')
      .eq('lead_id', lead_id)
      .eq('metadata->>event', 'outcome_logged')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lastOutcomeRow) {
      const daysSince = Math.round((Date.now() - new Date(lastOutcomeRow.created_at).getTime()) / 86400000)
      contactHistory = {
        outcome: lastOutcomeRow.metadata?.outcome || null,
        note: lastOutcomeRow.metadata?.note || null,
        seller_expectation: lastOutcomeRow.metadata?.seller_expectation ?? null,
        offer_amount: lastOutcomeRow.metadata?.offer_amount ?? null,
        counter_amount: lastOutcomeRow.metadata?.counter_amount ?? null,
        days_since_contact: daysSince,
      }
    }

    const context = buildDealBriefContext(lead, contactHistory)
    const inputHash = computeDealBriefInputHash(lead)

    // Cache hit — never re-calls the LLM if nothing meaningful changed (Section 10).
    if (lead.deal_brief?.input_hash === inputHash) {
      return json(200, { ok: true, brief: lead.deal_brief, cached: true })
    }

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 900,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(context) }],
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

    const brief = {
      input_hash: inputHash,
      summary: String(parsed.summary || '').slice(0, 600),
      why: Array.isArray(parsed.why) ? parsed.why.slice(0, 5) : [],
      missing: Array.isArray(parsed.missing) ? parsed.missing.slice(0, 5) : [],
      questions: Array.isArray(parsed.questions) ? parsed.questions.slice(0, 5) : [],
      objective: String(parsed.objective || '').slice(0, 300),
      // Contact-readiness guardrail enforced here too, not just in the prompt —
      // never show outreach text for a lead we can't actually contact yet.
      message_sms: context.market_type === 'off_market' && !context.contact_ready ? null : (parsed.message_sms ? String(parsed.message_sms).slice(0, 400) : null),
      message_email: context.market_type === 'off_market' && !context.contact_ready ? null : (parsed.message_email ? String(parsed.message_email).slice(0, 1500) : null),
      risk_notes: Array.isArray(parsed.risk_notes) ? parsed.risk_notes.slice(0, 5) : [],
      price_guidance: context.price_guidance,
      generated_at: new Date().toISOString(),
    }

    const { error: updErr } = await supabase.from('leads').update({ deal_brief: brief, deal_brief_updated_at: brief.generated_at }).eq('id', lead_id)
    if (updErr && !/deal_brief/i.test(updErr.message || '')) {
      console.warn('[generate-deal-brief] write failed (non-fatal):', updErr.message)
    }

    return json(200, { ok: true, brief, cached: false })
  } catch (err) {
    return json(500, { ok: false, error: err.message || String(err) })
  }
}
