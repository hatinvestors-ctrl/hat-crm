// AI-powered relationship email generator for agent outreach.
//
// POST /.netlify/functions/generate-agent-email
// body: {
//   workspace_id, agent_id,
//   scenario_type: 'intro'|'check_in'|'reactivation'|'post_close'|'passed_deal',
//   sender: 'kevin'|'hat_team',   // 'kevin' = Kevin Bachman persona, 'hat_team' = HAT Investors team
//   context: {
//     agent_name, brokerage, last_contacted_at, last_deal_address, last_deal_status,
//     relationship_status, days_since_contact, deals_linked, market_areas, custom_note
//   }
// }
// Returns: { ok, subject, body, generated_by: 'ai'|'template' }
//
// Required env vars: ANTHROPIC_API_KEY

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

import { NEGOTIATION_FRAMEWORK, HAT_BUYER_PROPOSITION, SELLER_TYPE_PLAYBOOKS } from './lib/negotiation-core.mjs'

const KEVIN_SYSTEM_PROMPT = `You are Kevin Bachman, Broker/Owner of Bachman Property Brokers LLC.
You represent HAT Investors — a Jacksonville-based real estate investment company that actively buys, renovates, and holds properties across the Jacksonville metro area.

Your job is to write professional, relationship-building emails on behalf of HAT Investors to real estate agents, wholesalers, and partners.

## Identity
- From: Kevin Bachman, Broker/Owner, Bachman Property Brokers LLC, (904) 748-9141
- Buyer client: HAT Investors (do NOT name individual people — never mention Tomer or any internal staff)
- HAT Investors buys as-is, cash, closes in 14–21 days

## Output Format (REQUIRED)
Output EXACTLY two sections:
SUBJECT: <the subject line here>

<the full email body starting with the greeting>

End with:
  Kevin Bachman
  Broker/Owner | Bachman Property Brokers LLC
  (904) 748-9141

Plain text only.
${NEGOTIATION_FRAMEWORK}
${HAT_BUYER_PROPOSITION}
${SELLER_TYPE_PLAYBOOKS}`

const HAT_TEAM_SYSTEM_PROMPT = `You are writing on behalf of Tomer Carmelli, principal of HAT Investors.
HAT Investors is a Jacksonville-based real estate investment company that actively buys, renovates, and holds properties across the Jacksonville metro area.

Your job is to write direct, personal emails to wholesalers, agents, and partners — from Tomer, not Kevin.

## Identity
- From: Tomer | HAT Investors
- HAT Investors buys as-is, cash, closes in 10–14 days

## Output Format (REQUIRED)
Output EXACTLY two sections:
SUBJECT: <the subject line here>

<the full email body starting with the greeting>

End with:
  Tomer
  HAT Investors
  (904) 553-1671

Plain text only.
${NEGOTIATION_FRAMEWORK}
${HAT_BUYER_PROPOSITION}
${SELLER_TYPE_PLAYBOOKS}`

const SCENARIO_GUIDANCE = {
  intro: `This is a first introduction to this contact. Goal: establish who we are and what we're looking for. Lead with what we buy (as-is, cash, fast close, motivated sellers, fix-and-flip range). Keep it brief. End with a clear, easy call-to-action (just "keep us in mind" or "reply if you have anything coming up"). Do NOT ask multiple questions.`,

  check_in: `This is a routine check-in to stay top-of-mind. Goal: brief, personal touch — remind them we're actively buying without being pushy. Reference any relevant context (last deal, shared zip codes, time since last contact). Ask one simple question (e.g., "anything in the pipeline?"). Max 3 short paragraphs.`,

  reactivation: `We haven't been in contact for a while (likely 60-90+ days). Goal: re-engage without sounding desperate or annoyed. Acknowledge the gap naturally, share a market-relevant hook, and remind them of our criteria. Plant a seed for future deals. Keep the tone as if we just got busy, not as if we've been waiting.`,

  post_close: `We just closed a deal together (or recently did). Goal: genuine thank-you, reference the specific property if known, express enthusiasm about the relationship, and set up future deals naturally. This is the highest ROI relationship moment — make it personal and warm. Don't pitch, just connect.`,

  passed_deal: `We reviewed their listing but passed. Goal: keep the relationship warm even though we didn't buy this one. Acknowledge we looked at it, briefly explain why it didn't fit (deal math, condition, etc.) without being negative. Clearly state what WOULD work for us. End with a forward-looking note ("keep us in mind for the next one").`,
}

