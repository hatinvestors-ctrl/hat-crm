// scripts/cap16_deal_brief_test.mjs
// Capability #16 — real-lead test of the Deal Brief generation logic,
// bypassing only the Netlify auth wrapper (identical prompt/context/
// parsing to netlify/functions/generate-deal-brief.mjs). No writes.
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { buildDealBriefContext, computeDealBriefInputHash } from '../src/lib/dealBriefInputs.js'

const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const SYSTEM_PROMPT = `You are an acquisitions assistant for HAT Investors, a Jacksonville FL real estate investment company. You turn ALREADY-DECIDED, pre-computed deal intelligence into a short, practical playbook for Kevin (the acquisitions lead) to execute today.

HARD RULES:
- You do NOT calculate or restate Buy Box fit, MAO, Opportunity, Confidence, Urgency, or price numbers — those are given to you as facts, already decided. Never contradict or "improve" them.
- Use ONLY the facts given. Never invent seller motivation, condition details, financial figures, or names not provided.
- Be concise. This is a scan, not a report.
- For off-market/distressed leads: outreach must be neutral, respectful, and NEVER reference foreclosure/distress/liens/financial hardship, EVEN INDIRECTLY. Do not use phrases like "situations where traditional options aren't working out," "time-sensitive situation," "no strings attached," "we can help," or anything implying you know about the owner's financial, legal, or personal circumstances. The message should read exactly like reaching out about any ordinary property purchase — e.g. "I'm reaching out regarding the property at [address]. We purchase properties directly in the area and wanted to see whether you'd be open to discussing a possible sale." Nothing more.
- If contact info is not available (off-market, "contact_ready": false), the message field must explain what research step comes first — never draft outreach text.
- Never fabricate a person's name — use it only if given.

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

const ADDRESSES = [
  '1012 BECKNER Avenue', '5646 RICKER Road', '7859 Denham Rd W',
  '12123   HOPKINTON CT', '11226   BUCKNER LN',
]

async function generateFor(address) {
  const { data } = await supabase.from('leads').select('*').ilike('address', `%${address.trim()}%`).limit(1)
  const lead = data?.[0]
  if (!lead) { console.log('NOT FOUND:', address); return }

  const context = buildDealBriefContext(lead)
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 900, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: JSON.stringify(context) }] }),
  })
  const data2 = await res.json()
  const raw = data2.content?.[0]?.text?.trim()
  let parsed
  try {
    const cleaned = raw.replace(/^```json\s*|\s*```$/g, '').trim()
    const m = cleaned.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(m ? m[0] : cleaned)
  } catch (e) { console.log('PARSE FAIL for', address, raw); return }

  console.log('\n========================================')
  console.log('ADDRESS:', lead.address, '| market:', context.market_type, '| rec:', context.recommendation, '| contact_ready:', context.contact_ready)
  console.log('CONTEXT GIVEN TO AI:', JSON.stringify({ asking: context.asking_price, arv: context.arv, reno: context.renovation_cost, rent: context.rent_estimate, price_guidance: context.price_guidance, distress_type: context.distress_type, owner_name: context.owner_name }))
  console.log('---BRIEF---')
  console.log(JSON.stringify(parsed, null, 1))
  return { address: lead.address, context, brief: parsed }
}

async function main() {
  const results = []
  for (const a of ADDRESSES) {
    const r = await generateFor(a)
    if (r) results.push(r)
  }
  fs.writeFileSync(new URL('./cap16_deal_brief_test_results.json', import.meta.url), JSON.stringify(results, null, 2))
  console.log(`\n\nLLM calls made: ${results.length}`)
}
main().catch(e => { console.error(e); process.exit(1) })
