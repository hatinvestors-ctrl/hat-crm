// src/lib/enrichmentResult.js
// Capability — Skip Trace Result Explainability + Contact Intelligence
// Visibility V1.
//
// TWO DELIBERATELY SEPARATE CONCEPTS (Part 3 — the current code never
// conflated these, but nothing named the distinction explicitly):
//   - CONTACT STATUS (getContactStatus(), contactEnrichment.js, unchanged)
//     — what contact info exists on the lead RIGHT NOW.
//   - ENRICHMENT ATTEMPT RESULT (this file) — what happened during ONE
//     specific enrichment action: was BatchData actually called, and why.
// A lead can be CONTACT_READY while its latest attempt was
// SKIPPED_ALREADY_ENRICHED (a later click that correctly didn't re-bill).
// A lead can be NO_MATCH and remain NEEDS_ENRICHMENT.
//
// This module NEVER re-runs or reinterprets classifyPersonMatch()'s
// decision — it only reads the REAL fields netlify/functions/
// batchdata-enrich.mjs's response already contains (skipped/decision/
// reason/lead on the preflight-skip path; ok/uiStatus/skipTraceStatus/
// contactMatchStatus/matchDiagnostics on the real-call path).
import { getContactStatus, fmtContactStatus } from './contactEnrichment.js'

export const ATTEMPT_RESULT = {
  PROVIDER_CALLED_SUCCESS: 'PROVIDER_CALLED_SUCCESS',
  PROVIDER_CALLED_NO_MATCH: 'PROVIDER_CALLED_NO_MATCH',
  SKIPPED_ALREADY_ENRICHED: 'SKIPPED_ALREADY_ENRICHED',
  SKIPPED_EXCLUDED_PROPERTY: 'SKIPPED_EXCLUDED_PROPERTY',
  SKIPPED_RECENT_PROVIDER_FAILURE: 'SKIPPED_RECENT_PROVIDER_FAILURE',
  SKIPPED_LOOKUP_IN_PROGRESS: 'SKIPPED_LOOKUP_IN_PROGRESS',
  SKIPPED_INSUFFICIENT_IDENTITY: 'SKIPPED_INSUFFICIENT_IDENTITY',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  RESPONSE_ERROR: 'RESPONSE_ERROR',
}

const SKIP_DECISION_TO_RESULT = {
  EXCLUDED_PROPERTY: ATTEMPT_RESULT.SKIPPED_EXCLUDED_PROPERTY,
  RECENT_PROVIDER_FAILURE: ATTEMPT_RESULT.SKIPPED_RECENT_PROVIDER_FAILURE,
  LOOKUP_IN_PROGRESS: ATTEMPT_RESULT.SKIPPED_LOOKUP_IN_PROGRESS,
  INSUFFICIENT_IDENTITY: ATTEMPT_RESULT.SKIPPED_INSUFFICIENT_IDENTITY,
  ALREADY_ENRICHED: ATTEMPT_RESULT.SKIPPED_ALREADY_ENRICHED,
}

const PROVIDER_ERROR_TYPES = new Set(['BILLING_ERROR', 'AUTH_ERROR', 'PROVIDER_ERROR', 'NETWORK_ERROR'])

/**
 * @param {object} response - the raw JSON body from POST /.netlify/functions/batchdata-enrich
 * @returns {{ attemptResult: string, providerCalled: boolean, humanReason: string, priorContactStatus: string|null }}
 */