const SPARSE_TEMPLATES = {
  intro: {
    subject: 'Quick intro — HAT Investors, active buyer in Jacksonville',
    body: `Hi there,

I wanted to reach out and introduce ourselves — HAT Investors is an active cash buyer across the Jacksonville metro area. We focus on as-is, distressed, and off-market properties in the fix-and-flip range, and we close in 14–21 days.

If you ever have sellers who need a fast, hassle-free close, we'd love to be your go-to buyer. No showings, no repairs, no financing contingency.

Feel free to reply or call anytime.

HAT Investors Team
(904) 553-1671`,
  },
  check_in: {
    subject: 'Checking in — still actively buying in Jacksonville',
    body: `Hi,

Just a quick check-in — we're still very active in the Jacksonville market and looking for our next deal.

Anything coming up that might fit our profile? As-is, motivated sellers, or off-market opportunities are always on our radar.

Thanks,
HAT Investors Team
(904) 553-1671`,
  },
}

function isContextSparse(ctx) {
  return !ctx.agent_name && !ctx.last_deal_address && !ctx.custom_note && !ctx.brokerage
}

function buildUserPrompt(scenario_type, sender, ctx) {
  const lines = [
    `Write a ${scenario_type.replace('_', ' ')} relationship email to this contact.`,
    '',
    '## Contact Info',
    `Name: ${ctx.agent_name || 'the agent'}`,
    ctx.brokerage ? `Brokerage: ${ctx.brokerage}` : null,
    ctx.relationship_status ? `Relationship status: ${ctx.relationship_status}` : null,
    ctx.market_areas?.length ? `Their market areas (ZIPs): ${ctx.market_areas.join(', ')}` : null,
    '',
    '## Relationship History',
    ctx.days_since_contact != null ? `Days since last contact: ${ctx.days_since_contact}` : 'Last contact: unknown',
    ctx.last_contacted_at ? `Last contacted: ${ctx.last_contacted_at}` : null,
    ctx.deals_linked ? `Deals linked: ${ctx.deals_linked}` : null,
    ctx.last_deal_address ? `Last deal property: ${ctx.last_deal_address}` : null,
    ctx.last_deal_status ? `Last deal status: ${ctx.last_deal_status}` : null,
    ctx.custom_note ? `\nContext hint from user: ${ctx.custom_note}` : null,
    '',
    '## Email Strategy',
    SCENARIO_GUIDANCE[scenario_type] || SCENARIO_GUIDANCE.check_in,
    '',
    'Write the email now. Output SUBJECT: on the first line, then a blank line, then the full email body.',
  ].filter(l => l !== null).join('\n')

  return lines
}

function parseSubjectAndBody(raw) {
  const lines = raw.split('\n')
  let subject = ''
  let bodyStart = 0
  if (lines[0].toUpperCase().startsWith('SUBJECT:')) {
    subject = lines[0].replace(/^SUBJECT:\s*/i, '').trim()
    bodyStart = lines[1] === '' ? 2 : 1
  }
  const body = lines.slice(bodyStart).join('\n').trim()
  return { subject, body }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: HEADERS })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: HEADERS })
  }
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY not configured' }), { status: 500, headers: HEADERS })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const {
      scenario_type = 'check_in',
      sender = 'hat_team',
      context: ctx = {},
    } = body

    const validScenarios = ['intro', 'check_in', 'reactivation', 'post_close', 'passed_deal']
    if (!validScenarios.includes(scenario_type)) {
      return new Response(JSON.stringify({ ok: false, error: `scenario_type must be one of: ${validScenarios.join(', ')}` }), { status: 400, headers: HEADERS })
    }

    // Fall back to hardcoded template if context is too sparse to generate a good email
    if (isContextSparse(ctx) && SPARSE_TEMPLATES[scenario_type]) {
      const tmpl = SPARSE_TEMPLATES[scenario_type]
      return new Response(JSON.stringify({ ok: true, subject: tmpl.subject, body: tmpl.body, generated_by: 'template' }), { status: 200, headers: HEADERS })
    }

    const systemPrompt = sender === 'kevin' ? KEVIN_SYSTEM_PROMPT : HAT_TEAM_SYSTEM_PROMPT
    const userPrompt = buildUserPrompt(scenario_type, sender, ctx)

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      throw new Error(`Claude API error ${claudeRes.status}: ${errText}`)
    }

    const claudeData = await claudeRes.json()
    const raw = claudeData.content?.[0]?.text?.trim() || ''
    const { subject, body: emailBody } = parseSubjectAndBody(raw)

    return new Response(JSON.stringify({ ok: true, subject, body: emailBody, generated_by: 'ai' }), { status: 200, headers: HEADERS })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500, headers: HEADERS })
  }
}
