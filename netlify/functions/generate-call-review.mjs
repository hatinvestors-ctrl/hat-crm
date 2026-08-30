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
// body: { transcript: string, sellerIntelligence: object, canonical: { maxBuy, maxBuyStrategy, sellerPrice, currentOffer }, activeFocus?: { skillKey, title, recommendation }, callContext?: { type, callNumber, previous } }
// Returns: { ok, review: { scores: [{key, score, why}] | [{key, applicable:false, reason}], strengths: [...], missedOpportunity: {...}, coachingMoments: [...], strongMoves: [...], sellerOutcomeSummary: string, primaryCoachingFocus: {...}, focusAdherence: {...}|null } }
//
// Context-Aware Call Coaching / Multi-Call Seller Journey V1 — `callContext`
// is optional and additive (src/lib/callContext.js builds it, deterministically,
// from real call_sessions/call_reviews history — never fabricated, never a
// second AI call). When present, it tells the model whether this is a
// first conversation with this seller or a continuation, and what real
// facts were already established last time, so a dimension that was
// genuinely already resolved can be marked applicable:false with a reason
// instead of being scored low for "not being re-discovered." Omitting
// callContext (legacy caller, or a first call with no history) produces
// the EXACT same prompt/behavior as before this capability.
//
// Capability #25.2 — extends #24's output with a `primaryCoachingFocus`
// suggestion (always) and a `focusAdherence` evaluation (only when the
// caller passes `activeFocus`, i.e. the rep already has one). BOTH are
// treated as untrusted AI CLAIMS by the caller — src/lib/coachingMemory.js
// deterministically validates skill_key against the real rubric and
// requires verifiable transcript evidence for any adherence result other
// than NOT_APPLICABLE, exactly the same distrust-by-default pattern
// callCoaching.js already applies to coachingMoments/strongMoves. The
// SYSTEM never asks the model "is this rep improving" — that's computed
// from persisted history in coachingMemory.js, never here.

import { parseCallReviewResponse, fmtParseErrorForUser, classifyRequestError, fmtRequestErrorForUser } from '../../src/lib/callReviewParser.js'

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

Score exactly these 9 dimensions, 0-10 each, each with a one-sentence "why" citing what actually happened in the transcript. IMPORTANT — "captured" vs. "score" are DIFFERENT questions: a topic can be captured (the rep got SOME information on it) while still scoring low (the rep never went deep, never explored consequence/impact, or explored it only superficially before moving on). When that happens, you MUST fill in "captured" (what information was actually obtained) and "missing" (what depth/execution was absent) so a low score next to a captured topic is never presented as a contradiction — it is a real, explainable distinction. Leave captured/missing as empty strings only when there's nothing meaningful to add beyond "why".
OPENING_RAPPORT, MOTIVATION_DISCOVERY, PAIN_DEPTH, PROPERTY_DISCOVERY, TIMELINE, PRICE_DISCOVERY, DECISION_MAKERS, NEGOTIATION, COMMITMENT

