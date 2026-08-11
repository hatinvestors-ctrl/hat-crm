// src/lib/batchDataHealth.js
// Capability #10.5 — derives BatchData provider health from recent stored
// call outcomes (enrichment_data.skip_trace_status/property_lookup_status
// across the most recently enriched leads) — no new table, no billable
// "health check" call (BatchData has no free/non-billable endpoint we
// could find; a real skip-trace/property-lookup is the only confirmed
// live signal, and spending money just to check health would defeat the
// purpose of this capability).

import { HEALTH_SAMPLE_SIZE } from './batchDataConfig.js'

/**
 * @typedef {'HEALTHY'|'AUTH_FAILURE'|'NO_BALANCE'|'DEGRADED'|'UNKNOWN'} ProviderHealth
 */

/**
 * @param {Array<{enrichment_data: object}>} recentLeads - most-recently-enriched leads, already sorted newest first, capped by caller
 * @returns {{health: ProviderHealth, sample_size: number, reason: string}}
 */
export function deriveBatchDataHealth(recentLeads) {
  const sample = (recentLeads || []).slice(0, HEALTH_SAMPLE_SIZE)
  if (sample.length === 0) return { health: 'UNKNOWN', sample_size: 0, reason: 'No recent BatchData attempts on record' }

  const statuses = sample.map(l => l.enrichment_data?.skip_trace_status || l.enrichment_data?.property_lookup_status).filter(Boolean)
  if (statuses.length === 0) return { health: 'UNKNOWN', sample_size: sample.length, reason: 'No status recorded on recent attempts' }

  const mostRecent = statuses[0]
  if (mostRecent === 'BILLING_ERROR') return { health: 'NO_BALANCE', sample_size: statuses.length, reason: 'Most recent attempt failed with BILLING_ERROR' }
  if (mostRecent === 'AUTH_ERROR') return { health: 'AUTH_FAILURE', sample_size: statuses.length, reason: 'Most recent attempt failed with AUTH_ERROR' }

  const errorCount = statuses.filter(s => s === 'BILLING_ERROR' || s === 'AUTH_ERROR' || s === 'PROVIDER_ERROR' || s === 'NETWORK_ERROR').length
  const errorRate = errorCount / statuses.length
  if (errorRate >= 0.5) return { health: 'DEGRADED', sample_size: statuses.length, reason: `${errorCount}/${statuses.length} of recent attempts errored` }

  return { health: 'HEALTHY', sample_size: statuses.length, reason: `${statuses.length - errorCount}/${statuses.length} of recent attempts succeeded` }
}

// User-facing translation (mission Section 15 — never show raw HTTP/error codes).
export function fmtProviderHealthForUser(health) {
  switch (health) {
    case 'HEALTHY': return null // nothing to show — normal operation
    case 'NO_BALANCE':
    case 'AUTH_FAILURE':
    case 'DEGRADED':
      return 'ENRICHMENT TEMPORARILY UNAVAILABLE'
    default:
      return null
  }
}
