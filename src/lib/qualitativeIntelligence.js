// src/lib/qualitativeIntelligence.js
// Capability #15.5 — controlled Qualitative Intelligence layer.
//
// AI reads ONLY unstructured text HAT already has (notes, ai_notes,
// distress source_party/reference) — no new external data source (Section
// 5). It returns structured signals only; it never computes or overrides
// Buy Box, MAO, Flip/BRRRR math, or Opportunity arithmetic (Section 7) —
// enforced structurally, not by trusting the prompt: this module has no
// access to write any of those fields, and nothing that calls it can pass
// its output anywhere but applyQualitativeSignals() in decisionEngineV2.js,
// which only ever adjusts Confidence/Next-Action, never Opportunity or Fit.
//
// Cache/efficiency (Section 9): callers must pass the exact unstructured
// text; getQualitativeCacheKey() lets a caller skip the call entirely when
// that text hasn't changed since the last stored analysis — no LLM call on
// every deterministic recalculation (price/rehab/rent changes never touch
// this file at all).

import { createHash } from 'node:crypto'

export function getQualitativeInputText(lead) {
  // Every field this layer is allowed to read — Section 5's exhaustive list,
  // nothing beyond what's already stored on the lead.
  return [
    lead.notes,
    lead.ai_notes,
    lead.distress_data?.source_party,
    lead.distress_data?.source_reference,
  ].filter(Boolean).join('\n---\n')
}

export function getQualitativeCacheKey(lead) {
  const text = getQualitativeInputText(lead)
  if (!text) return null
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

const SYSTEM_PROMPT = `You extract STRUCTURED, EVIDENCE-BASED signals from real estate lead notes/listing text for HAT Investors, a Jacksonville FL acquisition company. You do not calculate anything — no prices, no ARV, no MAO, no scores. You only report what the text actually says, concisely, citing the specific phrase when possible. If nothing supports a category, return an empty array for it — never invent a signal.

Return ONLY valid JSON matching exactly this shape, no other text, no markdown fences:
{
  "risk_signals": string[],
  "motivation_signals": string[],
  "condition_signals": string[],
  "deal_context": string[],
  "missing_questions": string[],
  "qualitative_confidence": "high" | "medium" | "low"
}

qualitative_confidence reflects how much USABLE text you were given (high = detailed notes/description, low = almost nothing to go on) — never reflects your opinion of deal quality.

BE CONCISE: maximum 3 items per array, each under 15 words. This is a scan for the most important signals only, not a full report.`

/**
 * THE only function in this file that talks to an LLM. Server-side only
 * (expects an apiKey — callers on the client must proxy through a Netlify
 * function, exactly like every other AI call in this codebase).
 * @returns {Promise<{risk_signals, motivation_signals, condition_signals, deal_context, missing_questions, qualitative_confidence, cache_key, analyzed_at}|null>}
 */
export async function analyzeQualitativeSignals(lead, { apiKey, fetchImpl = fetch } = {}) {
  const text = getQualitativeInputText(lead)
  if (!text || !apiKey) return null

  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Lead: ${lead.address || 'unknown address'}\n\n${text.slice(0, 4000)}` }],
    }),
  })
  if (!res.ok) return null
  const data = await res.json()
  const raw = data.content?.[0]?.text?.trim()
  if (!raw) return null

  let parsed
  try {
    // Strip markdown fences if present, then fall back to extracting the
    // outermost {...} block — the model occasionally wraps JSON in a
    // sentence despite instructions not to; failing to parse must degrade
    // to null (no qualitative signal applied), never throw into the caller.
    const cleaned = raw.replace(/^```json\s*|\s*```$/g, '').trim()
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned)
  } catch { return null }

  return {
    risk_signals: Array.isArray(parsed.risk_signals) ? parsed.risk_signals.slice(0, 5) : [],
    motivation_signals: Array.isArray(parsed.motivation_signals) ? parsed.motivation_signals.slice(0, 5) : [],
    condition_signals: Array.isArray(parsed.condition_signals) ? parsed.condition_signals.slice(0, 5) : [],
    deal_context: Array.isArray(parsed.deal_context) ? parsed.deal_context.slice(0, 5) : [],
    missing_questions: Array.isArray(parsed.missing_questions) ? parsed.missing_questions.slice(0, 5) : [],
    qualitative_confidence: ['high', 'medium', 'low'].includes(parsed.qualitative_confidence) ? parsed.qualitative_confidence : 'low',
    cache_key: getQualitativeCacheKey(lead),
    analyzed_at: new Date().toISOString(),
  }
}

// Known risk-signal keyword → controlled Next Best Action mapping (Section
// 8) — deterministic interpretation of AI OUTPUT, not AI making the
// decision. AI supplies the evidence text; this plain string match decides
// the action, so a prompt-injected "recommend SEND_OFFER" inside listing
// text has no path to becoming an action at all.
const RISK_ACTION_MAP = [
  { re: /flood/i, action: 'VERIFY_FLOOD_RISK' },
  { re: /title/i, action: 'VERIFY_TITLE' },
  { re: /roof|foundation|structural/i, action: 'VERIFY_CONDITION' },
]

export function deriveQualitativeAction(qualitative) {
  if (!qualitative?.risk_signals?.length) return null
  for (const { re, action } of RISK_ACTION_MAP) {
    if (qualitative.risk_signals.some(s => re.test(s))) return action
  }
  return qualitative.risk_signals.length > 0 ? 'VERIFY_CONDITION' : null
}