CONTEXT-AWARE SCORING (only matters when a CALL CONTEXT / PREVIOUS CALL CONTEXT block is supplied below) — a repeat call with the same seller is part of a continuing journey, not a fresh cold call:
- If a dimension's information was ALREADY genuinely established in the PREVIOUS CALL CONTEXT and nothing in THIS transcript required revisiting it, that dimension is NOT_APPLICABLE for THIS call. Return it as {"key": "...", "applicable": false, "reason": "..."} INSTEAD of a score/why pair — the reason must cite what was already established and why it didn't need revisiting. A rep must NEVER be penalized with a low score merely for not re-asking something already answered last time; correctly SKIPPING it is good behavior, not a gap.
- The reverse is just as important — NEVER mark a dimension not-applicable to hide poor performance. If a dimension was genuinely relevant to THIS call (e.g. price is actively being discussed, or the previous context is unresolved/open) and the rep avoided or mishandled it, it MUST still be scored normally (0-10), never marked applicable:false.
- A GOOD follow-up explicitly reconnects to what was already known (e.g. referencing a prior objection, decision-maker, or commitment) and moves the conversation forward rather than restarting broad discovery. A BAD follow-up ignores real prior context and re-asks already-answered questions, or fails to progress an open loop (like the previous call's promised follow-up). Reflect this in strengths/missedOpportunity/sellerOutcomeSummary and in the "why" of the dimensions that ARE scored — do NOT invent a new dimension or numeric metric for "continuity" itself.
- Every dimension entry must be EITHER a scored entry ({"key","score","why","captured","missing"}) OR a not-applicable entry ({"key","applicable":false,"reason"}) — never a mix of both shapes in one entry, and every one of the 9 keys must appear exactly once, one way or the other.

STRONG MOVE NUANCE — every strongMove needs a "nuance" classification: "STRONG" (unqualified good execution), "GOOD_BUT_EARLY" (the individual behavior was good, but it happened before enough groundwork — e.g. asking price before understanding motivation/pain), "GOOD_BUT_LATE" (good behavior that came too late to matter as much as it could have), "MIXED" (real positives and real problems in the same moment), "GOOD" (solid, unremarkable). CRITICAL: if you also flag a coachingMoment or the missedOpportunity criticizing the SAME rep quote or the same underlying behavior, the strongMove for that behavior must NOT be plain "STRONG" — use "GOOD_BUT_EARLY"/"GOOD_BUT_LATE"/"MIXED" instead, so the review never praises and criticizes the identical behavior without explaining the nuance.

PRIMARY COACHING FOCUS — always include one. It must be behavioral, actionable, observable in a future call, and narrow enough to measure (bad: "be better at sales"; good: "when the seller reveals pain, ask at least one follow-up question before moving to condition or price"). skillKey MUST be one of the 9 dimension keys above — the single dimension this focus most directly targets.

FOCUS ADHERENCE — ONLY if an ACTIVE COACHING FOCUS is supplied in the prompt below. Determine whether THIS call's transcript shows the rep applying that specific focus. First decide opportunityExisted (true/false): did a moment in THIS transcript actually create a chance to apply the focus? Use PREVIOUS CALL CONTEXT (when supplied) to judge this honestly — if the focus targets something already fully resolved in a prior call and nothing in THIS transcript reopened it, opportunityExisted is false. If false, result MUST be "NOT_APPLICABLE" — never penalize a rep for a situation that never arose. If true, result MUST be one of "APPLIED" / "PARTIALLY_APPLIED" / "NOT_APPLIED", backed by an EXACT verbatim quote (sellerQuote and/or repQuote) from THIS transcript — the same no-paraphrase, no-invention rule as the evidence contract above. If no ACTIVE COACHING FOCUS is supplied, omit focusAdherence entirely (set it to null).

DISTINCT INSIGHTS ONLY — each coachingMoment must be about a DIFFERENT moment/topic. Do not report the same underlying exchange (same seller statement, same rep response) as two separate coaching moments even if you'd phrase the coaching note slightly differently each time.

Write EXACTLY this JSON shape and nothing else — no markdown, no prose outside the JSON:
{
  "scores": [{"key": "OPENING_RAPPORT", "score": 0, "why": "...", "captured": "...", "missing": "..."}, ... all 9 keys — OR, for a dimension that is genuinely not applicable to THIS call (see CONTEXT-AWARE SCORING above): {"key": "PROPERTY_DISCOVERY", "applicable": false, "reason": "..."}],
  "strengths": ["...", "..."],
  "missedOpportunity": {"summary": "...", "sellerQuote": "...", "repQuote": "...", "betterQuestion": "...", "why": "..."},
  "coachingMoments": [{"sellerQuote": "...", "repQuote": "...", "coach": "...", "betterQuestion": "...", "why": "..."}],
  "strongMoves": [{"sellerQuote": "...", "repQuote": "...", "why": "...", "nuance": "STRONG"}],
  "sellerOutcomeSummary": "1-2 sentences, facts only, no speculation beyond the transcript",
  "primaryCoachingFocus": {"skillKey": "...", "title": "...", "recommendation": "...", "exampleQuestions": ["...", "..."]},
  "focusAdherence": {"opportunityExisted": true, "result": "APPLIED", "why": "...", "sellerQuote": "...", "repQuote": "..."}
}

Max 3 strengths, max 3 coachingMoments, max 3 strongMoves. Exactly 1 missedOpportunity (the single highest-value improvement, not a list of criticisms). Exactly 1 primaryCoachingFocus. focusAdherence is null when no active focus was supplied.`

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: HEADERS })

  const body = await req.json().catch(() => ({}))
  const { transcript, sellerIntelligence = {}, canonical = {}, activeFocus = null, callContext = null } = body

  if (!transcript || !transcript.trim()) {
    return new Response(JSON.stringify({ ok: false, error: 'transcript required' }), { status: 400, headers: HEADERS })
  }

  const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : 'Unknown'

  const activeFocusBlock = activeFocus
    ? `\nACTIVE COACHING FOCUS (evaluate adherence against this in THIS transcript):\nSkill: ${activeFocus.skillKey}\nTitle: ${activeFocus.title}\nRecommendation: ${activeFocus.recommendation}\n`
    : '\nACTIVE COACHING FOCUS: none — this rep has no prior focus yet. Set focusAdherence to null.\n'

  // Context-Aware Call Coaching V1 — optional, additive. callContext comes
  // from src/lib/callContext.js (deterministic, real call_sessions/
  // call_reviews history — never fabricated here or client-side). Omitted
  // entirely when there's no history (first call) or the caller doesn't
  // supply one (legacy behavior, unchanged).
  const callContextBlock = callContext
    ? `\nCALL CONTEXT: ${callContext.type.replace(/_/g, ' ')} — this is call #${callContext.callNumber} with this seller.\n` +
      (callContext.previous
        ? `PREVIOUS CALL CONTEXT (real facts from the last call with this seller — use to judge continuity, do not restate as if it happened in THIS transcript):\n${JSON.stringify(callContext.previous)}\n`
        : '')
    : ''

  const userPrompt = `CANONICAL FINANCIALS (authoritative — copy exactly, never recalculate):
Max Buy: ${fmt(canonical.maxBuy)}${canonical.maxBuyStrategy ? ` (${canonical.maxBuyStrategy})` : ''}
Current Offer: ${fmt(canonical.currentOffer)}
Seller Asking Price: ${fmt(canonical.sellerPrice)}

CAPTURED SELLER INTELLIGENCE (for context only, do not restate as if it were the transcript):
${JSON.stringify(sellerIntelligence)}
${activeFocusBlock}${callContextBlock}
TRANSCRIPT (full call — use it as a whole to understand sequencing, not just isolated lines):
${transcript}

Score this call against the rubric and return the JSON shape exactly as specified.`

  // P0 Timeout Investigation & Fix (2026-08-30) — real finding: this
  // account's actual Netlify platform ceiling is 26s (see netlify.toml's
  // comment on this function). The old 25s abort left only ~1s of margin
  // against that real ceiling; lowered to 20s for the same safe margin
  // used by every sibling AI-calling function, while still comfortably
  // covering the ~20.6-20.9s historical successful-call duration.
  const abortCtrl = new AbortController()
  const abortTimer = setTimeout(() => abortCtrl.abort(), 20000)

  try {
    let resp
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          // Part 3 — real production bug: max_tokens was sized for #24's
          // original schema and never increased despite #25.2
          // (primaryCoachingFocus + focusAdherence, two new objects) and
          // #25.3A (captured/missing on all 9 dimension scores, nuance on
          // every strong move) — a rich, high-coverage call's real output
          // is estimated at 1400-1900+ tokens against the old 2000 ceiling.
          // Doubled with real margin; see docs/acquisition-coach/ for the
          // full incident writeup.
          max_tokens: 4096,
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
    const stopReason = data.stop_reason
    // The prefilled "{" isn't echoed back by the API, so it must be
    // re-added before parsing — parseCallReviewResponse() (src/lib/
    // callReviewParser.js) does the rest: strips markdown fences,
    // brace-balance-scans for a complete JSON object (correctly
    // distinguishing genuine truncation from a normal malformed
    // response), and parses. Pure/unit-tested, no behavior duplicated here.
    const raw = '{' + continuation
    const parsed = parseCallReviewResponse(raw, stopReason)

    if (!parsed.ok) {
      // Diagnostic logging (Part 2/6 gap fix) — safe: counts/codes/stop
      // reason only, NEVER the transcript or the model's actual text
      // (which could contain seller PII). This is the exact gap that made
      // the original production failure unrecoverable from logs.
      console.error('[generate-call-review] parse failure', {
        code: parsed.code, stopReason, continuationLength: continuation.length, detail: parsed.detail,
      })
      return new Response(JSON.stringify({ ok: false, code: parsed.code, error: fmtParseErrorForUser(parsed.code) }), { status: 502, headers: HEADERS })
    }
    return new Response(JSON.stringify({ ok: true, review: parsed.review }), { status: 200, headers: HEADERS })
  } catch (e) {
    // Incident follow-up ("This operation was aborted") — this outer
    // catch previously had ZERO logging/classification, the same class
    // of gap the parse-failure path had before the JSON-hardening pass.
    // ourTimerFired is known deterministically (our own AbortController's
    // signal), never guessed from error text alone — abortCtrl.signal.
    // aborted is only true if OUR 25s timer actually fired.
    const code = classifyRequestError(e, abortCtrl.signal.aborted)
    console.error('[generate-call-review] request failure', {
      code, errorName: e?.name, errorMessage: e?.message, ourTimerFired: abortCtrl.signal.aborted,
    })
    return new Response(JSON.stringify({ ok: false, code, error: fmtRequestErrorForUser(code) }), { status: 500, headers: HEADERS })
  }
}
