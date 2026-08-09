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
