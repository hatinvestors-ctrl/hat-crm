// src/lib/propertyIntelligence.js
// Property Intelligence Engine V1 — Capability #3, Cycle 2.
//
// Business goal: the same physical property should never become two
// isolated opportunities. When a lead is created — or re-attempted for an
// address that already exists — find or create ONE `properties` record for
// that address in this workspace and append an event to it. Prior history
// is never lost or overwritten.
//
// MVP scope only: no Timeline UI, no architecture change. This is a
// best-effort side effect called from existing lead-creation code paths —
// it never throws into the caller and never changes what the user sees or
// blocks Kevin's existing workflow.

import { supabase } from './supabase'
import { normalizeAddressForDB } from './leadDedup'

/**
 * Finds or creates the Property record for an address and appends an event
 * to its history. Safe to call from anywhere leads are created or a
 * duplicate address is encountered — never throws, only logs on failure.
 *
 * @param {object} params
 * @param {string} params.workspaceId
 * @param {{address: string, city?: string, state?: string, zip_code?: string}} params.addressFields
 * @param {string|null} [params.leadId] - the lead row this event relates to, if any
 * @param {string} params.type - e.g. 'lead_created' | 'duplicate_attempt' | 'lead_reencountered'
 * @param {string} [params.content] - short human-readable event description
 * @param {object} [params.metadata]
 * @returns {Promise<string|null>} the property id, or null on failure
 */
export async function recordPropertyEvent({ workspaceId, addressFields, leadId = null, type, content = '', metadata = {} }) {
  try {
    if (!workspaceId || !addressFields?.address || !type) return null
    const normalized = normalizeAddressForDB(addressFields.address)
    if (!normalized) return null

    const { data: existing, error: findErr } = await supabase
      .from('properties')
      .select('id, event_count')
      .eq('workspace_id', workspaceId)
      .eq('normalized_address', normalized)
      .maybeSingle()
    if (findErr) throw findErr

    let propertyId = existing?.id

    if (propertyId) {
      // Property already exists — append the event below. Never overwrite
      // or delete anything already on the record; only extend it.
      await supabase
        .from('properties')
        .update({
          last_seen_at: new Date().toISOString(),
          event_count: (existing.event_count || 0) + 1,
          updated_at: new Date().toISOString(),
          ...(leadId ? { current_lead_id: leadId } : {}),
        })
        .eq('id', propertyId)
    } else {
      // First time this address has been seen in this workspace.
      const { data: created, error: insErr } = await supabase
        .from('properties')
        .insert({
          workspace_id: workspaceId,
          normalized_address: normalized,
          address: addressFields.address,
          city: addressFields.city ?? null,
          state: addressFields.state ?? null,
          zip_code: addressFields.zip_code ?? null,
          current_lead_id: leadId,
          event_count: 1,
        })
        .select('id')
        .single()
      if (insErr) {
        // Concurrent create race — someone else just created this property;
        // fetch it instead of failing the whole call.
        if (insErr.code === '23505') {
          const { data: raceExisting } = await supabase
            .from('properties')
            .select('id')
            .eq('workspace_id', workspaceId)
            .eq('normalized_address', normalized)
            .maybeSingle()
          propertyId = raceExisting?.id
          if (!propertyId) throw insErr
        } else {
          throw insErr
        }
      } else {
        propertyId = created.id
      }
    }

    await supabase.from('property_events').insert({
      workspace_id: workspaceId,
      property_id: propertyId,
      lead_id: leadId,
      type,
      content,
      metadata,
    })

    return propertyId
  } catch (err) {
    // Property Intelligence is a side effect, never a blocker for the
    // existing lead-creation flow it's called from.
    console.warn('[property-intelligence] non-fatal error:', err)
    return null
  }
}

// ── Opportunity Rediscovery Engine V1 — Capability #4, Cycle 2 ─────────────
// Reuses Capability #3's `properties` row (no new Property model) and
// whatever deal numbers the caller already has on hand (asking price, the
// already-parsed AI score/verdict, MAO, profit) — no AI call, no new
// calculation, only comparisons of numbers that already exist.

const ACTIONABLE_PRIORITIES = new Set(['HOT', 'TODAY'])
const DORMANT_PRIORITIES = new Set(['WATCH', 'IGNORE'])

/**
 * Pure comparison — no I/O. Given the property's previous evaluated
 * snapshot and the current one, decides UNCHANGED / IMPROVED / DECLINED /
 * REVIEW AGAIN and a single human-readable reason. Every field is optional;
 * missing data on either side simply skips that comparison.
 *
 * @param {object|null} prev - { askingPrice, score, verdict, priority, mao, profit }
 * @param {object} curr - same shape
 */
