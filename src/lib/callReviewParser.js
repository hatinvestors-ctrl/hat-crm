// src/lib/callReviewParser.js
// Capability — Call Review JSON Hardening (production bug fix). Pure,
// deterministic AI-response parsing extracted from netlify/functions/
// generate-call-review.mjs so it's directly unit-testable without a live
// Anthropic call. Does NOT touch the scoring rubric, the prompt contract,
// Live Copilot extraction, or coaching validation — this module only
// turns a raw provider response into either a parsed JSON object or a
// specific, honest failure code. Schema validation stays client-side
// (callCoaching.js/coachingMemory.js), unchanged.

export const PARSE_ERROR = {
  TRUNCATED_OUTPUT: 'TRUNCATED_OUTPUT',
  NO_JSON_FOUND: 'NO_JSON_FOUND',
  INVALID_JSON: 'INVALID_JSON',
  EMPTY_RESPONSE: 'EMPTY_RESPONSE',
}

/**
 * Scans forward from the first '{' counting brace depth, correctly
 * ignoring braces that appear inside quoted strings (so a coaching quote
 * like "she said \"that's fine\"" never confuses the scanner) — a real
 * improvement over a greedy regex, which has no notion of string context
 * and can also never distinguish "no closing brace at all" (truncated)
 * from "a closing brace exists somewhere unrelated."
 *
 * @returns {{ json: string, complete: boolean }} complete=false means the
 *   input ended before every opened brace was closed — i.e. truncated.
 */
export function extractBalancedJson(text) {
  const start = text.indexOf('{')
  if (start === -1) return { json: null, complete: false }

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') { inString = true; continue }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return { json: text.slice(start, i + 1), complete: true }
    }
  }
  // Ran off the end of the string with braces still open — genuinely
  // truncated mid-object, not a formatting quirk.
  return { json: text.slice(start), complete: false }
}

/**
 * @param {string} continuation - the raw text portion of the provider
 *   response (the assistant turn is prefilled with "{", so this is
 *   everything the model generated AFTER that seed character — the "{"
 *   itself must be re-added by the caller before this function runs, same
 *   as the pre-existing behavior).
 * @param {string} stopReason - the provider's own stop_reason field
 * @returns {{ ok: true, review: object } | { ok: false, code: string, detail: string }}
 */
export function parseCallReviewResponse(continuation, stopReason) {
  if (!continuation || !continuation.trim()) {
    return { ok: false, code: PARSE_ERROR.EMPTY_RESPONSE, detail: 'The model returned no content.' }
  }

  const cleaned = continuation.replace(/```json\s*|```/g, '').trim()
  const { json, complete } = extractBalancedJson(cleaned)

  if (!json) {
    return { ok: false, code: PARSE_ERROR.NO_JSON_FOUND, detail: 'No JSON object was found in the response.' }
  }

  // Part 3 — truncation must be treated as incomplete output, never
  // silently parsed/accepted. Two independent signals, checked together:
  // the provider's own stop_reason (authoritative when present) and our
  // own brace-balance scan (catches truncation even if stop_reason is
  // missing/unreliable in a given SDK response shape).
  if (stopReason === 'max_tokens' || !complete) {
    return {
      ok: false,
      code: PARSE_ERROR.TRUNCATED_OUTPUT,
      detail: stopReason === 'max_tokens'
        ? 'The model response was cut off (max_tokens reached) before the JSON was complete.'
        : 'The JSON object was not closed before the response ended — likely truncated.',
    }
  }

  try {
    const review = JSON.parse(json)
    return { ok: true, review }
  } catch (e) {
    return { ok: false, code: PARSE_ERROR.INVALID_JSON, detail: e.message }
  }
}

// User-facing message (Kevin never sees a raw parser error/stop_reason).
// Short by design — CallReview.jsx (the only caller) already appends its
// own "— coverage above and manually logged facts are still fully
// usable." suffix; duplicating that here would double it up on screen.
export function fmtParseErrorForUser(code) {
  switch (code) {
    case PARSE_ERROR.TRUNCATED_OUTPUT:
      return 'Call review response was cut off before it finished. Try again.'
    case PARSE_ERROR.EMPTY_RESPONSE:
    case PARSE_ERROR.NO_JSON_FOUND:
      return 'Call review response was empty. Try again.'
    default:
      return 'Call review response was not valid JSON.'
  }
}
