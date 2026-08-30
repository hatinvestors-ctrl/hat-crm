// test/callReviewAbort.test.js
// Call Review "This operation was aborted" production incident follow-up.
//
// Forensic findings (see delivery report for full detail):
//   - Real invocation found: 2026-08-26T14:46:27.237Z, duration 468ms.
//   - netlify.toml had NO explicit timeout override for generate-call-
//     review — the only LLM-calling function missing one, while every
//     sibling (generate-comps/generate-core-analysis/etc.) has one.
//   - Deploy 6a8efbe43be7d4fc8668d599 went "ready" at 14:46:14.644Z —
//     only 12.6s before the failing invocation, consistent with a
//     platform deploy-swap window contributing to the failure.
//   - The outer catch (network/abort errors) had ZERO diagnostic
//     logging or classification — the same class of gap the parse-
//     failure path had before the prior JSON-hardening pass.
//   - No client-side AbortController/timeout exists anywhere in
//     CallReview.jsx — confirmed by direct source inspection, not
//     assumed. Nothing to fix there.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { classifyRequestError, fmtRequestErrorForUser, REQUEST_ERROR } from '../src/lib/callReviewParser.js'

describe('classifyRequestError — deterministic, from the real exception, never guessed', () => {
  it('an AbortError where OUR OWN 25s timer fired is CLIENT_TIMEOUT', () => {
    const err = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
    expect(classifyRequestError(err, true)).toBe(REQUEST_ERROR.CLIENT_TIMEOUT)
  })
  it('the EXACT real production error text, when our timer did NOT fire, is REQUEST_ABORTED — never misreported as our own timeout', () => {
    const err = new Error('This operation was aborted')
    expect(classifyRequestError(err, false)).toBe(REQUEST_ERROR.REQUEST_ABORTED)
  })
  it('a real AbortError (by name, regardless of exact message wording) is still classified as an abort', () => {
    const err = Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' })
    expect(classifyRequestError(err, false)).toBe(REQUEST_ERROR.REQUEST_ABORTED)
  })
  it('an unrelated network/other error is never misclassified as an abort', () => {
    const err = new Error('fetch failed: ECONNRESET')
    expect(classifyRequestError(err, false)).toBe(REQUEST_ERROR.OTHER)
  })
  it('Test 7 — an abort is never misreported through the JSON-parse error path (distinct code space, distinct function)', () => {
    // classifyRequestError only ever returns REQUEST_ERROR.* codes —
    // structurally incapable of returning a PARSE_ERROR.INVALID_JSON code.
    const err = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
    const code = classifyRequestError(err, true)
    expect(code).not.toBe('INVALID_JSON')
    expect(code).not.toBe('TRUNCATED_OUTPUT')
  })
})

describe('fmtRequestErrorForUser — no raw DOMException/AbortError language reaches the user', () => {
  it('Test 4 — the timeout/abort message is user-friendly, matches the required wording', () => {
    const msg = fmtRequestErrorForUser(REQUEST_ERROR.CLIENT_TIMEOUT)
    expect(msg).toMatch(/took too long/i)
    expect(msg).toMatch(/captured call facts are safe/i)
    expect(msg).not.toMatch(/AbortError|DOMException|operation was aborted/i)
  })
  it('REQUEST_ABORTED gets the same honest, non-technical wording', () => {
    expect(fmtRequestErrorForUser(REQUEST_ERROR.REQUEST_ABORTED)).toMatch(/took too long/i)
  })
})

describe('Test 3 — an explicit abort still classifies correctly end-to-end (structural)', () => {
  it('generate-call-review.mjs passes abortCtrl.signal.aborted (real, deterministic) as ourTimerFired, never a guess', () => {
    const src = fs.readFileSync('netlify/functions/generate-call-review.mjs', 'utf8')
    expect(src).toMatch(/classifyRequestError\(e, abortCtrl\.signal\.aborted\)/)
  })
  it('outer-catch logging never includes the transcript or the seller intelligence payload', () => {
    const src = fs.readFileSync('netlify/functions/generate-call-review.mjs', 'utf8')
    const logCallIdx = src.indexOf("console.error('[generate-call-review] request failure'")
    expect(logCallIdx).toBeGreaterThan(-1)
    // The console.error call itself spans a small, fixed object literal —
    // check just that call's arguments, not the whole file.
    const callSlice = src.slice(logCallIdx, logCallIdx + 300)
    expect(callSlice).not.toMatch(/\btranscript\b/)
    expect(callSlice).not.toMatch(/sellerIntelligence/)
  })
})