export function evaluateRediscovery(prev, curr) {
  if (!prev) return { status: 'UNCHANGED', reason: null }

  // 1. Crossed from dormant (WATCH/IGNORE) into an actionable tier —
  //    this is the "deserves another look" case, highest priority signal.
  if (DORMANT_PRIORITIES.has(prev.priority) && ACTIONABLE_PRIORITIES.has(curr.priority)) {
    const was = prev.priority === 'IGNORE' ? 'ignored' : 'on watch'
    return { status: 'REVIEW AGAIN', reason: `Previously ${was}, now meets review criteria.` }
  }

  // 2. Deal score moved meaningfully (AI's own existing 0-100 score).
  if (prev.score != null && curr.score != null && curr.score !== prev.score) {
    if (curr.score - prev.score >= 5) {
      return { status: 'IMPROVED', reason: `Deal score increased from ${prev.score} to ${curr.score}.` }
    }
    if (prev.score - curr.score >= 5) {
      return { status: 'DECLINED', reason: `Deal score dropped from ${prev.score} to ${curr.score}.` }
    }
  }

  // 3. Asking price moved.
  if (prev.askingPrice != null && curr.askingPrice != null && curr.askingPrice !== prev.askingPrice) {
    if (curr.askingPrice < prev.askingPrice) {
      return { status: 'IMPROVED', reason: `Price dropped since last evaluation ($${prev.askingPrice.toLocaleString()} → $${curr.askingPrice.toLocaleString()}).` }
    }
    return { status: 'DECLINED', reason: `Price increased since last evaluation ($${prev.askingPrice.toLocaleString()} → $${curr.askingPrice.toLocaleString()}).` }
  }

  // 4. Estimated profit moved (existing deal_analysis.profit, not recomputed).
  if (prev.profit != null && curr.profit != null && curr.profit !== prev.profit) {
    return curr.profit > prev.profit
      ? { status: 'IMPROVED', reason: 'Estimated profit increased since last evaluation.' }
      : { status: 'DECLINED', reason: 'Estimated profit decreased since last evaluation.' }
  }

  // 5. Gap to MAO (ask − MAO) narrowed or widened — "better MAO relationship".
  if (prev.askingPrice != null && prev.mao != null && curr.askingPrice != null && curr.mao != null) {
    const prevGap = prev.askingPrice - prev.mao
    const currGap = curr.askingPrice - curr.mao
    if (currGap < prevGap) return { status: 'IMPROVED', reason: 'Price is now closer to our Maximum Offer.' }
    if (currGap > prevGap) return { status: 'DECLINED', reason: 'Price moved further from our Maximum Offer.' }
  }

  // 6. Priority tier itself moved without tripping rule 1 (e.g. downgraded
  //    out of an actionable tier — still worth flagging as declined).
  if (ACTIONABLE_PRIORITIES.has(prev.priority) && DORMANT_PRIORITIES.has(curr.priority)) {
    return { status: 'DECLINED', reason: 'No longer meets the criteria that made this worth acting on.' }
  }

  return { status: 'UNCHANGED', reason: null }
}

const REDISCOVERY_EVENT_TYPE = {
  'REVIEW AGAIN': 'rediscovered',
  'IMPROVED': 'analysis_improved', // overridden to price_improved/score_improved below when clear
}

/**
 * Finds the property already linked to this lead (via Capability #3),
 * compares its last evaluated snapshot to the current one, persists the
 * result, and — only for IMPROVED / REVIEW AGAIN — appends a Property
 * Event. Never throws; returns null on any failure or if no property row
 * exists yet for this lead (e.g. migration not applied, or lead predates
 * Property Intelligence).
 *
 * @param {object} params
 * @param {string} params.workspaceId
 * @param {string} params.leadId
 * @param {object} params.snapshot - { askingPrice, score, verdict, priority, mao, profit }
 * @returns {Promise<{status: string, reason: string|null}|null>}
 */
export async function evaluateAndRecordRediscovery({ workspaceId, leadId, snapshot }) {
  try {
    if (!workspaceId || !leadId) return null
    const { data: property, error: findErr } = await supabase
      .from('properties')
      .select('id, last_snapshot, last_rediscovery_status')
      .eq('workspace_id', workspaceId)
      .eq('current_lead_id', leadId)
      .maybeSingle()
    if (findErr) throw findErr
    if (!property) return null // no Capability #3 property row for this lead yet

    const { status, reason } = evaluateRediscovery(property.last_snapshot, snapshot)

    await supabase
      .from('properties')
      .update({
        last_snapshot: snapshot,
        last_rediscovery_status: status,
        last_rediscovery_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', property.id)

    if (status === 'IMPROVED' || status === 'REVIEW AGAIN') {
      let type = REDISCOVERY_EVENT_TYPE[status] || 'rediscovered'
      if (status === 'IMPROVED' && reason?.toLowerCase().includes('price')) type = 'price_improved'
      else if (status === 'IMPROVED' && reason?.toLowerCase().includes('score')) type = 'score_improved'
      await supabase.from('property_events').insert({
        workspace_id: workspaceId,
        property_id: property.id,
        lead_id: leadId,
        type,
        content: reason,
        metadata: { status, previousSnapshot: property.last_snapshot, currentSnapshot: snapshot },
      })
    }

    return { status, reason }
  } catch (err) {
    console.warn('[property-intelligence] rediscovery evaluation non-fatal error:', err)
    return null
  }
}

/**
 * Lightweight read for the Lead Detail banner — no evaluation, just returns
 * whatever the last evaluateAndRecordRediscovery() run persisted.
 */
export async function fetchRediscoveryStatus({ workspaceId, leadId }) {
  try {
    if (!workspaceId || !leadId) return null
    const { data, error } = await supabase
      .from('properties')
      .select('last_rediscovery_status, last_rediscovery_reason')
      .eq('workspace_id', workspaceId)
      .eq('current_lead_id', leadId)
      .maybeSingle()
    if (error) throw error
    if (!data?.last_rediscovery_status) return null
    return { status: data.last_rediscovery_status, reason: data.last_rediscovery_reason }
  } catch (err) {
    console.warn('[property-intelligence] fetchRediscoveryStatus non-fatal error:', err)
    return null
  }
}
