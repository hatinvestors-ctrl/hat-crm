// netlify/functions/generate-call-review.mjs
// Capability #24 — HAT Acquisition Coach: post-call Call Review.
//
// Scores the qualitative conversation (docs/acquisition-coach/
// scoring-rubric.md) and identifies coaching moments/strengths — the ONE
// place in this capability an LLM call happens. Everything financial
// (Max Buy, offer numbers) is passed in as CANONICAL FINANCIALS, same
// authority contract established for generate-comps.mjs (Comps
// Intelligence AI-authority fix) — the model must copy those numbers
// exactly, never recalculate them. Every returned coaching moment/strong
// move is independently re-verified client-side against the real
// transcript (src/lib/callCoaching.js's verifyCoachingMoments) before it's
// ever shown — this function's own prompt instructions are not trusted as
// the only safeguard.
//
// POST /.netlify/functions/generate-call-review
// body: { transcript: string, sellerIntelligence: object, canonical: { maxBuy, maxBuyStrategy, sellerPrice, currentOffer } }
// Returns: { ok, review: { scores: [{key, score, why}], strengths: [...], missedOpportunity: {...}, coachingMoments: [...], strongMoves: [...], sellerOutcomeSummary: string } }

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

// Exported (additive only, no behavior change) so the rubric/authority
// contract is directly unit-testable without a live LLM call — same
// pattern as generate-core-analysis.mjs / generate-comps.mjs.
export const SYSTEM_PROMPT = `You are an acquisitions sales coach reviewing a real cold-call transcript for HAT Investors, scoring it against a fixed rubric.

CANONICAL AUTHORITY CONTRACT — READ FIRST:
The CANONICAL FINANCIALS block in the prompt (Max Buy, Current Offer, Seller Price) is authoritative. Copy those numbers exactly wherever you reference them. Do NOT calculate, restate, or imply a different Max Buy. Do NOT recommend or imply an offer above the supplied Max Buy. Your job is entirely QUALITATIVE — coaching on how the rep handled the conversation, never on the financial numbers themselves.

EVIDENCE CONTRACT — READ FIRST:
Every coaching moment and every strong move you identify MUST include an EXACT quote copied verbatim from the transcript (sellerQuote and/or repQuote). Do NOT paraphrase a quote. Do NOT invent a quote. If you cannot find a genuine transcript line supporting a coaching moment, do NOT include that moment — an empty list is correct when the evidence isn't there. Never invent a seller statement that isn't in the transcript.

SCORING RULE: Score based on observable rep BEHAVIOR against the rubric below, never on whether the seller ultimately agreed to sell or accepted a price. A rep can run a strong call that doesn't produce a deal.

Score exactly these 9 dimensions, 0-10 each, each with a one-sentence "why" citing what actually happened in the transcript:
OPENING_RAPPORT, MOTIVATION_DISCOVERY, PAIN_DEPTH, PROPERTY_DISCOVERY, TIMELINE, PRICE_DISCOVERY, DECISION_MAKERS, NEGOTIATION, COMMITMENT

Write EXACTLY this JSON shape and nothing else — no markdown, no prose outside the JSON:
{
  "scores": [{"key": "OPENING_RAPPORT", "score": 0, "why": "..."}, ... all 9 keys],
  "strengths": ["...", "..."],
  "missedOpportunity": {"summary": "...", "sellerQuote": "...", "repQuote": "...", "betterQuestion": "...", "why": "..."},
  "coachingMoments": [{"sellerQuote": "...", "repQuote": "...", "coach": "...", "betterQuestion": "...", "why": "..."}],
  "strongMoves": [{"sellerQuote": "...", "repQuote": "...", "why": "..."}],
  "sellerOutcomeSummary": "1-2 sentences, facts only, no speculation beyond the transcript"
}

Max 3 strengths, max 3 coachingMoments, max 3 strongMoves. Exactly 1 missedOpportunity (the single highest-value improvement, not a list of criticisms).`

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: HEADERS })

  const body = await req.json().catch(() => ({}))
  const { transcript, sellerIntelligence = {}, canonical = {} } = body

  if (!transcript || !transcript.trim()) {
    return new Response(JSON.stringify({ ok: false, error: 'transcript required' }), { status: 400, headers: HEADERS })
  }

  const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : 'Unknown'

  const userPrompt = `CANONICAL FINANCIALS (authoritative — copy exactly, never recalculate):
Max Buy: ${fmt(canonical.maxBuy)}${canonical.maxBuyStrategy ? ` (${canonical.maxBuyStrategy})` : ''}
Current Offer: ${fmt(canonical.currentOffer)}
Seller Asking Price: ${fmt(canonical.sellerPrice)}

CAPTURED SELLER INTELLIGENCE (for context only, do not restate as if it were the transcript):
${JSON.stringify(sellerIntelligence)}

TRANSCRIPT:
${transcript}

Score this call against the rubric and return the JSON shape exactly as specified.`

  const abortCtrl = new AbortController()
  const abortTimer = setTimeout(() => abortCtrl.abort(), 25000)

  try {
    let resp
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2000,
          temperature: 0,
          system: SYSTEM_PROMPT,
          // Bug fix (found on first live production test) — an
          // assistant-turn prefill of "{" is the standard way to force
          // Claude to start its reply exactly at the JSON object, instead
          // of a markdown code fence or a sentence of preamble despite the
          // prompt saying "no prose outside the JSON." Same technique
          // generate-comps.mjs already uses (prefilled with its first
          // section header) — not a new pattern.
          messages: [
            { role: 'user', content: userPrompt },
            { role: 'assistant', content: '{' },
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
    const continuation = data.content?.[0]?.text?.trim() || ''
    // The prefilled "{" isn't echoed back by the API, so it must be
    // re-added before parsing. Still defensively strip markdown fences and
    // extract the outermost {...} in case the model adds anything else
    // around it (same defensive parse extract-seller-facts.mjs already uses).
    const raw = '{' + continuation
    let review
    try {
      const cleaned = raw.replace(/```json\s*|```/g, '').trim()
      const m = cleaned.match(/\{[\s\S]*\}/)
      review = JSON.parse(m ? m[0] : cleaned)
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'Call review response was not valid JSON.' }), { status: 502, headers: HEADERS })
    }
    return new Response(JSON.stringify({ ok: true, review }), { status: 200, headers: HEADERS })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: HEADERS })
  }
}