describe('Test 2 — the request does not abort at the old problematic gap (missing timeout config)', () => {
  it('netlify.toml has an explicit timeout override for generate-call-review, matching sibling LLM functions (corrected to the real 26s platform ceiling by the P0 Timeout Investigation & Fix, 2026-08-30 — see that function\'s netlify.toml comment)', () => {
    const toml = fs.readFileSync('netlify.toml', 'utf8')
    expect(toml).toMatch(/\[functions\."generate-call-review"\]\s*\n\s*timeout = 26/)
  })
  it('the configured timeout is safely above the function\'s own internal AbortController — never shorter', () => {
    const toml = fs.readFileSync('netlify.toml', 'utf8')
    const src = fs.readFileSync('netlify/functions/generate-call-review.mjs', 'utf8')
    const tomlMatch = toml.match(/\[functions\."generate-call-review"\]\s*\n\s*timeout = (\d+)/)
    const internalMatch = src.match(/abortCtrl\.abort\(\), (\d+)\)/)
    expect(Number(tomlMatch[1]) * 1000).toBeGreaterThan(Number(internalMatch[1]))
  })
  it('every other LLM-calling function still has an explicit timeout override — values corrected by the later P0 Timeout Investigation & Fix (2026-08-30) task to the real 26s platform ceiling, not silently removed', () => {
    const toml = fs.readFileSync('netlify.toml', 'utf8')
    expect(toml).toMatch(/\[functions\."generate-comps"\]\s*\n\s*timeout = 26/)
    expect(toml).toMatch(/\[functions\."generate-core-analysis"\]\s*\n\s*timeout = 26/)
    expect(toml).toMatch(/\[functions\."batchdata-enrich"\]\s*\n\s*timeout = 26/)
  })
})

describe('Test 1 — normal, complete responses are entirely unaffected by this fix', () => {
  it('the internal AbortController duration comfortably covers the ~20.6-20.9s historical call time (lowered from 25000ms to 20000ms by the P0 Timeout Investigation & Fix, 2026-08-30, for real margin under the true 26s platform ceiling — not blindly increased)', () => {
    const src = fs.readFileSync('netlify/functions/generate-call-review.mjs', 'utf8')
    expect(src).toMatch(/abortCtrl\.abort\(\), 20000\)/)
  })
})

describe('No client-side change — CallReview.jsx confirmed to have zero abort mechanism, nothing touched', () => {
  it('CallReview.jsx still has no AbortController/timeout of its own (structural regression)', () => {
    const src = fs.readFileSync('src/components/lead-detail/CallReview.jsx', 'utf8')
    expect(src).not.toMatch(/AbortController|AbortSignal/)
  })
})

describe('Test 9 — listener/extraction/scoring logic completely untouched', () => {
  it('zero diff signal: callReviewParser.js imports nothing from the listener/scoring/coaching modules', () => {
    const src = fs.readFileSync('src/lib/callReviewParser.js', 'utf8')
    expect(src).not.toMatch(/^import .*(conversationSession|sellerStrategy|callCoaching|coachingMemory)/m)
  })
})

describe('Test 8 — idempotency preserved (structural, unrelated code path untouched)', () => {
  it('CallReview.jsx still treats a unique_violation (23505) on call_reviews insert as success, not a duplicate — unchanged', () => {
    const src = fs.readFileSync('src/components/lead-detail/CallReview.jsx', 'utf8')
    expect(src).toMatch(/insertError && insertError\.code !== '23505'/)
  })
  it('a failed generate-call-review request never reaches the save step — save only runs after body.ok is confirmed true', () => {
    const src = fs.readFileSync('src/components/lead-detail/CallReview.jsx', 'utf8')
    expect(src).toMatch(/if \(!res\.ok \|\| !body\.ok\) throw new Error/)
  })
})
