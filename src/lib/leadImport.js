// src/lib/leadImport.js
// Universal Lead Import SDK V1 — Capability #6, Cycle 3.
//
// Infrastructure only. Implements the smallest possible foundation from
// the approved Universal Import Discovery report (Universal_Import_Discovery.md
// §8): ONE reusable entry point, importLead(), that every future lead
// source (Zillow, Realtor, Probate, Tax Delinquent, Water Liens, Code
// Violations, Facebook, CSV, APIs, ...) can call after its own
// source-specific Extract + Normalize step.
//
// This does NOT implement any new source. It encapsulates the exact
// workflow already duplicated across LeadForm.jsx, CSVImport.jsx, and
// ScreenerPage.jsx today — nothing here is new business logic, every step
// calls the same existing functions those three already call:
//   normalizeAddressForDB()      — src/lib/leadDedup.js (unchanged)
//   recordPropertyEvent()        — src/lib/propertyIntelligence.js (unchanged, Capability #3)
//   evaluateAndRecordRediscovery() — src/lib/propertyIntelligence.js (unchanged, Capability #4)
//   logLeadCreated()             — src/lib/activityLogger.js (unchanged)
//
// Redfin ingestion (hat-ai-agents) is untouched — it writes directly to
// Supabase via a separate PAT-based path and does not call this module.

import { supabase } from './supabase'
import { normalizeAddressForDB } from './leadDedup'
import { recordPropertyEvent, evaluateAndRecordRediscovery } from './propertyIntelligence'
import { logLeadCreated } from './activityLogger'

// ── NormalizedLead contract ────────────────────────────────────────────
// This is the ONE documented shape every future source's Extract+Normalize
// step must produce before calling importLead(). No runtime validation
// framework, no TypeScript, no Zod — this JSDoc typedef IS the contract.
// Mirrors Universal_Import_Discovery.md §5 field tiers exactly.
//
// @typedef {Object} NormalizedLead
//
// --- Required — importLead() throws without these ---
// @property {string} address        - Street address (city/state/zip separate)
// @property {string} source         - Provenance, e.g. 'redfin', 'zillow', 'csv_import',
//                                      'wholesaler', 'probate', 'tax_delinquent', ... Used
//                                      for Property Intelligence event metadata and activity
//                                      text. Does NOT get written into `lead_source` (see
//                                      below) unless it happens to already be a valid value.
//
// --- Recommended — nullable, but materially improve triage/underwriting quality ---
// @property {string} [city]
// @property {string} [state]
// @property {string} [zip_code]
// @property {number} [asking_price]
// @property {number} [bedrooms]
// @property {number} [bathrooms]
// @property {number} [sqft]
// @property {string} [listing_url]
// @property {string} [listing_agent_name]
// @property {string} [listing_agent_phone]
// @property {string} [listing_agent_email]
// @property {number} [days_on_market]
// @property {string} [mls_status]
//
// --- Optional — many sources (off-market/distressed lists especially) will never have these ---
// @property {string} [seller_name]
// @property {string} [phone]
// @property {string} [email]
// @property {number} [arv]
// @property {number} [renovation_cost]
// @property {number} [mao]
// @property {number} [rent_estimate]
// @property {number} [year_built]
// @property {string} [property_type]
// @property {string} [notes]
// @property {string} [zillow_url]
// @property {string} [lead_source] - MUST be one of the existing LEAD_SOURCES values
//                                    (src/lib/constants.js) — this column is DB-constrained,
//                                    unlike `source` above. Omit it and importLead() safely
//                                    defaults to 'other'.
//
// Any other existing `leads` column may also be included and is passed
// through to the insert as-is (e.g. `hoa_info`-style extras a source wants
// to carry, once a matching column exists) — importLead() does not
// enumerate or restrict extra fields.

// ── ImportLeadOptions ───────────────────────────────────────────────────
// @typedef {Object} ImportLeadOptions
// @property {string} workspaceId    - required
// @property {string} [userId]       - for activity logging; omit for unattended/automated imports
// @property {string} [status]       - defaults to 'new_lead'
// @property {Object} [defaults]     - extra column defaults merged in before insert
//                                     (e.g. { closing_costs, target_profit })

// ── ImportLeadResult ─────────────────────────────────────────────────────
// @typedef {Object} ImportLeadResult
// @property {boolean} created       - true if a new lead row was inserted
// @property {string|null} leadId    - the lead id (new or the pre-existing duplicate's)
// @property {'created'|'duplicate'} status
// @property {string|null} propertyId
// @property {Object} [lead]         - the full inserted row, when created

/**
 * THE single reusable entry point for creating a lead in HatCRM, regardless
 * of source. Encapsulates: validate required fields → normalize address →
 * duplicate detection → insert → Property Intelligence event → Rediscovery
 * evaluation → activity logging. Every one of those steps reuses the exact
 * existing function already relied on elsewhere — nothing is reimplemented.
 *
 * @param {NormalizedLead} normalizedLead
 * @param {ImportLeadOptions} options
 * @returns {Promise<ImportLeadResult>}
 */