export function getEnrichmentResultExplanation(response) {
  if (!response) {
    return { attemptResult: ATTEMPT_RESULT.RESPONSE_ERROR, providerCalled: 'UNKNOWN', humanReason: 'No response was received from the enrichment service.', priorContactStatus: null }
  }

  if (!response.ok && !response.skipped) {
    return { attemptResult: ATTEMPT_RESULT.RESPONSE_ERROR, providerCalled: 'UNKNOWN', humanReason: response.error || 'The enrichment request failed before a result could be determined.', priorContactStatus: null }
  }

  if (response.skipped) {
    const attemptResult = SKIP_DECISION_TO_RESULT[response.decision] || ATTEMPT_RESULT.RESPONSE_ERROR
    // Part 3/9 — the one real, provable distinction: does the lead THIS
    // skip left untouched already have contact data, or not. The function
    // already returns the pre-attempt `lead` row on every skip.
    const priorContactStatus = response.lead ? getContactStatus(response.lead) : null
    let humanReason
    if (attemptResult === ATTEMPT_RESULT.SKIPPED_ALREADY_ENRICHED) {
      humanReason = priorContactStatus === 'CONTACT_READY'
        ? 'Skipped — contact info was already on file from a prior lookup within the protection window. No new provider request was made.'
        : 'Skipped — this lead was already attempted recently (within the protection window), and that attempt found no safe contact match. No new provider request was made to avoid re-billing.'
    } else {
      humanReason = response.reason || 'Skipped before any provider request was made.'
    }
    return { attemptResult, providerCalled: false, humanReason, priorContactStatus }
  }

  // Real call happened (not skipped) — skipTraceStatus tells us whether
  // the request itself succeeded or failed at the provider level.
  if (PROVIDER_ERROR_TYPES.has(response.skipTraceStatus)) {
    return {
      attemptResult: ATTEMPT_RESULT.PROVIDER_ERROR, providerCalled: true, priorContactStatus: null,
      humanReason: response.skipTraceStatus === 'BILLING_ERROR' || response.skipTraceStatus === 'AUTH_ERROR'
        ? 'Provider request failed — BatchData credits are unavailable, or the account has an authentication problem.'
        : 'Provider request failed due to a temporary provider or network problem.',
    }
  }

  if (response.uiStatus === 'CONTACT READY') {
    return { attemptResult: ATTEMPT_RESULT.PROVIDER_CALLED_SUCCESS, providerCalled: true, priorContactStatus: null, humanReason: 'Provider lookup performed — a safe contact match was found and saved.' }
  }

  // PROVIDER_CALLED_NO_MATCH — covers contactMatchStatus NO_MATCH/AMBIGUOUS.
  // Uses matchDiagnostics (Part 5/8) when present — a small, non-PII,
  // deterministic diagnostic captured going forward. Historical attempts
  // made before this capability never captured it, so this honestly says
  // so rather than guessing.
  const d = response.matchDiagnostics
  let humanReason
  if (!d) {
    humanReason = 'No safe contact match was found. Diagnostic detail is not available for this specific attempt (captured for attempts made after this update).'
  } else if (d.candidatesReturned === 0) {
    humanReason = 'Provider lookup performed — no candidate person was returned for this property.'
  } else if (d.topCandidateHadName === false) {
    humanReason = `Provider lookup performed — ${d.candidatesReturned} candidate(s) returned, but the top candidate had no usable name to match against the owner on record.`
  } else if (d.topCandidateMatchStatus === 'AMBIGUOUS') {
    humanReason = `Provider lookup performed — ${d.candidatesReturned} candidate(s) returned; the closest name only partially overlapped with the owner on record (ambiguous, not safely matched).`
  } else {
    humanReason = `Provider lookup performed — ${d.candidatesReturned} candidate(s) returned, but none could be safely matched to the owner identity on record.`
  }
  return { attemptResult: ATTEMPT_RESULT.PROVIDER_CALLED_NO_MATCH, providerCalled: true, priorContactStatus: null, humanReason }
}

export function fmtAttemptResult(result) {
  switch (result) {
    case ATTEMPT_RESULT.PROVIDER_CALLED_SUCCESS: return 'Contact Found'
    case ATTEMPT_RESULT.PROVIDER_CALLED_NO_MATCH: return 'No Safe Match'
    case ATTEMPT_RESULT.SKIPPED_ALREADY_ENRICHED: return 'Already Enriched (Skipped)'
    case ATTEMPT_RESULT.SKIPPED_EXCLUDED_PROPERTY: return 'Excluded Property (Skipped)'
    case ATTEMPT_RESULT.SKIPPED_RECENT_PROVIDER_FAILURE: return 'Provider Recently Failed (Skipped)'
    case ATTEMPT_RESULT.SKIPPED_LOOKUP_IN_PROGRESS: return 'Lookup In Progress (Skipped)'
    case ATTEMPT_RESULT.SKIPPED_INSUFFICIENT_IDENTITY: return 'Insufficient Identity (Skipped)'
    case ATTEMPT_RESULT.PROVIDER_ERROR: return 'Provider Error'
    default: return 'Unknown Result'
  }
}

// Part 6/7 — Lead Workspace "last attempt" view. Reads the PERSISTED
// lead.enrichment_data shape (not a live API response) — used to show a
// failed/no-match enrichment's status after reload, from whatever
// diagnostic detail was actually captured at the time. Leads enriched
// before this capability's match_diagnostics addition honestly show
// "not available for this historical attempt" rather than a guess.
export function getLastAttemptSummary(lead) {
  const e = lead?.enrichment_data
  if (!e?.contact_enriched_at) return null // never attempted
  if (e.contact_match_status === 'VERIFIED' || e.contact_match_status === 'LIKELY') return null // has contact — no failure state to show

  const d = e.match_diagnostics
  let humanReason
  if (['BILLING_ERROR', 'AUTH_ERROR', 'PROVIDER_ERROR', 'NETWORK_ERROR'].includes(e.skip_trace_status)) {
    humanReason = 'The last provider request failed before a result could be determined.'
  } else if (!d) {
    humanReason = 'No safe contact match was found. Diagnostic detail is not available for this specific attempt (captured for attempts made after this update).'
  } else if (d.candidatesReturned === 0) {
    humanReason = 'Provider lookup performed — no candidate person was returned for this property.'
  } else if (d.topCandidateHadName === false) {
    humanReason = `Provider lookup performed — ${d.candidatesReturned} candidate(s) returned, but the top candidate had no usable name to match against the owner on record.`
  } else if (d.topCandidateMatchStatus === 'AMBIGUOUS') {
    humanReason = `Provider lookup performed — ${d.candidatesReturned} candidate(s) returned; the closest name only partially overlapped with the owner on record (ambiguous, not safely matched).`
  } else {
    humanReason = `Provider lookup performed — ${d.candidatesReturned} candidate(s) returned, but none could be safely matched to the owner identity on record.`
  }

  return {
    attemptedAt: e.contact_enriched_at,
    ownerSearched: lead.owner_name || null,
    humanReason,
  }
}

export { fmtContactStatus }
