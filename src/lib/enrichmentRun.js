// src/lib/enrichmentRun.js
// Capability — Off-Market Contact Enrichment V1. A thin CLIENT-SIDE
// orchestrator over the EXISTING single-lead netlify/functions/
// batchdata-enrich.mjs endpoint — no new backend function, no duplicated
// BatchData/preflight/dedupe/wrong-unit logic. Calls the same endpoint
// exactly once per selected lead, strictly SEQUENTIALLY (concurrency=1 —
// "a safe bounded sequence", never parallel/uncontrolled paid requests).
// A paid request only ever happens from runContactEnrichmentBatch(), which
// is only ever invoked after the user has confirmed the cost modal — no
// other code path in this file calls the network.
import { supabase } from './supabase'

export const ENRICHMENT_STAGES = ['PENDING', 'RUNNING', 'CONTACT FOUND', 'NO MATCH', 'ALREADY ENRICHED', 'ERROR']

// One real HTTP call to the EXISTING, already-certified single-lead
// endpoint — same auth pattern every other authenticated function call in
// this codebase uses (supabase.auth.getSession() -> Bearer token).
async function enrichOneLead(leadId) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/.netlify/functions/batchdata-enrich', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify({ lead_id: leadId }),
  })
  const data = await res.json().catch(() => null)
  if (!data) return { leadId, outcome: 'ERROR', error: 'Invalid response from enrichment service' }
  if (!data.ok) return { leadId, outcome: 'ERROR', error: data.error || 'Enrichment failed' }
  if (data.skipped) {
    // batchdata-enrich.mjs's own pre-flight gate declined the call — this
    // is NOT a failure, it's the existing #10.5 protection working
    // (ALREADY_ENRICHED / EXCLUDED_PROPERTY / RECENT_PROVIDER_FAILURE /
    // LOOKUP_IN_PROGRESS / INSUFFICIENT_IDENTITY).
    if (data.decision === 'ALREADY_ENRICHED') return { leadId, outcome: 'ALREADY ENRICHED', reason: data.reason }
    return { leadId, outcome: 'ERROR', error: data.reason || data.decision }
  }
  if (data.uiStatus === 'CONTACT READY') return { leadId, outcome: 'CONTACT FOUND', phoneFound: !!data.phoneFound, emailFound: !!data.emailFound }
  if (data.uiStatus === 'ENRICHMENT TEMPORARILY UNAVAILABLE') return { leadId, outcome: 'ERROR', error: 'Provider temporarily unavailable — see credits/health status.' }
  return { leadId, outcome: 'NO MATCH' }
}

/**
 * Runs enrichment for every leadId, strictly sequentially. onProgress is
 * called after each lead finishes with the full results-so-far array, so
 * the caller can render real per-lead status — never a fabricated
 * percentage (this loop's own real position IS the only true progress
 * signal available, and even that isn't shown as a % bar, just a count).
 */
export async function runContactEnrichmentBatch(leadIds, { onProgress } = {}) {
  const results = []
  for (const leadId of leadIds) {
    let result
    try {
      result = await enrichOneLead(leadId)
    } catch (err) {
      result = { leadId, outcome: 'ERROR', error: err.message || 'Network error' }
    }
    results.push(result)
    onProgress?.([...results])
    // Depleted-credit safety (mission Section 13): once BatchData itself
    // reports the account has no balance, stop the run rather than burning
    // through the rest of the queue on requests we already know will fail
    // — every already-completed lead's result is preserved as-is.
    if (result.outcome === 'ERROR' && /provider temporarily unavailable/i.test(result.error || '')) {
      const remaining = leadIds.slice(results.length).map(id => ({ leadId: id, outcome: 'ERROR', error: 'Skipped — provider unavailable' }))
      results.push(...remaining)
      onProgress?.([...results])
      break
    }
  }
  return results
}

// Pure — the exact real-counts-only result summary (Section 8). No
// invented stage percentages, no field not derived from the results array.
export function summarizeEnrichmentResults(results) {
  const summary = {
    total: results.length,
    contactReady: 0, noMatch: 0, alreadyEnriched: 0, errors: 0,
    phonesFound: 0, emailsFound: 0,
  }
  for (const r of results) {
    if (r.outcome === 'CONTACT FOUND') {
      summary.contactReady++
      if (r.phoneFound) summary.phonesFound++
      if (r.emailFound) summary.emailsFound++
    } else if (r.outcome === 'NO MATCH') summary.noMatch++
    else if (r.outcome === 'ALREADY ENRICHED') summary.alreadyEnriched++
    else if (r.outcome === 'ERROR') summary.errors++
  }
  return summary
}