export async function importLead(normalizedLead, options) {
  const { workspaceId, userId = null, status = 'new_lead', defaults = {} } = options || {}

  // 1. Validate minimum required fields.
  if (!workspaceId) throw new Error('importLead: workspaceId is required')
  if (!normalizedLead?.address?.trim()) throw new Error('importLead: address is required')
  if (!normalizedLead?.source) throw new Error('importLead: source is required')

  // 2. Normalize address (reuses the exact same normalization the DB's own
  //    unique index and every existing dedup check already use).
  const normalizedAddress = normalizeAddressForDB(normalizedLead.address)

  // 3. Duplicate detection — same workspace-scoped address check
  //    LeadForm/CSVImport/ScreenerPage each already perform independently.
  const { data: existingLeads } = await supabase
    .from('leads')
    .select('id, address')
    .eq('workspace_id', workspaceId)
  const duplicate = (existingLeads || []).find(l => normalizeAddressForDB(l.address) === normalizedAddress)

  if (duplicate) {
    // Property Intelligence + Rediscovery: the property already exists —
    // append an event and re-evaluate rather than silently dropping the
    // attempt or losing history (Capability #3/#4 behavior, reused as-is).
    const propertyId = await recordPropertyEvent({
      workspaceId,
      addressFields: normalizedLead,
      leadId: duplicate.id,
      type: 'duplicate_attempt',
      content: `Import attempted for an address that already exists (source: ${normalizedLead.source})`,
      metadata: { source: normalizedLead.source },
    })
    await evaluateAndRecordRediscovery({
      workspaceId,
      leadId: duplicate.id,
      snapshot: {
        askingPrice: normalizedLead.asking_price ?? null,
        score: null,
        verdict: null,
        priority: null,
        mao: normalizedLead.mao ?? null,
        profit: null,
      },
    })
    return { created: false, leadId: duplicate.id, status: 'duplicate', propertyId }
  }

  // 4. Create the lead. Every NormalizedLead field passes straight through
  //    onto the existing `leads` columns — the same shape LeadForm.jsx,
  //    CSVImport.jsx, and ScreenerPage.jsx already write today.
  const { source, lead_source, ...rest } = normalizedLead
  const payload = {
    ...defaults,
    ...rest,
    workspace_id: workspaceId,
    created_by: userId,
    // IMPORTANT (found during verification, corrects the Discovery report):
    // `lead_source` is DB-constrained by a CHECK to the exact existing
    // LEAD_SOURCES enum (src/lib/constants.js) — NOT free text, and NOT
    // even 'zillow_auto' despite hat-ai-agents docs describing it as
    // already working. `source` (provenance, e.g. 'redfin'/'csv_import'/
    // 'probate') is NEVER written into this constrained column unless the
    // caller explicitly passes a valid `lead_source`; it only flows into
    // Property Intelligence metadata / activity text. Default is the
    // always-valid 'other' so importLead() never breaks for a source whose
    // name isn't in the enum yet. Widening the enum (or dropping the
    // constraint) is a follow-up migration decision, not part of this
    // infrastructure-only capability.
    lead_source: lead_source || 'other',
    status,
  }

  const { data: created, error: insErr } = await supabase
    .from('leads')
    .insert(payload)
    .select()
    .single()

  if (insErr) {
    if (insErr.code === '23505') {
      // Race: another insert won between our dedup check and this insert —
      // treat exactly like a normal duplicate, don't fail the caller.
      const propertyId = await recordPropertyEvent({
        workspaceId, addressFields: normalizedLead, type: 'duplicate_attempt',
        content: `Import race — address already exists (source: ${normalizedLead.source})`,
        metadata: { source: normalizedLead.source },
      })
      return { created: false, leadId: null, status: 'duplicate', propertyId }
    }
    throw insErr
  }

  // 5. Activity log — same helper LeadForm.jsx already calls.
  if (userId) {
    await logLeadCreated(created.id, userId)
  }

  // 6. Property Intelligence — find/create the Property record, append
  //    the first event.
  const propertyId = await recordPropertyEvent({
    workspaceId,
    addressFields: created,
    leadId: created.id,
    type: 'lead_created',
    content: `Lead created via ${normalizedLead.source}`,
    metadata: { source: normalizedLead.source },
  })

  // 7. Rediscovery — seed the baseline snapshot for this property so a
  //    future re-encounter has something to compare against. No prior
  //    snapshot exists yet, so this always evaluates to UNCHANGED; it just
  //    stores today's numbers.
  await evaluateAndRecordRediscovery({
    workspaceId,
    leadId: created.id,
    snapshot: {
      askingPrice: created.asking_price ?? null,
      score: null,
      verdict: null,
      priority: null,
      mao: created.mao ?? null,
      profit: null,
    },
  })

  return { created: true, leadId: created.id, status: 'created', propertyId, lead: created }
}
